// ← SwitchBlock / Case / On (#switch with #case/#default; #on keeps its expression list).

import { TemplateElement } from '../templateElement.js';
import { BreakInstructionException } from '../../../errors.js';

/** #case ← Case. */
export class Case extends TemplateElement {
  /** @param {Expression} condition @param {TemplateElement[]} children */
  constructor(condition, children) {
    super();
    this.condition = condition; // null ← #default
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

/** #default ← On. */
export class On extends TemplateElement {
  /** @param {Expression[]} exps @param {TemplateElement[]} children */
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

/** #switch ← Switch. */
export class SwitchBlock extends TemplateElement {
  /** @param {Expression} switchExp @param {Case[]} cases @param {On[]} ons */
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
  execute(env) {
    const v = this.switchExp.evaluate(env);
    const visitMatched = (el) => {
      try {
        for (const c of el.children) env.visit(c);
      } catch (e) {
        if (!(e instanceof BreakInstructionException)) throw e; // #break ends the #switch
      }
    };
    for (const on of this.ons) {
      for (const exp of on.exps) {
        if (env.equals(v, exp.evaluate(env))) {
          visitMatched(on);
          return null;
        }
      }
    }
    for (const c of this.cases) {
      if (c.condition === null || env.equals(v, c.condition.evaluate(env))) {
        visitMatched(c);
        return null;
      }
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
