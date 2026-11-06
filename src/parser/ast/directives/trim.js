// <#t> / <#lt> / <#rt> / <#nt> ← freemarker/core/TrimInstruction.java (parse-time only).

import { TemplateElement } from '../templateElement.js';

/**
 * Whitespace-trim marker for the post-parse cleanup; renders nothing and is
 * always ignorable (removed from the tree once the text blocks consumed it).
 */
export class TrimInstruction extends TemplateElement {
  /**
   * @param {boolean} left - true for #t/#lt
   * @param {boolean} right - true for #t/#rt
   */
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
    this._isTrimInstruction = true;
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  execute(env) {
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `<${this._symbol()}/>`;
  }

  /** @returns {string} "#t" / "#lt" / "#rt" / "#nt" */
  _symbol() {
    if (this.left && this.right) return '#t';
    if (this.left) return '#lt';
    if (this.right) return '#rt';
    return '#nt';
  }

  /**
   * @param {boolean} stripWhitespace
   * @returns {boolean} always true ← TrimInstruction.isIgnorable
   */
  isIgnorable(stripWhitespace) {
    return true;
  }
}
