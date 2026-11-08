// Capability checks replacing interface instanceof (JS has no multiple
// inheritance): a value behaves as a model kind if it implements that kind's
// contract methods, mirroring the JVM's "implements TemplateXxxModel" rule.
// <- ClassUtil.appendTemplateModelTypeName (JVM checks the interfaces).

/** @param {unknown} v @returns {boolean} */
export function isScalarModel(v) {
  return v !== null && v !== undefined && typeof v.getAsString === 'function';
}

/** @param {unknown} v @returns {boolean} */
export function isNumberModel(v) {
  return v !== null && v !== undefined && typeof v.getAsNumber === 'function';
}

/** @param {unknown} v @returns {boolean} */
export function isBooleanModel(v) {
  return v !== null && v !== undefined && typeof v.getAsBoolean === 'function';
}

/** @param {unknown} v @returns {boolean} */
export function isDateModel(v) {
  return v !== null && v !== undefined && typeof v.getAsDate === 'function';
}

/** @param {unknown} v @returns {boolean} */
export function isSequenceModel(v) {
  return v !== null && v !== undefined && typeof v.getByIndex === 'function'
    && typeof v.size === 'function';
}

/** @param {unknown} v @returns {boolean} */
export function isHashModel(v) {
  return v !== null && v !== undefined && typeof v.get === 'function';
}

/** @param {unknown} v @returns {boolean} */
export function isHashModelEx(v) {
  return isHashModel(v) && typeof v.keys === 'function' && typeof v.values === 'function';
}

/** @param {unknown} v @returns {boolean} */
export function isMethodModel(v) {
  return v !== null && v !== undefined && typeof v.exec === 'function';
}

/** @param {unknown} v @returns {boolean} */
export function isTransformModel(v) {
  return v !== null && v !== undefined
    && (v.isTransform === true || typeof v.getWriter === 'function');
}

/**
 * True when a plain (non-TemplateModel) object implements one of the model
 * contracts closely enough to be used as a model without wrapping.
 * "get" alone is NOT a contract here, to avoid hijacking plain data objects
 * that happen to have a get() method.
 * @param {unknown} v @returns {boolean}
 */
export function isModelLike(v) {
  return v !== null && typeof v === 'object'
    && (isScalarModel(v) || isNumberModel(v) || isBooleanModel(v) || isDateModel(v)
      || isSequenceModel(v) || isHashModelEx(v) || isMethodModel(v) || isTransformModel(v));
}
