// ← freemarker.core.MethodCall: target(args). Named parameters (<@> / #macro) land in M9.

import { Expression } from './expression.js';
import { InvalidReferenceException, NonMethodException } from '../../../errors.js';
import { TemplateMethodModel } from '../../../model/templateModel.js';
import { unwrap } from '../../../model/unwrap.js';

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
  evaluate(env) {
    let t;
    let preCalled = false;
    if (typeof this.target._evaluateForMethodCall === 'function') {
      // ← BeforeMethodCall path (ZeroArgumentNonVoidMethodPolicy at Dot/DynamicKeyName).
      [t, preCalled] = this.target._evaluateForMethodCall(env, this.args);
      if (preCalled) return t;
    } else {
      t = this.target.evaluate(env);
    }
    if (t === null || t === undefined) {
      throw new InvalidReferenceException(
        `The expression ${this.target.getCanonicalForm()} evaluated to null or missing `
        + '(can\'t be called as a method).');
    }
    if (t.isFunctionModel === true) {
      // ← Environment.invokeFunction: an FTL #function called as f(args)
      const models = this.args.map((a) => a.evaluate(env));
      return t.invoke(env, { positionalArgs: models, namedArgs: new Map() });
    }
    if (!(t instanceof TemplateMethodModel)) {
      throw new NonMethodException(
        `Can't call ${this.target.getCanonicalForm()}: it is a ${env.typeLabel(t)}, not a method.`);
    }
    const raw = this.args.map(a => unwrap(a.evaluate(env)));
    return t.exec(env, raw);
  }
}
