// ← freemarker.core.StopInstruction (#stop) and FlushInstruction (#flush).

import { TemplateElement } from '../templateElement.js';
import { StopException } from '../../../errors.js';

/**
 * `#stop` / `#stop messageExp` — aborts processing with a StopException.
 */
export class StopInstruction extends TemplateElement {
  /**
   * @param {Object|null} exp - optional message expression
   */
  constructor(exp) {
    super();
    this.exp = exp;
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    // ← StopException.printStackTrace: "Encountered stop instruction" + "Cause given:".
    if (this.exp === null) throw new StopException('Encountered stop instruction');
    const msg = yield* env.coerceToString(yield* this.exp.evaluate(env), ' used as the #stop message');
    throw new StopException(`Encountered stop instruction\nCause given: ${msg}`);
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.exp === null ? '<#stop/>' : `<#stop ${this.exp.getCanonicalForm()}/>`;
  }
}

/**
 * `#flush` — a no-op for in-memory writers (still calls Writer.flush()).
 */
export class FlushInstruction extends TemplateElement {
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    if (typeof env.output.flush === 'function') env.output.flush();
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return '<#flush/>';
  }
}
