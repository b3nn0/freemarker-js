// <- SimpleObjectWrapper-like default wrapper (see UPSTREAM.md decisions).
// WeakMap identity cache <- the IntrospectionCache analogue: one model per wrapped object.

import { TemplateModel } from './templateModel.js';
import { isModelLike } from './capabilities.js';
import { StringModel, NumberModel, BooleanModel, DateModel, SequenceModel, HashModel, MethodModel } from './models.js';

/**
 * Maps plain JS values to TemplateModel instances; the same wrapped object always
 * yields the same model instance (WeakMap identity cache).
 */
export class SimpleObjectWrapper {
  /** Creates an empty wrapper (the cache is per instance). */
  constructor() {
    this._cache = new WeakMap();
  }

  /**
   * @param {unknown} value - any JS value; models pass through
   * @param {unknown} [owner] - the object/array a function value was read from; it becomes
   *   the receiver of the call (<- upstream SimpleMethodModel keeps the bean). Omitted for
   *   values that came from nowhere (literals, arguments), which then get no receiver.
   * @returns {import('./templateModel.js').TemplateModel|null} null for null/undefined/unsupported
   */
  wrap(value, owner = null) {
    if (value === null || value === undefined) return null;
    if (value instanceof TemplateModel) return value;
    switch (typeof value) {
      case 'string': return new StringModel(value);
      case 'number': return new NumberModel(value);
      case 'boolean': return value ? BooleanModel.TRUE : BooleanModel.FALSE;
      case 'function': return new MethodModel(value, null, owner);
      default: break;
    }
    if (value instanceof Date) return new DateModel(value);
    // <- capability duck: a bean implementing a model contract (its required
    // methods) passes through unwrapped, like the JVM's "instanceof
    // TemplateXxxModel" rule. Map/Set are excluded: their get/keys/values are
    // built-ins, not model contracts.
    if (isModelLike(value) && !(value instanceof Map) && !(value instanceof Set)) return value;
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
