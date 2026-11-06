// Root "mixed content" element list ← FTL.jj mixedContentElements().

import { TemplateElement } from './templateElement.js';

export class MixedContentElements extends TemplateElement {
  execute(env) {
    return this.children;
  }
}
