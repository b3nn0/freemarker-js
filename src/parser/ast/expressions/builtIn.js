// ← freemarker.core.BuiltIn: target?key (named-argument form lands with M10/M11).

import { Expression } from './expression.js';
import { getBuiltIn } from '../../../builtins/registry.js';
import { HashModel } from '../../../model/models.js';
import { InvalidReferenceException, TemplateException } from '../../../errors.js';

// ← freemarker.core.BuiltinVariable: the leading-dot special variables. Only .args lands in M9.
export class BuiltinVariable extends Expression {
  constructor(name) {
    super();
    this.name = name;
  }
  getCanonicalForm() {
    return `.${this.name}`;
  }
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
  constructor(target, key) {
    super();
    this.target = target;
    this.key = key;
  }
  getCanonicalForm() {
    return `${this.target.getCanonicalForm()}?${this.key}`;
  }
  evaluate(env) {
    const spec = getBuiltIn(this.key);
    if (!spec) {
      throw new TemplateException(`Unknown builtin: ${this.key}`);
    }
    const target = this.target.evaluate(env);
    if (target === null || target === undefined) return null; // null propagation
    return spec.impl(target, [], env);
  }
}
