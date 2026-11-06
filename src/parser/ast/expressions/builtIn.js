// ← freemarker.core.BuiltIn: target?key (named-argument form lands with M10/M11).

import { Expression } from './expression.js';
import { getBuiltIn } from '../../../builtins/registry.js';
import '../../../builtins/sequences.js'; // registers the sequence built-ins (side effect)
import { HashModel } from '../../../model/models.js';
import { InvalidReferenceException, TemplateException } from '../../../errors.js';

// ← freemarker.core.BuiltinVariable: the leading-dot special variables. Only .args lands in M9.
export class BuiltinVariable extends Expression {
  constructor(name) {
    super();
    this.name = name;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `.${this.name}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    if (this.name === 'args') {
      for (let i = env._scopes.length - 1; i >= 0; i--) {
        const s = env._scopes[i];
        if (s.isMacroScope) {
          const v = s.get('__args__');
          return v === undefined ? new HashModel(new Map()) : v;
        }
      }
      throw new InvalidReferenceException(
        'The "args" special variable is only available inside a macro or function.');
    }
    throw new TemplateException(`Unsupported special variable .${this.name}`);
  }
}

export class BuiltIn extends Expression {
  // args: Expression[] | null — raw argument expressions; builtins that accept
  // lambda arguments receive the unevaluated nodes (← BuiltInWithParseTimeParameters).
  constructor(target, key, args = null) {
    super();
    this.target = target;
    this.key = key;
    this.args = args;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const args = this.args === null || this.args.length === 0
      ? '' : `(${this.args.map((a) => a.getCanonicalForm()).join(', ')})`;
    return `${this.target.getCanonicalForm()}?${this.key}${args}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    const spec = getBuiltIn(this.key);
    if (!spec) {
      throw new TemplateException(`Unknown builtin: ${this.key}`);
    }
    const target = this.target.evaluate(env);
    if (target === null || target === undefined) return null; // null propagation
    return spec.impl(target, this.args === null ? [] : this.args, env);
  }
}
