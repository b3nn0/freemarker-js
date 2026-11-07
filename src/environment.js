// Render-time state; no module-global mutable state (all of it lives here).

import {
  TemplateException, InvalidReferenceException,
  NonStringException, NonStringOrTemplateOutputException, NonNumericalException, NonBooleanException, NonHashException,
  BreakInstructionException, ContinueInstructionException, ReturnInstructionException,
  InvalidSettingException,
} from './errors.js';
import { formatNumber } from './format/numberFormat.js';
import { formatDate } from './format/dateFormat.js';
import { Decimal } from './format/decimal.js';
import { StringModel, NumberModel, BooleanModel, DateModel, MarkupModel } from './model/models.js';
import { TemplateSequenceModel, TemplateHashModel, TemplateHashModelEx, TemplateMethodModel } from './model/templateModel.js';
import { MethodModel } from './model/models.js';
import { unwrap } from './model/unwrap.js';
import { Template } from './template.js';
import { callOp, awaitOp } from './async.js';

/**
 * @typedef {import('./model/templateModel.js').TemplateModel} TemplateModel
 */

// <- TemplateDateModel.TYPE_NAMES, indexed by this port's DATE_TYPES numbering.
const DATE_TYPE_NAMES = ['UNKNOWN', 'DATE', 'TIME', 'DATETIME', 'DATETIME'];

// <- EvalUtil.cmpOpToString fallback names (when the operator wasn't written in source).
const COMPARATOR_NAMES = { eq: 'equals', neq: 'not-equals', lt: 'less-than', gt: 'greater-than', lte: 'less-than-equals', gte: 'greater-than-equals' };

/** FTL type description in comparison errors <- _DelayedFTLTypeDescription + _DelayedAOrAn. */
function comparisonDescription(m) {
  if (m instanceof NumberModel) return 'a number';
  if (m instanceof MarkupModel) return 'a markup_output';
  if (m instanceof StringModel) return 'a string';
  if (m instanceof DateModel) return 'a date_or_time_or_datetime';
  if (m instanceof BooleanModel) return 'a boolean';
  if (m instanceof TemplateMethodModel) return 'a method';
  if (m instanceof TemplateSequenceModel) return 'a sequence';
  if (m && m.isTransform) return 'a transform';
  if (typeof m.keys === 'function') return 'an extended_hash';
  if (m instanceof TemplateHashModel) return 'a hash';
  return 'an unusual FTL value';
}

/** A blamed-expression label in a message may be given as a string or a lazy getter. */
function label(v) {
  return typeof v === 'function' ? v() : v;
}
/**
 * @typedef {Object} ProcessOptions
 * @property {Object} [out] - the character writer to output into
 * @property {Object|import('./model/templateModel.js').TemplateModel} [dataModel] - the root data model
 * @property {Function} [includeResolver] - reserved for #include/#import (M14)
 */

/**
 * The render-time state of a single template processing run; everything mutable
 * lives here (no module-global state). <- freemarker.core.Environment
 */
export class Environment {
  /**
   * @param {Object} rootElement - the parsed root element of the template
   * @param {import('./template.js').Template} template
   * @param {ProcessOptions} [options]
   */
  constructor(rootElement, template, options = {}) {
    this.rootElement = rootElement;
    this.template = template;
    // <- .template_name / .main_template_name always report the root template,
    // even after #include / ?interpret switch the current template.
    this._mainTemplate = template;
    // <- Environment.legacyParent (pre-IcI 2.3.22 getTemplate()): switched by
    // #include/#import/#nested; drives the deprecated .template_name.
    this._legacyTemplate = null;
    this._nsTemplate = template; // template owning the current namespace
    this.configuration = template.configuration;
    this.output = options.out;
    this.dataModel = options.dataModel == null
      ? null
      : (options.dataModel instanceof TemplateHashModel ? options.dataModel : this.wrap(options.dataModel));
    this.includeResolver = options.includeResolver ?? null;
    this.elementStack = [];
    this._scopes = []; // loop/macro scopes; innermost wins on read
    this._nsScope = new Map(); // current template namespace <- #assign target
    this._iterStack = []; // innermost iterator item, for #list without "as" + #items
    this._escapeValueStack = []; // active #escape target values (innermost last)
    this._macroCallStack = []; // active macro invocations: {boundary, bodyChildren, bodyParamNames}
    // <- Environment.currentMacroContext: {callTemplate, codeTemplate, prev};
    // drives .caller_template_name and call-site attribution of nested calls.
    this._macroCtx = null;
    this.loadedLibs = new Map(); // imported-template namespaces <- Environment.loadedLibs
    // <- Environment.outputFormat (built-ins consult it; interpolations carry
    // their own parse-time binding instead)
    this.outputFormat = template.outputFormat ?? this.configuration.getOutputFormat();
    // <- Environment settings layer (Configurable parent = the Configuration);
    // #setting mutates this copy (no automatic restore, like upstream 2.3).
    const cfg = this.configuration;
    this._settings = {
      numberFormat: cfg.getNumberFormat(),
      booleanFormat: cfg.getBooleanFormat(),
      cFormat: cfg.getCFormat(),
      dateFormat: cfg.getDateFormat(),
      timeFormat: cfg.getTimeFormat(),
      dateTimeFormat: cfg.getDateTimeFormat(),
      locale: cfg.getLocale(),
      timeZone: cfg.getTimeZone(),
      outputEncoding: null,
      urlEscapingCharset: null,
      classicCompatible: false,
    };
  }

  // <- Configurable.setSetting, restricted to the subset this port supports.
  /**
   * @param {string} name - setting name as written in #setting
   * @param {string} value - the evaluated string value
   * @returns {void}
   * @throws {import('./errors.js').InvalidSettingException}
   */
  setSetting(name, value) {
    const s = this._settings;
    if (name === 'number_format' || name === 'numberFormat') s.numberFormat = value;
    else if (name === 'boolean_format' || name === 'booleanFormat') {
      validateBooleanFormat(value);
      s.booleanFormat = value;
    } else if (name === 'c_format' || name === 'cFormat') s.cFormat = value;
    else if (name === 'date_format' || name === 'dateFormat') s.dateFormat = value;
    else if (name === 'time_format' || name === 'timeFormat') s.timeFormat = value;
    else if (name === 'datetime_format' || name === 'datetimeFormat') {
      s.dateTimeFormat = value;
    } else if (name === 'locale') s.locale = value;
    else if (name === 'time_zone' || name === 'timeZone') s.timeZone = value;
    else if (name === 'output_encoding' || name === 'outputEncoding') s.outputEncoding = value; // inert
    else if (name === 'url_escaping_charset' || name === 'urlEscapingCharset') s.urlEscapingCharset = value; // inert
    else if (name === 'classic_compatible' || name === 'classicCompatible') {
      // inert in this port; still parsed <- Configurable.setSetting
      const isNum = [...value].some((c) => c >= '0' && c <= '9');
      s.classicCompatible = value === 'true' || (isNum && Number(value) !== 0);
    } else if (name === 'sql_date_and_time_time_zone' || name === 'sqlDateAndTimeTimeZone') {
      // inert
    } else {
      throw new InvalidSettingException(`Unknown setting name: ${JSON.stringify(name)}.`);
    }
  }

  /**
   * Seeds the template's macros into the namespace, then visits the root element.
   * @returns {Generator<unknown, void, unknown>}
   */
  * process() {
    // <- Template's macros are part of the namespace from the very start.
    for (const m of this.template.macros) {
      m.macroModel.defTemplate = this.template;
      m.macroModel.defNsTemplate = this.template;
      if (!this._nsScope.has(m.name)) this._nsScope.set(m.name, m.macroModel);
    }
    yield* this.visit(this.rootElement);
  }

  /**
   * Executes one element, maintaining the element stack that feeds FTL error stack
   * traces, and decorates the first thrown TemplateException with location info.
   * Generator form: an element's execute may yield async tokens (see async.js).
   * @param {Object} element - the TemplateElement to visit
   * @returns {Generator<unknown, void, unknown>}
   */
  * visit(element) {
    this.elementStack.push(element);
    try {
      const more = yield* element.execute(this);
      if (more) {
        for (const el of more) {
          if (el) yield* this.visit(el);
        }
      }
    } catch (e) {
      const marker = e instanceof BreakInstructionException
        || e instanceof ContinueInstructionException
        || e instanceof ReturnInstructionException;
      if (!marker && e instanceof TemplateException && e.errorStackTrace === null) {
        const name = e.templateName ?? this.template.name;
        const stack = this._errorStackTrace(element);
        e.withLocation(name,
          e.beginLine === -1 ? element.beginLine : e.beginLine,
          e.beginColumn === -1 ? element.beginColumn : e.beginColumn,
          stack);
        // <- upstream getMessage() embeds the stack block in the message
        e.message = `${e.message}\n\n----\n${stack}\n----`;
      }
      throw e;
    } finally {
      this.elementStack.pop();
    }
  }

  /**
   * Builds the "FTL stack trace" text for an exception at the given element.
   * @param {Object} element
   * @returns {string}
   */
  _errorStackTrace(element) {
    const frames = [];
    for (let i = this.elementStack.length - 1; i >= 0; i--) {
      const el = this.elementStack[i];
      if (!el.getCanonicalForm || el.beginLine === -1) continue;
      const canon = el.getCanonicalForm().split('\n')[0];
      frames.push(`\t- ${frames.length === 0 ? 'Failed at' : 'Reached through'}: ${canon}`
        + `  [in template "${this.template.name ?? 'Template'}" `
        + `at line ${el.beginLine}, column ${el.beginColumn}]`);
    }
    return 'FTL stack trace ("~" means nesting-related):\n' + frames.join('\n');
  }

  // ---- template references (#include / #import) ----

  /**
   * Resolves a template's source text via the includeResolver. <- TemplateLoader.getSource
   * (the resolver may return a Promise; awaited in async mode -- generator form).
   * @param {string} name
   * @returns {Generator<unknown, string, unknown>} source text
   */
  * _resolveTemplateSource(name) {
    const resolver = this.includeResolver ?? this.configuration.getIncludeResolver();
    if (resolver == null) {
      throw new TemplateException(
        `Could not find the included template "${name}".\n`
        + 'Hint: no includeResolver was set on the Configuration (setIncludeResolver) '
        + 'or passed to the processing.');
    }
    let src;
    try {
      src = yield* awaitOp(`include resolver for "${name}"`, resolver(name));
    } catch (e) {
      if (e instanceof TemplateException) throw e;
      throw new TemplateException(
        `Could not find the included template "${name}".\n`
        + `Hint: the includeResolver threw: ${e.message}`);
    }
    if (typeof src !== 'string') {
      throw new TemplateException(
        `Could not find the included template "${name}".\n`
        + 'Hint: the includeResolver returned no source for this name.');
    }
    return src;
  }

  /**
   * Parse-once per Configuration cache of referenced templates. <- TemplateCache
   * (keyed by name only in this port - no locale/encoding variants). Parsing
   * itself is always sync; only the source resolution can be async.
   * @param {string} name
   * @returns {Generator<unknown, Template, unknown>} the parsed template
   */
  * loadIncludedSource(name) {
    name = this._resolveTemplateName(name);
    return yield* this._resolveTemplateSource(name);
  }

  /**
   * Builds a sub-template (used by ?interpret); errors surface at the caller.
   * @param {string} name @param {string} source
   * @returns {Template}
   */
  buildTemplate(name, source) {
    return new Template(name, source, this.configuration);
  }

  * loadIncludedTemplate(name) {
    const cfg = this.configuration;
    name = this._resolveTemplateName(name);
    let t = cfg._templateCache.get(name);
    if (t === undefined) {
      const src = yield* this._resolveTemplateSource(name);
      t = new Template(name, src, cfg);
      cfg._templateCache.set(name, t);
    }
    return t;
  }

  /**
   * Resolves a relative template name against the current template's directory
   * <- TemplateNameResolver (file-style names; a leading '/' makes it absolute;
   * inside a "?interpret" template the parent chain head is the base).
   * @param {string} rawName
   * @returns {string}
   */
  _resolveTemplateName(rawName) {
    let name = rawName;
    if (name.startsWith('/')) name = name.slice(1);
    const rawBase = this.template && this.template.name != null ? this.template.name : null;
    if (rawBase === null) return name;
    const chain = rawBase.indexOf('->');
    const base = chain >= 0 ? rawBase.slice(0, chain) : rawBase;
    if (!base.includes('/')) return name;
    const dirSegs = base.split('/').slice(0, -1);
    const outSegs = [...dirSegs];
    for (const seg of name.split('/')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') { outSegs.pop(); continue; }
      outSegs.push(seg);
    }
    return outSegs.join('/');
  }

  // ---- model plumbing ----

  /**
   * Wraps a plain JS value into a TemplateModel via the configured ObjectWrapper.
   * @param {unknown} value
   * @returns {import('./model/templateModel.js').TemplateModel|null}
   */
  wrap(value) {
    return this.configuration.getObjectWrapper().wrap(value);
  }

  /**
   * Pushes a new variable scope (loops, lambda bodies).
   * @returns {void}
   */
  pushScope() {
    this._scopes.push(new Map());
  }

  /**
   * Pops the innermost variable scope.
   * @returns {void}
   */
  popScope() {
    this._scopes.pop();
  }
  /**
   * Defines a variable in the innermost scope (creates one when needed).
   * @param {string} name
   * @param {import('./model/templateModel.js').TemplateModel} model
   * @returns {void}
   */
  setVariable(name, model) {
    if (this._scopes.length === 0) this.pushScope();
    this._scopes[this._scopes.length - 1].set(name, model);
  }

  /**
   * Looks up a variable: innermost scope first, then the template namespace, then
   * the data model. <- Environment.getVariable
   * @param {string} name
   * @returns {Generator<unknown, import('./model/templateModel.js').TemplateModel|null, unknown>}
   */
  * getVariable(name) {
    for (let i = this._scopes.length - 1; i >= 0; i--) {
      if (this._scopes[i].has(name)) return this._scopes[i].get(name);
    }
    if (this._nsScope.has(name)) return this._nsScope.get(name);
    return this.dataModel ? yield* callOp(`data-model variable "${name}"`, this.dataModel, 'get', name) : null;
  }

  /**
   * Assignment.visit scope rules: global -> data model (unwrapped); namespace -> the
   * template namespace; local -> the innermost macro scope.
   * @param {string} name
   * @param {import('./model/templateModel.js').TemplateModel|null} model - null clears/holds the null value
   * @param {'namespace'|'global'|'local'} scope
   * @returns {void}
   */
  assignVariable(name, model, scope) {
    if (scope === 'global') {
      if (this.dataModel === null) this.dataModel = this.wrap({});
      const src = this.dataModel.source;
      const raw = model === null || model === undefined ? null : unwrap(model);
      if (this.dataModel.isMap) src.set(name, raw);
      else src[name] = raw;
      return;
    }
    if (scope === 'local') {
      // macro/function scopes are marked by pushMacroScope() (M9); the parser already
      // rejects #local outside them.
      for (let i = this._scopes.length - 1; i >= 0; i--) {
        if (this._scopes[i].isMacroScope) {
          this._scopes[i].set(name, model);
          return;
        }
      }
      this._nsScope.set(name, model);
      return;
    }
    this._nsScope.set(name, model);
  }

  /**
   * Shared comparison <- ComparisonExpression.visit + #case/#on matching (M16 refines).
   * Generator form: the protocol getters may come from user models (async-capable).
   * @param {import('./model/templateModel.js').TemplateModel} l
   * @param {import('./model/templateModel.js').TemplateModel} r
   * @returns {Generator<unknown, number, unknown>} negative, zero or positive
   */
  // <- EvalUtil.compare (2.3.36): comparisons are only legal between same-kind pairs
  // (number/number, string/string, date/date, boolean/boolean); relational operators
  // are additionally illegal on strings and booleans. The long-standing v1
  // string-coercion fallback was a divergence; fixed against real 2.3.36 output.
  /**
   * @param {TemplateModel|null} l
   * @param {TemplateModel|null} r
   * @param {'eq'|'neq'|'lt'|'lte'|'gt'|'gte'} [operator]
   * @param {string|null} [operatorString] - operator as written, for relational error text
   * @param {Object} [opts]
   * @param {boolean} [opts.typeMismatchMeansNotEqual] - lenient: type mismatch -> not equal
   * @param {boolean} [opts.leftNullReturnsFalse] - lenient: null left -> not equal
   * @param {boolean} [opts.rightNullReturnsFalse] - lenient: null right -> not equal
   * @param {string|null} [opts.leftLabel] - blamed canonical form of the left operand
   * @param {string|null} [opts.rightLabel] - blamed canonical form of the right operand
   * @returns {Generator<unknown, number, unknown>} sign of the comparison result
   */
  * compare(l, r, operator = 'eq', operatorString = null, opts = {}) {
    const tmmne = opts.typeMismatchMeansNotEqual ?? false;
    if (l === null || l === undefined) {
      if (opts.leftNullReturnsFalse) return 1;
      throw new InvalidReferenceException(
        opts.leftLabel
          ? `The following has evaluated to null or missing:\n==> ${label(opts.leftLabel)}`
          : 'The left operand of the comparison was undefined or null.');
    }
    if (r === null || r === undefined) {
      if (opts.rightNullReturnsFalse) return 1;
      throw new InvalidReferenceException(
        opts.rightLabel
          ? `The following has evaluated to null or missing:\n==> ${label(opts.rightLabel)}`
          : 'The right operand of the comparison was undefined or null.');
    }
    const opName = operatorString ?? COMPARATOR_NAMES[operator];
    if (l instanceof NumberModel && r instanceof NumberModel) {
      const ln = yield* callOp('getAsNumber', l, 'getAsNumber');
      const rn = yield* callOp('getAsNumber', r, 'getAsNumber');
      // <- BigDecimalEngine.compareNumbers: exact when both have BigDecimal forms
      if (Number.isFinite(ln) && Number.isFinite(rn)) {
        const dl = l.getAsDecimal();
        const dr = r.getAsDecimal();
        if (dl !== null && dr !== null) return dl.cmp(dr);
        if (dl !== null) return dl.cmp(Decimal.fromNumber(rn));
        if (dr !== null) return Decimal.fromNumber(ln).cmp(dr);
      }
      return Math.sign(ln - rn);
    }
    if (l instanceof DateModel && r instanceof DateModel) {
      if (l.dateType !== r.dateType) {
        throw new TemplateException('Can\'t compare dates of different types. '
          + `Left date type is ${DATE_TYPE_NAMES[l.dateType]}, right date type is ${DATE_TYPE_NAMES[r.dateType]}.`);
      }
      const ld = yield* callOp('getAsDate', l, 'getAsDate');
      const rd = yield* callOp('getAsDate', r, 'getAsDate');
      return Math.sign(ld.getTime() - rd.getTime());
    }
    if (l instanceof StringModel && r instanceof StringModel) {
      if (operator !== 'eq' && operator !== 'neq') {
        throw new TemplateException(`Can't use operator "${opName}" on string values.`);
      }
      // <- 2.3.33+ equality is NFKC-normalized string content comparison.
      const ls = (yield* callOp('getAsString', l, 'getAsString')).normalize('NFKC');
      const rs = (yield* callOp('getAsString', r, 'getAsString')).normalize('NFKC');
      return ls < rs ? -1 : ls > rs ? 1 : 0;
    }
    if (l instanceof BooleanModel && r instanceof BooleanModel) {
      if (operator !== 'eq' && operator !== 'neq') {
        throw new TemplateException(`Can't use operator "${opName}" on boolean values.`);
      }
      return (l.getAsBoolean() ? 1 : 0) - (r.getAsBoolean() ? 1 : 0);
    }
    if (tmmne && (operator === 'eq' || operator === 'neq')) return 1;
    throw new TemplateException(
      'Can\'t compare values of these types. '
      + 'Allowed comparisons are between two numbers, two strings, two dates, or two booleans.\n'
      + `Left hand operand is ${comparisonDescription(l)}.\n`
      + `Right hand operand is ${comparisonDescription(r)}.`);
  }

  /**
   * FTL `==` semantics (strict: incomparable types throw).
   * @param {TemplateModel|null} l
   * @param {TemplateModel|null} r
   * @returns {Generator<unknown, boolean, unknown>}
   */
  * equals(l, r) {
    return (yield* this.compare(l, r, 'eq')) === 0;
  }

  /**
   * A human-readable FTL type name for error messages.
   * @param {import('./model/templateModel.js').TemplateModel|null} model
   * @returns {string}
   */
  typeLabel(model) {
    if (model === null || model === undefined) return 'null or missing';
    if (model instanceof MarkupModel) return 'a markup_output';
    if (model instanceof StringModel) return 'string';
    if (model instanceof NumberModel) return 'number';
    if (model instanceof BooleanModel) return 'boolean';
    if (model instanceof DateModel) return 'date';
    if (model instanceof TemplateMethodModel) return 'method';
    if (model !== null && model !== undefined && model.isTransform) return 'transform';
    if (model instanceof TemplateSequenceModel) return 'sequence';
    if (model instanceof TemplateHashModelEx) return 'extended_hash';
    if (model instanceof TemplateHashModel) return 'hash';
    return 'unknown type';
  }

  /**
   * Coerces strictly to a boolean; throws NonBooleanException otherwise.
   * @param {import('./model/templateModel.js').TemplateModel} model
   * @param {string} [context] - suffix like ` on the left of "&&"`
   * @returns {Generator<unknown, boolean, unknown>}
   */
  * toBoolean(model, context = '') {
    if (model instanceof BooleanModel) return model.getAsBoolean();
    throw new NonBooleanException(`Expected a boolean, but the value was a ${this.typeLabel(model)}${context}.`);
  }

  /**
   * Coerces strictly to a number; throws NonNumericalException otherwise.
   * @param {import('./model/templateModel.js').TemplateModel} model
   * @param {string} [context]
   * @returns {Generator<unknown, number, unknown>}
   */
  * toNumber(model, context = '') {
    if (model instanceof NumberModel) return model.getAsNumber();
    throw new NonNumericalException(`Expected a number, but the value was a ${this.typeLabel(model)}${context}.`);
  }

  /**
   * Coerces to a string for output/comparison; throws NonStringException for
   * sequences, hashes and methods.
   * @param {import('./model/templateModel.js').TemplateModel} model
   * @param {string} [context]
   * @returns {Generator<unknown, string, unknown>}
   */
  * coerceToString(model, context = '') {
    if (model instanceof StringModel) return model.getAsString();
    if (model instanceof NumberModel) {
      return this._formatNumber(model.getAsNumber(), undefined, null, model.getAsDecimal());
    }
    if (model instanceof BooleanModel) return this._autoFormatBoolean(model.getAsBoolean());
    if (model instanceof DateModel) return this._formatDate(model.getAsDate(), model.dateType);
    // <- CoercionUtil: same core message as the "${...}" content coercion
    throw new NonStringOrTemplateOutputException(
      `Expected a string or something automatically convertible to string `
      + `(number, date or boolean), or "template output" , but this has evaluated `
      + `to ${comparisonDescription(model)}${context}:`);
  }

  /**
   * <- Environment.formatNumberModel with the env number_format setting.
   * @param {number} v
   * @param {{ minFrac?: number, maxFrac?: number }} [fracOpts] - from #{exp;mN}
   * @param {string|null} [formatString] - explicit (?string(fmt)); null = default
   * @returns {string}
   */
  _formatNumber(v, fracOpts = undefined, formatString = null, dec = null) {
    return formatNumber(v, formatString ?? this._settings.numberFormat, fracOpts, dec);
  }

  /**
   * <- BooleanFormat: a "true,false"-style comma-separated pair, or "c".
   * @param {boolean} v
   * @param {string|null} [formatString] - override (from ?string(fmt))
   * @returns {string}
   */
  _formatBoolean(v, formatString = null) {
    const pair = validateBooleanFormat(formatString ?? this._settings.booleanFormat);
    return v ? pair[0] : pair[1];
  }

  /**
   * <- JVM: auto stringification of a boolean errors while boolean_format is the
   * legacy "true,false" default (or unset); ?string / ?c / ?then bypass this.
   * @param {boolean} v @returns {string}
   */
  _autoFormatBoolean(v) {
    const f = this._settings.booleanFormat;
    if (f === null || f === undefined || f === 'true,false') {
      throw new TemplateException(
        'Can\'t convert boolean to string automatically, because the "boolean_format" setting was '
        + '"true,false", which is the legacy deprecated default, and we treat it as if no format '
        + 'was set. This is the default configuration; you should provide the format explicitly '
        + 'for each place where you print a boolean.');
    }
    const pair = validateBooleanFormat(f);
    return v ? pair[0] : pair[1];
  }

  /**
   * @returns {[string, string]} the current boolean_format true/false pair
   */
  getBooleanFormat() {
    return validateBooleanFormat(this._settings.booleanFormat);
  }

  /**
   * <- Environment.formatDateFormatModel with the env date/time/datetime formats.
   * @param {Date} d
   * @param {number} [dateType] - DateModel.DATE / TIME / DATE_TIME
   * @param {string|null} [formatString] - explicit (?string("x")); null = default
   * @returns {string}
   */
  _formatDate(d, dateType = DateModel.DATE_TIME, formatString = null) {
    return formatDate(d, formatString, dateType, {
      date: this._settings.dateFormat,
      time: this._settings.timeFormat,
      datetime: this._settings.dateTimeFormat,
    }, this._settings.timeZone);
  }
}

/**
 * <- Configurable.parseBooleanFormat: "a,b" or "c"/"true,false" defaults.
 * @param {string} booleanFormat
 * @returns {[string, string]}
 * @throws {import('./errors.js').InvalidSettingException}
 */
export function validateBooleanFormat(booleanFormat) {
  if (booleanFormat === 'c' || booleanFormat === 'true,false') return ['true', 'false'];
  const comma = booleanFormat.indexOf(',');
  if (comma === -1) {
    throw new InvalidSettingException(
      'Setting value must be a string that contains two comma-separated values for true and false, '
      + 'or it must be "c", but it was ' + JSON.stringify(booleanFormat) + '.');
  }
  return [booleanFormat.slice(0, comma), booleanFormat.slice(comma + 1)];
}
