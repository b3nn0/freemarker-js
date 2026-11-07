// <#comment> ... </#comment> ← freemarker.core.CommentDirective.

import { TemplateElement } from './templateElement.js';

/** <#-- --> comment ← Comment. */
export class CommentDirective extends TemplateElement {
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
    return `<#comment>${this.text}</#comment>`;
  }
}
