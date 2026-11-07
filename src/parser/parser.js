// Recursive-descent expression parser mirroring FTL.jj production structure.
// Root: text + interpolations + comments; directive bodies land in later milestones.
// No regexes here (tag/text detection is token-type based).

import { TokenManager } from './tokenManager.js';
import { TT } from './tokenType.js';
import * as LEX from './lexicalStates.js';
import { ParseException, TokenMgrError, UnsupportedFeatureException,
  UnregisteredOutputFormatException } from '../errors.js';
import { getStandardOutputFormat } from '../outputFormat.js';
import { MixedContentElements } from './ast/mixedContentElements.js';
import { TextBlock } from './ast/textBlock.js';
import { Interpolation } from './ast/interpolation.js';
import { TerseComment } from './ast/terseComment.js';
import { CommentDirective } from './ast/commentDirective.js';
import { NumberLiteral, StringLiteral, BooleanLiteral, ListLiteral, HashLiteral } from './ast/expressions/literals.js';
import { Identifier, Dot, DynamicKeyName } from './ast/expressions/variables.js';
import { MethodCall } from './ast/expressions/calls.js';
import {
  ParentheticalExpression, AddConcatExpression, ArithmeticExpression, UnaryPlusMinusExpression,
  NotExpression, ComparisonExpression, Range, AndExpression, OrExpression,
  DefaultToExpression, ExistsExpression,
} from './ast/expressions/operators.js';
import { UPSTREAM_BUILT_INS, BI_LIST_TEXT } from '../builtins/upstreamBIRegistry.js';
import { BuiltIn } from './ast/expressions/builtIn.js';
import { LocalLambdaExpression } from './ast/expressions/lambda.js';
import { IfBlock, ConditionalBlock } from './ast/directives/if.js';
import { IteratorBlock, Items, Sep } from './ast/directives/list.js';
import { AttemptBlock } from './ast/directives/attempt.js';
import { SwitchBlock, Case, On } from './ast/directives/switch.js';
import { BreakInstruction, ContinueInstruction } from './ast/directives/control.js';
import { Assignment, AssignmentInstruction } from './ast/directives/assign.js';
import { Macro } from './ast/directives/macro.js';
import { UnifiedCall, NestedInstruction, FallbackInstruction } from './ast/directives/unifiedCall.js';
import { ReturnInstruction } from './ast/directives/control.js';
import { FTLHeader } from './ast/directives/ftlHeader.js';
import { TrimInstruction } from './ast/directives/trim.js';
import { CompressedBlock } from './ast/directives/compress.js';
import { IncludeDirective } from './ast/directives/include.js';
import { ImportDirective } from './ast/directives/importDir.js';
import { StopInstruction, FlushInstruction } from './ast/directives/stop.js';
import { AutoEscBlock, NoAutoEscBlock } from './ast/directives/autoEsc.js';
import { EscapeDirective, EscapeChain, EscapeVar, NoEscapeBlock } from './ast/directives/escape.js';
import { OutputFormatBlock } from './ast/directives/outputFormat.js';
import { PropertySetting, SETTING_NAMES, CAMEL_SETTING_NAMES } from './ast/directives/setting.js';
import { BuiltinVariable } from './ast/expressions/builtIn.js';
import { unescapeFTLStringLiteral, isTrimmableToEmpty } from '../utility/stringUtil.js';

/** @type {Set<import('./tokenType.js').TokenType>} */
const STATIC_TYPES = new Set([TT.STATIC_TEXT_WS, TT.STATIC_TEXT_NON_WS, TT.STATIC_TEXT_FALSE_ALARM]);

// <- FTL.jj HeaderElement() "you may meant" suggestions for unknown #ftl params
/** typo hints for #ftl params. @type {Map<string, string>} */
const FTL_HEADER_PARAM_SUGGESTIONS = new Map([
  ['charset', 'encoding'],
  ['xmlns', 'ns_prefixes'],
  ['auto_escape', 'auto_esc'],
  ['auto_escaping', 'auto_esc'],
  ['autoesc', 'auto_esc'],
  ['autoescape', 'autoEsc'],
  ['autoescaping', 'autoEsc'],
]);

/** @type {Set<import('./tokenType.js').TokenType>} */
const EQUALITY_OPS = new Set([TT.EQUALS, TT.DOUBLE_EQUALS, TT.NOT_EQUALS]);
/** @type {Set<import('./tokenType.js').TokenType>} */
const RELATIONAL_OPS = new Set([
  TT.NATURAL_GT, TT.NATURAL_GTE, TT.ESCAPED_GT, TT.ESCAPED_GTE, TT.LESS_THAN, TT.LESS_THAN_EQUALS,
]);
// keyword tokens usable as plain names after a dot <- FTL.jj DotVariable production
/** @type {Set<import('./tokenType.js').TokenType>} */
const DOT_KEY_TOKENS = new Set([
  TT.ID, TT.TRUE, TT.FALSE, TT.IN, TT.AS, TT.USING,
  TT.LESS_THAN, TT.LESS_THAN_EQUALS, TT.ESCAPED_GT, TT.ESCAPED_GTE, TT.TIMES, TT.DOUBLE_STAR,
]);
/** token types that may begin an expression. @type {Set<import('./tokenType.js').TokenType>} */
const EXPRESSION_START = new Set([
  TT.INTEGER, TT.DECIMAL, TT.HEX_INTEGER, TT.STRING_LITERAL, TT.RAW_STRING, TT.TRUE, TT.FALSE,
  TT.ID, TT.OPEN_BRACKET, TT.OPENING_CURLY_BRACKET, TT.OPEN_PAREN, TT.DOT, TT.PLUS, TT.MINUS, TT.EXCLAM,
]);
// Built-ins that bind their arguments at parse time and accept a lambda argument
// (name -> required lambda parameter count) <- BuiltInWithParseTimeParameters
// isLocalLambdaParameterSupported (filterBI, mapBI).
/** builtin -> param count. @type {Map<string, number>} */
const LAMBDA_ARG_BUILTINS = new Map([['filter', 1], ['map', 1]]);
// <- BuiltInWithParseTimeParameters with unevaluated (lazy) parameters: these consume
// "(args)" at parse time. All other built-ins return first; "(args)" is a MethodCall.
/** builtins with parse-time (unevaluated) args. @type {Set<string>} */
const LAZY_ARG_BUILTINS = new Set(['then', 'switch', 'default', 'string']);

/**
 * Recursive-descent parser mirroring the upstream JavaCC grammar (current syntax only).
 * @property {Object[]} macros - Macro nodes collected at parse time (namespace seeding)
 */
export class Parser {
  /**
   * @param {string} source - the template source
   * @param {import('../configuration.js').Configuration} configuration
   * @param {string|null} [templateName]
   */
  constructor(source, configuration, templateName = null) {
    this.cfg = configuration;
    this.templateName = templateName;
    this.tm = new TokenManager(source, configuration);
    this._buf = [];
    // directive context tracking <- FTL.jj parserIteratorBlockContexts / *DirectiveNesting
    this._iterCtx = [];
    this.breakableDepth = 0;
    this.continuableDepth = 0;
    this.inMacroOrFunction = false; // <- #local is only legal inside macros/functions (M9)
    this.inMacro = false;
    this.inFunction = false;
    this.macros = []; // <- template.addMacro equivalent; collected Macro nodes
    this._argsFlag = false; // set when `.args` is parsed inside the current macro/function
    this.headerElement = null; // <- FTL.jj Root(): at most one header
    this.stripWhitespace = configuration.getWhitespaceStripping();
    this.stripText = false; // only the #ftl header can set it (2.3)
    this.preventStrippings = false; // <- Configuration.preventStrippings (not exposed by this port)
    this.mixedContentNesting = 0; // <- FTL.jj mixedContentNesting (for stripText)
    // <- FTL.jj outputFormat / autoEscapingPolicy / autoEscaping parser fields
    this.outputFormat = configuration.getOutputFormat();
    this.autoEscapingPolicy = configuration.getAutoEscapingPolicy();
    this.autoEscaping = this._recalculateAutoEscaping();
    // <- FTL.jj escapeDirectives (the #escape / #noescape stack)
    this._escapeStack = [];
    this._escapeSuspendIndex = -1; // set while parsing inside #noescape
    this._escapeIdName = null; // name being replaced by placeholders in the as-expr
  }

  // <- FTL.jj recalculateAutoEscapingField()
  /** <- FTL.jj recalculateAutoEscapingField. @returns {void} */
  _recalculateAutoEscaping() {
    if (this.outputFormat.isMarkup) {
      switch (this.autoEscapingPolicy) {
        case 'enableIfDefault': return this.outputFormat.isAutoEscapedByDefault;
        case 'enableIfSupported':
        case 'force':
          return true;
        case 'disable':
          return false;
        default:
          throw new Error(`Unhandled autoEscaping policy: ${this.autoEscapingPolicy}`);
      }
    }
    return false;
  }

  /**
   * Parses the whole template; lexer failures (TokenMgrError) are converted to ParseException.
   * @returns {import('./ast/textBlock.js')|Object} the root element
   * @throws {import('../errors.js').ParseException}
   */
  parse() {
    try {
      const root = this._parseRoot();
    // <- Root(): if (!preventStrippings) root = root.postParseCleanup(stripWhitespace);
    if (!this.preventStrippings) this._postParseCleanup(root);
    return root;
    } catch (e) {
      if (e instanceof TokenMgrError) {
        throw new ParseException(e.message, {
          templateName: this.templateName,
          beginLine: e.beginLine, beginColumn: e.beginColumn,
          endLine: e.endLine, endColumn: e.endColumn,
        });
      }
      throw e;
    }
  }

  // ---- token plumbing ----

  /** @param {number} n @returns {void} */
  _ensure(n) {
    while (this._buf.length < n) this._buf.push(this.tm.nextToken());
  }

  /** @param {number} [k] @returns {import('./token.js').Token} */
  _peek(k = 0) {
    this._ensure(k + 1);
    return this._buf[k];
  }

  /** @returns {import('./token.js').Token} */
  _next() {
    this._ensure(1);
    return this._buf.shift();
  }

  /** @param {import('./token.js').Token} t @returns {string} human token description */
  _desc(t) {
    return t.type === TT.EOF ? 'end of template' : `${t.type.name}(${JSON.stringify(t.image)})`;
  }

  /** @param {string} message @param {import('./token.js').Token} t @returns {import('../errors.js').ParseException} */
  _error(message, t) {
    return new ParseException(message, {
      templateName: this.templateName,
      beginLine: t.beginLine, beginColumn: t.beginColumn, endLine: t.endLine, endColumn: t.endColumn,
    });
  }

  /** @param {string} message @param {Object} node @returns {import('../errors.js').ParseException} */
  _errorAt(message, node) {
    return new ParseException(message, {
      templateName: this.templateName,
      beginLine: node.beginLine, beginColumn: node.beginColumn,
      endLine: node.endLine, endColumn: node.endColumn,
    });
  }

  /** @param {Object} node @param {import('./token.js').Token} from @param {import('./token.js').Token} to @returns {Object} node, located */
  _span(node, from, to) {
    const setter = node.setLoc ?? node.setLocation;
    setter.call(node, this.templateName, from.beginLine, from.beginColumn, to.endLine, to.endColumn);
    return node;
  }

  // ---- FTL header (at most one, at the start) <- FTL.jj Root() header branch ----

  /**
   * @param {import('./token.js').Token} t - the TRIVIAL_FTL_HEADER token
   * @returns {FTLHeader}
   */
  _parseTrivialFTLHeader(t) {
    this.headerElement = this._span(new FTLHeader([], {}), t, t);
    return this.headerElement;
  }

  /**
   * Parameters and closing of the non-trivial header.
   * Upstream evaluates parameter expressions at parse time; this port restricts
   * them to literal constants (see UPSTREAM.md).
   * @param {import('./token.js').Token} startTok - the FTL_HEADER token
   * @returns {FTLHeader}
   */
  _parseFTLHeader(startTok) {
    const params = [];
    const settings = {};
    for (;;) {
      const kt = this._peek();
      if (kt.type === TT.DIRECTIVE_END || kt.type === TT.EMPTY_DIRECTIVE_END) {
        this._next();
        this.headerElement = this._span(new FTLHeader(params, settings), startTok, kt);
        return this.headerElement;
      }
      if (kt.type !== TT.ID) {
        throw this._error(`Expected a "#ftl" parameter name or the end of the directive, but got ${this._desc(kt)}.`, kt);
      }
      this._next();
      const eq = this._peek();
      if (eq.type !== TT.EQUALS) {
        throw this._error(`Expected "=" after the "#ftl" parameter name "${kt.image}".`, eq);
      }
      this._next();
      const exp = this._parseExpression();
      params.push({ key: kt.image, exp });
      this._applyFTLHeaderParam(kt, exp, settings);
    }
  }

  /**
   * @param {import('./token.js').Token} keyTok - the parameter name token
   * @param {import('./ast/expressions/expression.js').Expression} exp
   * @param {Object} settings - evaluated values, accumulated here
   * @returns {void}
   */
  _applyFTLHeaderParam(keyTok, exp, settings) {
    const k = keyTok.image;
    const ks = k.toLowerCase();
    // <- FTL.jj: equalsIgnoreCase(snake_case) || equals(camelCase)
    const matches = (snake, camel) => ks === snake || k === camel;
    if (ks === 'encoding') {
      const v = this._evalHeaderConstant(exp);
      if (typeof v !== 'string') throw this._errorAt(`Expected a string constant for "${keyTok.image}".`, exp);
      settings.encoding = v;
    } else if (matches('strip_whitespace', 'stripWhitespace')) {
      settings.stripWhitespace = this.stripWhitespace = this._evalHeaderBoolean(keyTok.image, exp);
    } else if (matches('strip_text', 'stripText')) {
      settings.stripText = this.stripText = this._evalHeaderBoolean(keyTok.image, exp);
    } else if (matches('strict_syntax', 'strictSyntax')) {
      settings.strictSyntax = this._evalHeaderBoolean(keyTok.image, exp);
    } else if (matches('auto_esc', 'autoEsc')) {
      settings.autoEsc = this._evalHeaderBoolean(keyTok.image, exp);
      // <- FTL.jj header: auto_esc=true/false picks the policy, then recalculate.
      this.autoEscapingPolicy = settings.autoEsc
        ? 'enableIfSupported'
        : (this.autoEscapingPolicy === 'force' ? this.autoEscapingPolicy : 'disable');
      this.autoEscaping = this._recalculateAutoEscaping();
    } else if (matches('output_format', 'outputFormat')) {
      const v = this._evalHeaderConstant(exp);
      if (typeof v !== 'string') throw this._errorAt(`Expected a string constant for "${keyTok.image}".`, exp);
      try {
        this.outputFormat = getStandardOutputFormat(v);
      } catch (e) {
        if (e instanceof UnregisteredOutputFormatException) throw this._errorAt(e.message, exp);
        throw e;
      }
      this.autoEscaping = this._recalculateAutoEscaping();
      settings.outputFormat = this.outputFormat.name;
    } else if (matches('ns_prefixes', 'nsPrefixes') || ks === 'attributes') {
      throw new UnsupportedFeatureException(
        `The "#ftl ${keyTok.image}" parameter is not supported by this port yet.`);
    } else {
      const suggested = FTL_HEADER_PARAM_SUGGESTIONS.get(ks) ?? null;
      throw this._error(
        `Unknown FTL header parameter: ${keyTok.image}`
        + (suggested === null ? '' : `. You may meant: ${suggested}`),
        keyTok);
    }
  }

  /**
   * @param {import('./ast/expressions/expression.js').Expression} exp
   * @returns {string|number|boolean} the literal value
   */
  _evalHeaderConstant(exp) {
    if (exp instanceof StringLiteral || exp instanceof NumberLiteral || exp instanceof BooleanLiteral) {
      return exp.value;
    }
    throw this._errorAt(
      `Could not evaluate expression (on parse-time): ${exp.getCanonicalForm()}`
      + ' - the "#ftl" parameter must be a constant literal.',
      exp);
  }

  /**
   * <- FTL.jj getBoolean(): true/false constants, or string "true"/"false".
   * @param {string} name - parameter name (for messages)
   * @param {import('./ast/expressions/expression.js').Expression} exp
   * @returns {boolean}
   */
  _evalHeaderBoolean(name, exp) {
    if (exp instanceof BooleanLiteral) return exp.value;
    if (exp instanceof StringLiteral) {
      const s = exp.value.toLowerCase();
      if (s === 'true') return true;
      if (s === 'false') return false;
    }
    throw this._errorAt(
      `Expected a boolean constant (true/false or "true"/"false") for "${name}", `
      + `but got ${exp.getCanonicalForm()}.`,
      exp);
  }

  // ---- root (mixed content) <- FTL.jj MixedContentElements() ----

  /** @returns {import('./ast/templateElement.js').TemplateElement} */
  _parseRoot() {
    const root = this._parseMixedContent(new Set());
    const t = this._peek();
    if (t.type !== TT.EOF) {
      throw this._error(`Unexpected ${this._desc(t)} at top level.`, t);
    }
    // <- FTL.jj Root() / TemplateElements.asSingleElement(): a lone child *is* the root
    return root.children.length === 1 ? root.children[0] : root;
  }

  /** @param {Set<import('./tokenType.js').TokenType>} stop @returns {MixedContentElements} */
  _parseMixedContent(stop) {
    this.mixedContentNesting++;
    const group = new MixedContentElements();
    let pending = '';
    let pendingBegin = null;
    let pendingEnd = null;
    const flush = () => {
      if (pendingBegin !== null) {
        group.addChild(this._span(new TextBlock(pending), pendingBegin, pendingEnd));
        pending = '';
        pendingBegin = null;
      }
    };

    for (;;) {
      const t = this._peek();
      if (t.type === TT.EOF) break;
      if (stop.has(t.type)) break;

      if (STATIC_TYPES.has(t.type)) {
        this._next();
        // <- PCData()/WhitespaceText(): stripText removes top-level text runs at parse time
        if (this.stripText && this.mixedContentNesting === 1 && !this.preventStrippings) continue;
        if (pendingBegin === null) pendingBegin = t;
        pending += t.image;
        pendingEnd = t;
        continue;
      }

      flush();

      if (t.type === TT.DOLLAR_INTERPOLATION_OPENING || t.type === TT.HASH_INTERPOLATION_OPENING
        || t.type === TT.SQUARE_BRACKET_INTERPOLATION_OPENING) {
        this._next();
        const expression = this._parseExpression();
        let fracOpts = null;
        // <- FTL.jj NumericalOutput(): #{exp; mN M2M4 format specifier
        if (t.type === TT.HASH_INTERPOLATION_OPENING) {
          this._checkNumericInterpolationLiteral(expression);
          if (this._peek().type === TT.SEMICOLON) {
            this._next();
            const fmt = this._peek();
            if (fmt.type !== TT.ID) {
              throw this._error(
                'Expected a format specifier like "m2M4" after the ";" in "#{...}", but got '
                + `${this._desc(fmt)}.`, fmt);
            }
            this._next();
            fracOpts = this._parseHashInterpolationFormat(fmt);
          }
        }
        const closer = this._peek();
        const expected = t.type === TT.SQUARE_BRACKET_INTERPOLATION_OPENING
          ? TT.CLOSE_BRACKET : TT.CLOSING_CURLY_BRACKET;
        if (closer.type !== expected) {
          throw this._error(
            `Expected "${expected === TT.CLOSE_BRACKET ? ']' : '}'}" to close the interpolation, but got ${this._desc(closer)}.`,
            closer);
        }
        this._next();
        // <- FTL.jj StringOutput: notHashLiteral/notListLiteral
        if (expression instanceof HashLiteral) {
          throw this._errorAt('A hash literal has no string form; it can\'t be interpolated with ${...}.', expression);
        }
        if (expression instanceof ListLiteral) {
          throw this._errorAt('A list literal has no string form; it can\'t be interpolated with ${...}.', expression);
        }
        // <- DollarVariable captures the format/auto-escape state at parse time
        group.addChild(this._span(
          new Interpolation(this._applyEscape(expression), this.outputFormat, this.autoEscaping, fracOpts), t, closer));
        continue;
      }

      if (t.type === TT.TERSE_COMMENT) {
        this._next();
        const c = this.tm.readUnparsedContent();
        this.tm.switchTo(LEX.DEFAULT);
        if (!c.closed) throw this._error('Unclosed comment. (Missing "-->")', t);
        group.addChild(new TerseComment(c.text)
          .setLocation(this.templateName, t.beginLine, t.beginColumn, c.endLine, c.endColumn));
        continue;
      }

      if (t.type === TT.COMMENT || t.type === TT.NOPARSE) {
        this._next();
        const c = this.tm.readUnparsedContent();
        this.tm.switchTo(LEX.DEFAULT);
        if (!c.closed) {
          throw this._error(
            t.type === TT.COMMENT ? 'Unclosed comment. (Missing "</#comment>")' : 'Unclosed #noparse. (Missing "</#noparse>")',
            t);
        }
        const node = t.type === TT.COMMENT ? new CommentDirective(c.text) : new TextBlock(c.text, true);
        group.addChild(node.setLocation(this.templateName, t.beginLine, t.beginColumn, c.endLine, c.endColumn));
        continue;
      }

      if (t.type === TT.TRIVIAL_FTL_HEADER || t.type === TT.FTL_HEADER) {
        // <- FTL.jj Root(): the header is only allowed at the start, preceded only by
        // whitespace (the LOOKAHEAD [STATIC_TEXT_WS] consumes that whitespace run).
        if (this.headerElement !== null
          || (group.children.length > 0
            && !group.children.every((c) => c instanceof TextBlock && isTrimmableToEmpty(c.text)))
          || pending.trim() !== '') {
          throw this._error('The "#ftl" directive is only allowed once, at the start of the template.', t);
        }
        group.children.length = 0; // LOOKAHEAD whitespace never becomes an element
        pending = '';
        pendingBegin = null;
        pendingEnd = null;
        this._next();
        // <- FTL.jj Root()/HeaderElement(): the header is NOT an AST child (void
        // production); it only configures the parser/template. The following text is
        // the first top-level text, so it skips the opening auto-strip.
        if (t.type === TT.TRIVIAL_FTL_HEADER) this._parseTrivialFTLHeader(t);
        else this._parseFTLHeader(t);
        continue;
      }

      switch (t.type) {
        case TT.IF:
          this._next();
          group.addChild(this._parseIf(t));
          continue;
        case TT.LIST:
          this._next();
          group.addChild(this._parseList(t));
          continue;
        case TT.FOREACH:
          this._next();
          group.addChild(this._parseForEach(t));
          continue;
        case TT.ATTEMPT:
          this._next();
          group.addChild(this._parseAttempt(t));
          continue;
        case TT.SWITCH:
          this._next();
          group.addChild(this._parseSwitch(t));
          continue;
        case TT.ITEMS:
          this._next();
          group.addChild(this._parseItems(t, stop));
          continue;
        case TT.SEP:
          this._next();
          group.addChild(this._parseSep(t, stop));
          continue;
        case TT.BREAK:
          this._next();
          group.addChild(this._parseBreak(t));
          continue;
        case TT.CONTINUE:
          this._next();
          group.addChild(this._parseContinue(t));
          continue;
        case TT.ASSIGN:
        case TT.GLOBALASSIGN:
        case TT.LOCALASSIGN:
          this._next();
          group.addChild(this._parseAssign(t));
          continue;
        case TT.MACRO:
        case TT.FUNCTION:
          this._next();
          group.addChild(this._parseMacro(t));
          continue;
        case TT.UNIFIED_CALL:
          this._next();
          group.addChild(this._parseUnifiedCall(t));
          continue;
        case TT.RETURN:
        case TT.SIMPLE_RETURN:
          this._next();
          group.addChild(this._parseReturn(t));
          continue;
        case TT.NESTED:
        case TT.SIMPLE_NESTED:
          this._next();
          group.addChild(this._parseNested(t));
          continue;
        case TT.TRIM:
          this._next();
          group.addChild(this._span(new TrimInstruction(true, true), t, t));
          continue;
        case TT.LTRIM:
          this._next();
          group.addChild(this._span(new TrimInstruction(true, false), t, t));
          continue;
        case TT.RTRIM:
          this._next();
          group.addChild(this._span(new TrimInstruction(false, true), t, t));
          continue;
        case TT.NOTRIM:
          this._next();
          group.addChild(this._span(new TrimInstruction(false, false), t, t));
          continue;
        case TT.COMPRESS:
          this._next();
          group.addChild(this._parseCompress(t));
          continue;
        case TT.FALLBACK:
          this._next();
          if (!this.inMacro) throw this._error('Cannot fall back outside a macro.', t);
          group.addChild(this._span(new FallbackInstruction(), t, t));
          continue;
        case TT._INCLUDE:
          this._next();
          group.addChild(this._parseInclude(t));
          continue;
        case TT.IMPORT:
          this._next();
          group.addChild(this._parseImport(t));
          continue;
        case TT.STOP:
          this._next();
          group.addChild(this._parseStop(t));
          continue;
        case TT.HALT:
          this._next();
          group.addChild(this._span(new StopInstruction(null), t, t));
          continue;
        case TT.FLUSH:
          this._next();
          group.addChild(this._span(new FlushInstruction(), t, t));
          continue;
        case TT.AUTOESC:
        case TT.NOAUTOESC:
          group.addChild(this._parseAutoEsc(t));
          continue;
        case TT.ESCAPE:
          group.addChild(this._parseEscape(t));
          continue;
        case TT.NOESCAPE:
          if (this._escapeStack.length === 0) {
            throw this._error('Unexpected "<#noescape>" (it can only appear inside a <#escape> block).', t);
          }
          this._next();
          group.addChild(this._parseNoEscape(t));
          continue;
        case TT.OUTPUTFORMAT:
          group.addChild(this._parseOutputFormatBlock(t));
          continue;
        case TT.SETTING:
          this._next();
          group.addChild(this._parseSetting(t));
          continue;
        default:
          break;
      }

      // stray end tags and dangling else-tags are parse errors, not later milestones
      if (t.image.startsWith('</')) {
        throw this._error(`Unexpected end tag: ${t.image}`, t);
      }
      if (t.type === TT.ELSE || t.type === TT.ELSE_IF) {
        throw this._error(
          `Unexpected "${t.image}" -- it must belong to an enclosing <#if> or <#list> block.`, t);
      }
      // remaining tag-starting tokens are directives not yet parseable
      if (t.image.startsWith('<') || t.image.startsWith('[')) {
        throw new UnsupportedFeatureException(
          `Directive "${directiveTag(t)}" is not supported in this milestone yet.`);
      }

      throw this._error(`Unexpected ${this._desc(t)} in this context.`, t);
    }

    flush();
    this.mixedContentNesting--;
    return group;
  }

  // ---- #include / #import / #stop (FTL.jj Include(), Import(), Stop()) ----

  /**
   * @param {import('./token.js').Token} startTok - the INCLUDE token
   * @returns {IncludeDirective}
   */
  _parseInclude(startTok) {
    const nameExp = this._parseExpression();
    if (this._peek().type === TT.SEMICOLON) this._next(); // <- [<SEMICOLON>]
    let parseExp = null;
    let encodingExp = null;
    let ignoreMissingExp = null;
    for (;;) {
      const kt = this._peek();
      if (kt.type === TT.DIRECTIVE_END || kt.type === TT.EMPTY_DIRECTIVE_END) {
        this._next();
        return this._span(new IncludeDirective(nameExp, parseExp, encodingExp, ignoreMissingExp), startTok, kt);
      }
      if (kt.type !== TT.ID) {
        throw this._error(`Expected an "#include" parameter or the end of the directive, but got ${this._desc(kt)}.`, kt);
      }
      this._next();
      if (this._peek().type !== TT.EQUALS) {
        throw this._error(`Expected "=" after the "#include" parameter "${kt.image}".`, this._peek());
      }
      this._next();
      const exp = this._parseExpression();
      const a = kt.image;
      const al = a.toLowerCase();
      if (al === 'parse') parseExp = exp;
      else if (al === 'encoding') encodingExp = exp;
      else if (al === 'ignore_missing' || a === 'ignoreMissing') {
        this.tm.checkNamingConvention(kt);
        ignoreMissingExp = exp;
      } else {
        const corrected = a === 'ignoreMissing' ? 'ignore_missing' : null;
        throw this._error('Unsupported named #include parameter: "' + a
          + '". Supported parameters are: "parse", "encoding", "ignore_missing".'
          + (corrected === null ? '' : ` Did you mean "${corrected}"?`), kt);
      }
    }
  }

  /**
   * @param {import('./token.js').Token} startTok - the IMPORT token
   * @returns {ImportDirective}
   */
  _parseImport(startTok) {
    const nameExp = this._parseExpression();
    const asTok = this._peek();
    if (asTok.type !== TT.AS) {
      throw this._error(`Expected "as" after the imported template name, but got ${this._desc(asTok)}.`, asTok);
    }
    this._next();
    const idTok = this._peek();
    if (idTok.type !== TT.ID) {
      throw this._error(`Expected a namespace variable name after "as", but got ${this._desc(idTok)}.`, idTok);
    }
    this._next();
    const kt = this._peek();
    if (kt.type !== TT.DIRECTIVE_END && kt.type !== TT.EMPTY_DIRECTIVE_END) {
      throw this._error(`Expected the end of the "#import" directive, but got ${this._desc(kt)}.`, kt);
    }
    this._next();
    return this._span(new ImportDirective(nameExp, idTok.image), startTok, kt);
  }

  /**
   * @param {import('./token.js').Token} startTok - the STOP token (with expression)
   * @returns {StopInstruction}
   */
  _parseStop(startTok) {
    const exp = this._parseExpression();
    const kt = this._peek();
    if (kt.type !== TT.DIRECTIVE_END && kt.type !== TT.EMPTY_DIRECTIVE_END) {
      throw this._error(`Expected the end of the "#stop" directive, but got ${this._desc(kt)}.`, kt);
    }
    this._next();
    return this._span(new StopInstruction(exp), startTok, kt);
  }

  // ---- post-parse whitespace cleanup <- TemplateElement.postParseCleanup ----

  /**
   * Recurses (children first), then runs TextBlock trimming, then drops ignorable children.
   * @param {import('./ast/templateElement.js').TemplateElement} el
   * @returns {import('./ast/templateElement.js').TemplateElement}
   */
  _postParseCleanup(el) {
    if (el.children.length > 0) {
      for (let i = 0; i < el.children.length; i++) {
        el.children[i] = this._postParseCleanup(el.children[i]);
      }
      for (let i = 0; i < el.children.length; i++) {
        if (el.children[i].isIgnorable(this.stripWhitespace)) {
          el.children.splice(i, 1);
          i--; // later isIgnorable calls investigate the shifted siblings
        }
      }
    }
    if (el instanceof TextBlock) el.postParseCleanup(this.stripWhitespace);
    return el;
  }

  /**
   * <#compress> body <- FTL.jj Compress().
   * @param {import('./token.js').Token} startTok
   * @returns {CompressedBlock}
   */
  _parseCompress(startTok) {
    const children = this._parseMixedContent(new Set([TT.END_COMPRESS]));
    const end = this._peek();
    if (end.type !== TT.END_COMPRESS) {
      throw this._error('Missing end tag: "</#compress>" expected.', end);
    }
    this._next();
    const block = new CompressedBlock(children.children);
    this._span(block, startTok, end);
    return block;
  }

  // ---- output format / auto-escape blocks <- FTL.jj AutoEscapeBlock(),
  // NoAutoEscBlock(), OutputFormatBlock() ----

  /** @param {import('./token.js').Token} startTok @returns {import('./ast/templateElement.js').TemplateElement} */
  _parseAutoEsc(startTok) {
    const isAuto = startTok.type === TT.AUTOESC;
    this._next();
    // <- checkCurrentOutputFormatCanEscape(start): only for #autoesc
    if (isAuto && !this.outputFormat.isMarkup) {
      throw this._error(
        `The current output format can't do escaping: ${this.outputFormat}`, startTok);
    }
    const endType = isAuto ? TT.END_AUTOESC : TT.END_NOAUTOESC;
    const endName = isAuto ? '</#autoesc>' : '</#noautoesc>';
    const savedPolicy = this.autoEscapingPolicy;
    const savedAutoEscaping = this.autoEscaping;
    this.autoEscapingPolicy = isAuto ? 'enableIfSupported' : 'disable';
    this.autoEscaping = this._recalculateAutoEscaping();
    try {
      const children = this._parseMixedContent(new Set([endType]));
      const end = this._peek();
      if (end.type !== endType) {
        throw this._error(`Missing end tag: "${endName}" expected.`, end);
      }
      this._next();
      const block = isAuto
        ? new AutoEscBlock(children.children)
        : new NoAutoEscBlock(children.children);
      return this._span(block, startTok, end);
    } finally {
      this.autoEscapingPolicy = savedPolicy;
      this.autoEscaping = savedAutoEscaping;
    }
  }

  /**
   * <- FTL.jj EscapeDirective(): <#escape varName as expr> ... </#escape>
   * @param {import('./token.js').Token} startTok @returns {EscapeDirective}
   */
  _parseEscape(startTok) {
    this._next();
    const name = this._assignName();
    const asTok = this._peek();
    if (asTok.type !== TT.AS) {
      throw this._error(`Expected "as" after the "#escape" variable name, but got ${this._desc(asTok)}.`, asTok);
    }
    this._next();
    const savedIdName = this._escapeIdName;
    this._escapeIdName = name;
    let expr;
    try {
      expr = this._parseExpression();
    } finally {
      this._escapeIdName = savedIdName;
    }
    const endTok = this._expect(TT.DIRECTIVE_END, '">"');
    this._escapeStack.push({ name, expr });
    try {
      const children = this._parseMixedContent(new Set([TT.END_ESCAPE]));
      const end = this._expect(TT.END_ESCAPE, '"</#escape>"');
      return this._span(new EscapeDirective(name, expr, children.children), startTok, end);
    } finally {
      this._escapeStack.pop();
    }
  }

  /**
   * <- FTL.jj NoEscapeBlock(): <#noescape> ... </#noescape> inside an #escape
   * @param {import('./token.js').Token} startTok @returns {import('./ast/templateElement.js').TemplateElement}
   */
  _parseNoEscape(startTok) {
    // TT.NOESCAPE (CLOSE2 map) already carries its ">" closer.
    const savedSuspend = this._escapeSuspendIndex;
    this._escapeSuspendIndex = this._escapeStack.length;
    try {
      const children = this._parseMixedContent(new Set([TT.END_NOESCAPE]));
      const end = this._expect(TT.END_NOESCAPE, '"</#noescape>"');
      return this._span(new NoEscapeBlock(children.children), startTok, end);
    } finally {
      this._escapeSuspendIndex = savedSuspend;
    }
  }

  /**
   * <- FTL.jj escape-directive wrapping of simple-identifier interpolations
   * @param {import('./ast/expressions/expression.js').Expression} expression
   * @returns {import('./ast/expressions/expression.js').Expression}
   */
  _applyEscape(expression) {
    if (this._escapeStack.length === 0 || !(expression instanceof Identifier)) return expression;
    for (let i = this._escapeStack.length - 1; i >= 0; i--) {
      const e = this._escapeStack[i];
      if (e.name !== expression.name) continue;
      if (this._escapeSuspendIndex >= 0 && i < this._escapeSuspendIndex) return expression;
      return new EscapeChain(expression.name, e.expr);
    }
    return expression;
  }

  /** @param {import('./token.js').Token} startTok @returns {OutputFormatBlock} */
  _parseOutputFormatBlock(startTok) {
    this._next();
    const exp = this._parseExpression();
    if (!(exp instanceof StringLiteral)) {
      throw this._errorAt(
        'Parameter expression must be parse-time evaluable (constant): ' + exp.getCanonicalForm(),
        exp);
    }
    const name = exp.value;
    if (name.startsWith('{')) {
      throw new UnsupportedFeatureException(
        'Combined output format names ("{outer{inner}}") are not supported by this port.');
    }
    let format;
    try {
      format = getStandardOutputFormat(name);
    } catch (e) {
      if (e instanceof UnregisteredOutputFormatException) throw this._errorAt(e.message, exp);
      throw e;
    }
    if (this._peek().type === TT.EMPTY_DIRECTIVE_END) {
      const emptyEnd = this._next();
      return this._span(new OutputFormatBlock([], name, format), startTok, emptyEnd);
    }
    this._expect(TT.DIRECTIVE_END, '">"');
    // <- FTL.jj OutputFormatBlock(): the parser-level format switches for the
    // whole block (its interpolations bind to it), then restores.
    const savedFormat = this.outputFormat;
    const savedAutoEscaping = this.autoEscaping;
    this.outputFormat = format;
    this.autoEscaping = this._recalculateAutoEscaping();
    try {
      const children = this._parseMixedContent(new Set([TT.END_OUTPUTFORMAT]));
      const end = this._peek();
      if (end.type !== TT.END_OUTPUTFORMAT) {
        throw this._error('Missing end tag: "</#outputformat>" expected.', end);
      }
      this._next();
      return this._span(new OutputFormatBlock(children.children, name, format), startTok, end);
    } finally {
      this.outputFormat = savedFormat;
      this.autoEscaping = savedAutoEscaping;
    }
  }

  // ---- #{...} numeric interpolation helpers <- FTL.jj NumericalOutput() ----

  // <- numberLiteralOnly(): string/list/hash/boolean literals are rejected.
  /** @param {import('./ast/expressions/expression.js').Expression} exp @returns {void} @throws {ParseException} */
  _checkNumericInterpolationLiteral(exp) {
    if (exp instanceof StringLiteral) {
      throw this._errorAt(`Found string literal: ${exp.getCanonicalForm()}. Expecting: number`, exp);
    }
    if (exp instanceof NumberLiteral) return;
    if (exp instanceof ListLiteral) {
      throw this._errorAt(`Found list literal: ${exp.getCanonicalForm()}. Expecting: number`, exp);
    }
    if (exp instanceof HashLiteral) {
      throw this._errorAt(`Found hash literal: ${exp.getCanonicalForm()}. Expecting: number`, exp);
    }
    if (exp instanceof BooleanLiteral) {
      throw this._errorAt(`Found boolean literal: ${exp.getCanonicalForm()}. Expecting: number`, exp);
    }
  }

  /**
   * Parses an "m2M4"-style format specifier <- FTL.jj NumericalOutput() inline parse.
   * @param {import('./token.js').Token} fmt - the ID token holding the specifier
   * @returns {{ minFrac: number, maxFrac: number }}
   */
  _parseHashInterpolationFormat(fmt) {
    const s = fmt.image;
    let minFrac = -1;
    let maxFrac = -1;
    let type = null;
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === 'm' || c === 'M') {
        if (type !== null) throw this._error(`Invalid format specifier ${fmt.image}`, fmt);
        type = c;
        i++;
        const numStart = i;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
        if (numStart === i) throw this._error(`Invalid format specifier ${fmt.image}`, fmt);
        const num = Number(s.slice(numStart, i));
        if (Number.isNaN(num)) throw this._error(`Invalid number in the format specifier ${fmt.image}`, fmt);
        if (type === 'm') {
          if (minFrac !== -1) throw this._error('Invalid formatting string', fmt);
          minFrac = num;
        } else {
          if (maxFrac !== -1) throw this._error('Invalid formatting string', fmt);
          maxFrac = num;
        }
        type = null;
      } else {
        throw this._error(`Invalid format specifier ${fmt.image}`, fmt);
      }
    }
    if (maxFrac === -1) {
      if (minFrac === -1) {
        throw this._error('Invalid format specification, at least one of m and M must be specified!', fmt);
      }
      maxFrac = minFrac;
    } else if (minFrac === -1) {
      minFrac = 0;
    }
    if (minFrac > maxFrac) {
      throw this._error('Invalid format specification, min cannot be greater than max!', fmt);
    }
    return { minFrac, maxFrac };
  }

  // ---- #setting <- FTL.jj Setting() + PropertySetting constructor ----

  /** @param {import('./token.js').Token} startTok @returns {PropertySetting} */
  _parseSetting(startTok) {
    const kt = this._peek();
    if (kt.type !== TT.ID) {
      throw this._error(`Expected a setting name after "#setting", but got ${this._desc(kt)}.`, kt);
    }
    this._next();
    const eq = this._peek();
    if (eq.type !== TT.EQUALS) {
      throw this._error(`Expected "=" after the "#setting" setting name "${kt.image}".`, eq);
    }
    this._next();
    const value = this._parseExpression();
    // <- LooseDirectiveEnd(): #setting is an empty element; both ">" and "/>" end it
    const end = this._peek();
    if (end.type !== TT.DIRECTIVE_END && end.type !== TT.EMPTY_DIRECTIVE_END) {
      throw this._error(`Expected ">" or "/>" after the "#setting" directive, but got ${this._desc(end)}.`, end);
    }
    this._next();
    const k = kt.image;
    if (!SETTING_NAMES.includes(k) && !CAMEL_SETTING_NAMES.includes(k)) {
      throw this._error(
        `Unknown setting name: ${JSON.stringify(k)}. The allowed setting names are: ${SETTING_NAMES.join(', ')}.`,
        kt);
    }
    return this._span(new PropertySetting(k, value), startTok, end);
  }

  // ---- M7 directives ----

  /** @param {import('./token.js').Token} startTok @returns {IfBlock} */
  _parseIf(startTok) {
    const condition = this._parseExpression();
    this._expect(TT.DIRECTIVE_END, '">"');
    const stop = new Set([TT.ELSE_IF, TT.ELSE, TT.END_IF]);
    const blocks = [];
    blocks.push(new ConditionalBlock(condition, this._parseMixedContent(stop).children, 'if'));
    for (;;) {
      const t = this._peek();
      if (t.type === TT.ELSE_IF) {
        this._next();
        const c = this._parseExpression();
        this._expect(TT.DIRECTIVE_END, '">"');
        blocks.push(new ConditionalBlock(c, this._parseMixedContent(stop).children, 'else-if'));
      } else if (t.type === TT.ELSE) {
        this._next();
        blocks.push(new ConditionalBlock(null, this._parseMixedContent(stop).children, 'else'));
      } else if (t.type === TT.END_IF) {
        const endTok = this._next();
        return this._span(new IfBlock(blocks), startTok, endTok);
      } else {
        throw this._error('Missing end tag: "</#if>" expected.', t);
      }
    }
  }

  /** @param {string} what @returns {string} the name */
  _expectIdName(what) {
    const t = this._peek();
    if (t.type !== TT.ID) {
      throw this._error(`Expected an identifier for the ${what}, but got ${this._desc(t)}.`, t);
    }
    this._next();
    return t.image;
  }

  /** @param {import('./token.js').Token} startTok @returns {IteratorBlock} */
  _parseList(startTok) {
    const exp = this._parseExpression();
    let lv = null;
    let lv2 = null;
    if (this._peek().type === TT.AS) {
      this._next();
      lv = this._expectIdName('first loop variable');
      if (this._peek().type === TT.COMMA) {
        this._next();
        lv2 = this._expectIdName('second loop variable');
        if (lv2 === lv) {
          throw this._error(
            `The key and value loop variable names must differ, but both were: ${lv}`, startTok);
        }
      }
    }
    this._expect(TT.DIRECTIVE_END, '">"');
    const ctx = { kind: 'list', loopVarName: lv, loopVar2Name: lv2 };
    this._iterCtx.push(ctx);
    if (lv !== null) {
      this.breakableDepth++;
      this.continuableDepth++;
    }
    let body;
    try {
      body = this._parseMixedContent(new Set([TT.END_LIST, TT.ELSE]));
    } finally {
      this._iterCtx.pop();
      if (lv !== null) {
        this.breakableDepth--;
        this.continuableDepth--;
      }
    }
    if (lv === null && ctx.kind !== 'items') {
      throw this._error(
        '#list must have either "as loopVar" parameter or nested #items that belongs to it.', startTok);
    }
    let elseChildren = null;
    if (this._peek().type === TT.ELSE) {
      this._next();
      elseChildren = this._parseMixedContent(new Set([TT.END_LIST])).children;
    }
    const endTok = this._expect(TT.END_LIST, '"</#list>"');
    return this._span(new IteratorBlock(exp, lv, lv2, body.children,
      lv2 !== null || ctx.hashListing === true, false, elseChildren),
      startTok, endTok);
  }

  /** @param {import('./token.js').Token} startTok @returns {IteratorBlock} */
  _parseForEach(startTok) {
    const lv = this._expectIdName('loop variable');
    this._expect(TT.IN, '"in"');
    const exp = this._parseExpression();
    this._expect(TT.DIRECTIVE_END, '">"');
    this._iterCtx.push({ kind: 'foreach', loopVarName: lv, loopVar2Name: null });
    this.breakableDepth++;
    this.continuableDepth++;
    let body;
    try {
      body = this._parseMixedContent(new Set([TT.END_FOREACH]));
    } finally {
      this._iterCtx.pop();
      this.breakableDepth--;
      this.continuableDepth--;
    }
    const endTok = this._expect(TT.END_FOREACH, '"</#forEach>"');
    return this._span(new IteratorBlock(exp, lv, null, body.children, false, true, null), startTok, endTok);
  }

  /** @param {import('./token.js').Token} startTok @param {Set<import('./tokenType.js').TokenType>} outerStop @returns {Items} */
  _parseItems(startTok, outerStop) {
    const ctx = this._iterCtx.length ? this._iterCtx[this._iterCtx.length - 1] : null;
    if (ctx === null) throw this._error('#items must be inside a #list block.', startTok);
    if (ctx.kind === 'foreach') throw this._error("#forEach doesn't support nested #items.", startTok);
    if (ctx.kind === 'items') {
      throw this._error("Can't nest #items into each other when they belong to the same #list.", startTok);
    }
    if (ctx.loopVarName !== null) {
      throw this._error('The parent #list of the #items must not have "as loopVar" parameter.', startTok);
    }
    const lv = this._expectIdName('first loop variable');
    let lv2 = null;
    if (this._peek().type === TT.COMMA) {
      this._next();
      lv2 = this._expectIdName('second loop variable');
      if (lv2 === lv) {
        throw this._error(`The key and value loop variable names must differ, but both were: ${lv}`, startTok);
      }
    }
    this._expect(TT.DIRECTIVE_END, '">"');
    if (lv2 !== null) ctx.hashListing = true;
    ctx.kind = 'items';
    ctx.loopVarName = lv;
    ctx.loopVar2Name = lv2;
    this.breakableDepth++;
    this.continuableDepth++;
    let body;
    try {
      body = this._parseMixedContent(new Set([...outerStop, TT.END_ITEMS, TT.ELSE]));
    } finally {
      this.breakableDepth--;
      this.continuableDepth--;
      ctx.loopVarName = null;
      ctx.loopVar2Name = null;
    }
    const endTok = this._expect(TT.END_ITEMS, '"</#items>"');
    return this._span(new Items(lv, lv2, body.children), startTok, endTok);
  }

  /** @param {import('./token.js').Token} startTok @param {Set<import('./tokenType.js').TokenType>} outerStop @returns {Sep} */
  _parseSep(startTok, outerStop) {
    if (this._iterCtx.length === 0) {
      throw this._error('#sep must be inside a #list block.', startTok);
    }
    const body = this._parseMixedContent(new Set([...outerStop, TT.END_SEP]));
    if (this._peek().type === TT.END_SEP) this._next();
    return this._span(new Sep(body.children), startTok, startTok);
  }

  /** @param {import('./token.js').Token} startTok @returns {BreakInstruction} */
  _parseBreak(startTok) {
    if (this.breakableDepth === 0) {
      throw this._error('You can\'t use the "#break" directive here.', startTok);
    }
    return this._span(new BreakInstruction(), startTok, startTok);
  }

  /** @param {import('./token.js').Token} startTok @returns {ContinueInstruction} */
  _parseContinue(startTok) {
    if (this.continuableDepth === 0) {
      throw this._error('You can\'t use the "#continue" directive here.', startTok);
    }
    return this._span(new ContinueInstruction(), startTok, startTok);
  }

  // <- FTL.jj Assign()
  /** @returns {string} */
  _assignName() {
    const t = this._peek();
    if (t.type === TT.ID) {
      this._next();
      return t.image;
    }
    if (t.type === TT.STRING_LITERAL) {
      this._next();
      try {
        return unescapeFTLStringLiteral(t.image.slice(1, -1));
      } catch (e) {
        throw this._error(e.message, t);
      }
    }
    throw this._error(`Expected a variable name, but got ${this._desc(t)}.`, t);
  }

  /** @param {import('./token.js').Token} startTok @returns {import('./ast/templateElement.js').TemplateElement} Assignment or AssignmentInstruction */
  _parseAssign(startTok) {
    const scope = startTok.type === TT.ASSIGN ? 'namespace'
      : startTok.type === TT.GLOBALASSIGN ? 'global' : 'local';
    if (scope === 'local' && !this.inMacroOrFunction) {
      throw this._error('Local variable assigned outside a macro or function.', startTok);
    }
    const OP_TOKENS = new Map([
      [TT.EQUALS, '='], [TT.PLUS_EQUALS, '+='], [TT.MINUS_EQUALS, '-='],
      [TT.TIMES_EQUALS, '*='], [TT.DIV_EQUALS, '/='], [TT.MOD_EQUALS, '%='],
    ]);

    const first = this._assignName();
    let opTok = this._next();
    // block form: <#assign name> or <#assign name+=>
    if (opTok.type === TT.DIRECTIVE_END) {
      return this._parseAssignBlock(startTok, scope, first, '=');
    }
    if (OP_TOKENS.has(opTok.type) && this._peek().type === TT.DIRECTIVE_END && opTok.type !== TT.EQUALS) {
      this._next();
      return this._parseAssignBlock(startTok, scope, first, OP_TOKENS.get(opTok.type));
    }

    const assignments = [];
    let pendingName = first;
    for (;;) {
      let opKind;
      let exp = null;
      if (opTok.type === TT.PLUS_PLUS) opKind = '++';
      else if (opTok.type === TT.MINUS_MINUS) opKind = '--';
      else if (OP_TOKENS.has(opTok.type)) {
        opKind = OP_TOKENS.get(opTok.type);
        exp = this._parseExpression();
      } else {
        throw this._error(
          `Expected "=", "+=", "-=", "*=", "/=", "%=", "++", "--" or ">" after the variable name, `
          + `but got ${this._desc(opTok)}.`, opTok);
      }
      assignments.push(new Assignment(pendingName, opKind, exp, scope));
      if (this._peek().type === TT.COMMA) {
        this._next();
        pendingName = this._assignName();
        opTok = this._next();
        continue;
      }
      break;
    }
    let nsExp = null;
    if (this._peek().type === TT.IN) {
      this._next();
      if (scope !== 'namespace') {
        throw this._error('Cannot assign to namespace here.', startTok);
      }
      nsExp = this._parseExpression();
    }
    const endTok = this._expect(TT.DIRECTIVE_END, '">"');
    if (assignments.length === 1 && nsExp === null) {
      const a = assignments[0];
      return this._span(a, startTok, endTok);
    }
    return this._span(new AssignmentInstruction(assignments, nsExp), startTok, endTok);
  }

  /** @param {import('./token.js').Token} startTok @param {string} scope @param {string} name @param {string} opKind @returns {Assignment} */
  _parseAssignBlock(startTok, scope, name, opKind) {
    const endType = scope === 'global' ? TT.END_GLOBAL
      : scope === 'local' ? TT.END_LOCAL : TT.END_ASSIGN;
    const children = this._parseMixedContent(new Set([endType]));
    const endTok = this._expect(endType, 'the matching end tag');
    return this._span(new Assignment(name, opKind === '=' ? 'block' : 'block+=', null, scope,
      children.children), startTok, endTok);
  }

  // ---- M9: macros / functions / calls ----

  // <- FTL.jj Macro()
  /** @param {import('./token.js').Token} startTok @returns {Macro} */
  _parseMacro(startTok) {
    const isFunction = startTok.type === TT.FUNCTION;
    if (this.inMacro || this.inFunction) {
      throw this._error('Macro or function definitions can\'t be nested into each other.', startTok);
    }
    const savedInMacro = this.inMacro;
    const savedInFunction = this.inFunction;
    const savedBreakable = this.breakableDepth;
    const savedContinuable = this.continuableDepth;
    const savedIterCtx = this._iterCtx;
    this._iterCtx = [];
    this.breakableDepth = 0;
    this.continuableDepth = 0;
    if (isFunction) this.inFunction = true; else this.inMacro = true;
    this.inMacroOrFunction = true;
    this._argsFlag = false;
    try {
      const name = this._assignName();
      const params = [];
      let catchAll = null;
      const hadParen = this._peek().type === TT.OPEN_PAREN;
      if (hadParen) this._next();
      while (this._peek().type === TT.ID) {
        const pTok = this._next();
        let defExp = null;
        let isCatch = false;
        if (this._peek().type === TT.ELLIPSIS) {
          this._next();
          isCatch = true;
        }
        if (catchAll !== null) {
          throw this._error('There may only be one "catch-all" parameter in a macro '
            + 'declaration, and it must be the last parameter.', pTok);
        }
        if (this._peek().type === TT.EQUALS) {
          this._next();
          if (isCatch) {
            throw this._error('"Catch-all" macro parameter may not have a default value.', pTok);
          }
          defExp = this._parseExpression();
        }
        if (isCatch) {
          catchAll = pTok.image;
        } else {
          if (params.some((p) => p.defaultExp !== null) && defExp === null) {
            throw this._error('In a macro declaration, parameters without a default value '
              + 'must all occur before the parameters with default values.', pTok);
          }
          params.push({ name: pTok.image, defaultExp: defExp });
        }
        if (this._peek().type === TT.COMMA) this._next();
      }
      if (hadParen) this._expect(TT.CLOSE_PAREN, '")"');
      this._expect(TT.DIRECTIVE_END, '">"');
      const endType = isFunction ? TT.END_FUNCTION : TT.END_MACRO;
      const children = this._parseMixedContent(new Set([endType]));
      const closeTok = this._expect(endType, isFunction ? '"</#function>"' : '"</#macro>"');
      const node = new Macro(name, params, catchAll, isFunction, children.children);
      node.argsNeeded = this._argsFlag;
      this.macros.push(node);
      return this._span(node, startTok, closeTok);
    } finally {
      this.inMacro = savedInMacro;
      this.inFunction = savedInFunction;
      this.inMacroOrFunction = this.inMacro || this.inFunction;
      this.breakableDepth = savedBreakable;
      this.continuableDepth = savedContinuable;
      this._iterCtx = savedIterCtx;
    }
  }

  // <- FTL.jj PositionalArgs(): whitespace separated; the comma between two args is optional
  /** @returns {import('./ast/expressions/expression.js').Expression[]} */
  _parsePositionalArgs() {
    const args = [];
    for (;;) {
      args.push(this._parseExpression());
      if (this._peek().type === TT.COMMA) {
        this._next();
        if (!EXPRESSION_START.has(this._peek().type)) {
          throw this._error('Expected an argument after ",".', this._peek());
        }
      }
      if (!EXPRESSION_START.has(this._peek().type)) break;
    }
    return args;
  }

  // <- FTL.jj UnifiedCall() (the `<@name ...>` form; legacy `<#call>` stays unsupported)
  /** @param {import('./token.js').Token} startTok @returns {UnifiedCall} */
  _parseUnifiedCall(startTok) {
    const target = this._parseExpression();
    const simpleName = target instanceof Identifier ? target.name : null;
    let positional = null;
    let named = null;
    const t = this._peek();
    if (t.type === TT.ID && this._peek(1).type === TT.EQUALS) {
      // <- NamedArgs(): `name=value` pairs separated by whitespace only (no commas)
      named = new Map();
      for (;;) {
        const id = this._expect(TT.ID, 'an argument name');
        this._expect(TT.EQUALS, '"="');
        named.set(id.image, this._parseExpression());
        if (this._peek().type === TT.ID && this._peek(1).type === TT.EQUALS) continue;
        break;
      }
    } else if (t.type !== TT.DIRECTIVE_END && t.type !== TT.EMPTY_DIRECTIVE_END
      && t.type !== TT.SEMICOLON) {
      positional = this._parsePositionalArgs();
    }
    let bodyParamNames = null;
    if (this._peek().type === TT.SEMICOLON) {
      this._next();
      bodyParamNames = [];
      for (;;) {
        const id = this._expect(TT.ID, 'a body parameter name');
        bodyParamNames.push(id.image);
        if (this._peek().type === TT.COMMA) {
          this._next();
          continue;
        }
        break;
      }
    }
    const closer = this._peek();
    if (closer.type === TT.EMPTY_DIRECTIVE_END) {
      this._next();
      return this._span(new UnifiedCall(target, positional, named, bodyParamNames, []),
        startTok, closer);
    }
    this._expect(TT.DIRECTIVE_END, '">"');
    const children = this._parseMixedContent(new Set([TT.UNIFIED_CALL_END]));
    const endTok = this._expect(TT.UNIFIED_CALL_END, 'the end tag for the <@...> call');
    if (simpleName !== null) {
      const at = endTok.image.indexOf('@');
      const gt = endTok.image.lastIndexOf('>');
      const endName = endTok.image.slice(at + 1, gt).trim();
      if (endName !== simpleName) {
        throw this._error(
          `Expected end tag for <@${simpleName}> here, but found ${this._desc(endTok)}.`, endTok);
      }
    }
    return this._span(new UnifiedCall(target, positional, named, bodyParamNames, children.children),
      startTok, endTok);
  }

  // <- FTL.jj Return()
  /** @param {import('./token.js').Token} startTok @returns {ReturnInstruction} */
  _parseReturn(startTok) {
    let exp = null;
    let endTok = startTok;
    if (startTok.type === TT.RETURN) {
      exp = this._parseExpression();
      const c = this._peek();
      if (c.type === TT.DIRECTIVE_END || c.type === TT.EMPTY_DIRECTIVE_END) {
        this._next();
        endTok = c;
      } else {
        throw this._error(`Expected the directive close, but got ${this._desc(c)}.`, c);
      }
    }
    if (this.inMacro) {
      if (exp !== null) throw this._error('A macro cannot return a value', startTok);
    } else if (this.inFunction) {
      if (exp === null) throw this._error('A function must return a value', startTok);
    } else if (exp === null) {
      throw this._error('A return instruction can only occur inside a macro or function', startTok);
    }
    return this._span(new ReturnInstruction(exp), startTok, endTok);
  }

  // <- FTL.jj Nested()
  /** @param {import('./token.js').Token} startTok @returns {NestedInstruction} */
  _parseNested(startTok) {
    if (!this.inMacro) {
      throw this._error('Cannot use a "#nested" instruction outside a macro.', startTok);
    }
    let params = null;
    let endTok = startTok;
    if (startTok.type === TT.NESTED) {
      params = [];
      if (EXPRESSION_START.has(this._peek().type)) {
        params = this._parsePositionalArgs();
      }
      const c = this._peek();
      if (c.type === TT.DIRECTIVE_END || c.type === TT.EMPTY_DIRECTIVE_END) {
        this._next();
        endTok = c;
      } else {
        throw this._error(`Expected the directive close, but got ${this._desc(c)}.`, c);
      }
    }
    return this._span(new NestedInstruction(
      startTok.type === TT.NESTED && params.length === 0 ? null : params), startTok, endTok);
  }

  /** @param {import('./token.js').Token} startTok @returns {AttemptBlock} */
  _parseAttempt(startTok) {
    const stop = new Set([TT.RECOVER, TT.END_ATTEMPT]);
    const children = this._parseMixedContent(stop);
    const recTok = this._peek();
    if (recTok.type !== TT.RECOVER) {
      throw this._error('#attempt block must have a #recover part.', recTok);
    }
    this._next();
    const recovery = this._parseMixedContent(new Set([TT.END_RECOVER, TT.END_ATTEMPT]));
    const nt = this._peek();
    if (nt.type === TT.END_RECOVER) this._next();
    const endTok = this._expect(TT.END_ATTEMPT, '"</#attempt>"');
    return this._span(new AttemptBlock(children.children, recovery.children), startTok, endTok);
  }

  /** @param {import('./token.js').Token} startTok @returns {SwitchBlock} */
  _parseSwitch(startTok) {
    const exp = this._parseExpression();
    this._expect(TT.DIRECTIVE_END, '">"');
    // <- ignoredSectionBeforeFirstCase: whitespace before the first case is dropped.
    while (STATIC_TYPES.has(this._peek().type)) this._next();
    const caseStop = new Set([TT.CASE, TT.DEFAUL, TT.ON, TT.END_SWITCH]);
    const cases = [];
    const ons = [];
    let hadDefault = false;
    let hadCase = false;
    let hadOn = false;
    this.breakableDepth++;
    try {
      for (;;) {
        const t = this._peek();
        if (t.type === TT.CASE) {
          this._next();
          if (hadOn) {
            throw this._error("You can't use both #on, and #case in a #switch block, and you already had an #on.", t);
          }
          hadCase = true;
          const cexp = this._parseExpression();
          this._expect(TT.DIRECTIVE_END, '">"');
          cases.push(new Case(cexp, this._parseMixedContent(caseStop).children));
        } else if (t.type === TT.DEFAUL) {
          this._next();
          if (hadDefault) {
            throw this._error('You already had a #default in the #switch block', t);
          }
          hadDefault = true;
          cases.push(new Case(null, this._parseMixedContent(caseStop).children));
        } else if (t.type === TT.ON) {
          this._next();
          if (hadCase) {
            throw this._error("You can't use both #on, and #case in a #switch block, and you already had a #case.", t);
          }
          if (hadDefault) {
            throw this._error("You can't use #on after #default in a #switch block; #default must come last.", t);
          }
          if (!hadOn) {
            // <- FTL.jj: breakable nesting is left before On() is parsed, so #break
            // inside an #on body fails as "outside breakable directive".
            this.breakableDepth--;
            hadOn = true;
          }
          // <- FTL.jj On(): exps = PositionalArgs() -- no parens; commas optional
          const exps = this._parsePositionalArgs();
          this._expect(TT.DIRECTIVE_END, '">"');
          ons.push(new On(exps, this._parseMixedContent(caseStop).children));
        } else if (t.type === TT.END_SWITCH) {
          break;
        } else {
          throw this._error(`Unexpected ${this._desc(t)} in #switch; "#case", "#default" or "#on" expected.`, t);
        }
      }
    } finally {
      if (!hadOn) this.breakableDepth--;
    }
    const endTok = this._expect(TT.END_SWITCH, '"</#switch>"');
    return this._span(new SwitchBlock(exp, cases, ons), startTok, endTok);
  }

  // ---- expression precedence chain <- FTL.jj Expression/... productions ----

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseExpression() {
    return this._parseOr();
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseOr() {
    let lhs = this._parseAnd();
    for (;;) {
      const t = this._peek();
      if (t.type === TT.OR || this._isSoftKeyword(t, 'or')) {
        this._next();
        const rhs = this._parseAnd();
        lhs = this._span(new OrExpression(lhs, rhs), lhs, rhs);
      } else {
        return lhs;
      }
    }
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseAnd() {
    let lhs = this._parseEquality();
    for (;;) {
      const t = this._peek();
      if (t.type === TT.AND || this._isSoftKeyword(t, 'and')) {
        this._next();
        const rhs = this._parseEquality();
        lhs = this._span(new AndExpression(lhs, rhs), lhs, rhs);
      } else {
        return lhs;
      }
    }
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseEquality() {
    let lhs = this._parseRelational();
    const t = this._peek();
    if (EQUALITY_OPS.has(t.type)) {
      this._next();
      const rhs = this._parseRelational();
      lhs = this._span(new ComparisonExpression(lhs, rhs, t.image), lhs, rhs);
    }
    return lhs;
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseRelational() {
    let lhs = this._parseRange();
    const t = this._peek();
    if (RELATIONAL_OPS.has(t.type)) {
      this._next();
      const rhs = this._parseRange();
      lhs = this._span(new ComparisonExpression(lhs, rhs, t.image), lhs, rhs);
    }
    return lhs;
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseRange() {
    const lhs = this._parseAdditive();
    const t = this._peek();
    if (t.type === TT.DOT_DOT_LESS || t.type === TT.DOT_DOT_ASTERISK) {
      this._next();
      const rhs = this._parseAdditive();
      return this._span(new Range(lhs, rhs,
        t.type === TT.DOT_DOT_LESS ? 'exclusive' : 'sizeLimited'), lhs, rhs);
    }
    if (t.type === TT.DOT_DOT) {
      this._next();
      if (EXPRESSION_START.has(this._peek().type)) {
        const rhs = this._parseAdditive();
        return this._span(new Range(lhs, rhs, 'inclusive'), lhs, rhs);
      }
      return this._span(new Range(lhs, null, 'unbound'), lhs, t);
    }
    return lhs;
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseAdditive() {
    let lhs = this._parseMultiplicative();
    for (;;) {
      const t = this._peek();
      if (t.type === TT.PLUS || t.type === TT.MINUS) {
        this._next();
        const rhs = this._parseMultiplicative();
        const node = t.type === TT.PLUS
          ? new AddConcatExpression(lhs, rhs)
          : new ArithmeticExpression(lhs, rhs, 'subtract');
        lhs = this._span(node, lhs, rhs);
      } else {
        return lhs;
      }
    }
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseMultiplicative() {
    let lhs = this._parseUnary();
    for (;;) {
      const t = this._peek();
      if (t.type === TT.TIMES || t.type === TT.DIVIDE || t.type === TT.PERCENT) {
        this._next();
        const rhs = this._parseUnary();
        const operator = t.type === TT.TIMES ? 'multiply' : t.type === TT.DIVIDE ? 'divide' : 'modulo';
        lhs = this._span(new ArithmeticExpression(lhs, rhs, operator), lhs, rhs);
      } else {
        return lhs;
      }
    }
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseUnary() {
    // <- NotExpression: zero or more ! (or soft "not"), then primary
    let nots = 0;
    let firstNot = null;
    for (;;) {
      const t = this._peek();
      if (t.type === TT.EXCLAM
        || (t.type === TT.ID && t.image === 'not' && EXPRESSION_START.has(this._peek(1).type))) {
        this._next();
        if (firstNot === null) firstNot = t;
        nots++;
      } else {
        break;
      }
    }
    if (nots > 0) {
      const target = this._parsePrimary();
      let result = target;
      for (let i = 0; i < nots; i++) result = new NotExpression(result);
      return this._span(result, firstNot, target);
    }
    const t = this._peek();
    if (t.type === TT.PLUS || t.type === TT.MINUS) {
      this._next();
      const target = this._parsePrimary();
      return this._span(new UnaryPlusMinusExpression(target, t.type === TT.MINUS), t, target);
    }
    return this._parsePrimary();
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parsePrimary() {
    let exp = this._parseAtomic();
    for (;;) {
      const t = this._peek();
      if (t.type === TT.DOT) {
        this._next();
        const k = this._peek();
        if (!DOT_KEY_TOKENS.has(k.type)) {
          throw this._error(`Expected an identifier after ".", but got ${this._desc(k)}.`, k);
        }
        this._next();
        exp = this._span(new Dot(exp, k.image), exp, k);
      } else if (t.type === TT.EXISTS) {
        this._next();
        exp = this._span(new ExistsExpression(exp), exp, t);
      } else if (t.type === TT.BUILT_IN) {
        this._next();
        const name = this._peek();
        if (name.type !== TT.ID) {
          throw this._error(`Expected a built-in name after "?", but got ${this._desc(name)}.`, name);
        }
        this._next();
        let args = null;
        const hasParen = this._peek().type === TT.OPEN_PAREN;
        if (LAMBDA_ARG_BUILTINS.has(name.image)) {
          if (!hasParen) {
            throw this._error(`The "?${name.image}" built-in must be called with an argument `
              + `in parentheses, as in ?${name.image}(x -> ...).`, name);
          }
          this._next(); // "("
          const arg = this._parseMaybeLambdaArg(name.image);
          const c = this._peek();
          if (c.type !== TT.CLOSE_PAREN) {
            throw this._error(`Expected ")" to close "?${name.image}(...)", but got ${this._desc(c)}.`, c);
          }
          this._next();
          args = [arg];
        } else if (hasParen && LAZY_ARG_BUILTINS.has(name.image)) {
          // <- BuiltInWithParseTimeParameters: the args must arrive unevaluated
          this._next(); // "("
          args = this._peek().type === TT.CLOSE_PAREN ? [] : this._parsePositionalArgs();
          const c = this._peek();
          if (c.type !== TT.CLOSE_PAREN) {
            throw this._error(`Expected ")" to close "?${name.image}(...)", but got ${this._desc(c)}.`, c);
          }
          this._next();
        }
        // Otherwise the "(" is left for the primary loop to parse as a MethodCall
        // <- upstream: plain built-ins return immediately and the "(...)" is a call.
        if (!UPSTREAM_BUILT_INS.has(name.image)) {
          // <- upstream resolves built-in names at parse time
          throw this._error(
            `Unknown built-in: "${name.image}". Help (latest version): `
            + "https://freemarker.apache.org/docs/ref_builtins.html; you're using FreeMarker 2.3.36.\n"
            + 'The alphabetical list of built-ins:\n  ' + BI_LIST_TEXT, name);
        }
        exp = this._span(new BuiltIn(exp, name.image, args), exp, name);
      } else if (t.type === TT.EXCLAM) {
        this._next();
        const rhs = EXPRESSION_START.has(this._peek().type) ? this._parseExpression() : null;
        exp = this._span(new DefaultToExpression(exp, rhs), exp, rhs ?? t);
      } else if (t.type === TT.OPEN_PAREN) {
        exp = this._parseMethodCall(exp);
      } else if (t.type === TT.OPEN_BRACKET) {
        this._next();
        const key = EXPRESSION_START.has(this._peek().type) ? this._parseExpression() : null;
        const close = this._next();
        if (close.type !== TT.CLOSE_BRACKET) {
          throw this._error(`Expected "]" to close the dynamic key access, but got ${this._desc(close)}.`, close);
        }
        exp = this._span(new DynamicKeyName(exp, key), exp, close);
      } else {
        return exp;
      }
    }
  }

  // <- FTL.jj LocalLambdaExpression (only as the argument of a few built-ins) +
  // PositionalMaybeLambdaArgs: `x -> exp`, `(x, y) -> exp`, or a plain expression.
  /** @param {string} builtinName @returns {import('./ast/expressions/expression.js').Expression} */
  _parseMaybeLambdaArg(builtinName) {
    const t = this._peek();
    if (t.type === TT.ID && this._peek(1).type === TT.LAMBDA_ARROW) {
      this._next();
      this._next();
      const rhs = this._parseOr();
      const node = new LocalLambdaExpression([t.image], rhs);
      this._checkLambdaParamCount(node, builtinName, t);
      return this._span(node, t, rhs);
    }
    if (t.type === TT.OPEN_PAREN) {
      // LOOKAHEAD: ( [ ID (COMMA ID)* ] ) LAMBDA_ARROW
      let j = 1;
      const params = [];
      if (this._peek(j).type === TT.ID) {
        for (;;) {
          params.push(this._peek(j).image);
          j++;
          if (this._peek(j).type === TT.COMMA) {
            j++;
            if (this._peek(j).type !== TT.ID) break;
            continue;
          }
          break;
        }
      }
      if (this._peek(j).type === TT.CLOSE_PAREN && this._peek(j + 1).type === TT.LAMBDA_ARROW) {
        this._next(); // "("
        for (let i = 0; i < params.length; i++) {
          if (i !== 0) this._expect(TT.COMMA, '","');
          this._expect(TT.ID, 'a lambda parameter name');
        }
        this._expect(TT.CLOSE_PAREN, '")"');
        this._expect(TT.LAMBDA_ARROW, '"->"');
        const rhs = this._parseOr();
        const node = new LocalLambdaExpression(params, rhs);
        this._checkLambdaParamCount(node, builtinName, t);
        return this._span(node, t, rhs);
      }
    }
    return this._parseExpression();
  }

  // <- BuiltInWithParseTimeParameters.checkLocalLambdaParamCount
  /** @param {Object} node @param {string} builtinName @param {import('./token.js').Token} tok @returns {void} */
  _checkLambdaParamCount(node, builtinName, tok) {
    const want = LAMBDA_ARG_BUILTINS.get(builtinName);
    if (node.params.length !== want) {
      throw this._error(
        `?${builtinName}(...) parameter lambda expression must declare exactly ${want} `
        + `parameter${want === 1 ? '' : 's'}, but it declared ${node.params.length}.`, tok);
    }
  }

  /** @param {import('./ast/expressions/expression.js').Expression} target @returns {MethodCall} */
  _parseMethodCall(target) {
    this._next(); // "("
    const args = [];
    if (EXPRESSION_START.has(this._peek().type)) {
      for (;;) {
        args.push(this._parseExpression());
        if (this._peek().type === TT.COMMA) {
          this._next();
          continue;
        }
        break;
      }
    }
    const close = this._next();
    if (close.type !== TT.CLOSE_PAREN) {
      throw this._error(`Expected ")" to close the method call, but got ${this._desc(close)}.`, close);
    }
    return this._span(new MethodCall(target, args), target, close);
  }

  /** @returns {import('./ast/expressions/expression.js').Expression} */
  _parseAtomic() {
    const t = this._peek();
    switch (t.type) {
      case TT.DOT: {
        // <- FTL.jj BuiltinVariable(): a leading "." + id is a special variable (.args here)
        const nt = this._peek(1);
        if (nt.type !== TT.ID) {
          throw this._error(`Expected a special-variable name after ".", but got ${this._desc(nt)}.`, nt);
        }
        this._next();
        this._next();
        if (nt.image === 'args') {
          if (!this.inMacro && !this.inFunction) {
            throw this._error('The "args" special variable must be inside a macro or function '
              + 'in the template source code.', nt);
          }
          this._argsFlag = true;
        } else {
          throw new UnsupportedFeatureException(
            `Special variable ".${nt.image}" is not supported in this milestone yet.`);
        }
        return this._span(new BuiltinVariable('args'), t, nt);
      }
      case TT.INTEGER:
        this._next();
        return this._span(new NumberLiteral(Number.parseInt(t.image, 10)), t, t);
      case TT.DECIMAL:
        this._next();
        return this._span(new NumberLiteral(Number.parseFloat(t.image)), t, t);
      case TT.HEX_INTEGER:
        this._next();
        return this._span(new NumberLiteral(Number.parseInt(t.image.slice(2), 16)), t, t);
      case TT.STRING_LITERAL: {
        this._next();
        let value;
        try {
          value = unescapeFTLStringLiteral(t.image.slice(1, -1));
        } catch (e) {
          throw this._error(e.message, t);
        }
        return this._span(new StringLiteral(value), t, t);
      }
      case TT.RAW_STRING:
        this._next();
        return this._span(new StringLiteral(t.image.slice(2, -1)), t, t);
      case TT.TRUE:
        this._next();
        return this._span(new BooleanLiteral(true), t, t);
      case TT.FALSE:
        this._next();
        return this._span(new BooleanLiteral(false), t, t);
      case TT.OPEN_BRACKET: {
        this._next();
        const items = [];
        if (this._peek().type !== TT.CLOSE_BRACKET) {
          for (;;) {
            items.push(this._parseExpression());
            if (this._peek().type === TT.COMMA) this._next();
            else break;
          }
        }
        const end = this._expect(TT.CLOSE_BRACKET, '"]"');
        return this._span(new ListLiteral(items), t, end);
      }
      case TT.OPENING_CURLY_BRACKET: {
        this._next();
        const keys = [];
        const values = [];
        if (this._peek().type !== TT.CLOSING_CURLY_BRACKET) {
          for (;;) {
            const key = this._parseExpression();
            // <- FTL.jj stringLiteralOnly(key): number/list/hash/boolean literals excluded;
            // identifiers and other expressions stay legal (evaluated at render time).
            for (const [cls, kind] of /** @type {Array<[Function, string]>} */ ([[NumberLiteral, 'number'],
              [ListLiteral, 'list'], [HashLiteral, 'hash'], [BooleanLiteral, 'boolean']])) {
              if (key instanceof cls) {
                throw this._errorAt(
                  `Hash literal key ${key.getCanonicalForm()} can't be a ${kind} literal.`, key);
              }
            }
            const sep = this._peek();
            if (sep.type !== TT.COMMA && sep.type !== TT.COLON) {
              throw this._error(`Expected ":" or "," after a hash literal key, but got ${this._desc(sep)}.`, sep);
            }
            this._next();
            keys.push(key);
            values.push(this._parseExpression());
            if (this._peek().type === TT.COMMA) this._next();
            else break;
          }
        }
        const end = this._expect(TT.CLOSING_CURLY_BRACKET, '"}"');
        return this._span(new HashLiteral(keys, values), t, end);
      }
      case TT.ID:
        this._next();
        if (this._escapeIdName !== null && t.image === this._escapeIdName) {
          return this._span(new EscapeVar(t.image), t, t);
        }
        return this._span(new Identifier(t.image), t, t);
      case TT.OPEN_PAREN: {
        this._next();
        const exp = this._parseExpression();
        const end = this._expect(TT.CLOSE_PAREN, '")"');
        return this._span(new ParentheticalExpression(exp), t, end);
      }
      default:
        throw this._error(`Expected an expression, but got ${this._desc(t)}.`, t);
    }
  }

  /** @param {import('./tokenType.js').TokenType} type @param {string} description @returns {import('./token.js').Token} */
  _expect(type, description) {
    const t = this._next();
    if (t.type !== type) throw this._error(`Expected ${description}, but got ${this._desc(t)}.`, t);
    return t;
  }

  /** @param {import('./token.js').Token} t @param {string} word @returns {boolean} */
  _isSoftKeyword(t, word) {
    return t.type === TT.ID && t.image === word;
  }
}

// '#name' / '/#name' for error messages, extracted without regexes.
/** @param {import('./token.js').Token} t @returns {string} */
function directiveTag(t) {
  const img = t.image;
  let s = t.type.name.startsWith('END_') ? '/' : '';
  let i = 0;
  while (i < img.length && !isLetterOrUnderscore(img[i]) && img[i] !== '@') i++;
  let j = i;
  while (j < img.length && isLetterOrUnderscore(img[j])) j++;
  return s + '#' + img.slice(i, j);
}

/** @param {string} c @returns {boolean} */
function isLetterOrUnderscore(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}
