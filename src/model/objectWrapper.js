// ← SimpleObjectWrapper-like default wrapper (see UPSTREAM.md decisions).
// WeakMap identity cache ← the IntrospectionCache analogue: one model per wrapped object.

import { TemplateModel } from './templateModel.js';
import { StringModel, NumberModel, BooleanModel, DateModel, SequenceModel, HashModel, MethodModel } from './models.js';

export class SimpleObjectWrapper {
  constructor() {
    this._cache = new WeakMap();
  }

  wrap(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof TemplateModel) return value;
    switch (typeof value) {
      case 'string': return new StringModel(value);
      case 'number': return new NumberModel(value);
      case 'boolean': return value ? BooleanModel.TRUE : BooleanModel.FALSE;
      case 'function': return new MethodModel(value);
      default: break;
    }
    if (value instanceof Date) return new DateModel(value);
    const cached = this._cache.get(value);
    if (cached) return cached;
    let model;
    if (Array.isArray(value)) model = new SequenceModel(value, this);
    else if (value instanceof Map) model = new HashModel(value, this);
    else if (typeof value === 'object') model = new HashModel(value, this);
    else return null;
    this._cache.set(value, model);
    return model;
  }
}
