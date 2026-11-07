// Literal nodes <- NumberLiteral, StringLiteral, BooleanLiteral, ListLiteral, HashLiteral.

import { Expression } from './expression.js';
import { ftlQuote } from '../../../utility/stringUtil.js';
import { NumberModel } from '../../../model/models.js';

/** Number literal <- NumberLiteral. */
export class NumberLiteral extends Expression {
  /** @param {number} value @param {import('../../../format/decimal.js').Decimal|null} [dec] */
  constructor(value, dec = null) {
    super();
    this.value = value;
    this.dec = dec; // <- exact BigDecimal-style value from the literal image
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.dec !== null ? this.dec.toPlainString() : String(this.value);
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  * evaluate(env) {
    if (this.dec !== null) return new NumberModel(this.dec.toNumber(), this.dec);
    return env.wrap(this.value);
  }
}

/** String literal <- StringLiteral. */
export class StringLiteral extends Expression {
  /** @param {string} value */
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
  * evaluate(env) {
    return env.wrap(this.value);
  }
}

/** Boolean literal <- BooleanLiteral. */
export class BooleanLiteral extends Expression {
  /** @param {boolean} value */
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
  * evaluate(env) {
    return env.wrap(this.value);
  }
}

/** List literal <- ListLiteral. */
export class ListLiteral extends Expression {
  /** @param {Expression[]} items */
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
  * evaluate(env) {
    const items = [];
    for (const i of this.items) items.push(yield* i.evaluate(env));
    return env.wrap(items);
  }
}

/** Hash literal <- HashLiteral. */
export class HashLiteral extends Expression {
  /** @param {Expression[]} keys @param {Expression[]} values */
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
  * evaluate(env) {
    const map = new Map();
    for (let i = 0; i < this.keys.length; i++) {
      const k = yield* this.keys[i].evaluate(env);
      const s = yield* env.coerceToString(k, ' used as a hash-literal key');
      map.set(s, yield* this.values[i].evaluate(env));
    }
    return env.wrap(map);
  }
}
