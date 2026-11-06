// Token ← javacc Token: image + 1-based begin/end positions, `next` link.

export class Token {
  constructor(type, image, beginLine, beginColumn, endLine, endColumn) {
    this.type = type;
    this.image = image;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
    this.next = null;
  }

  toString() {
    return `${this.type.name}(${JSON.stringify(this.image)})`;
  }
}
