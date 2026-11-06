// Hand-written token manager mirroring FTL.jj: lexical states, nesting counters, tag syntax,
// interpolation syntax, naming-convention detection. No regexes.

import { Token } from './token.js';
import { TT } from './tokenType.js';
import * as LEX from './lexicalStates.js';
import { TokenMgrError } from '../errors.js';
import { Configuration } from '../configuration.js';

// start-tags that take expression params (need whitespace after the name):
/** tag-name -> param keyword. @type {Map<string, string>} */
const PARAM_START = new Map(Object.entries({
  if: TT.IF, list: TT.LIST, switch: TT.SWITCH, case: TT.CASE, on: TT.ON,
  assign: TT.ASSIGN, global: TT.GLOBALASSIGN, local: TT.LOCALASSIGN, include: TT._INCLUDE,
  import: TT.IMPORT, function: TT.FUNCTION, macro: TT.MACRO, transform: TT.TRANSFORM,
  visit: TT.VISIT, stop: TT.STOP, return: TT.RETURN, call: TT.CALL, setting: TT.SETTING,
  foreach: TT.FOREACH, forEach: TT.FOREACH, elseif: TT.ELSE_IF, elseIf: TT.ELSE_IF,
  outputformat: TT.OUTPUTFORMAT, outputFormat: TT.OUTPUTFORMAT,
  nested: TT.NESTED, recurse: TT.RECURSE, escape: TT.ESCAPE,
}));

// start-tags closed by ws* (">"|"]"); value: [type, newLexState]:
/** </tag> (requires close tag). @type {Map<string, string>} */
const CLOSE1_START = new Map(Object.entries({
  attempt: [TT.ATTEMPT, LEX.DEFAULT], recover: [TT.RECOVER, LEX.DEFAULT], sep: [TT.SEP, LEX.DEFAULT],
  compress: [TT.COMPRESS, LEX.DEFAULT], comment: [TT.COMMENT, LEX.NO_PARSE], default: [TT.DEFAUL, LEX.DEFAULT],
  autoesc: [TT.AUTOESC, LEX.DEFAULT], autoEsc: [TT.AUTOESC, LEX.DEFAULT],
  noautoesc: [TT.NOAUTOESC, LEX.DEFAULT], noAutoEsc: [TT.NOAUTOESC, LEX.DEFAULT],
  noparse: [TT.NOPARSE, LEX.NO_PARSE], noParse: [TT.NOPARSE, LEX.NO_PARSE],
}));

// start-tags closed by ws* ("/")? (">"|"]"):
/** </tag> (optional close). @type {Map<string, string>} */
const CLOSE2_START = new Map(Object.entries({
  else: TT.ELSE, break: TT.BREAK, continue: TT.CONTINUE, return: TT.SIMPLE_RETURN,
  stop: TT.HALT, flush: TT.FLUSH, t: TT.TRIM, lt: TT.LTRIM, rt: TT.RTRIM, nt: TT.NOTRIM,
  nested: TT.SIMPLE_NESTED, recurse: TT.SIMPLE_RECURSE, fallback: TT.FALLBACK,
  noescape: TT.NOESCAPE, noEscape: TT.NOESCAPE,
}));

// end tags (ws* (">"|"]")):
/** close tag -> directive token. @type {Map<string, Object>} */
const END_TAGS = new Map(Object.entries({
  if: TT.END_IF, list: TT.END_LIST, items: TT.END_ITEMS, sep: TT.END_SEP,
  recover: TT.END_RECOVER, attempt: TT.END_ATTEMPT, foreach: TT.END_FOREACH, forEach: TT.END_FOREACH,
  local: TT.END_LOCAL, global: TT.END_GLOBAL, assign: TT.END_ASSIGN, function: TT.END_FUNCTION,
  macro: TT.END_MACRO, outputformat: TT.END_OUTPUTFORMAT, outputFormat: TT.END_OUTPUTFORMAT,
  autoesc: TT.END_AUTOESC, autoEsc: TT.END_AUTOESC, noautoesc: TT.END_NOAUTOESC,
  noAutoEsc: TT.END_NOAUTOESC, compress: TT.END_COMPRESS, transform: TT.END_TRANSFORM,
  switch: TT.END_SWITCH, escape: TT.END_ESCAPE, noescape: TT.END_NOESCAPE, noEscape: TT.END_NOESCAPE,
}));

// all directive names ← _CoreAPI.ALL_BUILT_IN_DIRECTIVE_NAMES
/** every directive keyword. @type {Set<string>} */
const ALL_DIRECTIVE_NAMES = new Set([
  'assign', 'attempt', 'autoesc', 'autoEsc', 'break', 'call', 'case', 'comment', 'compress',
  'continue', 'default', 'else', 'elseif', 'elseIf', 'escape', 'fallback', 'flush', 'foreach',
  'forEach', 'ftl', 'function', 'global', 'if', 'import', 'include', 'items', 'list', 'local',
  'lt', 'macro', 'nested', 'noautoesc', 'noAutoEsc', 'noescape', 'noEscape', 'noparse', 'noParse',
  'nt', 'on', 'outputformat', 'outputFormat', 'recover', 'recurse', 'return', 'rt', 'sep',
  'setting', 'stop', 'switch', 't', 'transform', 'visit',
]);

// word spellings that lex to non-ID token types ← FTL.jj token literals
/** expression-language keywords. @type {Map<string, Object>} */
const KEYWORDS = new Map(Object.entries({
  true: TT.TRUE, false: TT.FALSE, as: TT.AS, in: TT.IN, using: TT.USING,
  lt: TT.LESS_THAN, lte: TT.LESS_THAN_EQUALS, gt: TT.ESCAPED_GT, gte: TT.ESCAPED_GTE,
}));

/** typo hints for unknown directives. @type {Map<string, string>} */
const UNKNOWN_DIRECTIVE_TIPS = new Map(Object.entries({
  set: 'Use #assign or #local or #global, depending on the intended scope (#assign is template-scope).',
  var: 'Use #assign or #local or #global, depending on the intended scope (#assign is template-scope).',
  else_if: 'Use #elseif.',
  elif: 'Use #elseif.',
  no_escape: 'Use #noescape instead.',
  method: 'Use #function instead.',
  head: 'You may have meant #ftl.',
  template: 'You may have meant #ftl.',
  fm: 'You may have meant #ftl.',
  try: 'You may have meant #attempt.',
  atempt: 'You may have meant #attempt.',
  for: 'You may have meant #list.',
  each: 'You may have meant #list.',
  iterate: 'You may have meant #list.',
  iterator: 'You may have meant #list.',
  prefix: 'You may have meant #import.',
  item: 'You may have meant #items.',
  row: 'You may have meant #items.',
  rows: 'You may have meant #items.',
  separator: 'You may have meant #sep.',
  separate: 'You may have meant #sep.',
  separ: 'You may have meant #sep.',
}));

// index of the case-deciding char in camel-variant directive names, -1 = no camel variant
/** @param {string} name @returns {number} index of the first capital, or -1 */
function camelIdx(name) {
  switch (name.toLowerCase()) {
    case 'elseif': return 4;
    case 'foreach': return 3;
    case 'outputformat': return 6;
    case 'autoesc': return 4;
    case 'noautoesc': return 2;
    case 'noparse': return 2;
    case 'noescape': return 2;
    default: return -1;
  }
}

// identifier start chars (Unicode subset mirroring FTL.jj NON_ESCAPED_ID_START_CHAR ranges)
/** non-ASCII identifier ranges (letter table). @type {number[][]} */
const ID_RANGES = [
  [0x24, 0x24], [0x40, 0x5a], [0x5f, 0x5f], [0x61, 0x7a], // $ @ A-Z _ a-z
  [0xaa, 0xaa], [0xb5, 0xb5], [0xba, 0xba],
  [0xc0, 0xd6], [0xd8, 0xf6], [0xf8, 0x2fff], [0x3040, 0x318f], [0x31a0, 0x31ba],
  [0x31f0, 0x31ff], [0x3400, 0x4db5], [0x4e00, 0x9fff], [0xac00, 0xd7a3],
  [0xf900, 0xfb06], [0xfb13, 0xfb17], [0xff21, 0xff3a], [0xff41, 0xff5a],
];

/** chars allowed in [bracketed] ids. @type {Set<string>} */
const ESCAPED_ID_CHARS = new Set(['-', '.', ':', '#']);

/**
 * Hand-written lexer mirroring FTL.jj token states / TOKEN_MGR_DECLS (no regex).
 * Positions are 1-based with tab expansion, like SimpleCharStream.
 */
export class TokenManager {
  /**
   * @param {string} source
   * @param {import('../configuration.js').Configuration} configuration
   */
  constructor(source, configuration) {
    this.source = source;
    this.cfg = configuration;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.lastLine = 1;
    this.lastColumn = 1;
    this.tabSize = configuration.getTabSize();

    this.curLexState = LEX.DEFAULT;
    this.postInterpolationLexState = -1;
    this.curlyBracketNesting = 0;
    this.parenthesisNesting = 0;
    this.bracketNesting = 0;
    this.inFTLHeader = false;
    this.inInvocation = false;
    this.noparseTag = null;

    const tagSyntax = configuration.getTagSyntax();
    this.autodetectTagSyntax = tagSyntax === Configuration.AUTO_DETECT_TAG_SYNTAX;
    this.squBracTagSyntax = tagSyntax === Configuration.SQUARE_BRACKET_TAG_SYNTAX;
    this.tagSyntaxEstablished = false;
    this.interpolationSyntax = configuration.getInterpolationSyntax();
    this.initialNamingConvention = configuration.getNamingConvention();
    this.namingConvention = configuration.getNamingConvention();
    this.namingConventionEstablisher = null;
  }

  // ---- char stream (1-based, tab expansion mirrors SimpleCharStream.setTabSize, CRLF/CR = 1 break) ----

  /** @returns {Token} */
  _eof() {
    return this.pos >= this.source.length;
  }

  /** @param {number} [o] @returns {Token} */
  _peek(o = 0) {
    return this.pos + o < this.source.length ? this.source[this.pos + o] : '';
  }

  /** @returns {Object} scanner state snapshot */
  _save() {
    return { pos: this.pos, line: this.line, column: this.column, lastLine: this.lastLine, lastColumn: this.lastColumn };
  }

  /** @param {Object} s @returns {void} */
  _restore(s) {
    this.pos = s.pos;
    this.line = s.line;
    this.column = s.column;
    this.lastLine = s.lastLine;
    this.lastColumn = s.lastColumn;
  }

  /** @returns {string} one char */
  _read() {
    const c = this.source[this.pos++];
    if (c === '\r') {
      this.lastLine = this.line;
      this.lastColumn = this.column;
      if (this.source[this.pos] === '\n') this.pos++;
      this.line++;
      this.column = 1;
    } else if (c === '\n') {
      this.lastLine = this.line;
      this.lastColumn = this.column;
      this.line++;
      this.column = 1;
    } else if (c === '\t') {
      this.column = (Math.floor((this.column - 1) / this.tabSize) + 1) * this.tabSize + 1;
      this.lastLine = this.line;
      this.lastColumn = this.column;
    } else {
      this.lastLine = this.line;
      this.lastColumn = this.column;
      this.column++;
    }
    return c;
  }

  /** @param {number} n @returns {string} */
  _readN(n) {
    for (let i = 0; i < n; i++) this._read();
  }

  /** @param {string} c @returns {boolean} */
  static isWhitespace(c) {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  }

  /** @param {string} c @returns {boolean} */
  _isDigit(c) {
    return c >= '0' && c <= '9';
  }

  /** @param {string} c @returns {boolean} */
  _isHexDigit(c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
  }

  /** @param {string} c @returns {boolean} */
  _isLetter(c) {
    if (c === '') return false;
    const cp = c.codePointAt(0);
    for (const [lo, hi] of ID_RANGES) {
      if (cp >= lo && cp <= hi) return true;
      if (cp < lo) break;
    }
    return false;
  }

  /** @param {string} c @returns {boolean} */
  _isIdStartChar(c) {
    if (c === '') return false;
    if (c === '\\') return ESCAPED_ID_CHARS.has(this._peek(1));
    return this._isLetter(c) || c === '$' || c === '@' || c === '_';
  }

  /** @param {string} c @returns {boolean} */
  _isIdPartChar(c) {
    return c === '\\' ? ESCAPED_ID_CHARS.has(this._peek(1)) || false : this._isLetter(c) || this._isDigit(c) || c === '$' || c === '@' || c === '_';
  }

  /** @param {TokenType} type @param {number} startPos @param {number} startLine @param {number} startColumn @returns {Token} */
  _token(type, startPos, startLine, startColumn) {
    return new Token(type, this.source.slice(startPos, this.pos),
      startLine, startColumn, this.lastLine, this.lastColumn);
  }

  /** @param {string} message @param {number} beginLine @param {number} beginColumn @param {number} endLine @param {number} endColumn @returns {TokenMgrError} */
  _error(message, beginLine, beginColumn, endLine, endColumn) {
    return new TokenMgrError(message, beginLine ?? this.line, beginColumn ?? this.column,
      endLine ?? this.lastLine, endColumn ?? this.lastColumn);
  }

  // ---- state / tag syntax / naming convention ← FTL.jj TOKEN_MGR_DECLS ----

  /**
   * Switches the active token state.
   * @param {number} state - a LEX.* constant
   * @returns {void}
   */
  switchTo(state) {
    this.curLexState = state;
  }

  /**
   * Applies tag-syntax auto-detection/consistency, then the naming convention and state switch
   * ← FTL.jj handleTagSyntaxAndSwitch.
   * @param {import('./token.js').Token} tok
   * @param {number} tokenNamingConvention
   * @param {number} newLexState
   * @returns {void}
   */
  handleTagSyntaxAndSwitch(tok, tokenNamingConvention, newLexState) {
    const image = tok.image;
    const firstChar = image[0];
    if (this.autodetectTagSyntax && !this.tagSyntaxEstablished) {
      this.squBracTagSyntax = firstChar === '[';
    }
    if ((firstChar === '[' && !this.squBracTagSyntax) || (firstChar === '<' && this.squBracTagSyntax)) {
      tok.type = TT.STATIC_TEXT_NON_WS; // not an FTL tag after all; image becomes static text
      return;
    }
    this.tagSyntaxEstablished = true;

    const lastChar = image[image.length - 1];
    if ((lastChar === '>' || lastChar === ']')
      && (!this.squBracTagSyntax && lastChar !== '>' || this.squBracTagSyntax && lastChar !== ']')) {
      throw this._error(`The tag shouldn't end with "${lastChar}".`,
        tok.beginLine, tok.beginColumn, tok.endLine, tok.endColumn);
    }

    this.checkNamingConvention(tok, tokenNamingConvention);
    this.switchTo(newLexState);
  }

  /**
   * Enforces the #ftl naming convention once established
   * ← FTL.jj checkNamingConvention.
   * @param {import('./token.js').Token} tok
   * @param {number} tokenNamingConvention
   * @returns {void}
   */
  checkNamingConvention(tok, tokenNamingConvention) {
    if (tokenNamingConvention === undefined) {
      tokenNamingConvention = TokenManager.identifierNamingConvention(tok.image);
    }
    if (tokenNamingConvention === Configuration.AUTO_DETECT_NAMING_CONVENTION) return;
    if (this.namingConvention === Configuration.AUTO_DETECT_NAMING_CONVENTION) {
      this.namingConvention = tokenNamingConvention;
      this.namingConventionEstablisher = tok;
    } else if (this.namingConvention !== tokenNamingConvention) {
      throw this._error(
        'Naming convention mismatch. Identifiers that are part of the template language must consistently '
        + `use the same naming convention. This template uses the `
        + `${this.namingConvention === Configuration.CAMEL_CASE_NAMING_CONVENTION ? 'camel case' : 'legacy'} `
        + 'naming convention'
        + (this.namingConventionEstablisher
          ? `, established at L${this.namingConventionEstablisher.beginLine}C${this.namingConventionEstablisher.beginColumn} `
            + `by token ${JSON.stringify(this.namingConventionEstablisher.image.trim())}`
          : '')
        + `, but the problematic token uses a different convention: `
        + JSON.stringify(tok.image.trim()),
        tok.beginLine, tok.beginColumn, tok.endLine, tok.endColumn);
    }
  }

  /** @param {string} name @returns {string} the detected convention */
  static identifierNamingConvention(name) {
    for (const c of name) {
      if (c === '_') return Configuration.LEGACY_NAMING_CONVENTION;
      if (c >= 'A' && c <= 'Z') return Configuration.CAMEL_CASE_NAMING_CONVENTION;
    }
    return Configuration.AUTO_DETECT_NAMING_CONVENTION;
  }

  /** @param {string} name @param {number} idx @returns {string} */
  static _tagNamingConvention(name, idx) {
    if (idx < 0) return Configuration.AUTO_DETECT_NAMING_CONVENTION;
    const c = name[idx];
    return c !== undefined && c >= 'A' && c <= 'Z'
      ? Configuration.CAMEL_CASE_NAMING_CONVENTION
      : Configuration.LEGACY_NAMING_CONVENTION;
  }

  /**
   * Enters expression mode for an interpolation opening that matches the configured syntax;
   * a disabled syntax demotes the token to static text ← FTL.jj startInterpolation.
   * @param {import('./token.js').Token} tok
   * @returns {void}
   */
  startInterpolation(tok) {
    const syntax = this.interpolationSyntax;
    const isSquOpen = tok.type === TT.SQUARE_BRACKET_INTERPOLATION_OPENING;
    const isDollarOpen = tok.type === TT.DOLLAR_INTERPOLATION_OPENING;
    // ← FTL.jj startInterpolation: LEGACY accepts ${ and #{ but demotes [=;
    // DOLLAR accepts only ${; SQUARE accepts only [=
    const demoted = (syntax === Configuration.LEGACY_INTERPOLATION_SYNTAX && isSquOpen)
      || (syntax === Configuration.DOLLAR_INTERPOLATION_SYNTAX && !isDollarOpen)
      || (syntax === Configuration.SQUARE_BRACKET_INTERPOLATION_SYNTAX && !isSquOpen);
    if (demoted) {
      tok.type = TT.STATIC_TEXT_NON_WS; // this interpolation syntax is disabled
      return;
    }
    this.postInterpolationLexState = this.curLexState;
    this.switchTo(LEX.FM_EXPRESSION);
  }

  /** @returns {void} Leaves expression mode back to the pre-interpolation state. */
  endInterpolation() {
    this.switchTo(this.postInterpolationLexState);
    this.postInterpolationLexState = -1;
  }

  /** @param {Token} tok @returns {never} */
  _unexpectedClosingToken(tok) {
    throw this._error(
      `You can't have an "${tok.image}" here, as there's nothing open that it could close.`,
      tok.beginLine, tok.beginColumn, tok.endLine, tok.endColumn);
  }

  // ---- main entry ----

  /**
   * Main entry: produces the next token per the current lexical state.
   * @returns {import('./token.js').Token}
   * @throws {import('../errors.js').TokenMgrError}
   */
  nextToken() {
    const st = this.curLexState;
    if (st === LEX.FM_EXPRESSION || st === LEX.IN_PAREN || st === LEX.NO_SPACE_EXPRESSION
      || st === LEX.NAMED_PARAMETER_EXPRESSION || st === LEX.NO_DIRECTIVE) {
      this._skipExpressionWhitespaceAndComments();
      if (this._eof()) return this._token(TT.EOF, this.pos, this.line, this.column);
      return this._lexExpression();
    }
    if (this._eof()) return this._token(TT.EOF, this.pos, this.line, this.column);
    return this._lexDefault();
  }

  // ---- DEFAULT state: text, interpolation openings, tags, comments ----

  /** STATIC mode scanner. @returns {void} */
  _lexDefault() {
    const startPos = this.pos;
    const startLine = this.line;
    const startColumn = this.column;
    const c = this._peek();

    if (TokenManager.isWhitespace(c)) {
      while (!this._eof() && TokenManager.isWhitespace(this._peek())) this._read();
      return this._token(TT.STATIC_TEXT_WS, startPos, startLine, startColumn);
    }

    // interpolation openings take priority over lone-char false alarms
    if ((c === '$' || c === '#') && this._peek(1) === '{') {
      this._read(); this._read();
      const tok = this._token(c === '$' ? TT.DOLLAR_INTERPOLATION_OPENING : TT.HASH_INTERPOLATION_OPENING,
        startPos, startLine, startColumn);
      this.startInterpolation(tok);
      return tok;
    }
    if (c === '[' && this._peek(1) === '=') {
      this._read(); this._read();
      const tok = this._token(TT.SQUARE_BRACKET_INTERPOLATION_OPENING, startPos, startLine, startColumn);
      this.startInterpolation(tok);
      return tok;
    }

    if (c === '<' || c === '[') {
      return this._lexTagStart(startPos, startLine, startColumn);
    }

    if (c === '$' || c === '#' || c === '<' || c === '[' || c === '{') {
      this._read();
      return this._token(TT.STATIC_TEXT_FALSE_ALARM, startPos, startLine, startColumn);
    }

    while (!this._eof()) {
      const d = this._peek();
      if (d === '$' || d === '<' || d === '#' || d === '[' || d === '{' || TokenManager.isWhitespace(d)) break;
      this._read();
    }
    return this._token(TT.STATIC_TEXT_NON_WS, startPos, startLine, startColumn);
  }

  /** @param {number} startPos @param {number} startLine @param {number} startColumn @returns {void} */
  _lexTagStart(startPos, startLine, startColumn) {
    const opener = this._peek();
    const slash = this._peek(1) === '/';
    const nameAt = slash ? 2 : 1; // index of the '#' (or non-# legacy char)

    if (!slash && this._peek(nameAt) === '@') {
      this._readN(2);
      const tok = this._token(TT.UNIFIED_CALL, startPos, startLine, startColumn);
      this._unifiedCall(tok);
      return tok;
    }
    if (slash && this._peek(2) === '@') {
      this._readN(3); // < or [, /, @
      this._readIdChars();
      while (this._peek() === '.' && this._isIdStartChar(this._peek(1))) {
        this._read();
        this._readIdChars();
      }
      while (!this._eof() && TokenManager.isWhitespace(this._peek())) this._read();
      if (this._peek() === '>' || this._peek() === ']') this._read();
      const tok = this._token(TT.UNIFIED_CALL_END, startPos, startLine, startColumn);
      this._unifiedCallEnd(tok);
      return tok;
    }
    if (this._peek(nameAt) !== '#') {
      // legacy non-strict tag syntax is not supported: lone opener is static text
      this._read();
      return this._token(TT.STATIC_TEXT_FALSE_ALARM, startPos, startLine, startColumn);
    }
    return this._lexFtlTag(startPos, startLine, startColumn, opener, slash);
  }

  /** @param {Token} tok @returns {void} */
  _unifiedCall(tok) {
    const firstChar = tok.image[0];
    if (this.autodetectTagSyntax && !this.tagSyntaxEstablished) {
      this.squBracTagSyntax = firstChar === '[';
    }
    if ((this.squBracTagSyntax && firstChar === '<') || (!this.squBracTagSyntax && firstChar === '[')) {
      tok.type = TT.STATIC_TEXT_NON_WS;
      return;
    }
    this.tagSyntaxEstablished = true;
    this.switchTo(LEX.NO_SPACE_EXPRESSION);
  }

  /** @param {Token} tok @returns {void} */
  _unifiedCallEnd(tok) {
    const firstChar = tok.image[0];
    if ((this.squBracTagSyntax && firstChar === '<') || (!this.squBracTagSyntax && firstChar === '[')) {
      tok.type = TT.STATIC_TEXT_NON_WS;
      return;
    }
    this.switchTo(LEX.DEFAULT);
  }

  /** @param {number} startPos @param {number} startLine @param {number} startColumn @param {string} opener @param {boolean} isEnd @returns {void} */
  _lexFtlTag(startPos, startLine, startColumn, opener, isEnd) {
    this._readN(isEnd ? 3 : 2); // opener[/]#

    if (!isEnd && this._peek() === '-' && this._peek(1) === '-') {
      this._read(); this._read();
      const tok = this._token(TT.TERSE_COMMENT, startPos, startLine, startColumn);
      this.noparseTag = '-->';
      this.handleTagSyntaxAndSwitch(tok, Configuration.AUTO_DETECT_NAMING_CONVENTION, LEX.NO_PARSE);
      return tok;
    }

    let name = '';
    while (!this._eof()) {
      const d = this._peek();
      if ((d >= 'a' && d <= 'z') || (d >= 'A' && d <= 'Z') || d === '_') name += this._read();
      else break;
    }
    if (name === '') {
      throw this._error('Malformed FTL tag: a directive name is expected after "#".',
        startLine, startColumn, this.lastLine, this.lastColumn);
    }

    // #items as loopVar → single token spanning through "as "
    if (!isEnd && name === 'items') {
      const save = this._save();
      let wsLen = 0;
      while (TokenManager.isWhitespace(this._peek())) {
        this._read();
        wsLen++;
      }
      if (wsLen > 0 && this._peek(0) === 'a' && this._peek(1) === 's' && !this._isIdPartChar(this._peek(2))) {
        this._read(); this._read();
        let ws2 = 0;
        while (TokenManager.isWhitespace(this._peek())) {
          this._read();
          ws2++;
        }
        if (ws2 > 0) {
          const tok = this._token(TT.ITEMS, startPos, startLine, startColumn);
          this.handleTagSyntaxAndSwitch(tok, Configuration.AUTO_DETECT_NAMING_CONVENTION, LEX.FM_EXPRESSION);
          return tok;
        }
      }
      this._restore(save);
      return this._unknownDirective(startPos, startLine, startColumn, opener, isEnd, name);
    }

    const beforeClose = this._save();
    let wsLen = 0;
    while (TokenManager.isWhitespace(this._peek())) {
      this._read();
      wsLen++;
    }
    const wsEnd = this._save();
    let selfClosed = false;
    if (this._peek() === '/') {
      this._read();
      selfClosed = true;
    }
    let closer = null;
    if (this._peek() === '>' || this._peek() === ']') closer = this._read();

    if (isEnd) {
      const kind = END_TAGS.get(name);
      if (kind == null || closer == null || selfClosed) {
        this._restore(beforeClose);
        return this._unknownDirective(startPos, startLine, startColumn, opener, isEnd, name);
      }
      const tok = this._token(kind, startPos, startLine, startColumn);
      this.handleTagSyntaxAndSwitch(tok, TokenManager._tagNamingConvention(name, camelIdx(name)), LEX.DEFAULT);
      return tok;
    }

    if (name === 'ftl') {
      if (closer != null && wsLen === 0) {
        const tok = this._token(TT.TRIVIAL_FTL_HEADER, startPos, startLine, startColumn);
        this._ftlHeader(tok);
        return tok;
      }
      if (wsLen > 0) {
        this._restore(wsEnd); // tag token ends after the ws; closer (if any) relexes as DIRECTIVE_END
        const tok = this._token(TT.FTL_HEADER, startPos, startLine, startColumn);
        this._ftlHeader(tok);
        return tok;
      }
      this._restore(beforeClose);
      return this._unknownDirective(startPos, startLine, startColumn, opener, isEnd, name);
    }

    const paramType = PARAM_START.get(name);
    if (paramType != null && wsLen > 0) {
      this._restore(wsEnd); // ← FTL.jj: IF/LIST/... tokens end at the single BLANK
      const tok = this._token(paramType, startPos, startLine, startColumn);
      this.handleTagSyntaxAndSwitch(tok, TokenManager._tagNamingConvention(name, camelIdx(name)), LEX.FM_EXPRESSION);
      return tok;
    }
    const close1 = CLOSE1_START.get(name);
    if (close1 != null && closer != null && !selfClosed) {
      const [type, state] = close1;
      const tok = this._token(type, startPos, startLine, startColumn);
      if (type === TT.COMMENT) this.noparseTag = 'comment';
      if (type === TT.NOPARSE) {
        this.noparseTag = TokenManager._tagNamingConvention(name, 2) === Configuration.CAMEL_CASE_NAMING_CONVENTION
          ? 'noParse' : 'noparse';
      }
      this.handleTagSyntaxAndSwitch(tok, TokenManager._tagNamingConvention(name, camelIdx(name)), state);
      return tok;
    }
    const close2 = CLOSE2_START.get(name);
    if (close2 != null && closer != null) {
      const tok = this._token(close2, startPos, startLine, startColumn);
      this.handleTagSyntaxAndSwitch(tok, TokenManager._tagNamingConvention(name, camelIdx(name)), LEX.DEFAULT);
      return tok;
    }

    // known name in wrong form → malformed-tag; unknown name → unknown-directive
    this._restore(beforeClose);
    return this._unknownDirective(startPos, startLine, startColumn, opener, isEnd, name);
  }

  /** @param {Token} tok @returns {void} */
  _ftlHeader(tok) {
    if (!this.tagSyntaxEstablished) {
      this.squBracTagSyntax = tok.image[0] === '[';
      this.tagSyntaxEstablished = true;
      this.autodetectTagSyntax = false;
    }
    const firstChar = tok.image[0];
    const lastChar = tok.image[tok.image.length - 1];
    if ((firstChar === '[' && !this.squBracTagSyntax) || (firstChar === '<' && this.squBracTagSyntax)) {
      tok.type = TT.STATIC_TEXT_NON_WS;
      return;
    }
    if (lastChar !== '>' && lastChar !== ']') {
      this.switchTo(LEX.FM_EXPRESSION);
      this.inFTLHeader = true;
    } else {
      this._eatNewline();
    }
  }

  /** @returns {void} */
  _eatNewline() {
    // ← FTL.jj eatNewline: consumes whitespace only up to and including the first
    // line break; a whitespace run without any line break is put back unread.
    const save = this._save();
    while (!this._eof()) {
      const c = this._peek();
      if (!TokenManager.isWhitespace(c)) {
        this._restore(save);
        return;
      }
      this._read();
      if (c === '\r') {
        if (this._peek() === '\n') this._read();
        return;
      }
      if (c === '\n') return;
    }
    this._restore(save); // EOF before any line break: nothing was eaten
  }

  /** @param {number} startPos @param {number} startLine @param {number} startColumn @param {string} opener @param {boolean} isEnd @param {string} name @returns {never} */
  _unknownDirective(startPos, startLine, startColumn, opener, isEnd, name) {
    const tok = this._token(TT.UNKNOWN_DIRECTIVE, startPos, startLine, startColumn);
    if (ALL_DIRECTIVE_NAMES.has(name)) {
      throw this._error(
        `#${name} is an existing directive, but the tag is malformed.`
        + ' (See FreeMarker Manual / Directive Reference.)',
        tok.beginLine, tok.beginColumn, tok.endLine, tok.endColumn);
    }
    const tip = UNKNOWN_DIRECTIVE_TIPS.get(name);
    throw this._error(
      `Unknown directive: #${name}` + (tip ? `. ${tip}` : ''),
      tok.beginLine, tok.beginColumn, tok.endLine, tok.endColumn);
  }

  // ---- expression states ----

  /** @returns {void} */
  _skipExpressionWhitespaceAndComments() {
    for (;;) {
      while (!this._eof() && TokenManager.isWhitespace(this._peek())) this._read();
      if ((this._peek() === '<' || this._peek() === '[')
        && (this._peek(1) === '#' || this._peek(1) === '!')
        && this._peek(2) === '-' && this._peek(3) === '-') {
        this._skipExpressionComment();
        continue;
      }
      return;
    }
  }

  /** @returns {void} */
  _skipExpressionComment() {
    const startLine = this.line;
    const startColumn = this.column;
    for (;;) {
      if (this._eof()) {
        throw this._error('Unclosed expression comment ("-->").', startLine, startColumn);
      }
      if (this._peek() === '-' && this._peek(1) === '-' && (this._peek(2) === '>' || this._peek(2) === ']')) {
        this._readN(3);
        break;
      }
      this._read();
    }
    if (this.parenthesisNesting > 0) this.switchTo(LEX.IN_PAREN);
    else if (this.inInvocation) this.switchTo(LEX.NAMED_PARAMETER_EXPRESSION);
    else this.switchTo(LEX.FM_EXPRESSION);
  }

  /** FM_EXPRESSION mode scanner. @returns {void} */
  _lexExpression() {
    const startPos = this.pos;
    const startLine = this.line;
    const startColumn = this.column;
    const st = this.curLexState;
    const c = this._peek();

    if ((c === '$' || c === '#') && this._peek(1) === '{' || c === '[' && this._peek(1) === '=') {
      this._read(); this._read();
      const tok = this._token(TT.OPEN_MISPLACED_INTERPOLATION, startPos, startLine, startColumn);
      const closerC = tok.image[0] !== '[' ? '}' : ']';
      throw this._error(
        `You can't use ${tok.image}...${closerC} (an interpolation) here as you are already in `
        + 'FreeMarker-expression-mode. Thus, instead of '
        + `${tok.image}myExpression${closerC}, just write myExpression. `
        + `(${tok.image}...${closerC} is only used where otherwise static text is expected, `
        + 'i.e., outside FreeMarker tags and interpolations, or inside string literals.)',
        tok.beginLine, tok.beginColumn, tok.endLine, tok.endColumn);
    }

    if (c === '[') {
      this._read();
      this.bracketNesting++;
      return this._token(TT.OPEN_BRACKET, startPos, startLine, startColumn);
    }
    if (c === ']') {
      this._read();
      const tok = this._token(TT.CLOSE_BRACKET, startPos, startLine, startColumn);
      if (this.bracketNesting > 0) {
        this.bracketNesting--;
      } else if (this.interpolationSyntax === Configuration.SQUARE_BRACKET_INTERPOLATION_SYNTAX
        && this.postInterpolationLexState !== -1) {
        this.endInterpolation();
      } else if (this.postInterpolationLexState !== -1 || !this.squBracTagSyntax) {
        this._unexpectedClosingToken(tok);
      } else {
        tok.type = TT.DIRECTIVE_END;
        if (this.inFTLHeader) {
          this._eatNewline();
          this.inFTLHeader = false;
        }
        this.switchTo(LEX.DEFAULT);
      }
      return tok;
    }
    if (c === '(') {
      this._read();
      this.parenthesisNesting++;
      if (this.parenthesisNesting === 1) this.switchTo(LEX.IN_PAREN);
      return this._token(TT.OPEN_PAREN, startPos, startLine, startColumn);
    }
    if (c === ')') {
      this._read();
      this.parenthesisNesting--;
      if (this.parenthesisNesting === 0) {
        if (this.inInvocation) this.switchTo(LEX.NAMED_PARAMETER_EXPRESSION);
        else this.switchTo(LEX.FM_EXPRESSION);
      }
      return this._token(TT.CLOSE_PAREN, startPos, startLine, startColumn);
    }
    if (c === '{') {
      this._read();
      this.curlyBracketNesting++;
      return this._token(TT.OPENING_CURLY_BRACKET, startPos, startLine, startColumn);
    }
    if (c === '}') {
      this._read();
      const tok = this._token(TT.CLOSING_CURLY_BRACKET, startPos, startLine, startColumn);
      if (this.curlyBracketNesting > 0) {
        this.curlyBracketNesting--;
      } else if (this.postInterpolationLexState !== -1) {
        this.endInterpolation();
      } else {
        this._unexpectedClosingToken(tok);
      }
      return tok;
    }

    if (st === LEX.IN_PAREN && c === '>') {
      if (this._peek(1) === '=') {
        this._read(); this._read();
        return this._token(TT.NATURAL_GTE, startPos, startLine, startColumn);
      }
      this._read();
      return this._token(TT.NATURAL_GT, startPos, startLine, startColumn);
    }

    if (st !== LEX.IN_PAREN) {
      if (c === '>') {
        this._read();
        if (this.squBracTagSyntax || this.postInterpolationLexState !== -1) {
          return this._token(TT.NATURAL_GT, startPos, startLine, startColumn);
        }
        const tok = this._token(TT.DIRECTIVE_END, startPos, startLine, startColumn);
        if (this.inFTLHeader) {
          this._eatNewline();
          this.inFTLHeader = false;
        }
        this.switchTo(LEX.DEFAULT);
        return tok;
      }
      if (c === '/' && (this._peek(1) === '>' || this._peek(1) === ']')) {
        this._read(); this._read();
        const tok = this._token(TT.EMPTY_DIRECTIVE_END, startPos, startLine, startColumn);
        const lastChar = tok.image[tok.image.length - 1];
        if (!this.squBracTagSyntax && lastChar !== '>' || this.squBracTagSyntax && lastChar !== ']') {
          throw this._error(`The tag shouldn't end with "${lastChar}".`,
            tok.beginLine, tok.beginColumn, tok.endLine, tok.endColumn);
        }
        if (this.inFTLHeader) {
          this._eatNewline();
          this.inFTLHeader = false;
        }
        this.switchTo(LEX.DEFAULT);
        return tok;
      }
    }

    if (st === LEX.NAMED_PARAMETER_EXPRESSION && c === '!' && TokenManager.isWhitespace(this._peek(1))) {
      this._read();
      while (!this._eof() && TokenManager.isWhitespace(this._peek())) this._read();
      const tok = this._token(TT.TERMINATING_EXCLAM, startPos, startLine, startColumn);
      this.switchTo(LEX.FM_EXPRESSION);
      return tok;
    }

    if (st === LEX.NO_SPACE_EXPRESSION && TokenManager.isWhitespace(c)) {
      while (!this._eof() && TokenManager.isWhitespace(this._peek())) this._read();
      const tok = this._token(TT.TERMINATING_WHITESPACE, startPos, startLine, startColumn);
      this.switchTo(LEX.FM_EXPRESSION);
      return tok;
    }

    if (c === '"' || c === "'") return this._lexString(startPos, startLine, startColumn, false);
    if (c === 'r' && (this._peek(1) === '"' || this._peek(1) === "'")) {
      this._read();
      return this._lexString(startPos, startLine, startColumn, true);
    }

    if (this._isDigit(c)) {
      if (c === '0' && (this._peek(1) === 'x' || this._peek(1) === 'X') && this._isHexDigit(this._peek(2))) {
        this._readN(2);
        while (this._isHexDigit(this._peek())) this._read();
        return this._token(TT.HEX_INTEGER, startPos, startLine, startColumn);
      }
      while (this._isDigit(this._peek())) this._read();
      if (this._peek() === '.' && this._isDigit(this._peek(1))) {
        this._read();
        while (this._isDigit(this._peek())) this._read();
        return this._token(TT.DECIMAL, startPos, startLine, startColumn);
      }
      return this._token(TT.INTEGER, startPos, startLine, startColumn);
    }

    if (this._isIdStartChar(c)) {
      this._readIdChars();
      const image = this.source.slice(startPos, this.pos).split('\\').join('');
      const kw = KEYWORDS.get(image);
      const tok = this._token(kw ?? TT.ID, startPos, startLine, startColumn);
      tok.image = image; // backslashes stripped, mirroring the FTL.jj ID action
      return tok;
    }

    // operators, longest match first
    if (this._startsWith('...')) {
      this._readN(3);
      return this._token(TT.ELLIPSIS, startPos, startLine, startColumn);
    }
    if (this._startsWith('..<') || this._startsWith('..!')) {
      this._readN(3);
      return this._token(TT.DOT_DOT_LESS, startPos, startLine, startColumn);
    }
    if (this._startsWith('..*')) {
      this._readN(3);
      return this._token(TT.DOT_DOT_ASTERISK, startPos, startLine, startColumn);
    }
    if (this._startsWith('??')) {
      this._readN(2);
      return this._token(TT.EXISTS, startPos, startLine, startColumn);
    }
    if (this._startsWith('..')) {
      this._readN(2);
      return this._token(TT.DOT_DOT, startPos, startLine, startColumn);
    }
    if (this._startsWith('**')) {
      this._readN(2);
      return this._token(TT.DOUBLE_STAR, startPos, startLine, startColumn);
    }
    if (this._startsWith('->') || this._startsWith('-&gt;')) {
      this._readN(this._startsWith('-&gt;') ? 5 : 2);
      return this._token(TT.LAMBDA_ARROW, startPos, startLine, startColumn);
    }
    if (this._startsWith('--')) {
      this._readN(2);
      return this._token(TT.MINUS_MINUS, startPos, startLine, startColumn);
    }
    if (this._startsWith('++')) {
      this._readN(2);
      return this._token(TT.PLUS_PLUS, startPos, startLine, startColumn);
    }
    if (this._startsWith('==')) {
      this._readN(2);
      return this._token(TT.DOUBLE_EQUALS, startPos, startLine, startColumn);
    }
    if (this._startsWith('!=')) {
      this._readN(2);
      return this._token(TT.NOT_EQUALS, startPos, startLine, startColumn);
    }
    if (this._startsWith('&amp;&amp;')) {
      this._readN(9);
      return this._token(TT.AND, startPos, startLine, startColumn);
    }
    if (this._startsWith('&lt;=')) {
      this._readN(5);
      return this._token(TT.LESS_THAN_EQUALS, startPos, startLine, startColumn);
    }
    if (this._startsWith('&gt;=')) {
      this._readN(5);
      return this._token(TT.ESCAPED_GTE, startPos, startLine, startColumn);
    }
    if (this._startsWith('&lt;')) {
      this._readN(4);
      return this._token(TT.LESS_THAN, startPos, startLine, startColumn);
    }
    if (this._startsWith('&gt;')) {
      this._readN(4);
      return this._token(TT.ESCAPED_GT, startPos, startLine, startColumn);
    }
    if (this._startsWith('\\lte')) {
      this._readN(4);
      return this._token(TT.LESS_THAN_EQUALS, startPos, startLine, startColumn);
    }
    if (this._startsWith('\\gte')) {
      this._readN(4);
      return this._token(TT.ESCAPED_GTE, startPos, startLine, startColumn);
    }
    if (this._startsWith('\\lt')) {
      this._readN(3);
      return this._token(TT.LESS_THAN, startPos, startLine, startColumn);
    }
    if (this._startsWith('\\gt')) {
      this._readN(3);
      return this._token(TT.ESCAPED_GT, startPos, startLine, startColumn);
    }
    if (this._startsWith('\\and')) {
      this._readN(4);
      return this._token(TT.AND, startPos, startLine, startColumn);
    }
    if (this._startsWith('&&')) {
      this._readN(2);
      return this._token(TT.AND, startPos, startLine, startColumn);
    }
    if (this._startsWith('||')) {
      this._readN(2);
      return this._token(TT.OR, startPos, startLine, startColumn);
    }
    for (const [op, type] of TokenManager.OP2) {
      if (this._startsWith(op)) {
        this._readN(2);
        return this._token(type, startPos, startLine, startColumn);
      }
    }

    if (c === '?') {
      this._read();
      return this._token(TT.BUILT_IN, startPos, startLine, startColumn);
    }
    if (c === '.') {
      this._read();
      return this._token(TT.DOT, startPos, startLine, startColumn);
    }
    const single = TokenManager.OP1.get(c);
    if (single) {
      this._read();
      return this._token(single, startPos, startLine, startColumn);
    }

    throw this._error(`Unrecognized character in expression: ${JSON.stringify(c)}`,
      startLine, startColumn, this.line, this.column);
  }

  /** two-char operator images -> token type. @type {Map<string, TokenType>} */
  static OP2 = new Map(Object.entries({
    '+=': TT.PLUS_EQUALS, '-=': TT.MINUS_EQUALS, '*=': TT.TIMES_EQUALS,
    '/=': TT.DIV_EQUALS, '%=': TT.MOD_EQUALS, '<=': TT.LESS_THAN_EQUALS,
  }));

  /** one-char operator images -> token type. @type {Map<string, TokenType>} */
  static OP1 = new Map(Object.entries({
    '+': TT.PLUS, '-': TT.MINUS, '*': TT.TIMES, '/': TT.DIVIDE, '%': TT.PERCENT,
    '=': TT.EQUALS, '<': TT.LESS_THAN, '&': TT.AND, '|': TT.OR, '!': TT.EXCLAM,
    ',': TT.COMMA, ';': TT.SEMICOLON, ':': TT.COLON, '?': TT.BUILT_IN, '.': TT.DOT,
  }));

  /** @param {string} s @returns {boolean} */
  _startsWith(s) {
    return this.source.startsWith(s, this.pos);
  }

  /** @returns {string} */
  _readIdChars() {
    for (;;) {
      if (this._peek() === '\\') {
        if (ESCAPED_ID_CHARS.has(this._peek(1))) {
          this._read();
          this._read();
        } else {
          return;
        }
      } else if (this._isLetter(this._peek()) || this._isDigit(this._peek())
        || this._peek() === '$' || this._peek() === '@' || this._peek() === '_') {
        this._read();
      } else {
        return;
      }
    }
  }

  /** @param {number} startPos @param {number} startLine @param {number} startColumn @param {boolean} raw @returns {void} */
  _lexString(startPos, startLine, startColumn, raw) {
    const quote = this._read();
    for (;;) {
      if (this._eof()) {
        throw this._error('Unclosed string literal.', startLine, startColumn, this.line, this.column);
      }
      const c = this._read();
      if (c === quote) break;
      if (c === '\\' && !raw) this._read(); // escaped char stays in image; decoding is the parser's job
    }
    return this._token(raw ? TT.RAW_STRING : TT.STRING_LITERAL, startPos, startLine, startColumn);
  }

  // ---- NO_PARSE content (comment / noparse); parser calls this after COMMENT/TERSE_COMMENT/NOPARSE ----

  /**
   * Reads comment/noparse body up to the matching closing tag; called by the parser after
   * COMMENT / TERSE_COMMENT / NOPARSE tokens ← UnparsedContent().
   * @returns {{ text: string, closed: boolean, beginLine: number, beginColumn: number,
   *   endLine: number, endColumn: number, endTagImage: string|null }}
   */
  readUnparsedContent() {
    // ← UnparsedContent(): returns { text, closed, beginLine, beginColumn, endLine, endColumn, endTagImage }
    const parts = [];
    const startLine = this.line;
    const startColumn = this.column;
    for (;;) {
      if (this._eof()) {
        return { text: parts.join(''), closed: false, beginLine: startLine, beginColumn: startColumn,
          endLine: this.lastLine, endColumn: this.lastColumn, endTagImage: null };
      }
      const c = this._peek();
      if (this.noparseTag === '-->' && c === '-' && this._peek(1) === '-'
        && (this._peek(2) === '>' || this._peek(2) === ']')) {
        const bracket = this._peek(2) === ']';
        if (this.squBracTagSyntax === bracket) {
          const save = this._save();
          this._readN(3);
          return { text: parts.join(''), closed: true, beginLine: startLine, beginColumn: startColumn,
            endLine: this.lastLine, endColumn: this.lastColumn, endTagImage: this.source.slice(save.pos, this.pos) };
        }
      }
      if (this.noparseTag !== '-->' && (c === '<' || c === '[') && this._looksLikeNoparseEnd()) {
        const save = this._save();
        while (!this._eof() && this._peek() !== '>' && this._peek() !== ']') this._read();
        if (this._peek() === '>' || this._peek() === ']') this._read();
        return { text: parts.join(''), closed: true, beginLine: startLine, beginColumn: startColumn,
          endLine: this.lastLine, endColumn: this.lastColumn, endTagImage: this.source.slice(save.pos, this.pos) };
      }
      this._read();
      parts.push(c);
    }
  }

  /** @returns {boolean} */
  _looksLikeNoparseEnd() {
    // MAYBE_END ← ("<" | "[") "/" ("#")? letters ws* (">" | "]") with name == noparseTag
    let i = 1;
    if (this._peek(i) === '/') i++;
    if (this._peek(i) === '#') i++;
    let name = '';
    while (true) {
      const c = this._peek(i);
      if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
        name += c;
        i++;
      } else {
        break;
      }
    }
    if (name !== this.noparseTag) return false;
    while (TokenManager.isWhitespace(this._peek(i))) i++;
    return this._peek(i) === '>' || this._peek(i) === ']';
  }
}
