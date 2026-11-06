// ← freemarker.core.MethodCall: target(args). Named parameters (<@> / #macro) land in M9.

import { Expression } from './expression.js';
import { InvalidReferenceException, NonMethodException } from '../../../errors.js';
import { MethodModel } from '../../../model/models.js';
import { unwrap } from '../../../model/unwrap.js';

export class MethodCall extends Expression {
  constructor(target, args) {
    super();
    this.target = target;
    this.args = args;
  }
  getCanonicalForm() {
    return `${this.target.getCanonicalForm()}(${this.args.map(a => a.getCanonicalForm()).join(', ')})`;
  }
  evaluate(env) {
    const t = this.target.evaluate(env);
    if (t === null || t === undefined) {
      throw new InvalidReferenceException(
        `The expression ${this.target.getCanonicalForm()} evaluated to null or missing `
        + '(can\'t be called as a method).');
    }
    if (!(t instanceof MethodModel)) {
      throw new NonMethodException(
        `Can't call ${this.target.getCanonicalForm()}: it is a ${env.typeLabel(t)}, not a method.`);
    }
    const raw = this.args.map(a => unwrap(a.evaluate(env)));
    return t.exec(env, raw);
  }
}
