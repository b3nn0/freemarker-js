// ← freemarker.core.BuiltIn: target?key; positional (args) consumption landed with M10/M11.

import { Expression } from './expression.js';
import { getBuiltIn } from '../../../builtins/registry.js';
import '../../../builtins/index.js'; // registers the milestone's built-ins (side effect)
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
    const args = this.args === null
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
      // ← upstream reports unknown built-ins at parse time; the registry fills by
      // milestone, so this port detects at run time (deviation in UPSTREAM.md).
      throw new TemplateException(`There is no such built-in: ${this.key}`);
    }
    let target;
    if (spec.acceptsMissing) {
      // ← ExistenceBuiltIn.evalMaybeNonexistentTarget: a missing target becomes null
      try {
        target = this.target.evaluate(env);
      } catch (e) {
        if (e instanceof InvalidReferenceException) target = null;
        else throw e;
      }
    } else {
      target = this.target.evaluate(env);
      if (target === null || target === undefined) {
        // ← the type-bound BuiltInForXxx classes reject null targets
        throw new InvalidReferenceException(
          `The "?${this.key}" built-in needs a value, but its target has evaluated to `
          + 'null or missing.');
      }
    }
    return spec.impl(target, this.args === null ? [] : this.args, env);
  }
}
