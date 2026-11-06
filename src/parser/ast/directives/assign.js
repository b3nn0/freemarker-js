// ← Assignment / AssignmentInstruction / block-assignment (#assign, #global, #local).

import { TemplateElement } from '../templateElement.js';
import {
  InvalidReferenceException, NonNumericalException, UnsupportedFeatureException,
} from '../../../errors.js';
import { StringWriter } from '../../../io/writer.js';
import { StringModel } from '../../../model/models.js';

export const ASSIGN_SCOPE = { NAMESPACE: 'namespace', GLOBAL: 'global', LOCAL: 'local' };

export class Assignment extends TemplateElement {
  // name; opKind: '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '++' | '-- | 'block' | 'block+=' ;
  // exp (null for ++/-- and block); scope: ASSIGN_SCOPE value
  constructor(name, opKind, exp, scope, blockChildren = null) {
    super();
    this.name = name;
    this.opKind = opKind;
    this.exp = exp;
    this.scope = scope;
    this.blockChildren = blockChildren;
  }

  execute(env) {
    let value;
    switch (this.opKind) {
      case '=':
        value = this.exp.evaluate(env);
        break;
      case 'block':
      case 'block+=': {
        const captured = this._capture(env);
        if (this.opKind === 'block+=') {
          const old = env.getVariable(this.name);
          if (old === null || old === undefined) {
            throw new InvalidReferenceException(
              `Can't do "#assign ${this.name}+=": the variable has no old value.`);
          }
          value = new StringModel(env.coerceToString(old) + captured);
        } else {
          value = new StringModel(captured);
        }
        break;
      }
      case '++':
      case '--':
      case '+=':
      case '-=':
      case '*=':
      case '/=':
      case '%=': {
        const old = env.getVariable(this.name);
        if (old === null || old === undefined) {
          throw new InvalidReferenceException(
            `Can't do "#assign ${this.name} ${this.opKind}": the variable has no old value.`);
        }
        const oldN = env.toNumber(old, ` as the old value of "${this.name}"`);
        let result;
        if (this.opKind === '++') result = oldN + 1;
        else if (this.opKind === '--') result = oldN - 1;
        else {
          const r = env.toNumber(this.exp.evaluate(env), ` as the right side of "${this.opKind}"`);
          switch (this.opKind) {
            case '+=': result = oldN + r; break;
            case '-=': result = oldN - r; break;
            case '*=': result = oldN * r; break;
            case '/=':
              if (r === 0) throw new InvalidReferenceException('Division by zero.');
              result = oldN / r;
              break;
            default:
              if (r === 0) throw new InvalidReferenceException('Division by zero.');
              result = oldN % r;
              break;
          }
        }
        value = env.wrap(result);
        break;
      }
    }
    env.assignVariable(this.name, value, this.scope);
    return null;
  }

  _capture(env) {
    const w = new StringWriter();
    const savedOut = env.output;
    env.output = w;
    try {
      for (const c of this.blockChildren) env.visit(c);
    } finally {
      env.output = savedOut;
    }
    return w.getAsString();
  }

  _tag() {
    return this.scope === ASSIGN_SCOPE.GLOBAL ? 'global'
      : this.scope === ASSIGN_SCOPE.LOCAL ? 'local' : 'assign';
  }

  _namePart() {
    if (this.opKind === '++' || this.opKind === '--') return `${this.name}${this.opKind}`;
    if (this.exp === null) return `${this.name} ${this.opKind}`;
    return `${this.name} ${this.opKind} ${this.exp.getCanonicalForm()}`;
  }

  getCanonicalForm() {
    const tag = this._tag();
    if (this.blockChildren) {
      const op = this.opKind === 'block+=' ? '+=' : '';
      return `<#${tag} ${this.name}${op}>`
        + this.blockChildren.map((c) => c.getCanonicalForm()).join('')
        + `</#${tag}>`;
    }
    return `<#${tag} ${this._namePart()}>`;
  }
}

export class AssignmentInstruction extends TemplateElement {
  constructor(assignments, namespaceExp) {
    super();
    this.assignments = assignments;
    this.namespaceExp = namespaceExp ?? null;
    for (const a of assignments) this.addChild(a);
  }
  execute(env) {
    if (this.namespaceExp !== null) {
      throw new UnsupportedFeatureException(
        'Assigning into another namespace (#assign x in ns) lands with #import (M14).');
    }
    for (const a of this.assignments) env.visit(a);
    return null;
  }
  getCanonicalForm() {
    const tag = this.assignments.length > 0 ? this.assignments[0]._tag() : 'assign';
    const parts = this.assignments.map((a) => a._namePart()).join(', ');
    const ns = this.namespaceExp === null ? '' : ` in ${this.namespaceExp.getCanonicalForm()}`;
    return `<#${tag} ${parts}${ns}>`;
  }
}
