// Literal nodes ← NumberLiteral, StringLiteral, BooleanLiteral, ListLiteral, HashLiteral.

import { Expression } from './expression.js';
import { ftlQuote } from '../../../utility/stringUtil.js';

export class NumberLiteral extends Expression {
  constructor(value) {
    super();
    this.value = value;
  }
  getCanonicalForm() {
    return String(this.value);
  }
  evaluate(env) {
    return env.wrap(this.value);
  }
}

export class StringLiteral extends Expression {
  constructor(value) {
    super();
    this.value = value;
  }
  getCanonicalForm() {
    return ftlQuote(this.value);
  }
  evaluate(env) {
    return env.wrap(this.value);
  }
}

export class BooleanLiteral extends Expression {
  constructor(value) {
    super();
    this.value = value;
  }
  getCanonicalForm() {
    return this.value ? 'true' : 'false';
  }
  evaluate(env) {
    return env.wrap(this.value);
  }
}

export class ListLiteral extends Expression {
  constructor(items) {
    super();
    this.items = items;
  }
  getCanonicalForm() {
    return `[${this.items.map(i => i.getCanonicalForm()).join(', ')}]`;
  }
  evaluate(env) {
    return env.wrap(this.items.map(i => i.evaluate(env)));
  }
}

export class HashLiteral extends Expression {
  constructor(keys, values) {
    super();
    this.keys = keys;
    this.values = values;
  }
  getCanonicalForm() {
    const parts = this.keys.map((k, i) => `${k.getCanonicalForm()}: ${this.values[i].getCanonicalForm()}`);
    return `{${parts.join(', ')}}`;
  }
  evaluate(env) {
    const map = new Map();
    this.keys.forEach((k, i) => map.set(k.value, this.values[i].evaluate(env)));
    return env.wrap(map);
  }
}
