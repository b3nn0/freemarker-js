// <#ftl ...> header <- FTL.jj Root()/HeaderElement() inline production.

import { TemplateElement } from '../templateElement.js';

/**
 * The optional FTL header; renders nothing.
 * `settings` carries parse-time parameter results (encoding, stripWhitespace,
 * stripText, strictSyntax, autoEsc, outputFormat); consumer behavior lands in
 * later milestones (whitespace stripping M13, output format / auto-esc M15).
 */
export class FTLHeader extends TemplateElement {
  /**
   * @param {Array<{ key: string, exp: import('../expressions/expression.js').Expression }>} params - parsed parameters
   * @param {Object} settings - evaluated parameter values keyed canonically
   */
  constructor(params, settings) {
    super();
    this.params = params;
    this.settings = settings;
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    if (this.params.length === 0) return '<#ftl/>';
    return `<#ftl ${this.params.map((p) => `${p.key}=${p.exp.getCanonicalForm()}`).join(' ')} />`;
  }
}
