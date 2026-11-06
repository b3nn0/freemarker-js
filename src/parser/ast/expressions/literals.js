// Literal nodes ← NumberLiteral, StringLiteral, BooleanLiteral, ListLiteral, HashLiteral.

import { Expression } from './expression.js';
import { ftlQuote } from '../../../utility/stringUtil.js';

export class NumberLiteral extends Expression {
  constructor(value) {
    super();
    this.value = value;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return String(this.value);
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    return env.wrap(this.value);
  }
}

export class StringLiteral extends Expression {
  constructor(value) {
    super();
    this.value = value;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return ftlQuote(this.value);
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    return env.wrap(this.value);
  }
}

export class BooleanLiteral extends Expression {
  constructor(value) {
    super();
    this.value = value;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.value ? 'true' : 'false';
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    return env.wrap(this.value);
  }
}

export class ListLiteral extends Expression {
  constructor(items) {
    super();
    this.items = items;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `[${this.items.map(i => i.getCanonicalForm()).join(', ')}]`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
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
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const parts = this.keys.map((k, i) => `${k.getCanonicalForm()}: ${this.values[i].getCanonicalForm()}`);
    return `{${parts.join(', ')}}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    const map = new Map();
    this.keys.forEach((k, i) => {
      map.set(env.coerceToString(k.evaluate(env), ' used as a hash-literal key'), this.values[i].evaluate(env));
    });
    return env.wrap(map);
  }
}
