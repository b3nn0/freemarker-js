// ← freemarker.core.BuiltIn: target?key (named-argument form lands with M10/M11).

import { Expression } from './expression.js';

export class BuiltIn extends Expression {
  constructor(target, key) {
    super();
    this.target = target;
    this.key = key;
  }
  getCanonicalForm() {
    return `${this.target.getCanonicalForm()}?${this.key}`;
  }
}
