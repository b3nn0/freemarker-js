// Token ← javacc Token: image + 1-based begin/end positions, `next` link.

/**
 * A token: type + image + 1-based span (mirrors JavaCC Token's position fields).
 */
export class Token {
  /**
   * @param {import('./tokenType.js').TokenType} type
   * @param {string} image
   * @param {number} beginLine
   * @param {number} beginColumn
   * @param {number} endLine
   * @param {number} endColumn
   */
  constructor(type, image, beginLine, beginColumn, endLine, endColumn) {
    this.type = type;
    this.image = image;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
    this.next = null;
  }

  /** @returns {string} */
  toString() {
    return `${this.type.name}(${JSON.stringify(this.image)})`;
  }
}
