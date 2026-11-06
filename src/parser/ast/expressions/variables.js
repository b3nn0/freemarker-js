// Variable reference nodes ← Identifier, Dot, DynamicKeyName (← freemarker.core.VariableExpression).

import { Expression } from './expression.js';
import { backslashEscapeIdentifier } from '../../../utility/stringUtil.js';
import {
  UnassignedVariableException, InvalidPropertyException, NonHashException, InvalidReferenceException,
} from '../../../errors.js';
import { TemplateHashModel, TemplateSequenceModel } from '../../../model/templateModel.js';

export class Identifier extends Expression {
  constructor(name) {
    super();
    this.name = name;
  }
  getCanonicalForm() {
    return backslashEscapeIdentifier(this.name);
  }
  evaluate(env) {
    const v = env.getVariable(this.name);
    if (v === null || v === undefined) {
      throw new UnassignedVariableException(`The variable ${JSON.stringify(this.name)} is not in the data model.`);
    }
    return v;
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
  evaluate(env) {
    const t = this.target.evaluate(env);
    if (t === null || t === undefined) {
      throw new InvalidPropertyException(
        `Can't read the ${JSON.stringify(this.key)} key: the parent expression `
        + `${this.target.getCanonicalForm()} evaluated to null or missing.`);
    }
    if (!(t instanceof TemplateHashModel)) {
      throw new NonHashException(
        `Can't read the ${JSON.stringify(this.key)} key: ${this.target.getCanonicalForm()} `
        + `is not a hash (it is a ${env.typeLabel(t)}).`);
    }
    const v = t.get(this.key);
    if (v === null || v === undefined) {
      throw new InvalidPropertyException(
        `The ${JSON.stringify(this.key)} key of ${this.target.getCanonicalForm()} `
        + 'has not been found (it is missing).');
    }
    return v;
  }
}

// ← freemarker.core.DynamicKeyName: target[key] or target[...]
export class DynamicKeyName extends Expression {
  constructor(target, key) {
    super();
    this.target = target;
    this.key = key; // null ← empty [] (only legal before !/??)
  }
  getCanonicalForm() {
    return `${this.target.getCanonicalForm()}[${this.key === null ? '' : this.key.getCanonicalForm()}]`;
  }
  evaluate(env) {
    const t = this.target.evaluate(env);
    const empty = () => new InvalidPropertyException(
      `The dynamic key expression of ${this.getCanonicalForm()} evaluated to null or missing `
      + '(use the ! or ?? operator to define a default).');
    if (t === null || t === undefined) throw empty();
    if (this.key === null) throw empty();
    let k;
    try {
      k = this.key.evaluate(env);
    } catch (e) {
      if (e instanceof InvalidReferenceException) throw empty();
      throw e;
    }
    if (k === null || k === undefined) throw empty();
    if (t instanceof TemplateSequenceModel) {
      const n = env.toNumber(k, ' used as an index into a sequence');
      return t.getByIndex(Math.trunc(n));
    }
    if (t instanceof TemplateHashModel) {
      return t.get(env.coerceToString(k, ' used as a hash key'));
    }
    throw new NonHashException(
      `Can't read: ${this.target.getCanonicalForm()} is a ${env.typeLabel(t)}, `
      + 'not a hash or sequence.');
  }
}
