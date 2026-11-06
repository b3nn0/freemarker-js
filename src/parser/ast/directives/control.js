// Control-flow directives ← freemarker.core BreakInstruction / ContinueInstruction.

import { TemplateElement } from '../templateElement.js';
import {
  BreakInstructionException, ContinueInstructionException, ReturnInstructionException,
} from '../../../errors.js';

export class BreakInstruction extends TemplateElement {
  execute() {
    throw new BreakInstructionException('#break');
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return '<#break>';
  }
}

export class ContinueInstruction extends TemplateElement {
  execute() {
    throw new ContinueInstructionException('#continue');
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return '<#continue>';
  }
}

// ← ReturnInstruction (#return): exits a macro (no value) or returns a value from a function.
export class ReturnInstruction extends TemplateElement {
  constructor(exp) {
    super();
    this.exp = exp;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  execute(env) {
    throw new ReturnInstructionException(this.exp === null ? null : this.exp.evaluate(env));
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.exp === null ? '<#return>' : `<#return ${this.exp.getCanonicalForm()}>`;
  }
}
