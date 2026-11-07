// <#-- ... --> <- freemarker.core.TerseComment.

import { TemplateElement } from './templateElement.js';

/** <#-- terse -->-style comment <- TerseComment. */
export class TerseComment extends TemplateElement {
  /** @param {string} text */
  constructor(text) {
    super();
    this.text = text;
  }

  /** @returns {null} */
  * execute() {
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `<#--${this.text}-->`;
  }
}
