// Variable reference nodes ← Identifier, Dot (DynamicKeyName lands in M5).

import { Expression } from './expression.js';
import { backslashEscapeIdentifier } from '../../../utility/stringUtil.js';
import { UnassignedVariableException, InvalidPropertyException, NonHashException } from '../../../errors.js';
import { TemplateHashModel } from '../../../model/templateModel.js';

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
