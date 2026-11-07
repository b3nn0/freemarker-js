// Render-time state; no module-global mutable state (all of it lives here).

import {
  TemplateException, InvalidReferenceException,
  NonStringException, NonNumericalException, NonBooleanException, NonHashException,
  BreakInstructionException, ContinueInstructionException, ReturnInstructionException,
  InvalidSettingException,
} from './errors.js';
import { formatNumber } from './format/numberFormat.js';
import { formatDate } from './format/dateFormat.js';
import { StringModel, NumberModel, BooleanModel, DateModel } from './model/models.js';
import { TemplateSequenceModel, TemplateHashModel, TemplateMethodModel } from './model/templateModel.js';
import { MethodModel } from './model/models.js';
import { unwrap } from './model/unwrap.js';
import { Template } from './template.js';
import { callOp, awaitOp } from './async.js';

/**
 * @typedef {import('./model/templateModel.js').TemplateModel} TemplateModel
 */
/**
 * @typedef {Object} ProcessOptions
 * @property {Object} [out] - the character writer to output into
 * @property {Object|TemplateModel} [dataModel] - the root data model
 * @property {Function} [includeResolver] - reserved for #include/#import (M14)
 */

/**
 * The render-time state of a single template processing run; everything mutable
 * lives here (no module-global state). ← freemarker.core.Environment
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
    this.configuration = template.configuration;
    this.output = options.out;
    this.dataModel = options.dataModel == null
      ? null
      : (options.dataModel instanceof TemplateHashModel ? options.dataModel : this.wrap(options.dataModel));
    this.includeResolver = options.includeResolver ?? null;
    this.elementStack = [];
    this._scopes = []; // loop/macro scopes; innermost wins on read
    this._nsScope = new Map(); // current template namespace ← #assign target
    this._iterStack = []; // innermost iterator item, for #list without "as" + #items
    this._macroCallStack = []; // active macro invocations: {boundary, bodyChildren, bodyParamNames}
    this.loadedLibs = new Map(); // imported-template namespaces ← Environment.loadedLibs
    // ← Environment.outputFormat (built-ins consult it; interpolations carry
    // their own parse-time binding instead)
    this.outputFormat = template.outputFormat ?? this.configuration.getOutputFormat();
    // ← Environment settings layer (Configurable parent = the Configuration);
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
      timeZone: null,
      outputEncoding: null,
      urlEscapingCharset: null,
      classicCompatible: false,
    };
  }

  // ← Configurable.setSetting, restricted to the subset this port supports.
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
    else if (name === 'time_zone' || name === 'timeZone') s.timeZone = value; // inert
    else if (name === 'output_encoding' || name === 'outputEncoding') s.outputEncoding = value; // inert
    else if (name === 'url_escaping_charset' || name === 'urlEscapingCharset') s.urlEscapingCharset = value; // inert
    else if (name === 'classic_compatible' || name === 'classicCompatible') {
      // inert in this port; still parsed ← Configurable.setSetting
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
    // ← Template's macros are part of the namespace from the very start.
    for (const m of this.template.macros) {
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
        e.withLocation(name,
          e.beginLine === -1 ? element.beginLine : e.beginLine,
          e.beginColumn === -1 ? element.beginColumn : e.beginColumn,
          this._errorStackTrace(element));
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
        + `in line ${el.beginLine}, column ${el.beginColumn}]`);
    }
    return 'FTL stack trace ("~" means nesting-related):\n' + frames.join('\n');
  }

  // ---- template references (#include / #import) ----

  /**
   * Resolves a template's source text via the includeResolver. ← TemplateLoader.getSource
   * (the resolver may return a Promise; awaited in async mode — generator form).
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
   * Parse-once per Configuration cache of referenced templates. ← TemplateCache
   * (keyed by name only in this port - no locale/encoding variants). Parsing
   * itself is always sync; only the source resolution can be async.
   * @param {string} name
   * @returns {Generator<unknown, Template, unknown>} the parsed template
   */
  * loadIncludedTemplate(name) {
    const cfg = this.configuration;
    let t = cfg._templateCache.get(name);
    if (t === undefined) {
      const src = yield* this._resolveTemplateSource(name);
      t = new Template(name, src, cfg);
      cfg._templateCache.set(name, t);
    }
    return t;
  }

  // ---- model plumbing ----

  /**
   * Wraps a plain JS value into a TemplateModel via the configured ObjectWrapper.
   * @param {unknown} value
   * @returns {TemplateModel|null}
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
   * @param {TemplateModel} model
   * @returns {void}
   */
  setVariable(name, model) {
    if (this._scopes.length === 0) this.pushScope();
    this._scopes[this._scopes.length - 1].set(name, model);
  }

  /**
   * Looks up a variable: innermost scope first, then the template namespace, then
   * the data model. ← Environment.getVariable
   * @param {string} name
   * @returns {Generator<unknown, TemplateModel|null, unknown>}
   */
  * getVariable(name) {
    for (let i = this._scopes.length - 1; i >= 0; i--) {
      if (this._scopes[i].has(name)) return this._scopes[i].get(name);
    }
    if (this._nsScope.has(name)) return this._nsScope.get(name);
    return this.dataModel ? yield* callOp(`data-model variable "${name}"`, this.dataModel, 'get', name) : null;
  }

  /**
   * Assignment.visit scope rules: global → data model (unwrapped); namespace → the
   * template namespace; local → the innermost macro scope.
   * @param {string} name
   * @param {TemplateModel|null} model - null clears/holds the null value
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
   * Shared comparison ← ComparisonExpression.visit + #case/#on matching (M16 refines).
   * Generator form: the protocol getters may come from user models (async-capable).
   * @param {TemplateModel} l
   * @param {TemplateModel} r
   * @returns {Generator<unknown, number, unknown>} negative, zero or positive
   */
  * compare(l, r) {
    if (l && typeof l.getAsNumber === 'function' && r && typeof r.getAsNumber === 'function') {
      const ln = yield* callOp('getAsNumber', l, 'getAsNumber');
      const rn = yield* callOp('getAsNumber', r, 'getAsNumber');
      return Math.sign(ln - rn);
    }
    if (l && typeof l.getAsDate === 'function' && r && typeof r.getAsDate === 'function') {
      const ld = yield* callOp('getAsDate', l, 'getAsDate');
      const rd = yield* callOp('getAsDate', r, 'getAsDate');
      return Math.sign(ld.getTime() - rd.getTime());
    }
    if (l instanceof BooleanModel && r instanceof BooleanModel) {
      return l.getAsBoolean() === r.getAsBoolean() ? 0 : (l.getAsBoolean() ? 1 : -1);
    }
    const ls = yield* this.coerceToString(l);
    const rs = yield* this.coerceToString(r);
    return ls < rs ? -1 : ls > rs ? 1 : 0;
  }

  /**
   * @param {TemplateModel} l
   * @param {TemplateModel} r
   * @returns {Generator<unknown, boolean, unknown>}
   */
  * equals(l, r) {
    return (yield* this.compare(l, r)) === 0;
  }

  /**
   * A human-readable FTL type name for error messages.
   * @param {TemplateModel|null} model
   * @returns {string}
   */
  typeLabel(model) {
    if (model === null || model === undefined) return 'null or missing';
    if (model instanceof StringModel) return 'string';
    if (model instanceof NumberModel) return 'number';
    if (model instanceof BooleanModel) return 'boolean';
    if (model instanceof DateModel) return 'date';
    if (model instanceof TemplateMethodModel) return 'method';
    if (model instanceof TemplateSequenceModel) return 'sequence';
    if (model instanceof TemplateHashModel) return 'hash';
    return 'unknown type';
  }

  /**
   * Coerces strictly to a boolean; throws NonBooleanException otherwise.
   * @param {TemplateModel} model
   * @param {string} [context] - suffix like ` on the left of "&&"`
   * @returns {Generator<unknown, boolean, unknown>}
   */
  * toBoolean(model, context = '') {
    if (model instanceof BooleanModel) return model.getAsBoolean();
    throw new NonBooleanException(`Expected a boolean, but the value was a ${this.typeLabel(model)}${context}.`);
  }

  /**
   * Coerces strictly to a number; throws NonNumericalException otherwise.
   * @param {TemplateModel} model
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
   * @param {TemplateModel} model
   * @param {string} [context]
   * @returns {Generator<unknown, string, unknown>}
   */
  * coerceToString(model, context = '') {
    if (model instanceof StringModel) return model.getAsString();
    if (model instanceof NumberModel) return this._formatNumber(model.getAsNumber());
    if (model instanceof BooleanModel) return this._formatBoolean(model.getAsBoolean());
    if (model instanceof DateModel) return this._formatDate(model.getAsDate(), model.dateType);
    throw new NonStringException(
      `Can't convert to string${context}: the value is a ${this.typeLabel(model)}.`);
  }

  /**
   * ← Environment.formatNumberModel with the env number_format setting.
   * @param {number} v
   * @param {{ minFrac?: number, maxFrac?: number }} [fracOpts] - from #{exp;mN}
   * @returns {string}
   */
  _formatNumber(v, fracOpts) {
    return formatNumber(v, this._settings.numberFormat, fracOpts);
  }

  /**
   * ← BooleanFormat: a "true,false"-style comma-separated pair, or "c".
   * @param {boolean} v
   * @param {string|null} [formatString] - override (from ?string(fmt))
   * @returns {string}
   */
  _formatBoolean(v, formatString = null) {
    const pair = validateBooleanFormat(formatString ?? this._settings.booleanFormat);
    return v ? pair[0] : pair[1];
  }

  /**
   * ← Environment.formatDateFormatModel with the env date/time/datetime formats.
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
    });
  }
}

/**
 * ← Configurable.parseBooleanFormat: "a,b" or "c"/"true,false" defaults.
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
