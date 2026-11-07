// <- Assignment / AssignmentInstruction / block-assignment (#assign, #global, #local).

import { TemplateElement } from '../templateElement.js';
import { backslashEscapeIdentifier } from '../../../utility/stringUtil.js';
import {
  InvalidReferenceException, NonNumericalException, TemplateException,
} from '../../../errors.js';
import { StringWriter } from '../../../io/writer.js';
import { StringModel, MarkupModel, HashModel } from '../../../model/models.js';
import { AddConcatExpression } from '../expressions/operators.js';
import { Identifier } from '../expressions/variables.js';

/** @type {{ NAMESPACE: string, GLOBAL: string, LOCAL: string }} */
export const ASSIGN_SCOPE = { NAMESPACE: 'namespace', GLOBAL: 'global', LOCAL: 'local' };

/** #assign/#global/#local <- Assignment. */
export class Assignment extends TemplateElement {
  // name; opKind: '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '++' | '-- | 'block' ;
  // exp (null for ++/-- and block); scope: ASSIGN_SCOPE value
  /**
   * @param {string} name
   * @param {string} opKind
   * @param {import('../expressions/expression.js').Expression|null} exp
   * @param {string} scope
   * @param {TemplateElement[]|null} [blockChildren]
   */
  constructor(name, opKind, exp, scope, blockChildren = null, nsExp = null) {
    super();
    this.name = name;
    this.opKind = opKind;
    if (opKind === 'block') this._whitespaceScanLeaf = true; // <- BlockAssignment
    this.exp = exp;
    this.scope = scope;
    this.blockChildren = blockChildren;
    this.nsExp = nsExp;
    this._runtimeNs = null; // set by AssignmentInstruction for the "in ns" pair form
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
      case 'block': {
        const captured = yield* this._capture(env);
        // <- Environment.captureOutput + BlockAssignment: under a markup output
        // format the captured text becomes a markup output model (printed as-is,
        // not re-escaped); under Undefined/PlainText it stays a plain string.
        const of = env.outputFormat ?? env.configuration.getOutputFormat();
        value = of && of.isMarkup ? new MarkupModel(null, of, captured) : new StringModel(captured);
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
        if (this.opKind === '+=') {
          // <- "+=" follows the "+" operator: string+string concatenates,
          // sequence+sequence appends, number+number adds.
          value = yield* new AddConcatExpression(new Identifier(this.name), this.exp)
            .evaluate(env);
          break;
        }
        const oldN = yield* env.toNumber(old, ` as the old value of "${this.name}"`);
        let result;
        if (this.opKind === '++') result = oldN + 1;
        else if (this.opKind === '--') result = oldN - 1;
        else {
          const r = yield* env.toNumber(yield* this.exp.evaluate(env), ` as the right side of "${this.opKind}"`);
          switch (this.opKind) {
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
    if (this._runtimeNs !== null) {
      this._runtimeNs.source.set(this.name, value);
    } else if (this.nsExp !== null) {
      const ns = yield* resolveNamespaceTarget(env, this.nsExp);
      ns.source.set(this.name, value);
    } else {
      env.assignVariable(this.name, value, this.scope);
    }
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
      const op = '';
      return `<#${tag} ${backslashEscapeIdentifier(this.name)}${op}>`
        + this.blockChildren.map((c) => c.getCanonicalForm()).join('')
        + `</#${tag}>`;
    }
    return `<#${tag} ${this._namePart()}>`;
  }
}

/**
 * <- NSAssignmentTarget: the "in" expression must be a writable namespace hash
 * (the object an #import namespace exposes).
 * @param {import('../../../environment.js').Environment} env
 * @param {import('../expressions/expression.js').Expression} nsExp
 * @returns {import('../../../model/models.js').HashModel}
 */
export function* resolveNamespaceTarget(env, nsExp) {
  const ns = yield* nsExp.evaluate(env);
  if (ns === null || ns === undefined) {
    throw new InvalidReferenceException(
      'The namespace expression of the "#assign ... in ..." evaluated to a missing value.');
  }
  if (!(ns instanceof HashModel) || !ns.isMap) {
    throw new TemplateException(
      `The "in" expression of "#assign" must be a namespace hash, but it was a ${env.typeLabel(ns)}.`);
  }
  return ns;
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
      const ns = yield* resolveNamespaceTarget(env, this.namespaceExp);
      for (const a of this.assignments) {
        a._runtimeNs = ns;
        try {
          yield* env.visit(a);
        } finally {
          a._runtimeNs = null;
        }
      }
      return null;
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
