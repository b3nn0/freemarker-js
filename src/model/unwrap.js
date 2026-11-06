// Deep unwrap of models back to plain JS values (← BeansWrapper "wrapper" removal,
// used when handing arguments to JS functions).

import { StringModel, NumberModel, BooleanModel, DateModel, SequenceModel, HashModel, MethodModel } from './models.js';

/**
 * Recursively converts models back to plain JS values (for handing arguments to JS
 * functions). Unrelated values pass through unchanged.
 * @param {TemplateModel|null|undefined|unknown} model
 * @returns {unknown} a plain string / number / boolean / Date / Array / Map / object, or null
 */
export function unwrap(model) {
  if (model === null || model === undefined) return null;
  if (model instanceof StringModel) return model.value;
  if (model instanceof NumberModel) return model.value;
  if (model instanceof BooleanModel) return model.value;
  if (model instanceof DateModel) return model.value;
  if (model instanceof MethodModel) return model.fn;
  if (model instanceof SequenceModel) return model.items.map(unwrap);
  if (model instanceof HashModel) {
    if (model.isMap) {
      const out = new Map();
      for (const [k, v] of model.source) out.set(k, unwrap(v));
      return out;
    }
    const out = {};
    for (const k of Object.keys(model.source)) out[k] = unwrap(model.source[k]);
    return out;
  }
  return model;
}
