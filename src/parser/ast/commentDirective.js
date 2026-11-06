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

  getCanonicalForm() {
    return `<#comment>${this.text}</#comment>`;
  }
}
