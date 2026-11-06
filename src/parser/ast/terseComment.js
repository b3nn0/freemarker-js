// <#-- ... --> ← freemarker.core.TerseComment.

import { TemplateElement } from './templateElement.js';

export class TerseComment extends TemplateElement {
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
    return `<#--${this.text}-->`;
  }
}
