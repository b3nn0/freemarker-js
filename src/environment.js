// Render-time state; no module-global mutable state (all of it lives here).

import {
  TemplateException, InvalidReferenceException,
  NonStringException, NonNumericalException, NonBooleanException, NonHashException,
} from './errors.js';
import { StringModel, NumberModel, BooleanModel, DateModel } from './model/models.js';
import { TemplateSequenceModel, TemplateHashModel } from './model/templateModel.js';
import { MethodModel } from './model/models.js';

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
  }

  process() {
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
      if (e instanceof TemplateException && e.errorStackTrace === null) {
        e.withLocation(this.template.name, element.beginLine, element.beginColumn,
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
      frames.push(`\t- Failed at: ${canon}  [in template "${this.template.name ?? 'Template'}" `
        + `in line ${el.beginLine}, column ${el.beginColumn}]`);
    }
    return 'FTL stack trace ("~" means nesting-related):\n' + frames.join('\n');
  }

  // ---- model plumbing ----

  wrap(value) {
    return this.configuration.getObjectWrapper().wrap(value);
  }

  getVariable(name) {
    return this.dataModel ? this.dataModel.get(name) : null;
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
