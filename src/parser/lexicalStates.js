/** Lexical states, names mirrored from FTL.jj; TokenManager.curLexState holds one. */
export const DEFAULT = 0;
/** Lexical state 1 ← LHS_FM_EXPRESSION. @type {number} */
export const FM_EXPRESSION = 1;
/** Lexical state 2 ← LHS_IN_PAREN. @type {number} */
export const IN_PAREN = 2;
/** Lexical state 3 ← LHS_NO_PARSE. @type {number} */
export const NO_PARSE = 3;
/** Lexical state 4 ← LHS_EXPRESSION_COMMENT. @type {number} */
export const EXPRESSION_COMMENT = 4;
/** Lexical state 5 ← LHS_NAMED_PARAMETER_EXPRESSION. @type {number} */
export const NAMED_PARAMETER_EXPRESSION = 5;
/** Lexical state 6 ← LHS_NO_SPACE_EXPRESSION. @type {number} */
export const NO_SPACE_EXPRESSION = 6;
/** Lexical state 7 ← LHS_NO_DIRECTIVE. @type {number} */
export const NO_DIRECTIVE = 7;
