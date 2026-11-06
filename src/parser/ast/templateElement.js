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

  execute(env) {
    throw new Error(`execute() not implemented for ${this.constructor.name}`);
  }

  getCanonicalForm() {
    return this.children.map(c => c.getCanonicalForm()).join('');
  }
}
