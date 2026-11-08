// Operator nodes, canonical forms <- FTL.jj production actions.

import { Expression } from './expression.js';
import { InvalidReferenceException, TemplateException } from '../../../errors.js';
import { awaitOp, callOp } from '../../../async.js';
import { BooleanModel, RangeModel, StringModel, MarkupModel } from '../../../model/models.js';
import { isSequenceModel, isHashModelEx } from '../../../model/capabilities.js';
import { Decimal } from '../../../format/decimal.js';
import { NumberModel } from '../../../model/models.js';

/**
 * Exact-decimal operand for an arithmetic op: the model's BigDecimal value
 * when it carries one, else BigDecimal.valueOf(double) of its JS number
 * (upstream converts any Number via toBigDecimal).
 * @param {number} n @param {import('../../../model/templateModel.js').TemplateModel} m
 * @returns {Decimal|null} null when non-finite (falls back to double math)
 */
function decimalOperand(n, m) {
  if (!Number.isFinite(n)) return null;
  const d = m && typeof m.getAsDecimal === 'function' ? m.getAsDecimal() : null;
  return d !== null && d !== undefined ? d : Decimal.fromNumber(n);
}

/** @param {Decimal} d @returns {NumberModel} */
function wrapDecimal(d) {
  return new NumberModel(d.toNumber(), d);
}

/** (...) <- ParentheticalExpression. */
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
  * evaluate(env) {
    return yield* this.expression.evaluate(env);
  }
}

// "+": sequence+sequence and hash+hash stay collections; number+number is arithmetic;
// otherwise both sides are coerced to strings <- AddConcatExpression.visit.
/** + (string/sequence concat) <- AddConcat. */
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
  * evaluate(env) {
    const l = yield* this.left.evaluate(env);
    const r = yield* this.right.evaluate(env);
    // <- coerceModelToStringOrMarkup: when either side is markup, the other side
    // is escaped into that markup format and the result stays markup
    if (l instanceof MarkupModel || r instanceof MarkupModel) {
      const fmt = (l instanceof MarkupModel ? l : r).outputFormat;
      if (l instanceof MarkupModel && r instanceof MarkupModel
        && l.outputFormat.name !== r.outputFormat.name) {
        throw new TemplateException('Can\'t add these two markup outputs because they have '
          + `different output formats: ${l.outputFormat.name} and ${r.outputFormat.name}.`);
      }
      const lM = l instanceof MarkupModel ? l.value
        : fmt.escapePlainText(yield* env.coerceToString(l, ' used with the "+" operator'));
      const rM = r instanceof MarkupModel ? r.value
        : fmt.escapePlainText(yield* env.coerceToString(r, ' used with the "+" operator'));
      return new MarkupModel(null, fmt, lM + rM);
    }
    if (isSequenceModel(l) && isSequenceModel(r)) {
      const items = [];
      const n1 = yield* awaitOp('size', l.size());
      for (let i = 0; i < n1; i++) items.push(yield* callOp('getByIndex', l, 'getByIndex', i));
      const n2 = yield* awaitOp('size', r.size());
      for (let i = 0; i < n2; i++) items.push(yield* callOp('getByIndex', r, 'getByIndex', i));
      return env.wrap(items);
    }
    if (isHashModelEx(l) && isHashModelEx(r)) {
      const map = new Map();
      for (const k of yield* awaitOp('keys', l.keys())) map.set(k, yield* callOp(`get "${k}"`, l, 'get', k));
      for (const k of yield* awaitOp('keys', r.keys())) map.set(k, yield* callOp(`get "${k}"`, r, 'get', k));
      return env.wrap(map);
    }
    if (l && r && typeof l.getAsNumber === 'function' && typeof r.getAsNumber === 'function') {
      const ln = yield* callOp('getAsNumber', l, 'getAsNumber');
      const rn = yield* callOp('getAsNumber', r, 'getAsNumber');
      const dl = decimalOperand(ln, l);
      const dr = decimalOperand(rn, r);
      if (dl !== null && dr !== null) return wrapDecimal(dl.add(dr));
      return env.wrap(ln + rn);
    }
    return env.wrap((yield* env.coerceToString(l, ' used with the "+" operator'))
      + (yield* env.coerceToString(r, ' used with the "+" operator')));
  }
}

/** - * / % <- ArithmeticExpression. */
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
  * evaluate(env) {
    const lm = yield* this.left.evaluate(env);
    const rm = yield* this.right.evaluate(env);
    const l = yield* env.toNumber(lm, ` on the left of "${this.operator}"`);
    const r = yield* env.toNumber(rm, ` on the right of "${this.operator}"`);
    const dl = decimalOperand(l, lm);
    const dr = decimalOperand(r, rm);
    if (dl !== null && dr !== null) {
      switch (this.operator) {
        case 'subtract': return wrapDecimal(dl.sub(dr));
        case 'multiply': return wrapDecimal(dl.mul(dr));
        case 'divide':
          try {
            return wrapDecimal(dl.div(dr));
          } catch (e) {
            if (e instanceof Error && e.message === 'Division by zero.') {
              throw new TemplateException(e.message);
            }
            throw e;
          }
        default:
          if (dr.trunc().u === 0n) throw new TemplateException('Division by zero.');
          return wrapDecimal(dl.modulus(dr));
      }
    }
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

/** -x/+x <- UnaryPlusMinusExpression. */
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
  * evaluate(env) {
    const tm = yield* this.target.evaluate(env);
    const v = yield* env.toNumber(tm, ' after a unary +/- sign');
    const d = decimalOperand(v, tm);
    if (d !== null) return wrapDecimal(this.isMinus ? d.neg() : d);
    return env.wrap(this.isMinus ? -v : +v);
  }
}

/** !x <- NotExpression. */
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
  * evaluate(env) {
    return env.wrap(!(yield* env.toBoolean(yield* this.target.evaluate(env), ' after "!"')));
  }
}

// Comparison semantics: strict same-kind pairs only, per EvalUtil.compare (2.3.36);
// see Environment.compare. Relational operators throw on strings/booleans.
/** == != < <= > >= <- ComparisonExpression. */
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
  * evaluate(env) {
    const l = yield* this.left.evaluate(env);
    const r = yield* this.right.evaluate(env);
    // Normalize the many operator spellings to a canonical comparator.
    const op = {
      '==': 'eq', '!=': 'neq',
      '<': 'lt', 'lt': 'lt', '\\lt': 'lt', '&lt;': 'lt', '&lt': 'lt',
      '<=': 'lte', 'lte': 'lte', '\\lte': 'lte', '&lt;=': 'lte', '&lt=': 'lte',
      '>': 'gt', 'gt': 'gt', '\\gt': 'gt', '&gt;': 'gt', '&gt': 'gt',
      '>=': 'gte', 'gte': 'gte', '\\gte': 'gte', '&gt;=': 'gte', '&gt=': 'gte',
    }[this.opString] ?? this.opString;
    const cmp = yield* env.compare(l, r, op, this.opString, {
      leftLabel: () => this.left.getCanonicalForm(),
      rightLabel: () => this.right.getCanonicalForm(),
    });
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

// endType: inclusive | exclusive | sizeLimited | unbound <- Range.END_*
/** x..y <- Range. */
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
  * evaluate(env) {
    const from = yield* env.toNumber(yield* this.left.evaluate(env), ' on the left of a range');
    const to = this.right === null
      ? null
      : yield* env.toNumber(yield* this.right.evaluate(env), ' on the right of a range');
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

/** && <- AndExpression. */
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
  * evaluate(env) {
    if (!(yield* env.toBoolean(yield* this.left.evaluate(env), ' on the left of "&&"'))) return BooleanModel.FALSE;
    return env.wrap(yield* env.toBoolean(yield* this.right.evaluate(env), ' on the right of "&&"'));
  }
}

/** || <- OrExpression. */
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
  * evaluate(env) {
    if (yield* env.toBoolean(yield* this.left.evaluate(env), ' on the left of "||"')) return BooleanModel.TRUE;
    return env.wrap(yield* env.toBoolean(yield* this.right.evaluate(env), ' on the right of "||"'));
  }
}

// `x!y` / `x!`: missing left side (thrown or null) falls back to right side.
/** x!y <- DefaultToExpression. */
export class DefaultToExpression extends Expression {
  /** @param {Expression} left @param {Expression|null} right */
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right ?? null; // <- x! (trailing ! in named params)
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
  * evaluate(env) {
    let l = null;
    if (this.left instanceof ParentheticalExpression) {
      // <- JVM: an exception is swallowed only through parentheses
      try {
        l = yield* this.left.evaluate(env);
      } catch (e) {
        if (!(e instanceof InvalidReferenceException)) throw e;
      }
    } else {
      try {
        l = yield* this.left.evaluate(env);
      } catch (e) {
        // "!" covers the failing step only when it is the whole left expression
        // (JVM: Dot returns null for a missing last step; intermediate failures throw).
        if (!(e instanceof InvalidReferenceException) || e.blamedExpression !== this.left.getCanonicalForm()) {
          throw e;
        }
      }
    }
    if (l !== null && l !== undefined) return l;
    // <- EMPTY_STRING_AND_SEQUENCE_AND_HASH for a bare "x!"
    return this.right === null ? new StringModel('') : yield* this.right.evaluate(env);
  }
}

/** x?has? <- ExistsExpression. */
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
  * evaluate(env) {
    try {
      const v = yield* this.expression.evaluate(env);
      return v === null || v === undefined ? BooleanModel.FALSE : BooleanModel.TRUE;
    } catch (e) {
      if (!(e instanceof InvalidReferenceException)) throw e;
      return BooleanModel.FALSE;
    }
  }
}
