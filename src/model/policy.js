// Zero-argument function-property handling <- ZeroArgumentNonVoidMethodPolicy,
// simplified to one knob for all model sources (no record/class split, no
// getX/isX bean-reader carve-out -- Java artifacts; see UPSTREAM.md).

/**
 * How a hash value that is a zero-argument JS function (e.g. a method stored on a
 * plain object or class instance in the data model) behaves when a template reads
 * the property **without** parentheses, as in `${h.name}`. Reads with parentheses
 * (`${h.name(args...)}`) always invoke the function with those args, under either
 * policy; functions that declare at least one parameter (fn.length !== 0) are never
 * property-like and always stay callable values.
 * @type {{ AUTO_INVOKE: string, METHOD_ONLY: string }}
 */
export const ZeroArgumentPolicy = Object.freeze({
  /**
   * Default. A bare property read of a 0-arg function auto-invokes it with no
   * arguments and yields its (wrapped) return value: `${h.x}` == `${h.x()}` for
   * `x() {}` (async returns are awaited in async mode). The function itself is
   * not reachable as a value through such a read. Applies uniformly to plain
   * objects, Maps, and class instances (no Java record/bean-name carve-outs).
   */
  AUTO_INVOKE: 'AUTO_INVOKE',
  /**
   * A bare property read returns the function as a callable model (`?is_method`
   * is true, it can be passed around); only parenthesized syntax invokes it:
   * `${h.x()}` / `${h.x(1)}`. This is upstream 2.3's default for non-records
   * (METHOD_ONLY); the port makes it the opt-in mode.
   */
  METHOD_ONLY: 'METHOD_ONLY',
});

/**
 * Should a zero-argument function property be read as a value ("property-like")?
 * @param {import('../configuration.js').Configuration} configuration
 * @param {unknown} fn - the property value
 * @returns {boolean}
 */
export function zeroArgFunctionIsProperty(configuration, fn) {
  return typeof fn === 'function' && fn.length === 0
    && configuration.getZeroArgumentPolicy() !== ZeroArgumentPolicy.METHOD_ONLY;
}
