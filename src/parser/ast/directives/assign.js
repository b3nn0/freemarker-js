// <- Assignment / AssignmentInstruction / block-assignment (#assign, #global, #local).

import { TemplateElement } from '../templateElement.js';
import { backslashEscapeIdentifier } from '../../../utility/stringUtil.js';
import {
  InvalidReferenceException, NonNumericalException, UnsupportedFeatureException,
} from '../../../errors.js';
import { StringWriter } from '../../../io/writer.js';
import { StringModel } from '../../../model/models.js';

/** @type {{ NAMESPACE: string, GLOBAL: string, LOCAL: string }} */
export const ASSIGN_SCOPE = { NAMESPACE: 'namespace', GLOBAL: 'global', LOCAL: 'local' };

/** #assign/#global/#local <- Assignment. */
export class Assignment extends TemplateElement {
  // name; opKind: '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '++' | '-- | 'block' | 'block+=' ;
  // exp (null for ++/-- and block); scope: ASSIGN_SCOPE value
  /**
   * @param {string} name
   * @param {string} opKind
   * @param {import('../expressions/expression.js').Expression|null} exp
   * @param {string} scope
   * @param {TemplateElement[]|null} [blockChildren]
   */
  constructor(name, opKind, exp, scope, blockChildren = null) {
    super();
    this.name = name;
    this.opKind = opKind;
    if (opKind === 'block' || opKind === 'block+=') this._whitespaceScanLeaf = true; // <- BlockAssignment
    this.exp = exp;
    this.scope = scope;
    this.blockChildren = blockChildren;
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    let value;
    switch (this.opKind) {
      case '=':
        value = yield* this.exp.evaluate(env);
        break;
      case 'block':
      case 'block+=': {
        const captured = yield* this._capture(env);
        if (this.opKind === 'block+=') {
          const old = yield* env.getVariable(this.name);
          if (old === null || old === undefined) {
            throw new InvalidReferenceException(
              `Can't do "#assign ${this.name}+=": the variable has no old value.`);
          }
          value = new StringModel((yield* env.coerceToString(old)) + captured);
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
        const old = yield* env.getVariable(this.name);
        if (old === null || old === undefined) {
          throw new InvalidReferenceException(
            `Can't do "#assign ${this.name} ${this.opKind}": the variable has no old value.`);
        }
        const oldN = yield* env.toNumber(old, ` as the old value of "${this.name}"`);
        let result;
        if (this.opKind === '++') result = oldN + 1;
        else if (this.opKind === '--') result = oldN - 1;
        else {
          const r = yield* env.toNumber(yield* this.exp.evaluate(env), ` as the right side of "${this.opKind}"`);
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

  /** @param {import('../../../environment.js').Environment} env @returns {unknown} current value or null */
  * _capture(env) {
    const w = new StringWriter();
    const savedOut = env.output;
    env.output = w;
    try {
      for (const c of this.blockChildren) yield* env.visit(c);
    } finally {
      env.output = savedOut;
    }
    return w.getAsString();
  }

  /** @returns {string} */
  _tag() {
    return this.scope === ASSIGN_SCOPE.GLOBAL ? 'global'
      : this.scope === ASSIGN_SCOPE.LOCAL ? 'local' : 'assign';
  }

  /** @returns {string} */
  _namePart() {
    if (this.opKind === '++' || this.opKind === '--') return `${this.name}${this.opKind}`;
    if (this.exp === null) return `${this.name} ${this.opKind}`;
    return `${backslashEscapeIdentifier(this.name)} ${this.opKind} ${this.exp.getCanonicalForm()}`;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const tag = this._tag();
    if (this.blockChildren) {
      const op = this.opKind === 'block+=' ? '+=' : '';
      return `<#${tag} ${backslashEscapeIdentifier(this.name)}${op}>`
        + this.blockChildren.map((c) => c.getCanonicalForm()).join('')
        + `</#${tag}>`;
    }
    return `<#${tag} ${this._namePart()}>`;
  }
}

/** #assign a=1, b=2 <- AssignmentInstruction. */
export class AssignmentInstruction extends TemplateElement {
  /** @param {Assignment[]} assignments @param {import('../expressions/expression.js').Expression|null} namespaceExp */
  constructor(assignments, namespaceExp) {
    super();
    this.assignments = assignments;
    this.namespaceExp = namespaceExp ?? null;
    for (const a of assignments) this.addChild(a);
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    if (this.namespaceExp !== null) {
      throw new UnsupportedFeatureException(
        'Assigning into another namespace (#assign x in ns) lands with #import (M14).');
    }
    for (const a of this.assignments) yield* env.visit(a);
    return null;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const tag = this.assignments.length > 0 ? this.assignments[0]._tag() : 'assign';
    const parts = this.assignments.map((a) => a._namePart()).join(', ');
    const ns = this.namespaceExp === null ? '' : ` in ${this.namespaceExp.getCanonicalForm()}`;
    return `<#${tag} ${parts}${ns}>`;
  }
}
