// <- SwitchBlock / Case / On (#switch with #case/#default; #on keeps its expression list).

import { TemplateElement } from '../templateElement.js';
import { BreakInstructionException, ContinueInstructionException } from '../../../errors.js';

/** #case <- Case. */
export class Case extends TemplateElement {
  /** @param {import('../expressions/expression.js').Expression} condition @param {TemplateElement[]} children */
  constructor(condition, children) {
    super();
    this.condition = condition; // null <- #default
    if (children) for (const c of children) this.addChild(c);
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const head = this.condition === null
      ? '<#default>'
      : `<#case ${this.condition.getCanonicalForm()}>`;
    return head + this.children.map((c) => c.getCanonicalForm()).join('');
  }
}

/** #default <- On. */
export class On extends TemplateElement {
  /** @param {import('../expressions/expression.js').Expression[]} exps @param {TemplateElement[]} children */
  constructor(exps, children) {
    super();
    this.exps = exps;
    if (children) for (const c of children) this.addChild(c);
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const args = this.exps.map((e) => e.getCanonicalForm()).join(', ');
    return `<#on ${args}>` + this.children.map((c) => c.getCanonicalForm()).join('');
  }
}

/** #switch <- Switch. */
export class SwitchBlock extends TemplateElement {
  /** @param {import('../expressions/expression.js').Expression} switchExp @param {Case[]} cases @param {On[]} ons */
  constructor(switchExp, cases, ons) {
    super();
    this.switchExp = switchExp;
    this.cases = cases;
    this.ons = ons ?? [];
    for (const c of cases) this.addChild(c);
    for (const o of this.ons) this.addChild(o);
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    const v = yield* this.switchExp.evaluate(env);
    const defaultCase = this.cases.find((c) => c.condition === null) ?? null;
    if (this.ons.length) {
      // #on mode: #break inside is a parse error upstream, so it is not caught here.
      let matched = false;
      processOnDirectives: for (const on of this.ons) {
        for (const exp of on.exps) {
          if ((yield* env.compare(v, yield* exp.evaluate(env), 'eq', 'on==', {
            leftLabel: () => this.switchExp.getCanonicalForm(),
            rightLabel: () => exp.getCanonicalForm(),
          })) === 0) {
            for (const c of on.children) yield* env.visit(c);
            matched = true;
            break processOnDirectives;
          }
        }
      }
      if (!matched && defaultCase) {
        for (const ch of defaultCase.children) yield* env.visit(ch);
      }
      return null;
    }
    // #case mode <- SwitchBlock.accept: fall-through once a case matched; the
    // outer catch swallows #break AND (upstream BC bug) #continue.
    try {
      let processed = false;
      for (const c of this.cases) {
        let processCase = processed;
        if (!processCase && c.condition !== null) {
          processCase = (yield* env.compare(v, yield* c.condition.evaluate(env), 'eq', 'case==', {
            leftLabel: () => this.switchExp.getCanonicalForm(),
            rightLabel: () => c.condition.getCanonicalForm(),
          })) === 0;
        }
        if (processCase) {
          for (const ch of c.children) yield* env.visit(ch);
          processed = true;
        }
      }
      if (!processed && defaultCase) {
        for (const ch of defaultCase.children) yield* env.visit(ch);
      }
    } catch (e) {
      if (!(e instanceof BreakInstructionException) && !(e instanceof ContinueInstructionException)) throw e;
    }
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const head = `<#switch ${this.switchExp.getCanonicalForm()}>`;
    return head
      + this.ons.map((o) => o.getCanonicalForm()).join('')
      + this.cases.map((c) => c.getCanonicalForm()).join('')
      + '</#switch>';
  }
}
