// ← freemarker.core.LocalLambdaExpression: `(a, b) -> exp` / `a -> exp`.
// Only legal as the argument of a few built-ins (?filter, ?map); it is not a value.

import { Expression } from './expression.js';
import { TemplateException } from '../../../errors.js';

/**
 * A locally-scoped lambda expression; only valid as the argument of a few built-ins.
 * @property {string[]} params - declared parameter names
 * @property {Object} rhs - the body expression (an OrExpression upstream)
 */
export class LocalLambdaExpression extends Expression {
  /**
   * @param {string[]} params
   * @param {Object} rhs
   */
  constructor(params, rhs) {
    super();
    this.params = params;
    this.rhs = rhs;
  }

  /**
   * A lambda is not a value in 2.3.36 — evaluating it as one is an error.
   * @throws {TemplateException} always
   */
  evaluate() {
    throw new TemplateException(
      'Can\'t get lambda expression as a value: Lambdas currently can only be used '
      + 'on a few special places.');
  }

  /**
   * ← LocalLambdaExpression.invokeLambdaDefinedFunction /
   * Environment.evaluateWithNewLocal: a single scope layer, visible to the body only.
   * @param {import('../../../environment.js').Environment} env
   * @param {Object[]} values - one model per declared parameter
   * @returns {Object} the rhs evaluated value
   */
  invoke(env, values) {
    const scope = new Map();
    this.params.forEach((p, i) => scope.set(p, values[i] === undefined ? null : values[i]));
    env._scopes.push(scope);
    try {
      return this.rhs.evaluate(env);
    } finally {
      env._scopes.pop();
    }
  }

  // ← LocalLambdaExpression.getCanonicalForm / LambdaParameterList.getCanonicalForm
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const lhs = this.params.length === 1
      ? this.params[0]
      : `(${this.params.join(', ')})`;
    return `${lhs} -> ${this.rhs.getCanonicalForm()}`;
  }
}
