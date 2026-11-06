// A block of plain text. ← freemarker/core/TextBlock.java

import { TemplateElement } from './templateElement.js';

export class TextBlock extends TemplateElement {
  constructor(text, unparsed = false) {
    super();
    this.text = text;
    this.unparsed = unparsed;
  }

  execute(env) {
    env.output.write(this.text);
    return null;
  }

  getCanonicalForm() {
    return this.unparsed ? `<#noparse>${this.text}</#noparse>` : this.text;
  }
}
