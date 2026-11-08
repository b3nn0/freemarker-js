// Concrete model implementations for JS values <- DefaultObjectWrapper/SimpleObjectWrapper models.

import {
  TemplateScalarModel, TemplateNumberModel, TemplateBooleanModel, TemplateDateModel,
  TemplateSequenceModel, TemplateHashModelEx, TemplateMethodModel, TemplateModel,
} from './templateModel.js';
import { UnsupportedFeatureException } from '../errors.js';
import { awaitOp, isThenable } from '../async.js';
import { readerNameCandidates } from './beanNaming.js';

/** A string value. */
export class StringModel extends TemplateScalarModel {
  /** @param {string} value */
  constructor(value) {
    super();
    this.value = value;
  }
  /** @returns {string} */
  getAsString() {
    return this.value;
  }
}

// <- TemplateMarkupOutputModel (CommonTemplateMarkupOutputModel flavor): a value
// that is either already markup, or plain text to be escaped by its format.
/** A string tagged with an OutputFormat <- MarkupOutputFormat output values. */
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
   * @returns {MarkupModel} <- fromPlainTextByEscaping
   */
  static fromPlainText(plainText, outputFormat) {
    return new MarkupModel(plainText, outputFormat, null);
  }

  /**
   * @param {string} markup
   * @param {import('../outputFormat.js').OutputFormat} outputFormat
   * @returns {MarkupModel} <- fromMarkup
   */
  static fromMarkup(markup, outputFormat) {
    return new MarkupModel(null, outputFormat, markup);
  }
}

/** A numeric value (any finite or non-finite JS number). */
export class NumberModel extends TemplateNumberModel {
  /** @param {number} value @param {import('../format/decimal.js').Decimal|null} [dec] */
  constructor(value, dec = null) {
    super();
    this.value = value;
    this.dec = dec; // <- BigDecimalEngine exact value, when known
  }
  /** @returns {number} */
  getAsNumber() {
    return this.value;
  }
  /** @returns {import('../format/decimal.js').Decimal|null} */
  getAsDecimal() {
    return this.dec;
  }
}

/** A boolean; the shared TRUE/FALSE instances are canonical. */
export class BooleanModel extends TemplateBooleanModel {
  /** @param {boolean} value */
  constructor(value) {
    super();
    this.value = value;
  }
  /** @returns {boolean} */
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
   *   vs. date-time); defaults to date-time <- wrapped java.util.Date
   */
  constructor(value, dateType = DateModel.DATE_TIME) {
    super();
    this.value = value;
    this.dateType = dateType;
  }
  /** @returns {Date} */
  getAsDate() {
    return this.value;
  }
}
// <- TemplateDateModel constants (the port's values differ; names kept):
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
   * @returns {Generator<unknown, import('./templateModel.js').TemplateModel|null, unknown>}
   *   (generator form so raw async data can be awaited; see async.js)
   */
  * getByIndex(i) {
    if (i < 0 || i >= this.items.length) return null;
    const v = this.items[i];
    if (this.wrapper && isThenable(v)) {
      const raw = yield* awaitOp(`sequence element at index ${i}`, v);
      return this.wrapper.wrap(raw, this.items);
    }
    return this.wrapper ? this.wrapper.wrap(v, this.items) : v;
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
  /**
   * @param {unknown} v
   * @returns {import('./templateModel.js').TemplateModel} a function value becomes a
   *   method model that runs on this hash's source object (<- upstream's
   *   SimpleMethodModel is bound to the bean it was read from)
   */
  _wrap(v) {
    return this.wrapper ? this.wrapper.wrap(v, this.source) : v;
  }
  /**
   * @param {string} key
   * @returns {Generator<unknown, import('./templateModel.js').TemplateModel|null, unknown>}
   *   null when missing; plain objects walk the prototype chain but never past
   *   Object.prototype, and on a miss a getFoo/isFoo member stands for the property
   *   (JavaBeans reader naming, see beanNaming.js; Maps are exact-key only, like the
   *   JVM's MapModel); async property values (getter -> Promise) are awaited in
   *   async mode (generator form; see async.js)
   */
  * get(key) {
    if (this.isMap) {
      if (!this.source.has(key)) return null;
      const v = this.source.get(key);
      if (this.wrapper && isThenable(v)) {
        return this.wrapper.wrap(yield* awaitOp(`data-model key "${key}"`, v), this.source);
      }
      return this._wrap(v);
    }
    // Walk the prototype chain but never past Object.prototype (<- class methods are members).
    let obj = this.source;
    while (obj !== null && obj !== Object.prototype) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const v = obj[key];
        if (this.wrapper && isThenable(v)) {
          return this.wrapper.wrap(yield* awaitOp(`data-model key "${key}"`, v), this.source);
        }
        return this._wrap(v);
      }
      obj = Object.getPrototypeOf(obj);
    }
    // JavaBeans reader fallback <- the property entries of ClassIntrospector's map:
    // ${cust.foo} reads getFoo()/isFoo(). The exact-name step above already won, so a
    // real member called "foo" (data or method) always beats the reader naming.
    for (const reader of readerNameCandidates(key)) {
      const fn = this._memberFunction(reader);
      if (fn === null) continue;
      const r = fn.call(this.source);
      if (this.wrapper && isThenable(r)) {
        return this.wrapper.wrap(yield* awaitOp(`read-only call "${reader}"`, r), this.source);
      }
      return this._wrap(r);
    }
    return null;
  }
  /**
   * A zero-parameter member function on the object or its prototypes (never past
   * Object.prototype), for the getFoo/isFoo fallback. A same-named member that is not
   * a zero-parameter function shadows any inherited reader and reads as no reader.
   * @param {string} name - member name
   * @returns {Function|null} the member function, or null
   */
  _memberFunction(name) {
    let obj = this.source;
    while (obj !== null && obj !== Object.prototype) {
      if (Object.prototype.hasOwnProperty.call(obj, name)) {
        const v = obj[name];
        return typeof v === 'function' && v.length === 0 ? v : null;
      }
      obj = Object.getPrototypeOf(obj);
    }
    return null;
  }
  /** @returns {string[]} */
  keys() {
    return this.isMap ? [...this.source.keys()] : Object.keys(this.source);
  }
  /** @returns {unknown[]} raw (unwrapped) values <- the wrapper re-wraps them on demand */
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
   * @param {unknown} [owner] - the object/array the member was read from; the receiver of
   *   the call, <- upstream SimpleMethodModel keeps the bean it came from (JVM:
   *   ${r.self()} reads the bean's field, ${r.viaGetter()} works). Without it the call
   *   would run with the wrapper as receiver.
   */
  constructor(fn, name = null, owner = null) {
    super();
    this.fn = fn;
    this.name = name;
    this.owner = owner ?? null;
  }
  /**
   * Args arrive already unwrapped to plain JS values (<- MethodCall). A JS
   * function returning a Promise awaits it in async mode (generator form).
   * @param {import('../environment.js').Environment} env
   * @param {unknown[]} [args]
   * @returns {Generator<unknown, import('./templateModel.js').TemplateModel|null, unknown>}
   *   the wrapped return value
   */
  * exec(env, args = []) {
    const r = this.fn.call(this.owner, ...args);
    if (isThenable(r)) return env.wrap(yield* awaitOp(`method call "${this.name ?? 'anonymous'}"`, r));
    return env.wrap(r);
  }
}

// 0..size-1 mapping over a numeric range <- freemarker.core.Range's model.
/**
 * 0..size-1 mapping over a numeric range <- freemarker.core.Range's model.
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
  /** @returns {number} unbounded ranges report Integer.MAX_VALUE <- RangeBuiltIn */
  size() {
    return this.sizeValue === null ? 2147483647 : this.sizeValue;
  }
}

export { TemplateModel };
