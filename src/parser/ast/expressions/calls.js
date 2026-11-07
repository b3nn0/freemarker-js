// ← freemarker.core.MethodCall: target(args). Named parameters (<@> / #macro) land in M9.

import { Expression } from './expression.js';
import { InvalidReferenceException, NonMethodException } from '../../../errors.js';
import { TemplateMethodModel } from '../../../model/templateModel.js';
import { unwrap } from '../../../model/unwrap.js';
import { callOp } from '../../../async.js';

/** f(x) ← MethodCall. */
export class MethodCall extends Expression {
  /** @param {Expression} target @param {Expression[]} args */
  constructor(target, args) {
    super();
    this.target = target;
    this.args = args;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `${this.target.getCanonicalForm()}(${this.args.map(a => a.getCanonicalForm()).join(', ')})`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  * evaluate(env) {
    let t;
    let preCalled = false;
    if (typeof this.target._evaluateForMethodCall === 'function') {
      // ← BeforeMethodCall path (ZeroArgumentPolicy at Dot/DynamicKeyName).
      [t, preCalled] = yield* this.target._evaluateForMethodCall(env, this.args);
      if (preCalled) return t;
    } else {
      t = yield* this.target.evaluate(env);
    }
    if (t === null || t === undefined) {
      throw new InvalidReferenceException(
        `The expression ${this.target.getCanonicalForm()} evaluated to null or missing `
        + '(can\'t be called as a method).');
    }
    if (t.isFunctionModel === true) {
      // ← Environment.invokeFunction: an FTL #function called as f(args)
      const models = [];
      for (const a of this.args) models.push(yield* a.evaluate(env));
      return yield* callOp(`function call "${this.target.getCanonicalForm()}"`, t, 'invoke', env,
        { positionalArgs: models, namedArgs: new Map() });
    }
    if (!(t instanceof TemplateMethodModel)) {
      throw new NonMethodException(
        `Can't call ${this.target.getCanonicalForm()}: it is a ${env.typeLabel(t)}, not a method.`);
    }
    const raw = [];
    for (const a of this.args) raw.push(unwrap(yield* a.evaluate(env)));
    return yield* callOp(`method call "${this.target.getCanonicalForm()}"`, t, 'exec', env, raw);
  }
}
