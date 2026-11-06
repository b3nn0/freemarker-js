// Concrete model implementations for JS values ← DefaultObjectWrapper/SimpleObjectWrapper models.

import {
  TemplateScalarModel, TemplateNumberModel, TemplateBooleanModel, TemplateDateModel,
  TemplateSequenceModel, TemplateHashModelEx, TemplateMethodModel, TemplateModel,
} from './templateModel.js';
import { UnsupportedFeatureException } from '../errors.js';

export class StringModel extends TemplateScalarModel {
  constructor(value) {
    super();
    this.value = value;
  }
  getAsString() {
    return this.value;
  }
}

export class NumberModel extends TemplateNumberModel {
  constructor(value) {
    super();
    this.value = value;
  }
  getAsNumber() {
    return this.value;
  }
}

export class BooleanModel extends TemplateBooleanModel {
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

export class DateModel extends TemplateDateModel {
  constructor(value) {
    super();
    this.value = value;
  }
  getAsDate() {
    return this.value;
  }
}

export class SequenceModel extends TemplateSequenceModel {
  constructor(items, wrapper) {
    super();
    this.items = items;
    this.wrapper = wrapper ?? null;
  }
  getByIndex(i) {
    if (i < 0 || i >= this.items.length) return null;
    const v = this.items[i];
    return this.wrapper ? this.wrapper.wrap(v) : v;
  }
  size() {
    return this.items.length;
  }
}

// Keys are plain strings; source is a Map or a plain object.
export class HashModel extends TemplateHashModelEx {
  constructor(source, wrapper) {
    super();
    this.source = source;
    this.wrapper = wrapper ?? null;
    this.isMap = source instanceof Map;
  }
  _wrap(v) {
    return this.wrapper ? this.wrapper.wrap(v) : v;
  }
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
  keys() {
    return this.isMap ? [...this.source.keys()].map(String) : Object.keys(this.source);
  }
  values() {
    return this.isMap ? [...this.source.values()] : this.keys().map(k => this.source[k]);
  }
  size() {
    return this.isMap ? this.source.size : Object.keys(this.source).length;
  }
  isEmpty() {
    return this.size() === 0;
  }
}

export class MethodModel extends TemplateMethodModel {
  constructor(fn, name = null) {
    super();
    this.fn = fn;
    this.name = name;
  }
  // args arrive already unwrapped to plain JS values (← MethodCall).
  exec(env, args = []) {
    return env.wrap(this.fn(...args));
  }
}

// 0..size-1 mapping over a numeric range ← freemarker.core.Range's model.
export class RangeModel extends TemplateSequenceModel {
  constructor(from, to, endType) {
    super();
    this.from = from;
    this.to = to; // null = unbounded open end
    this.endType = endType;
    this.sizeValue = to === null ? null : (endType === 'exclusive' ? to - from : to - from + 1);
  }
  getByIndex(i) {
    if (i < 0) return null;
    const v = this.from + i;
    if (this.sizeValue !== null && i >= this.sizeValue) return null;
    return new NumberModel(v);
  }
  size() {
    if (this.sizeValue === null) {
      throw new UnsupportedFeatureException('Unbounded range size is not supported yet.');
    }
    return this.sizeValue;
  }
}

export { TemplateModel };
