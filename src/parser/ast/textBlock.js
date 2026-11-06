// A block of plain text. ← freemarker/core/TextBlock.java

import { TemplateElement } from './templateElement.js';

export class TextBlock extends TemplateElement {
  constructor(text, unparsed = false) {
    super();
    this.text = text;
    this.unparsed = unparsed;
  }

  /**
   * @param {import('../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  execute(env) {
    env.output.write(this.text);
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.unparsed ? `<#noparse>${this.text}</#noparse>` : this.text;
  }
}
