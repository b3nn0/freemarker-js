// <#autoesc> / <#noautoesc> blocks <- FTL.jj AutoEscapeBlock / NoAutoEscBlock.
// Upstream binds auto-escaping to each interpolation at parse time; these nodes
// only exist to hold children (their accept() just visits them).

import { TemplateElement } from '../templateElement.js';

/** <#autoesc> <- AutoEscapingBlock (parse-time binding holder). */
export class AutoEscBlock extends TemplateElement {
  /** @param {TemplateElement[]} children */
  constructor(children) {
    super();
    for (const c of children) this.addChild(c);
  }

  /**
   * @param {import('../../../environment.js').Environment} env
   * @returns {TemplateElement[]} children (visit via the normal mechanism)
   */
  * execute(env) {
    return this.children;
  }

  /** @returns {string} */
  getCanonicalForm() {
    return `<#autoesc>${this.children.map((c) => c.getCanonicalForm()).join("")}</#autoesc>`;
  }

  /** @returns {boolean} */
  isIgnorable() {
    return this.children.length === 0;
  }
}

/** <#noautoesc> <- NoAutoEscapingBlock. */
export class NoAutoEscBlock extends TemplateElement {
  /** @param {TemplateElement[]} children */
  constructor(children) {
    super();
    for (const c of children) this.addChild(c);
  }

  /**
   * @param {import('../../../environment.js').Environment} env
   * @returns {TemplateElement[]}
   */
  * execute(env) {
    return this.children;
  }

  /** @returns {string} */
  getCanonicalForm() {
    return `<#noautoesc>${this.children.map((c) => c.getCanonicalForm()).join("")}</#noautoesc>`;
  }

  /** @returns {boolean} */
  isIgnorable() {
    return this.children.length === 0;
  }
}
