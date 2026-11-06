// ${...} (and [=...], canonicalized to ${...}). ← freemarker.core.DollarVariable (Interpolation).

import { TemplateElement } from './templateElement.js';
import { UnsupportedFeatureException } from '../../errors.js';

export class Interpolation extends TemplateElement {
  constructor(expression) {
    super();
    this.expression = expression;
  }

  execute(env) {
    throw new UnsupportedFeatureException('Interpolation output lands in M4.');
  }

  getCanonicalForm() {
    return `\${${this.expression.getCanonicalForm()}}`;
  }
}
