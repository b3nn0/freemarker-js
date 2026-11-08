// <- AttemptBlock / RecoveryBlock (#attempt ... #recover ...).

import { TemplateElement } from '../templateElement.js';
import {
  TemplateException, BreakInstructionException, ContinueInstructionException,
  ReturnInstructionException,
} from '../../../errors.js';

/** #attempt/#recover <- Attempt. */
export class AttemptBlock extends TemplateElement {
  /** @param {TemplateElement[]} children @param {TemplateElement[]} recoveryChildren */
  constructor(children, recoveryChildren) {
    super();
    this.recoveryChildren = recoveryChildren;
    if (children) for (const c of children) this.addChild(c);
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    // <- Environment.visitAttemptRecover: the body writes into a StringWriter;
    // on error its output is discarded, on success it is flushed to the real
    // output. Flow-control signals (JVM FlowControlException, RuntimeException)
    // are not TemplateExceptions and propagate.
    const prevOut = env.output;
    const chunks = [];
    env.output = { write(s) { chunks.push(String(s)); }, close() {} };
    let thrown = null;
    try {
      for (const c of this.children) yield* env.visit(c);
    } catch (e) {
      if (e instanceof BreakInstructionException || e instanceof ContinueInstructionException
        || e instanceof ReturnInstructionException) {
        throw e;
      }
      if (!(e instanceof TemplateException)) throw e;
      thrown = e;
    } finally {
      env.output = prevOut;
    }
    if (thrown === null) {
      prevOut.write(chunks.join(''));
      return null;
    }
    // <- Environment.visitAttemptRecover: .error is visible inside the recover body
    const prev = env._recoverError;
    env._recoverError = thrown;
    try {
      for (const c of this.recoveryChildren) yield* env.visit(c);
    } finally {
      env._recoverError = prev;
    }
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const body = this.children.map((c) => c.getCanonicalForm()).join('');
    const rec = this.recoveryChildren.map((c) => c.getCanonicalForm()).join('');
    return `<#attempt>${body}<#recover>${rec}</#attempt>`;
  }
}
