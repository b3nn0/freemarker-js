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

  getCanonicalForm() {
    return `<#--${this.text}-->`;
  }
}
