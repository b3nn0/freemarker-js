// Recursive-descent expression parser mirroring FTL.jj production structure.
// Root: text + interpolations + comments; directive bodies land in later milestones.
// No regexes here (tag/text detection is token-type based).

import { TokenManager } from './tokenManager.js';
import { TT } from './tokenType.js';
import * as LEX from './lexicalStates.js';
import { ParseException, TokenMgrError, UnsupportedFeatureException } from '../errors.js';
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
import { BuiltIn } from './ast/expressions/builtIn.js';
import { IfBlock, ConditionalBlock } from './ast/directives/if.js';
import { IteratorBlock, Items, Sep } from './ast/directives/list.js';
import { AttemptBlock } from './ast/directives/attempt.js';
import { SwitchBlock, Case, On } from './ast/directives/switch.js';
import { BreakInstruction, ContinueInstruction } from './ast/directives/control.js';
import { unescapeFTLStringLiteral } from '../utility/stringUtil.js';

const STATIC_TYPES = new Set([TT.STATIC_TEXT_WS, TT.STATIC_TEXT_NON_WS, TT.STATIC_TEXT_FALSE_ALARM]);

const EQUALITY_OPS = new Set([TT.EQUALS, TT.DOUBLE_EQUALS, TT.NOT_EQUALS]);
const RELATIONAL_OPS = new Set([
  TT.NATURAL_GT, TT.NATURAL_GTE, TT.ESCAPED_GT, TT.ESCAPED_GTE, TT.LESS_THAN, TT.LESS_THAN_EQUALS,
]);
// keyword tokens usable as plain names after a dot ← FTL.jj DotVariable production
const DOT_KEY_TOKENS = new Set([
  TT.ID, TT.TRUE, TT.FALSE, TT.IN, TT.AS, TT.USING,
  TT.LESS_THAN, TT.LESS_THAN_EQUALS, TT.ESCAPED_GT, TT.ESCAPED_GTE, TT.TIMES, TT.DOUBLE_STAR,
]);
const EXPRESSION_START = new Set([
  TT.INTEGER, TT.DECIMAL, TT.HEX_INTEGER, TT.STRING_LITERAL, TT.RAW_STRING, TT.TRUE, TT.FALSE,
  TT.ID, TT.OPEN_BRACKET, TT.OPENING_CURLY_BRACKET, TT.OPEN_PAREN, TT.DOT, TT.PLUS, TT.MINUS, TT.EXCLAM,
]);

export class Parser {
  constructor(source, configuration, templateName = null) {
    this.cfg = configuration;
    this.templateName = templateName;
    this.tm = new TokenManager(source, configuration);
    this._buf = [];
    // directive context tracking ← FTL.jj parserIteratorBlockContexts / *DirectiveNesting
    this._iterCtx = [];
    this.breakableDepth = 0;
    this.continuableDepth = 0;
  }

  parse() {
    try {
      return this._parseRoot();
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

  _ensure(n) {
    while (this._buf.length < n) this._buf.push(this.tm.nextToken());
  }

  _peek(k = 0) {
    this._ensure(k + 1);
    return this._buf[k];
  }

  _next() {
    this._ensure(1);
    return this._buf.shift();
  }

  _desc(t) {
    return t.type === TT.EOF ? 'end of template' : `${t.type.name}(${JSON.stringify(t.image)})`;
  }

  _error(message, t) {
    return new ParseException(message, {
      templateName: this.templateName,
      beginLine: t.beginLine, beginColumn: t.beginColumn, endLine: t.endLine, endColumn: t.endColumn,
    });
  }

  _errorAt(message, node) {
    return new ParseException(message, {
      templateName: this.templateName,
      beginLine: node.beginLine, beginColumn: node.beginColumn,
      endLine: node.endLine, endColumn: node.endColumn,
    });
  }

  _span(node, from, to) {
    const setter = node.setLoc ?? node.setLocation;
    setter.call(node, this.templateName, from.beginLine, from.beginColumn, to.endLine, to.endColumn);
    return node;
  }

  // ---- root (mixed content) ← FTL.jj MixedContentElements() ----

  _parseRoot() {
    const root = this._parseMixedContent(new Set());
    const t = this._peek();
    if (t.type !== TT.EOF) {
      throw this._error(`Unexpected ${this._desc(t)} at top level.`, t);
    }
    return root;
  }

  _parseMixedContent(stop) {
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
        if (pendingBegin === null) pendingBegin = t;
        pending += t.image;
        pendingEnd = t;
        continue;
      }

      flush();

      if (t.type === TT.DOLLAR_INTERPOLATION_OPENING || t.type === TT.SQUARE_BRACKET_INTERPOLATION_OPENING) {
        this._next();
        const expression = this._parseExpression();
        const closer = this._peek();
        const expected = t.type === TT.SQUARE_BRACKET_INTERPOLATION_OPENING
          ? TT.CLOSE_BRACKET : TT.CLOSING_CURLY_BRACKET;
        if (closer.type !== expected) {
          throw this._error(
            `Expected "${expected === TT.CLOSE_BRACKET ? ']' : '}'}" to close the interpolation, but got ${this._desc(closer)}.`,
            closer);
        }
        this._next();
        // ← FTL.jj StringOutput: notHashLiteral/notListLiteral
        if (expression instanceof HashLiteral) {
          throw this._errorAt('A hash literal has no string form; it can\'t be interpolated with ${...}.', expression);
        }
        if (expression instanceof ListLiteral) {
          throw this._errorAt('A list literal has no string form; it can\'t be interpolated with ${...}.', expression);
        }
        group.addChild(this._span(new Interpolation(expression), t, closer));
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
        throw new UnsupportedFeatureException('The #ftl directive is not supported in this milestone yet.');
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
        default:
          break;
      }

      // remaining tag-starting tokens are directives not yet parseable
      if (t.image.startsWith('<') || t.image.startsWith('[')) {
        throw new UnsupportedFeatureException(
          `Directive "${directiveTag(t)}" is not supported in this milestone yet.`);
      }

      throw this._error(`Unexpected ${this._desc(t)} in this context.`, t);
    }

    flush();
    return group;
  }

  // ---- M7 directives ----

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

  _expectIdName(what) {
    const t = this._peek();
    if (t.type !== TT.ID) {
      throw this._error(`Expected an identifier for the ${what}, but got ${this._desc(t)}.`, t);
    }
    this._next();
    return t.image;
  }

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

  _parseSep(startTok, outerStop) {
    if (this._iterCtx.length === 0) {
      throw this._error('#sep must be inside a #list block.', startTok);
    }
    const body = this._parseMixedContent(new Set([...outerStop, TT.END_SEP]));
    if (this._peek().type === TT.END_SEP) this._next();
    return this._span(new Sep(body.children), startTok, startTok);
  }

  _parseBreak(startTok) {
    if (this.breakableDepth === 0) {
      throw this._error('You can\'t use the "#break" directive here.', startTok);
    }
    return this._span(new BreakInstruction(), startTok, startTok);
  }

  _parseContinue(startTok) {
    if (this.continuableDepth === 0) {
      throw this._error('You can\'t use the "#continue" directive here.', startTok);
    }
    return this._span(new ContinueInstruction(), startTok, startTok);
  }

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

  _parseSwitch(startTok) {
    const exp = this._parseExpression();
    this._expect(TT.DIRECTIVE_END, '">"');
    // ← ignoredSectionBeforeFirstCase: whitespace before the first case is dropped.
    while (STATIC_TYPES.has(this._peek().type)) this._next();
    const caseStop = new Set([TT.CASE, TT.DEFAUL, TT.ON, TT.END_SWITCH]);
    const cases = [];
    const ons = [];
    let hadDefault = false;
    this.breakableDepth++;
    try {
      for (;;) {
        const t = this._peek();
        if (t.type === TT.CASE) {
          this._next();
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
          this._expect(TT.OPEN_PAREN, '"(" (the #on argument list)');
          const exps = [];
          for (;;) {
            exps.push(this._parseExpression());
            if (this._peek().type === TT.COMMA) {
              this._next();
              continue;
            }
            break;
          }
          this._expect(TT.CLOSE_PAREN, '")"');
          this._expect(TT.DIRECTIVE_END, '">"');
          ons.push(new On(exps, this._parseMixedContent(caseStop).children));
        } else if (t.type === TT.END_SWITCH) {
          break;
        } else {
          throw this._error(`Unexpected ${this._desc(t)} in #switch; "#case", "#default" or "#on" expected.`, t);
        }
      }
    } finally {
      this.breakableDepth--;
    }
    const endTok = this._expect(TT.END_SWITCH, '"</#switch>"');
    return this._span(new SwitchBlock(exp, cases, ons), startTok, endTok);
  }

  // ---- expression precedence chain ← FTL.jj Expression/... productions ----

  _parseExpression() {
    return this._parseOr();
  }

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

  _parseUnary() {
    // ← NotExpression: zero or more ! (or soft "not"), then primary
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
        if (this._peek(1).type === TT.OPEN_PAREN) {
          throw new UnsupportedFeatureException(
            `Built-in arguments (as in ?${name.image}(...)) land in M11.`);
        }
        this._next();
        exp = this._span(new BuiltIn(exp, name.image), exp, name);
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

  _parseAtomic() {
    const t = this._peek();
    switch (t.type) {
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
            // ← FTL.jj stringLiteralOnly(key): number/list/hash/boolean literals excluded;
            // identifiers and other expressions stay legal (evaluated at render time).
            for (const [cls, kind] of [[NumberLiteral, 'number'], [ListLiteral, 'list'],
              [HashLiteral, 'hash'], [BooleanLiteral, 'boolean']]) {
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

  _expect(type, description) {
    const t = this._next();
    if (t.type !== type) throw this._error(`Expected ${description}, but got ${this._desc(t)}.`, t);
    return t;
  }

  _isSoftKeyword(t, word) {
    return t.type === TT.ID && t.image === word;
  }
}

// '#name' / '/#name' for error messages, extracted without regexes.
function directiveTag(t) {
  const img = t.image;
  let s = t.type.name.startsWith('END_') ? '/' : '';
  let i = 0;
  while (i < img.length && !isLetterOrUnderscore(img[i]) && img[i] !== '@') i++;
  let j = i;
  while (j < img.length && isLetterOrUnderscore(img[j])) j++;
  return s + '#' + img.slice(i, j);
}

function isLetterOrUnderscore(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}
