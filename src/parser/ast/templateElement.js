// Base AST element: execute(env), getCanonicalForm(), location.

export class TemplateElement {
  constructor() {
    this.children = [];
    this.parent = null;
    this.templateName = null;
    this.beginLine = -1;
    this.beginColumn = -1;
    this.endLine = -1;
    this.endColumn = -1;
  }

  setLocation(templateName, beginLine, beginColumn, endLine, endColumn) {
    this.templateName = templateName;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
    return this;
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
    return this;
  }

  /**
   * @returns {TemplateElement|null} previous sibling ← TemplateElement.previousSibling
   */
  previousSibling() {
    if (this.parent == null) return null;
    const i = this.parent.children.indexOf(this);
    return i > 0 ? this.parent.children[i - 1] : null;
  }

  /**
   * @returns {TemplateElement|null} next sibling ← TemplateElement.nextSibling
   */
  nextSibling() {
    if (this.parent == null) return null;
    const i = this.parent.children.indexOf(this);
    return i >= 0 && i + 1 < this.parent.children.length ? this.parent.children[i + 1] : null;
  }

  /**
   * @returns {TemplateElement|null} deepest first leaf ← TemplateElement.getFirstLeaf
   * (Macro / block-assignment are treated as leaves)
   */
  getFirstLeaf() {
    let e = this;
    while (e.children.length > 0 && e._whitespaceScanLeaf !== true) e = e.children[0];
    return e;
  }

  /**
   * @returns {TemplateElement|null} deepest last leaf ← TemplateElement.getLastLeaf
   * (Macro / block-assignment are treated as leaves)
   */
  getLastLeaf() {
    let e = this;
    while (e.children.length > 0 && e._whitespaceScanLeaf !== true) e = e.children[e.children.length - 1];
    return e;
  }

  /**
   * ← TemplateElement.prevTerminalNode (tree-walk helper for whitespace cleanup).
   * @returns {TemplateElement|null}
   */
  prevTerminalNode() {
    const prev = this.previousSibling();
    if (prev != null) return prev.getLastLeaf();
    if (this.parent != null) return this.parent.prevTerminalNode();
    return null;
  }

  /**
   * ← TemplateElement.nextTerminalNode (tree-walk helper for whitespace cleanup).
   * @returns {TemplateElement|null}
   */
  nextTerminalNode() {
    const next = this.nextSibling();
    if (next != null) return next.getFirstLeaf();
    if (this.parent != null) return this.parent.nextTerminalNode();
    return null;
  }

  /**
   * ← TemplateElement.heedsOpeningWhitespace default (non-output directives: false).
   * @returns {boolean}
   */
  heedsOpeningWhitespace() {
    return false;
  }

  /**
   * ← TemplateElement.heedsTrailingWhitespace default (non-output directives: false).
   * @returns {boolean}
   */
  heedsTrailingWhitespace() {
    return false;
  }

  /**
   * ← TemplateElement.isIgnorable: removed by post-parse cleanup.
   * @param {boolean} stripWhitespace
   * @returns {boolean}
   */
  isIgnorable(stripWhitespace) {
    return false;
  }

  /**
   * @param {import('../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  execute(env) {
    throw new Error(`execute() not implemented for ${this.constructor.name}`);
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.children.map(c => c.getCanonicalForm()).join('');
  }
}
