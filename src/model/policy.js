// ← freemarker.ext.beans.ZeroArgumentNonVoidMethodPolicy (3 values kept for API parity;
// BOTH ≡ PROPERTY_ONLY in the JS port, see UPSTREAM.md).

export const ZeroArgumentNonVoidMethodPolicy = Object.freeze({
  METHOD_ONLY: 'METHOD_ONLY',
  PROPERTY_ONLY_UNLESS_BEAN_PROPERTY_READ_METHOD: 'PROPERTY_ONLY_UNLESS_BEAN_PROPERTY_READ_METHOD',
  BOTH_METHOD_AND_PROPERTY_UNLESS_BEAN_PROPERTY_READ_METHOD: 'BOTH_METHOD_AND_PROPERTY_UNLESS_BEAN_PROPERTY_READ_METHOD',
});

// ← Java-record analogue: plain object literal (no class prototype).
/**
 * Whether a value looks like a Java "record" — here: a plain object literal.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRecordLike(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Map) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Bean property read method naming: getX / isX — exempt from the policies (always methods).
 * @param {unknown} name
 * @returns {boolean}
 */
export function isBeanReaderStyleName(name) {
  if (typeof name !== 'string') return false;
  if (name.length > 3 && name.startsWith('get')) {
    const c = name[3];
    return c >= 'A' && c <= 'Z';
  }
  if (name.length > 2 && name.startsWith('is')) {
    const c = name[2];
    return c >= 'A' && c <= 'Z';
  }
  return false;
}

/**
 * Picks the policy for a property source: record-like sources get the record policy.
 * @param {import('../configuration.js').Configuration} configuration
 * @param {unknown} source
 * @returns {string} one of ZeroArgumentNonVoidMethodPolicy
 */
export function resolvePolicy(configuration, source) {
  return isRecordLike(source)
    ? configuration.getRecordZeroArgumentNonVoidMethodPolicy()
    : configuration.getDefaultZeroArgumentNonVoidMethodPolicy();
}

/**
 * Should a zero-argument function property be read as a value ("property-like")?
 * @param {import('../configuration.js').Configuration} configuration
 * @param {unknown} source - the object holding the property
 * @param {string} key - the property name
 * @param {unknown} fn - the property value
 * @returns {boolean}
 */
export function zeroArgFunctionIsProperty(configuration, source, key, fn) {
  if (typeof fn !== 'function' || fn.length !== 0) return false;
  if (isBeanReaderStyleName(key)) return false;
  return resolvePolicy(configuration, source) !== ZeroArgumentNonVoidMethodPolicy.METHOD_ONLY;
}
