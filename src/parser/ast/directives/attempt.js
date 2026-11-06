// ← AttemptBlock / RecoveryBlock (#attempt ... #recover ...).

import { TemplateElement } from '../templateElement.js';
import {
  TemplateException, BreakInstructionException, ContinueInstructionException,
  ReturnInstructionException,
} from '../../../errors.js';

export class AttemptBlock extends TemplateElement {
  constructor(children, recoveryChildren) {
    super();
    this.recoveryChildren = recoveryChildren;
    if (children) for (const c of children) this.addChild(c);
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  execute(env) {
    try {
      for (const c of this.children) env.visit(c);
    } catch (e) {
      if (e instanceof BreakInstructionException || e instanceof ContinueInstructionException
        || e instanceof ReturnInstructionException) {
        throw e;
      }
      if (!(e instanceof TemplateException)) throw e;
      for (const c of this.recoveryChildren) env.visit(c);
    }
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const body = this.children.map((c) => c.getCanonicalForm()).join('');
    const rec = this.recoveryChildren.map((c) => c.getCanonicalForm()).join('');
    return `<#attempt>${body}<#recover>${rec}</#recover></#attempt>`;
  }
}
