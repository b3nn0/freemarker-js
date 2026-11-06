// ← freemarker.core.BuiltIn: target?key (named-argument form lands with M10/M11).

import { Expression } from './expression.js';
import { getBuiltIn } from '../../../builtins/registry.js';
import { TemplateException } from '../../../errors.js';

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
