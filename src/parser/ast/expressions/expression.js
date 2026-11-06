// Expression AST base node (← freemarker.core.Expression). Evaluation lands in M4.

/** Base for expression AST nodes ← Expression. */
export class Expression {
  /** Location fields are filled in by the parser. */
  constructor() {
    this.templateName = null;
    this.beginLine = -1;
    this.beginColumn = -1;
    this.endLine = -1;
    this.endColumn = -1;
  }

  /**
   * @param {string} templateName
   * @param {number} beginLine
   * @param {number} beginColumn
   * @param {number} endLine
   * @param {number} endColumn
   * @returns {void}
   */
  setLoc(templateName, beginLine, beginColumn, endLine, endColumn) {
    this.templateName = templateName;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
    return this;
  }

  // Convenience: copy positions off tokens ({beginLine..} objects).
  /** @param {string} templateName @param {import('../../token.js').Token} beginToken @param {import('../../token.js').Token} endToken @returns {void} */
  setTokenLoc(templateName, beginToken, endToken) {
    return this.setLoc(templateName,
      beginToken.beginLine, beginToken.beginColumn, endToken.endLine, endToken.endColumn);
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    throw new Error(`getCanonicalForm() not implemented for ${this.constructor.name}`);
  }

  // Returns a TemplateModel, or null for missing values (← Expression.visit semantics;
  // missing-as-error conversion happens at consumption points).
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  evaluate(env) {
    throw new Error(`evaluate() not implemented for ${this.constructor.name}`);
  }
}
