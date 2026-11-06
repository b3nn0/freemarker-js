// Operator nodes, canonical forms ← FTL.jj production actions.

import { Expression } from './expression.js';

export class ParentheticalExpression extends Expression {
  constructor(expression) {
    super();
    this.expression = expression;
  }
  getCanonicalForm() {
    return `(${this.expression.getCanonicalForm()})`;
  }
}

// "+" is always sequence/string/hash concatenation:
export class AddConcatExpression extends Expression {
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  getCanonicalForm() {
    return `${this.left.getCanonicalForm()} + ${this.right.getCanonicalForm()}`;
  }
}

export class ArithmeticExpression extends Expression {
  constructor(left, right, operator) {
    super();
    this.left = left;
    this.right = right;
    this.operator = operator; // subtract | multiply | divide | modulo
  }
  getCanonicalForm() {
    const symbol = { subtract: '-', multiply: '*', divide: '/', modulo: '%' }[this.operator];
    return `${this.left.getCanonicalForm()} ${symbol} ${this.right.getCanonicalForm()}`;
  }
}

export class UnaryPlusMinusExpression extends Expression {
  constructor(target, isMinus) {
    super();
    this.target = target;
    this.isMinus = isMinus;
  }
  getCanonicalForm() {
    return `${this.isMinus ? '-' : '+'}${this.target.getCanonicalForm()}`;
  }
}

export class NotExpression extends Expression {
  constructor(target) {
    super();
    this.target = target;
  }
  getCanonicalForm() {
    return `!${this.target.getCanonicalForm()}`;
  }
}

export class ComparisonExpression extends Expression {
  constructor(left, right, opString) {
    super();
    this.left = left;
    this.right = right;
    this.opString = opString; // == != < <= > >= &lt; &lt;= &gt; &gt;=
  }
  getCanonicalForm() {
    return `${this.left.getCanonicalForm()} ${this.opString} ${this.right.getCanonicalForm()}`;
  }
}

// endType: inclusive | exclusive | sizeLimited | unbound ← Range.END_*
export class Range extends Expression {
  constructor(left, right, endType) {
    super();
    this.left = left;
    this.right = right; // may be null
    this.endType = endType;
  }
  getCanonicalForm() {
    const symbol = { inclusive: '..', exclusive: '..<', sizeLimited: '..*', unbound: '..' }[this.endType];
    return `${this.left.getCanonicalForm()}${symbol}${this.right === null ? '' : this.right.getCanonicalForm()}`;
  }
}

export class AndExpression extends Expression {
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  getCanonicalForm() {
    return `${this.left.getCanonicalForm()} && ${this.right.getCanonicalForm()}`;
  }
}

export class OrExpression extends Expression {
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  getCanonicalForm() {
    return `${this.left.getCanonicalForm()} || ${this.right.getCanonicalForm()}`;
  }
}

export class DefaultToExpression extends Expression {
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right ?? null; // ← x! (trailing ! in named params)
  }
  getCanonicalForm() {
    return this.right === null
      ? `${this.left.getCanonicalForm()}!`
      : `${this.left.getCanonicalForm()}!${this.right.getCanonicalForm()}`;
  }
}

export class ExistsExpression extends Expression {
  constructor(expression) {
    super();
    this.expression = expression;
  }
  getCanonicalForm() {
    return `${this.expression.getCanonicalForm()}??`;
  }
}
