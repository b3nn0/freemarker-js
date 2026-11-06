/** Lexical states, names mirrored from FTL.jj; TokenManager.curLexState holds one. */
export const DEFAULT = 0;
export const FM_EXPRESSION = 1;
export const IN_PAREN = 2;
export const NO_PARSE = 3;
export const EXPRESSION_COMMENT = 4;
export const NAMED_PARAMETER_EXPRESSION = 5;
export const NO_SPACE_EXPRESSION = 6;
export const NO_DIRECTIVE = 7;
