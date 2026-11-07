// A block of plain text. ← freemarker/core/TextBlock.java (incl. whitespace stripping).

import { TemplateElement } from './templateElement.js';
import { isTrimmableToEmpty } from '../../utility/stringUtil.js';
import { Macro } from './directives/macro.js';
import { Assignment, AssignmentInstruction } from './directives/assign.js';
import { CommentDirective } from './commentDirective.js';
import { TerseComment } from './terseComment.js';
import { MixedContentElements } from './mixedContentElements.js';

/** @param {string} c @returns {boolean} */
function isWsChar(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

/** Static text ← TextBlock (incl. M13 whitespace-trim state). */
export class TextBlock extends TemplateElement {
  /** @param {string} text @param {boolean} [unparsed] */
  constructor(text, unparsed = false) {
    super();
    this.text = text;
    this.unparsed = unparsed;
  }

  /**
   * @param {import('../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    env.output.write(this.text);
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.unparsed ? `<#noparse>${this.text}</#noparse>` : this.text;
  }

  // ---- post-parse whitespace stripping ← TextBlock.postParseCleanup ----

  /**
   * @param {boolean} stripWhitespace
   * @returns {void}
   */
  postParseCleanup(stripWhitespace) {
    if (this.text.length === 0) return;
    const deliberateLeftTrim = this._deliberateLeftTrim();
    const deliberateRightTrim = this._deliberateRightTrim();
    if (!stripWhitespace || this.text.length === 0) return;
    const parentElement = this.parent;
    if (this._isTopLevelTextIfParentIs(parentElement) && this.previousSibling() === null) return;
    let openingCharsToStrip = 0;
    let trailingCharsToStrip = 0;
    if (!deliberateLeftTrim) trailingCharsToStrip = this._trailingCharsToStrip();
    if (!deliberateRightTrim) openingCharsToStrip = this._openingCharsToStrip();
    if (openingCharsToStrip === 0 && trailingCharsToStrip === 0) return;
    this.text = this.text.substring(openingCharsToStrip, this.text.length - trailingCharsToStrip);
    if (openingCharsToStrip > 0) {
      this.beginLine++;
      this.beginColumn = 1;
    }
    if (trailingCharsToStrip > 0) {
      this.endColumn = 0;
    }
  }

  /**
   * Scans forward the nodes on the same line for a deliberate #t/#lt ← deliberateLeftTrim().
   * @returns {boolean} true suppresses the automatic trailing strip
   */
  _deliberateLeftTrim() {
    let result = false;
    for (let elem = this.nextTerminalNode();
      elem != null && elem.beginLine === this.endLine;
      elem = elem.nextTerminalNode()) {
      if (elem._isTrimInstruction === true) {
        if (!elem.left && !elem.right) {
          result = true; // #nt: suppress auto-stripping on this line
        }
        if (elem.left) {
          result = true;
          const lastNewLineIndex = this._lastNewLineIndex();
          if (lastNewLineIndex >= 0 || this.beginColumn === 1) {
            const firstPart = this.text.substring(0, lastNewLineIndex + 1);
            const lastLine = this.text.substring(1 + lastNewLineIndex);
            if (isTrimmableToEmpty(lastLine)) {
              this.text = firstPart;
              this.endColumn = 0;
            } else {
              let i = 0;
              while (isWsChar(lastLine[i])) i++;
              this.text = firstPart + lastLine.substring(i);
            }
          }
        }
      }
    }
    return result;
  }

  /**
   * Scans backward the nodes on the same line for a deliberate #t/#rt ← deliberateRightTrim().
   * @returns {boolean} true suppresses the automatic opening strip
   */
  _deliberateRightTrim() {
    let result = false;
    for (let elem = this.prevTerminalNode();
      elem != null && elem.endLine === this.beginLine;
      elem = elem.prevTerminalNode()) {
      if (elem._isTrimInstruction === true) {
        if (!elem.left && !elem.right) {
          result = true; // #nt
        }
        if (elem.right) {
          result = true;
          let firstLineIndex = this._firstNewLineIndex() + 1;
          if (firstLineIndex === 0) {
            return false;
          }
          if (this.text.length > firstLineIndex
            && this.text[firstLineIndex - 1] === '\r' && this.text[firstLineIndex] === '\n') {
            firstLineIndex++;
          }
          const trailingPart = this.text.substring(firstLineIndex);
          const openingPart = this.text.substring(0, firstLineIndex);
          if (isTrimmableToEmpty(openingPart)) {
            this.text = trailingPart;
            this.beginLine++;
            this.beginColumn = 1;
          } else {
            let lastNonWS = openingPart.length - 1;
            while (isWsChar(this.text[lastNonWS])) lastNonWS--;
            const printablePart = this.text.substring(0, lastNonWS + 1);
            let trimTrailingPart = true;
            if (isTrimmableToEmpty(trailingPart)) {
              for (let te = this.nextTerminalNode();
                te != null && te.beginLine === this.endLine;
                te = te.nextTerminalNode()) {
                if (te.heedsOpeningWhitespace()) {
                  trimTrailingPart = false;
                }
                if (te._isTrimInstruction === true && te.left) {
                  trimTrailingPart = true;
                  break;
                }
              }
            }
            this.text = printablePart + (isTrimmableToEmpty(trailingPart) && trimTrailingPart ? '' : trailingPart);
          }
        }
      }
    }
    return result;
  }

  /** @returns {number} index of first line-break char, or -1 */
  _firstNewLineIndex() {
    for (let i = 0; i < this.text.length; i++) {
      const c = this.text[i];
      if (c === '\r' || c === '\n') return i;
    }
    return -1;
  }

  /** @returns {number} index of last line-break char, or -1 */
  _lastNewLineIndex() {
    for (let i = this.text.length - 1; i >= 0; i--) {
      const c = this.text[i];
      if (c === '\r' || c === '\n') return i;
    }
    return -1;
  }

  /** ← openingCharsToStrip() */
  _openingCharsToStrip() {
    let newlineIndex = this._firstNewLineIndex();
    if (newlineIndex === -1 && this.beginColumn !== 1) return 0;
    ++newlineIndex;
    if (this.text.length > newlineIndex) {
      if (newlineIndex > 0 && this.text[newlineIndex - 1] === '\r' && this.text[newlineIndex] === '\n') {
        ++newlineIndex;
      }
    }
    if (!isTrimmableToEmpty(this.text, 0, newlineIndex)) return 0;
    for (let elem = this.prevTerminalNode();
      elem != null && elem.endLine === this.beginLine;
      elem = elem.prevTerminalNode()) {
      if (elem.heedsOpeningWhitespace()) return 0;
    }
    return newlineIndex;
  }

  /** ← trailingCharsToStrip() */
  _trailingCharsToStrip() {
    const lastNewlineIndex = this._lastNewLineIndex();
    if (lastNewlineIndex === -1 && this.beginColumn !== 1) return 0;
    if (!isTrimmableToEmpty(this.text, lastNewlineIndex + 1)) return 0;
    for (let elem = this.nextTerminalNode();
      elem != null && elem.beginLine === this.endLine;
      elem = elem.nextTerminalNode()) {
      if (elem.heedsTrailingWhitespace()) return 0;
    }
    return this.text.length - (lastNewlineIndex + 1);
  }

  /** ← isTopLevelTextIfParentIs */
  _isTopLevelTextIfParentIs(parentElement) {
    return parentElement == null
      || (parentElement.parent == null && parentElement instanceof MixedContentElements);
  }

  /** ← heedsTrailingWhitespace(): content on the first line → true */
  heedsTrailingWhitespace() {
    if (this.isIgnorable(true)) return false;
    for (let i = 0; i < this.text.length; i++) {
      const c = this.text[i];
      if (c === '\n' || c === '\r') return false;
      if (!isWsChar(c)) return true;
    }
    return true;
  }

  /** ← heedsOpeningWhitespace(): content on the last line → true */
  heedsOpeningWhitespace() {
    if (this.isIgnorable(true)) return false;
    for (let i = this.text.length - 1; i >= 0; i--) {
      const c = this.text[i];
      if (c === '\n' || c === '\r') return false;
      if (!isWsChar(c)) return true;
    }
    return true;
  }

  /** ← isIgnorable(stripWhitespace) */
  isIgnorable(stripWhitespace) {
    if (this.text === null || this.text.length === 0) return true;
    if (!stripWhitespace) return false;
    if (!isTrimmableToEmpty(this.text)) return false;
    const parentElement = this.parent;
    const atTopLevel = this._isTopLevelTextIfParentIs(parentElement);
    const prevSibling = this.previousSibling();
    const nextSibling = this.nextSibling();
    return ((prevSibling === null && atTopLevel) || TextBlock._nonOutputtingType(prevSibling))
      && ((nextSibling === null && atTopLevel) || TextBlock._nonOutputtingType(nextSibling));
  }

  /** ← nonOutputtingType */
  static _nonOutputtingType(element) {
    return element instanceof Macro
      || element instanceof Assignment
      || element instanceof AssignmentInstruction
      || element instanceof CommentDirective
      || element instanceof TerseComment;
  }
}
