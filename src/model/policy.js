// Zero-argument function-property handling <- ZeroArgumentNonVoidMethodPolicy,
// simplified to one knob for all model sources (no record/class split -- Java artifact;
// see UPSTREAM.md). The bean-reader carve-out of the upstream policies is in place for
// the kinds of model the port applies getter naming to (beanNaming.js).

import { beanPropertyNameFromReaderName } from './beanNaming.js';

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
   * objects, Maps, and class instances (no Java record split). The exception is a
   * name that is itself a bean reader name (getFoo/isFoo on a non-Map model): that
   * member stays a callable value, because the bare property it reads for is the
   * value (`${o.foo}` == `${o.getFoo()}`), as upstream carves bean readers out.
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
 * When `key` is the property name and it is a JavaBeans reader name (getFoo/isFoo), the
 * function stays a callable value even under AUTO_INVOKE <- upstream keeps bean property
 * readers out of the zero-argument-method policies (ClassIntrospector's
 * beanPropertyReadMethodNameCollector; JVM: ${cust.getName} reports ?is_method true under
 * both its auto-invoking and its default policy). Pass `key` only for the hash kinds the
 * reader naming applies to (object-backed hashes; Maps are exact-key only).
 * @param {import('../configuration.js').Configuration} configuration
 * @param {unknown} fn - the property value
 * @param {string} [key] - the property name the value was read under
 * @returns {boolean}
 */
export function zeroArgFunctionIsProperty(configuration, fn, key = undefined) {
  if (typeof fn !== 'function' || fn.length !== 0) return false;
  if (configuration.getZeroArgumentPolicy() === ZeroArgumentPolicy.METHOD_ONLY) return false;
  return !(typeof key === 'string' && beanPropertyNameFromReaderName(key) !== null);
}
