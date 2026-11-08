// Shared helpers for the built-in implementations <- BuiltIn.java's protected helpers
// (checkMethodArgCount) and the BuiltInWithDirectCallOptimization BIMethod pattern.

import { TemplateMethodModel } from '../model/templateModel.js';
import { awaitOp, callOp, isGenerator } from '../async.js';
import {
  NonStringException, TemplateException, NonSequenceOrCollectionException,
} from '../errors.js';

/**
 * <- _MessageUtil.newArgCntError.
 * @param {string} key - built-in name without "?"
 * @param {number} argCnt
 * @param {number} minCnt
 * @param {number} maxCnt - may be Infinity
 * @returns {TemplateException}
 */
export function argCntError(key, argCnt, minCnt, maxCnt) {
  let expects;
  if (minCnt === maxCnt) {
    expects = maxCnt === 0 ? 'no' : String(maxCnt);
  } else if (maxCnt - minCnt === 1) {
    expects = `${minCnt} or ${maxCnt}`;
  } else if (maxCnt === Infinity) {
    expects = `${minCnt} or more (unlimited)`;
  } else {
    expects = `${minCnt} to ${maxCnt}`;
  }
  const received = argCnt === 0 ? 'none' : String(argCnt);
  return new TemplateException(
    `?${key}(...) expects ${expects} argument${maxCnt > 1 ? 's' : ''} `
    + `but has received ${received} argument${argCnt === 1 ? '' : 's'}.`);
}

/**
 * A built-in that evaluates to a method, called later through MethodCall syntax
 * <- the BIMethod inner classes of the arg-taking built-ins.
 */
export class BuiltinArgMethod extends TemplateMethodModel {
  /**
   * @param {string} name - built-in name (for arity errors)
   * @param {number} minArgs
   * @param {number} maxArgs - may be Infinity
   * @param {(env: import('../environment.js').Environment, args: unknown[]) => Object} fn
   *   args arrive already unwrapped (<- MethodCall)
   */
  constructor(name, minArgs, maxArgs, fn) {
    super();
    this.name = name;
    this.minArgs = minArgs;
    this.maxArgs = maxArgs;
    this.fn = fn;
  }

  /**
   * @param {import('../environment.js').Environment} env
   * @param {unknown[]} args - unwrapped plain JS values
   * @returns {Generator<unknown, import('../model/templateModel.js').TemplateModel, unknown>}
   */
  * exec(env, args) {
    if (args.length < this.minArgs || args.length > this.maxArgs) {
      throw argCntError(this.name, args.length, this.minArgs, this.maxArgs);
    }
    // Callbacks may be plain functions (pure) or generator functions (they call
    // into models/expressions); both are accepted here.
    const r = this.fn(env, args);
    return isGenerator(r) ? yield* r : r;
  }
}

/**
 * Coerce an unwrapped method argument to a string <- BuiltIn.getStringMethodArg.
 * @param {unknown} v
 * @param {import('../environment.js').Environment} env
 * @returns {string}
 */
export function stringMethodArg(v, env) {
  if (typeof v === 'string') return v;
  throw new NonStringException(
    `Expected a string argument, but the argument is a ${env.typeLabel(env.wrap(v))}.`);
}

/**
 * Materializes the elements through getByIndex so raw data-model values become models.
 * Generator form: user sequence models can be async (see async.js).
 * @param {Object} target
 * @param {import('../environment.js').Environment} [env] - wraps raw bean returns
 * @returns {Generator<unknown, Object[]|null, unknown>} the element models, or null when not a sequence
 */
export function* sequenceItems(target, env = null) {
  if (target && typeof target.getByIndex === 'function' && typeof target.size === 'function') {
    const n = yield* awaitOp('sequence size', target.size());
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = yield* callOp(`sequence element ${i}`, target, 'getByIndex', i);
      out[i] = env && !(v instanceof Object) ? env.wrap(v) : v;
    }
    return out;
  }
  return null;
}

/**
 * @param {string} key - built-in name for the message
 * @param {Object} target
 * @param {import('../environment.js').Environment} env
 * @returns {TemplateException}
 */
export function nonSequenceError(key, target, env) {
  return new NonSequenceOrCollectionException(
    `The "?${key}" built-in can only be used on sequences (lists), `
    + `but the target is a ${env.typeLabel(target)}.`);
}
