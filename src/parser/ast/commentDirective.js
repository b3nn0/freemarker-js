// <#comment> ... </#comment> ← freemarker.core.CommentDirective.

import { TemplateElement } from './templateElement.js';

export class CommentDirective extends TemplateElement {
  constructor(text) {
    super();
    this.text = text;
  }

  execute() {
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `<#comment>${this.text}</#comment>`;
  }
}
