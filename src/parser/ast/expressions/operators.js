// Operator nodes, canonical forms ← FTL.jj production actions.

import { Expression } from './expression.js';
import { InvalidReferenceException, TemplateException } from '../../../errors.js';
import { BooleanModel, RangeModel } from '../../../model/models.js';
import { TemplateSequenceModel, TemplateHashModel } from '../../../model/templateModel.js';

/** (...) ← ParentheticalExpression. */
export class ParentheticalExpression extends Expression {
  /** @param {Expression} expression */
  constructor(expression) {
    super();
    this.expression = expression;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `(${this.expression.getCanonicalForm()})`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    return this.expression.evaluate(env);
  }
}

// "+": sequence+sequence and hash+hash stay collections; number+number is arithmetic;
// otherwise both sides are coerced to strings ← AddConcatExpression.visit.
/** + (string/sequence concat) ← AddConcat. */
export class AddConcatExpression extends Expression {
  /** @param {Expression} left @param {Expression} right */
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `${this.left.getCanonicalForm()} + ${this.right.getCanonicalForm()}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    const l = this.left.evaluate(env);
    const r = this.right.evaluate(env);
    if (l instanceof TemplateSequenceModel && r instanceof TemplateSequenceModel) {
      const items = [];
      for (let i = 0; i < l.size(); i++) items.push(l.getByIndex(i));
      for (let i = 0; i < r.size(); i++) items.push(r.getByIndex(i));
      return env.wrap(items);
    }
    if (l instanceof TemplateHashModel && r instanceof TemplateHashModel) {
      const map = new Map();
      for (const k of l.keys()) map.set(k, l.get(k));
      for (const k of r.keys()) map.set(k, r.get(k));
      return env.wrap(map);
    }
    if (l && r && typeof l.getAsNumber === 'function' && typeof r.getAsNumber === 'function') {
      return env.wrap(l.getAsNumber() + r.getAsNumber());
    }
    return env.wrap(env.coerceToString(l) + env.coerceToString(r));
  }
}

/** - * / % ← ArithmeticExpression. */
export class ArithmeticExpression extends Expression {
  /** @param {Expression} left @param {Expression} right @param {string} operator */
  constructor(left, right, operator) {
    super();
    this.left = left;
    this.right = right;
    this.operator = operator; // subtract | multiply | divide | modulo
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const symbol = { subtract: '-', multiply: '*', divide: '/', modulo: '%' }[this.operator];
    return `${this.left.getCanonicalForm()} ${symbol} ${this.right.getCanonicalForm()}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    const l = env.toNumber(this.left.evaluate(env), ` on the left of "${this.operator}"`);
    const r = env.toNumber(this.right.evaluate(env), ` on the right of "${this.operator}"`);
    switch (this.operator) {
      case 'subtract': return env.wrap(l - r);
      case 'multiply': return env.wrap(l * r);
      case 'divide':
        if (r === 0) throw new TemplateException('Division by zero.');
        return env.wrap(l / r);
      default:
        if (r === 0) throw new TemplateException('Division by zero.');
        return env.wrap(l % r);
    }
  }
}

/** -x/+x ← UnaryPlusMinusExpression. */
export class UnaryPlusMinusExpression extends Expression {
  /** @param {Expression} target @param {boolean} isMinus */
  constructor(target, isMinus) {
    super();
    this.target = target;
    this.isMinus = isMinus;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `${this.isMinus ? '-' : '+'}${this.target.getCanonicalForm()}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    const v = env.toNumber(this.target.evaluate(env), ' after a unary +/- sign');
    return env.wrap(this.isMinus ? -v : +v);
  }
}

/** !x ← NotExpression. */
export class NotExpression extends Expression {
  /** @param {Expression} target */
  constructor(target) {
    super();
    this.target = target;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `!${this.target.getCanonicalForm()}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    return env.wrap(!env.toBoolean(this.target.evaluate(env), ' after "!"'));
  }
}

// Comparison semantics v1 (M16 refines date handling and natural string order):
// both numbers → numeric; both dates → time; both booleans → identity; else string form.
/** == != < <= > >= ← ComparisonExpression. */
export class ComparisonExpression extends Expression {
  /** @param {Expression} left @param {Expression} right @param {string} opString */
  constructor(left, right, opString) {
    super();
    this.left = left;
    this.right = right;
    this.opString = opString; // == != < <= > >= &lt; &lt;= &gt; &gt;=
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `${this.left.getCanonicalForm()} ${this.opString} ${this.right.getCanonicalForm()}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    const l = this.left.evaluate(env);
    const r = this.right.evaluate(env);
    const cmp = env.compare(l, r);
    // Normalize the many operator spellings to a canonical comparator.
    const op = {
      '==': 'eq', '!=': 'neq',
      '<': 'lt', 'lt': 'lt', '\\lt': 'lt', '&lt;': 'lt', '&lt': 'lt',
      '<=': 'lte', 'lte': 'lte', '\\lte': 'lte', '&lt;=': 'lte', '&lt=': 'lte',
      '>': 'gt', 'gt': 'gt', '\\gt': 'gt', '&gt;': 'gt', '&gt': 'gt',
      '>=': 'gte', 'gte': 'gte', '\\gte': 'gte', '&gt;=': 'gte', '&gt=': 'gte',
    }[this.opString] ?? this.opString;
    switch (op) {
      case 'eq': return env.wrap(cmp === 0);
      case 'neq': return env.wrap(cmp !== 0);
      case 'lt': return env.wrap(cmp < 0);
      case 'lte': return env.wrap(cmp <= 0);
      case 'gte': return env.wrap(cmp >= 0);
      default: return env.wrap(cmp > 0); // 'gt'
    }
  }
}

// endType: inclusive | exclusive | sizeLimited | unbound ← Range.END_*
/** x..y ← Range. */
export class Range extends Expression {
  /** @param {Expression} left @param {Expression} right @param {string} endType */
  constructor(left, right, endType) {
    super();
    this.left = left;
    this.right = right; // may be null
    this.endType = endType;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const symbol = { inclusive: '..', exclusive: '..<', sizeLimited: '..*', unbound: '..' }[this.endType];
    return `${this.left.getCanonicalForm()}${symbol}${this.right === null ? '' : this.right.getCanonicalForm()}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    const from = env.toNumber(this.left.evaluate(env), ' on the left of a range');
    const to = this.right === null ? null : env.toNumber(this.right.evaluate(env), ' on the right of a range');
    let size = null;
    if (to !== null) {
      if (this.endType === 'sizeLimited') {
        if (to < 0) throw new TemplateException('Size of range can\'t be negative.');
        size = to;
      } else {
        size = this.endType === 'exclusive' ? to - from : to - from + 1;
        if (size < 0) size = 0;
      }
    }
    const model = new RangeModel(from, to, this.endType);
    model.sizeValue = size;
    return model;
  }
}

/** && ← AndExpression. */
export class AndExpression extends Expression {
  /** @param {Expression} left @param {Expression} right */
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `${this.left.getCanonicalForm()} && ${this.right.getCanonicalForm()}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    if (!env.toBoolean(this.left.evaluate(env), ' on the left of "&&"')) return BooleanModel.FALSE;
    return env.wrap(env.toBoolean(this.right.evaluate(env), ' on the right of "&&"'));
  }
}

/** || ← OrExpression. */
export class OrExpression extends Expression {
  /** @param {Expression} left @param {Expression} right */
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `${this.left.getCanonicalForm()} || ${this.right.getCanonicalForm()}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    if (env.toBoolean(this.left.evaluate(env), ' on the left of "||"')) return BooleanModel.TRUE;
    return env.wrap(env.toBoolean(this.right.evaluate(env), ' on the right of "||"'));
  }
}

// `x!y` / `x!`: missing left side (thrown or null) falls back to right side.
/** x!y ← DefaultToExpression. */
export class DefaultToExpression extends Expression {
  /** @param {Expression} left @param {Expression|null} right */
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right ?? null; // ← x! (trailing ! in named params)
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.right === null
      ? `${this.left.getCanonicalForm()}!`
      : `${this.left.getCanonicalForm()}!${this.right.getCanonicalForm()}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    try {
      const l = this.left.evaluate(env);
      if (l !== null && l !== undefined) return l;
    } catch (e) {
      if (!(e instanceof InvalidReferenceException)) throw e;
    }
    return this.right === null ? null : this.right.evaluate(env);
  }
}

/** x?has? ← ExistsExpression. */
export class ExistsExpression extends Expression {
  /** @param {Expression} expression */
  constructor(expression) {
    super();
    this.expression = expression;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `${this.expression.getCanonicalForm()}??`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    try {
      const v = this.expression.evaluate(env);
      return v === null || v === undefined ? BooleanModel.FALSE : BooleanModel.TRUE;
    } catch (e) {
      if (!(e instanceof InvalidReferenceException)) throw e;
      return BooleanModel.FALSE;
    }
  }
}
