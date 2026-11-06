/**
 * Token type enum with readable names (for error messages), mirroring FTL.jj token definitions.
 * @typedef {Object} Token
 * @property {number} type - a TT.* constant
 * @property {string} image - the exact source text of the token
 * @property {number} beginLine @property {number} beginColumn
 * @property {number} endLine @property {number} endColumn
 */

const TYPES = new Map();
let count = 0;

/** Named token type ← freemarker.core.TokenType. */
export class TokenType {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
    this.index = count++;
    TYPES.set(name, this);
  }

  /** @returns {string} */
  toString() {
    return this.name;
  }
}

// Tag / text / interpolation tokens (DEFAULT state):
new TokenType('EOF');
new TokenType('STATIC_TEXT_WS');
new TokenType('STATIC_TEXT_NON_WS');
new TokenType('STATIC_TEXT_FALSE_ALARM');
new TokenType('DOLLAR_INTERPOLATION_OPENING');
new TokenType('HASH_INTERPOLATION_OPENING');
new TokenType('SQUARE_BRACKET_INTERPOLATION_OPENING');
new TokenType('TERSE_COMMENT');
new TokenType('TERSE_COMMENT_END');
new TokenType('UNIFIED_CALL');
new TokenType('UNIFIED_CALL_END');
new TokenType('FTL_HEADER');
new TokenType('TRIVIAL_FTL_HEADER');
new TokenType('UNKNOWN_DIRECTIVE');

// Directive start/end tokens (names identical to FTL.jj):
for (const name of [
  'ATTEMPT', 'RECOVER', 'IF', 'ELSE_IF', 'LIST', 'ITEMS', 'SEP', 'FOREACH', 'SWITCH', 'CASE', 'ON',
  'ASSIGN', 'GLOBALASSIGN', 'LOCALASSIGN', '_INCLUDE', 'IMPORT', 'FUNCTION', 'MACRO', 'TRANSFORM',
  'VISIT', 'STOP', 'RETURN', 'CALL', 'SETTING', 'OUTPUTFORMAT', 'AUTOESC', 'NOAUTOESC', 'COMPRESS',
  'COMMENT', 'NOPARSE', 'ELSE', 'BREAK', 'CONTINUE', 'SIMPLE_RETURN', 'HALT', 'FLUSH', 'TRIM',
  'LTRIM', 'RTRIM', 'NOTRIM', 'DEFAUL', 'SIMPLE_NESTED', 'NESTED', 'SIMPLE_RECURSE', 'RECURSE',
  'FALLBACK', 'ESCAPE', 'NOESCAPE',
  'END_IF', 'END_LIST', 'END_ITEMS', 'END_SEP', 'END_RECOVER', 'END_ATTEMPT', 'END_FOREACH',
  'END_LOCAL', 'END_GLOBAL', 'END_ASSIGN', 'END_FUNCTION', 'END_MACRO', 'END_OUTPUTFORMAT',
  'END_AUTOESC', 'END_NOAUTOESC', 'END_COMPRESS', 'END_TRANSFORM', 'END_SWITCH', 'END_ESCAPE',
  'END_NOESCAPE',
]) new TokenType(name);

// Expression tokens (FM_EXPRESSION / IN_PAREN / NAMED_PARAMETER_EXPRESSION / NO_SPACE_EXPRESSION):
for (const name of [
  'STRING_LITERAL', 'RAW_STRING', 'FALSE', 'TRUE', 'INTEGER', 'DECIMAL', 'HEX_INTEGER',
  'DOT', 'DOT_DOT', 'DOT_DOT_LESS', 'DOT_DOT_ASTERISK', 'BUILT_IN', 'EXISTS', 'EQUALS',
  'DOUBLE_EQUALS', 'NOT_EQUALS', 'PLUS_EQUALS', 'MINUS_EQUALS', 'TIMES_EQUALS', 'DIV_EQUALS',
  'MOD_EQUALS', 'PLUS_PLUS', 'MINUS_MINUS', 'LESS_THAN', 'LESS_THAN_EQUALS', 'ESCAPED_GT',
  'ESCAPED_GTE', 'LAMBDA_ARROW', 'PLUS', 'MINUS', 'TIMES', 'DOUBLE_STAR', 'ELLIPSIS', 'DIVIDE',
  'PERCENT', 'AND', 'OR', 'EXCLAM', 'COMMA', 'SEMICOLON', 'COLON', 'OPEN_BRACKET', 'CLOSE_BRACKET',
  'OPEN_PAREN', 'CLOSE_PAREN', 'OPENING_CURLY_BRACKET', 'CLOSING_CURLY_BRACKET', 'IN', 'AS',
  'USING', 'ID', 'OPEN_MISPLACED_INTERPOLATION', 'DIRECTIVE_END', 'EMPTY_DIRECTIVE_END',
  'NATURAL_GT', 'NATURAL_GTE', 'TERMINATING_WHITESPACE', 'TERMINATING_EXCLAM',
]) new TokenType(name);

// NO_PARSE state:
for (const name of ['KEEP_GOING', 'MAYBE_END', 'LONE_LESS_THAN_OR_DASH']) new TokenType(name);

// name -> TokenType, frozen:
/** All token types by name. @type {Object<string, TokenType>} */
export const TT = Object.freeze(Object.fromEntries(TYPES));
