// Root "mixed content" element list ← FTL.jj mixedContentElements().

import { TemplateElement } from './templateElement.js';

/** A run of mixed content ← MixedContentElements. */
export class MixedContentElements extends TemplateElement {
  /**
   * @param {import('../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    return this.children;
  }
}
