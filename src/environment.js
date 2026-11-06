// Render-time state; no module-global mutable state (all of it lives here).

import {
  TemplateException, InvalidReferenceException,
  NonStringException, NonNumericalException, NonBooleanException, NonHashException,
  BreakInstructionException, ContinueInstructionException, ReturnInstructionException,
} from './errors.js';
import { StringModel, NumberModel, BooleanModel, DateModel } from './model/models.js';
import { TemplateSequenceModel, TemplateHashModel, TemplateMethodModel } from './model/templateModel.js';
import { MethodModel } from './model/models.js';
import { unwrap } from './model/unwrap.js';
import { Template } from './template.js';

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
  }

  /**
   * Seeds the template's macros into the namespace, then visits the root element.
   * @returns {void}
   */
  process() {
    // ← Template's macros are part of the namespace from the very start.
    for (const m of this.template.macros) {
      if (!this._nsScope.has(m.name)) this._nsScope.set(m.name, m.macroModel);
    }
    this.visit(this.rootElement);
  }

  /**
   * Executes one element, maintaining the element stack that feeds FTL error stack
   * traces, and decorates the first thrown TemplateException with location info.
   * @param {Object} element - the TemplateElement to visit
   * @returns {void}
   */
  visit(element) {
    this.elementStack.push(element);
    try {
      const more = element.execute(this);
      if (more) {
        for (const el of more) {
          if (el) this.visit(el);
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
   * (synchronous in this port; see UPSTREAM.md).
   * @param {string} name
   * @returns {string} source text
   */
  _resolveTemplateSource(name) {
    const resolver = this.includeResolver ?? this.configuration.getIncludeResolver();
    if (resolver == null) {
      throw new TemplateException(
        `Could not find the included template "${name}".\n`
        + 'Hint: no includeResolver was set on the Configuration (setIncludeResolver) '
        + 'or passed to the processing.');
    }
    let src;
    try {
      src = resolver(name);
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
   * (keyed by name only in this port - no locale/encoding variants).
   * @param {string} name
   * @returns {Template} the parsed template
   */
  loadIncludedTemplate(name) {
    const cfg = this.configuration;
    let t = cfg._templateCache.get(name);
    if (t === undefined) {
      const src = this._resolveTemplateSource(name);
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
   * @returns {TemplateModel|null}
   */
  getVariable(name) {
    for (let i = this._scopes.length - 1; i >= 0; i--) {
      if (this._scopes[i].has(name)) return this._scopes[i].get(name);
    }
    if (this._nsScope.has(name)) return this._nsScope.get(name);
    return this.dataModel ? this.dataModel.get(name) : null;
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
   * @param {TemplateModel} l
   * @param {TemplateModel} r
   * @returns {number} negative, zero or positive
   */
  compare(l, r) {
    if (l && typeof l.getAsNumber === 'function' && r && typeof r.getAsNumber === 'function') {
      return Math.sign(l.getAsNumber() - r.getAsNumber());
    }
    if (l && typeof l.getAsDate === 'function' && r && typeof r.getAsDate === 'function') {
      return Math.sign(l.getAsDate().getTime() - r.getAsDate().getTime());
    }
    if (l instanceof BooleanModel && r instanceof BooleanModel) {
      return l.getAsBoolean() === r.getAsBoolean() ? 0 : (l.getAsBoolean() ? 1 : -1);
    }
    const ls = this.coerceToString(l);
    const rs = this.coerceToString(r);
    return ls < rs ? -1 : ls > rs ? 1 : 0;
  }

  /**
   * @param {TemplateModel} l
   * @param {TemplateModel} r
   * @returns {boolean}
   */
  equals(l, r) {
    return this.compare(l, r) === 0;
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
   * @returns {boolean}
   */
  toBoolean(model, context = '') {
    if (model instanceof BooleanModel) return model.getAsBoolean();
    throw new NonBooleanException(`Expected a boolean, but the value was a ${this.typeLabel(model)}${context}.`);
  }

  /**
   * Coerces strictly to a number; throws NonNumericalException otherwise.
   * @param {TemplateModel} model
   * @param {string} [context]
   * @returns {number}
   */
  toNumber(model, context = '') {
    if (model instanceof NumberModel) return model.getAsNumber();
    throw new NonNumericalException(`Expected a number, but the value was a ${this.typeLabel(model)}${context}.`);
  }

  /**
   * Coerces to a string for output/comparison; throws NonStringException for
   * sequences, hashes and methods.
   * @param {TemplateModel} model
   * @param {string} [context]
   * @returns {string}
   */
  coerceToString(model, context = '') {
    if (model instanceof StringModel) return model.getAsString();
    if (model instanceof NumberModel) return this._formatNumber(model.getAsNumber());
    if (model instanceof BooleanModel) return model.getAsBoolean() ? 'true' : 'false';
    if (model instanceof DateModel) return this._formatDate(model.getAsDate());
    throw new NonStringException(
      `Can't convert to string${context}: the value is a ${this.typeLabel(model)}.`);
  }

  /**
   * M16 lands real number formats; default mirrors the "number" format (plain decimal).
   * @param {number} v
   * @returns {string}
   */
  _formatNumber(v) {
    if (!Number.isFinite(v)) {
      throw new TemplateException(`The number ${String(v)} can't be converted to a string.`);
    }
    return String(v);
  }

  /**
   * M16 lands real date formats; interim default is the ISO form (deviation noted in UPSTREAM.md).
   * @param {Date} d
   * @returns {string}
   */
  _formatDate(d) {
    return d.toISOString();
  }
}
