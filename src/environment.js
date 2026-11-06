// Render-time state; no module-global mutable state (all of it lives here).

import {
  TemplateException, InvalidReferenceException,
  NonStringException, NonNumericalException, NonBooleanException, NonHashException,
  BreakInstructionException, ContinueInstructionException, ReturnInstructionException,
} from './errors.js';
import { StringModel, NumberModel, BooleanModel, DateModel } from './model/models.js';
import { TemplateSequenceModel, TemplateHashModel } from './model/templateModel.js';
import { MethodModel } from './model/models.js';
import { unwrap } from './model/unwrap.js';

export class Environment {
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
  }

  process() {
    // ← Template's macros are part of the namespace from the very start.
    for (const m of this.template.macros) {
      if (!this._nsScope.has(m.name)) this._nsScope.set(m.name, m.macroModel);
    }
    this.visit(this.rootElement);
  }

  // Mirrors Environment.visit: elementStack feeds FTL error stack traces.
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

  // ---- model plumbing ----

  wrap(value) {
    return this.configuration.getObjectWrapper().wrap(value);
  }

  pushScope() {
    this._scopes.push(new Map());
  }
  popScope() {
    this._scopes.pop();
  }
  setVariable(name, model) {
    if (this._scopes.length === 0) this.pushScope();
    this._scopes[this._scopes.length - 1].set(name, model);
  }

  getVariable(name) {
    for (let i = this._scopes.length - 1; i >= 0; i--) {
      if (this._scopes[i].has(name)) return this._scopes[i].get(name);
    }
    if (this._nsScope.has(name)) return this._nsScope.get(name);
    return this.dataModel ? this.dataModel.get(name) : null;
  }

  // ← Assignment.visit scope rules: global → data model; namespace → template namespace;
  // local → innermost macro scope (macro scopes land in M9; here it behaves like namespace).
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

  // Shared comparison ← ComparisonExpression.visit + #case/#on matching (M16 refines).
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

  equals(l, r) {
    return this.compare(l, r) === 0;
  }

  typeLabel(model) {
    if (model === null || model === undefined) return 'null or missing';
    if (model instanceof StringModel) return 'string';
    if (model instanceof NumberModel) return 'number';
    if (model instanceof BooleanModel) return 'boolean';
    if (model instanceof DateModel) return 'date';
    if (model instanceof MethodModel) return 'method';
    if (model instanceof TemplateSequenceModel) return 'sequence';
    if (model instanceof TemplateHashModel) return 'hash';
    return 'unknown type';
  }

  toBoolean(model, context = '') {
    if (model instanceof BooleanModel) return model.getAsBoolean();
    throw new NonBooleanException(`Expected a boolean, but the value was a ${this.typeLabel(model)}${context}.`);
  }

  toNumber(model, context = '') {
    if (model instanceof NumberModel) return model.getAsNumber();
    throw new NonNumericalException(`Expected a number, but the value was a ${this.typeLabel(model)}${context}.`);
  }

  coerceToString(model, context = '') {
    if (model instanceof StringModel) return model.getAsString();
    if (model instanceof NumberModel) return this._formatNumber(model.getAsNumber());
    if (model instanceof BooleanModel) return model.getAsBoolean() ? 'true' : 'false';
    if (model instanceof DateModel) return this._formatDate(model.getAsDate());
    throw new NonStringException(
      `Can't convert to string${context}: the value is a ${this.typeLabel(model)}.`);
  }

  // M16 lands real number formats; default mirrors the "number" format (plain decimal).
  _formatNumber(v) {
    if (!Number.isFinite(v)) {
      throw new TemplateException(`The number ${String(v)} can't be converted to a string.`);
    }
    return String(v);
  }

  // M16 lands real date formats; interim default is the ISO form (deviation noted in UPSTREAM.md).
  _formatDate(d) {
    return d.toISOString();
  }
}
