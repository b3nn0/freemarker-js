// Concrete model implementations for JS values ← DefaultObjectWrapper/SimpleObjectWrapper models.

import {
  TemplateScalarModel, TemplateNumberModel, TemplateBooleanModel, TemplateDateModel,
  TemplateSequenceModel, TemplateHashModelEx, TemplateMethodModel, TemplateModel,
} from './templateModel.js';
import { UnsupportedFeatureException } from '../errors.js';

/** A string value. */
export class StringModel extends TemplateScalarModel {
  /** @param {string} value */
  constructor(value) {
    super();
    this.value = value;
  }
  getAsString() {
    return this.value;
  }
}

// ← TemplateMarkupOutputModel (CommonTemplateMarkupOutputModel flavor): a value
// that is either already markup, or plain text to be escaped by its format.
export class MarkupModel extends StringModel {
  /**
   * @param {string|null} plainText - the unescaped source text (nullable once markup is known)
   * @param {import('../outputFormat.js').OutputFormat} outputFormat
   * @param {string|null} [markup] - pre-escaped markup content
   */
  constructor(plainText, outputFormat, markup = null) {
    super(markup ?? outputFormat.escapePlainText(plainText ?? ''));
    this.plainText = plainText;
    this.markup = markup;
    this.outputFormat = outputFormat;
  }

  /**
   * @param {string|null} plainText
   * @param {import('../outputFormat.js').OutputFormat} outputFormat
   * @returns {MarkupModel} ← fromPlainTextByEscaping
   */
  static fromPlainText(plainText, outputFormat) {
    return new MarkupModel(plainText, outputFormat, null);
  }

  /**
   * @param {string} markup
   * @param {import('../outputFormat.js').OutputFormat} outputFormat
   * @returns {MarkupModel} ← fromMarkup
   */
  static fromMarkup(markup, outputFormat) {
    return new MarkupModel(null, outputFormat, markup);
  }
}

/** A numeric value (any finite or non-finite JS number). */
export class NumberModel extends TemplateNumberModel {
  /** @param {number} value */
  constructor(value) {
    super();
    this.value = value;
  }
  getAsNumber() {
    return this.value;
  }
}

/** A boolean; the shared TRUE/FALSE instances are canonical. */
export class BooleanModel extends TemplateBooleanModel {
  /** @param {boolean} value */
  constructor(value) {
    super();
    this.value = value;
  }
  getAsBoolean() {
    return this.value;
  }
}
BooleanModel.TRUE = new BooleanModel(true);
BooleanModel.FALSE = new BooleanModel(false);

/** A date/time value. */
export class DateModel extends TemplateDateModel {
  /**
   * @param {Date} value
   * @param {number} [dateType] - TemplateDateModel-style type (date-only/time-only
   *   vs. date-time); defaults to date-time ← wrapped java.util.Date
   */
  constructor(value, dateType = DateModel.DATE_TIME) {
    super();
    this.value = value;
    this.dateType = dateType;
  }
  getAsDate() {
    return this.value;
  }
}
// ← TemplateDateModel constants (the port's values differ; names kept):
DateModel.NONE = 0;
DateModel.DATE = 1;
DateModel.TIME = 2;
DateModel.DATE_TIME = 3;

/** A list of already-converted models (items), optionally re-wrapping raw values. */
export class SequenceModel extends TemplateSequenceModel {
  /**
   * @param {unknown[]} items - models, or raw values when `wrapper` is given
   * @param {import('./objectWrapper.js').SimpleObjectWrapper} [wrapper]
   */
  constructor(items, wrapper) {
    super();
    this.items = items;
    this.wrapper = wrapper ?? null;
  }
  /**
   * @param {number} i
   * @returns {import('./templateModel.js').TemplateModel|null}
   */
  getByIndex(i) {
    if (i < 0 || i >= this.items.length) return null;
    const v = this.items[i];
    return this.wrapper ? this.wrapper.wrap(v) : v;
  }
  /** @returns {number} */
  size() {
    return this.items.length;
  }
}

/** Keys are plain strings; source is a Map or a plain object. */
export class HashModel extends TemplateHashModelEx {
  /**
   * @param {Map<string, unknown>|Object} source - Map (isMap) or plain/class object
   * @param {import('./objectWrapper.js').SimpleObjectWrapper} [wrapper]
   */
  constructor(source, wrapper) {
    super();
    this.source = source;
    this.wrapper = wrapper ?? null;
    this.isMap = source instanceof Map;
  }
  _wrap(v) {
    return this.wrapper ? this.wrapper.wrap(v) : v;
  }
  /**
   * @param {string} key
   * @returns {import('./templateModel.js').TemplateModel|null} null when missing;
   *   plain objects walk the prototype chain but never past Object.prototype
   */
  get(key) {
    if (this.isMap) {
      return this.source.has(key) ? this._wrap(this.source.get(key)) : null;
    }
    // Walk the prototype chain but never past Object.prototype (← class methods are members).
    let obj = this.source;
    while (obj !== null && obj !== Object.prototype) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) return this._wrap(obj[key]);
      obj = Object.getPrototypeOf(obj);
    }
    return null;
  }
  /** @returns {string[]} */
  keys() {
    return this.isMap ? [...this.source.keys()].map(String) : Object.keys(this.source);
  }
  /** @returns {unknown[]} raw (unwrapped) values ← the wrapper re-wraps them on demand */
  values() {
    return this.isMap ? [...this.source.values()] : this.keys().map(k => this.source[k]);
  }
  /** @returns {number} */
  size() {
    return this.isMap ? this.source.size : Object.keys(this.source).length;
  }
  /** @returns {boolean} */
  isEmpty() {
    return this.size() === 0;
  }
}

/** Wraps a callable JS function as a method model. */
export class MethodModel extends TemplateMethodModel {
  /**
   * @param {Function} fn
   * @param {string} [name]
   */
  constructor(fn, name = null) {
    super();
    this.fn = fn;
    this.name = name;
  }
  /**
   * Args arrive already unwrapped to plain JS values (← MethodCall).
   * @param {import('../environment.js').Environment} env
   * @param {unknown[]} [args]
   * @returns {import('./templateModel.js').TemplateModel|null} the wrapped return value
   */
  exec(env, args = []) {
    return env.wrap(this.fn(...args));
  }
}

// 0..size-1 mapping over a numeric range ← freemarker.core.Range's model.
/**
 * 0..size-1 mapping over a numeric range ← freemarker.core.Range's model.
 * @param {number} from @param {number|null} to - null = unbounded open end
 * @param {'inclusive'|'exclusive'} endType
 */
export class RangeModel extends TemplateSequenceModel {
  /**
   * @param {number} from
   * @param {number|null} to
   * @param {'inclusive'|'exclusive'} endType
   */
  constructor(from, to, endType) {
    super();
    this.from = from;
    this.to = to; // null = unbounded open end
    this.endType = endType;
    this.sizeValue = to === null ? null : (endType === 'exclusive' ? to - from : to - from + 1);
  }
  /**
   * @param {number} i
   * @returns {NumberModel|null}
   */
  getByIndex(i) {
    if (i < 0) return null;
    const v = this.from + i;
    if (this.sizeValue !== null && i >= this.sizeValue) return null;
    return new NumberModel(v);
  }
  /** @returns {number} throws for unbounded ranges until streaming support (M11+) */
  size() {
    if (this.sizeValue === null) {
      throw new UnsupportedFeatureException('Unbounded range size is not supported yet.');
    }
    return this.sizeValue;
  }
}

export { TemplateModel };
