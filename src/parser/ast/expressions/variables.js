// Variable reference nodes ← Identifier, Dot (DynamicKeyName lands in M5).

import { Expression } from './expression.js';
import { backslashEscapeIdentifier } from '../../../utility/stringUtil.js';

export class Identifier extends Expression {
  constructor(name) {
    super();
    this.name = name;
  }
  getCanonicalForm() {
    return backslashEscapeIdentifier(this.name);
  }
}

export class Dot extends Expression {
  constructor(target, key) {
    super();
    this.target = target;
    this.key = key;
  }
  getCanonicalForm() {
    return `${this.target.getCanonicalForm()}.${backslashEscapeIdentifier(this.key)}`;
  }
}
