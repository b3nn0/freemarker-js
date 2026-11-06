// ${...} (and [=...], canonicalized to ${...}). ← freemarker.core.DollarVariable (Interpolation).

import { TemplateElement } from './templateElement.js';
import { InvalidReferenceException } from '../../errors.js';

export class Interpolation extends TemplateElement {
  constructor(expression) {
    super();
    this.expression = expression;
  }

  execute(env) {
    const value = this.expression.evaluate(env);
    if (value === null || value === undefined) {
      throw new InvalidReferenceException(
        `The following has evaluated to null or missing: ==> ${this.expression.getCanonicalForm()}`);
    }
    env.output.write(env.coerceToString(value, ' (output of an interpolation)'));
    return null;
  }

  getCanonicalForm() {
    return `\${${this.expression.getCanonicalForm()}}`;
  }
}
