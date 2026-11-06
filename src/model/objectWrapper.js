// ← SimpleObjectWrapper-like default wrapper (see UPSTREAM.md decisions).

import { TemplateModel } from './templateModel.js';
import { StringModel, NumberModel, BooleanModel, DateModel, SequenceModel, HashModel, MethodModel } from './models.js';

export class SimpleObjectWrapper {
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
    if (Array.isArray(value)) return new SequenceModel(value, this);
    if (value instanceof Map) return new HashModel(value, this);
    if (typeof value === 'object') return new HashModel(value, this);
    return null;
  }
}
