// Generator-based green-thread core: one evaluation core, two drivers.
// Every frame on the transitive path to a model/loader callback is a generator;
// at each async boundary it yields a `{ op, promise }` token up to the driver
// instead of consuming the promise itself. runSync() turns a token into an
// error; runAsync() awaits it. <- the co-routine technique; upstream Java has no
// analogue (its engine is simply sync), see UPSTREAM.md.

import { AsyncOperationNotAllowedException } from './errors.js';

/**
 * @param {unknown} v
 * @returns {boolean} any thenable (Promise or compatible)
 */
export function isThenable(v) {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

/**
 * @param {unknown} v
 * @returns {boolean} a (not-yet-exhausted or exhausted) generator object
 */
export function isGenerator(v) {
  return !!v && typeof v === 'object' && typeof v.next === 'function'
    && typeof v.throw === 'function' && typeof v[Symbol.iterator] === 'function';
}

/**
 * @param {unknown} v
 * @returns {{ op: string, promise: unknown }|null} the async token form, or null
 */
function asyncToken(v) {
  if (isThenable(v)) return { op: 'unknown callback', promise: v };
  if (v !== null && typeof v === 'object' && isThenable(v.promise)) return v;
  return null;
}

/**
 * Await-or-passthrough helper for use inside generators: plain values return
 * directly; thenables yield the token; generators (internal model protocols)
 * are delegated through.
 * @param {string} op - description of the callback for sync-mode error messages
 * @param {unknown} v - the raw result of a callback call
 * @returns {Generator<unknown, any, any>}
 */
export function* awaitOp(op, v) {
  if (isThenable(v)) return yield { op, promise: v };
  if (isGenerator(v)) return yield* v;
  return v;
}

/**
 * Calls a model-protocol method (get / getByIndex / exec / invoke) honoring the
 * await discipline; the implementation may be sync (plain value), async-capable
 * (returns a Promise) or a port-internal generator.
 * @param {string} op
 * @param {Object} recv - the model object
 * @param {string} method - protocol method name
 * @param {...unknown} args
 * @returns {Generator<unknown, any, any>}
 */
export function* callOp(op, recv, method, ...args) {
  return yield* awaitOp(op, recv[method](...args));
}

/**
 * Pumps the render generator synchronously: an async token is engine misuse in
 * sync mode, so it is thrown back into the generator (letting #attempt recover
 * it and the visit stack decorate it), where it re-escapes if unhandled.
 * @param {Generator<unknown, unknown, unknown>} it - the top-level render iterator
 * @returns {unknown} the generator's return value
 * @throws {AsyncOperationNotAllowedException} when a callback returns a promise
 */
export function runSync(it) {
  let step = it.next();
  while (!step.done) {
    if (isGenerator(step.value)) {
      step = it.throw(new Error(
        'Internal port bug: a generator was yielded without yield* delegation.'));
      continue;
    }
    const tok = asyncToken(step.value);
    if (tok !== null) {
      step = it.throw(new AsyncOperationNotAllowedException(tok.op));
      continue;
    }
    step = it.next(step.value);
  }
  return step.value;
}

/**
 * Pumps the render generator asynchronously: tokens are awaited and the value
 * is sent back in; a rejection is delivered into the generator (gen.throw) so
 * #attempt/#recover and finally-unwinding inside the engine still run.
 * @param {Generator<unknown, unknown, unknown>} it
 * @returns {Promise<unknown>} the generator's return value
 */
export async function runAsync(it) {
  let step = it.next();
  while (!step.done) {
    if (isGenerator(step.value)) {
      step = it.throw(new Error(
        'Internal port bug: a generator was yielded without yield* delegation.'));
      continue;
    }
    const tok = asyncToken(step.value);
    if (tok === null) {
      step = it.next(step.value);
      continue;
    }
    let value;
    try {
      value = await tok.promise;
    } catch (e) {
      step = it.throw(e);
      continue;
    }
    step = it.next(value);
  }
  return step.value;
}
