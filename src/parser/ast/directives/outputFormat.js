// <#outputformat "NAME"> ... </#outputformat> ← FTL.jj OutputFormatBlock (2.3.36).
// The format name must be a parse-time constant literal (upstream: any literal
// expression; this port evaluates literals like the #ftl params). The "{...}"
// combined-format syntax is unsupported.

import { TemplateElement } from '../templateElement.js';

export class OutputFormatBlock extends TemplateElement {
  /**
   * @param {TemplateElement[]} children - block contents
   * @param {string} formatName - the literal format name as written
   * @param {import('../../../outputFormat.js').OutputFormat} outputFormat - resolved at parse time
   */
  constructor(children, formatName, outputFormat) {
    super();
    for (const c of children) this.addChild(c);
    this.formatName = formatName;
    this.outputFormat = outputFormat;
  }

  /**
   * Swaps env.outputFormat for the duration of the block; the interpolations
   * inside were already bound to it at parse time, but built-ins that consult
   * the current format read it from the environment.
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  execute(env) {
    const saved = env.outputFormat;
    env.outputFormat = this.outputFormat;
    try {
      for (const c of this.children) env.visit(c);
    } finally {
      env.outputFormat = saved;
    }
    return null;
  }

  /** @returns {string} */
  getCanonicalForm() {
    return `<#outputformat ${JSON.stringify(this.formatName)}>${this.children.map((c) => c.getCanonicalForm()).join("")}</#outputformat>`;
  }

  /** @returns {boolean} */
  isIgnorable() {
    return this.children.length === 0;
  }
}
