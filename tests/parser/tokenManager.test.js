// Lexer (token-level) tests mirroring FTL.jj token definitions and actions.

import { describe, it, eq, snapshot, throwsMatch } from '../harness.js';
import { TokenManager } from '../../src/parser/tokenManager.js';
import { TT } from '../../src/parser/tokenType.js';
import { Configuration } from '../../src/configuration.js';
import * as LEX from '../../src/parser/lexicalStates.js';
import { TokenMgrError } from '../../src/errors.js';

function tokenize(source, cfg = new Configuration()) {
  const tm = new TokenManager(source, cfg);
  const out = [];
  for (;;) {
    const t = tm.nextToken();
    out.push(`${t.type.name}[${t.image}]`);
    if (t.type === TT.EOF) return out;
    if (t.type === TT.COMMENT || t.type === TT.TERSE_COMMENT || t.type === TT.NOPARSE) {
      const c = tm.readUnparsedContent();
      out.push(`UNPARSED[${c.text}]${c.closed ? '' : '<unclosed>'}`);
      tm.switchTo(LEX.DEFAULT);
    }
  }
}

describe('lexer: static text', () => {
  it('splits ws / non-ws runs', () => {
    eq(tokenize('foo bar\nbaz'), [
      'STATIC_TEXT_NON_WS[foo]', 'STATIC_TEXT_WS[ ]', 'STATIC_TEXT_NON_WS[bar]',
      'STATIC_TEXT_WS[\n]', 'STATIC_TEXT_NON_WS[baz]', 'EOF[]',
    ]);
  });

  it('lone $ < [ { # are false alarms', () => {
    eq(tokenize('$x <y [z {w #q'), [
      'STATIC_TEXT_FALSE_ALARM[$]', 'STATIC_TEXT_NON_WS[x]', 'STATIC_TEXT_WS[ ]',
      'STATIC_TEXT_FALSE_ALARM[<]', 'STATIC_TEXT_NON_WS[y]', 'STATIC_TEXT_WS[ ]',
      'STATIC_TEXT_FALSE_ALARM[[]', 'STATIC_TEXT_NON_WS[z]', 'STATIC_TEXT_WS[ ]',
      'STATIC_TEXT_FALSE_ALARM[{]', 'STATIC_TEXT_NON_WS[w]', 'STATIC_TEXT_WS[ ]',
      'STATIC_TEXT_FALSE_ALARM[#]', 'STATIC_TEXT_NON_WS[q]', 'EOF[]',
    ]);
  });

  it('empty source is just EOF', () => {
    eq(tokenize(''), ['EOF[]']);
  });
});

describe('lexer: interpolation syntax', () => {
  it('dollar interpolation (default) lexes expression inside', () => {
    eq(tokenize('A${x}B'), [
      'STATIC_TEXT_NON_WS[A]', 'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[x]',
      'CLOSING_CURLY_BRACKET[}]', 'STATIC_TEXT_NON_WS[B]', 'EOF[]',
    ]);
  });

  it('hash interpolation: starts under the LEGACY default syntax', () => {
    eq(tokenize('A#{}B'), [
      'STATIC_TEXT_NON_WS[A]', 'HASH_INTERPOLATION_OPENING[#{]', 'CLOSING_CURLY_BRACKET[}]',
      'STATIC_TEXT_NON_WS[B]', 'EOF[]',
    ]);
  });

  it('square-bracket interpolation disabled under DOLLAR syntax', () => {
    eq(tokenize('A[=x]B'), [
      'STATIC_TEXT_NON_WS[A]', 'STATIC_TEXT_NON_WS[[=]', 'STATIC_TEXT_NON_WS[x]B]', 'EOF[]',
    ]);
  });

  it('square-bracket interpolation enabled, dollar disabled', () => {
    const cfg = new Configuration();
    cfg.setInterpolationSyntax(Configuration.SQUARE_BRACKET_INTERPOLATION_SYNTAX);
    eq(tokenize('A[=x]B$y', cfg), [
      'STATIC_TEXT_NON_WS[A]', 'SQUARE_BRACKET_INTERPOLATION_OPENING[[=]', 'ID[x]',
      'CLOSE_BRACKET[]]', 'STATIC_TEXT_NON_WS[B]', 'STATIC_TEXT_FALSE_ALARM[$]',
      'STATIC_TEXT_NON_WS[y]', 'EOF[]',
    ]);
  });

  it('misplaced interpolation inside expression is an error', () => {
    throwsMatch(() => tokenize('<#if ${x}>'), TokenMgrError, ["You can't use ${...}"]);
  });
});

describe('lexer: expressions', () => {
  it('numbers, ops, builtins', () => {
    eq(tokenize('${1 + 0x1F * 1.5 == x?c}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'INTEGER[1]', 'PLUS[+]', 'HEX_INTEGER[0x1F]',
      'TIMES[*]', 'DECIMAL[1.5]', 'DOUBLE_EQUALS[==]', 'ID[x]', 'BUILT_IN[?]', 'ID[c]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('ranges and dots', () => {
    eq(tokenize('${0..9}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'INTEGER[0]', 'DOT_DOT[..]', 'INTEGER[9]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
    eq(tokenize('${x.a?has_content}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[x]', 'DOT[.]', 'ID[a]', 'BUILT_IN[?]',
      'ID[has_content]', 'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('operators: exists, and, or, not, compare', () => {
    eq(tokenize('${!a?has_content && b || c <= d??}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'EXCLAM[!]', 'ID[a]', 'BUILT_IN[?]', 'ID[has_content]',
      'AND[&&]', 'ID[b]', 'OR[||]', 'ID[c]', 'LESS_THAN_EQUALS[<=]', 'ID[d]', 'EXISTS[??]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('operator keyword spellings lt / lte / gt / gte', () => {
    eq(tokenize('${a lt b}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[a]', 'LESS_THAN[lt]', 'ID[b]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
    eq(tokenize('${a lte b}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[a]', 'LESS_THAN_EQUALS[lte]', 'ID[b]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
    eq(tokenize('${a gt b}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[a]', 'ESCAPED_GT[gt]', 'ID[b]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
    eq(tokenize('${a gte b}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[a]', 'ESCAPED_GTE[gte]', 'ID[b]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
    eq(tokenize('${a \\and b \\lte c}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[a]', 'AND[\\and]', 'ID[b]',
      'LESS_THAN_EQUALS[\\lte]', 'ID[c]', 'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('& and | are and/or', () => {
    eq(tokenize('${a & b | c}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[a]', 'AND[&]', 'ID[b]', 'OR[|]', 'ID[c]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('>= is only natural inside parens', () => {
    eq(tokenize('${(a >= b)}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'OPEN_PAREN[(]', 'ID[a]', 'NATURAL_GTE[>=]', 'ID[b]',
      'CLOSE_PAREN[)]', 'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('strings, raw strings, booleans, keywords', () => {
    eq(tokenize('${"a\\"b" + r\'c\\d\' + true}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'STRING_LITERAL["a\\"b"]', 'PLUS[+]',
      'RAW_STRING[r\'c\\d\']', 'PLUS[+]', 'TRUE[true]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('parens and list/hash literals', () => {
    eq(tokenize('${[1, 2]: {k: v}}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'OPEN_BRACKET[[]', 'INTEGER[1]', 'COMMA[,]',
      'INTEGER[2]', 'CLOSE_BRACKET[]]', 'COLON[:]', 'OPENING_CURLY_BRACKET[{]', 'ID[k]',
      'COLON[:]', 'ID[v]', 'CLOSING_CURLY_BRACKET[}]', 'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('expression comments are skipped', () => {
    eq(tokenize('${x<!-- c -->+1}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[x]', 'PLUS[+]', 'INTEGER[1]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
    eq(tokenize('${x<#-- c -->+1}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[x]', 'PLUS[+]', 'INTEGER[1]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('lambda arrow', () => {
    eq(tokenize('${x -> x}'), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[x]', 'LAMBDA_ARROW[->]', 'ID[x]',
      'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });
});

describe('lexer: directives', () => {
  it('if / list / end', () => {
    eq(tokenize('<#if x>y</#if>'), [
      'IF[<#if ]', 'ID[x]', 'DIRECTIVE_END[>]', 'STATIC_TEXT_NON_WS[y]', 'END_IF[</#if>]', 'EOF[]',
    ]);
  });

  it('list ... as ...', () => {
    eq(tokenize('<#list xs as x>${x}</#list>'), [
      'LIST[<#list ]', 'ID[xs]', 'AS[as]', 'ID[x]', 'DIRECTIVE_END[>]',
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[x]', 'CLOSING_CURLY_BRACKET[}]',
      'END_LIST[</#list>]', 'EOF[]',
    ]);
  });

  it('#items spans through "as"', () => {
    eq(tokenize('<#list xs><#items as x>y</#items></#list>'), [
      'LIST[<#list ]', 'ID[xs]', 'DIRECTIVE_END[>]', 'ITEMS[<#items as ]', 'ID[x]',
      'DIRECTIVE_END[>]', 'STATIC_TEXT_NON_WS[y]', 'END_ITEMS[</#items>]', 'END_LIST[</#list>]', 'EOF[]',
    ]);
  });

  it('switch / case / default / else / break', () => {
    eq(tokenize('<#switch x><#case 1>a<#default>b<#else>c<#break></#switch>'), [
      'SWITCH[<#switch ]', 'ID[x]', 'DIRECTIVE_END[>]', 'CASE[<#case ]', 'INTEGER[1]',
      'DIRECTIVE_END[>]', 'STATIC_TEXT_NON_WS[a]', 'DEFAUL[<#default>]',
      'STATIC_TEXT_NON_WS[b]', 'ELSE[<#else>]', 'STATIC_TEXT_NON_WS[c]',
      'BREAK[<#break>]', 'END_SWITCH[</#switch>]', 'EOF[]',
    ]);
  });

  it('elseif is a current directive', () => {
    eq(tokenize('<#if x>1<#elseif y>2</#if>'), [
      'IF[<#if ]', 'ID[x]', 'DIRECTIVE_END[>]', 'STATIC_TEXT_NON_WS[1]',
      'ELSE_IF[<#elseif ]', 'ID[y]', 'DIRECTIVE_END[>]', 'STATIC_TEXT_NON_WS[2]',
      'END_IF[</#if>]', 'EOF[]',
    ]);
  });

  it('assign / macro / function / call', () => {
    eq(tokenize('<#assign x = 1><@macro arg />'), [
      'ASSIGN[<#assign ]', 'ID[x]', 'EQUALS[=]', 'INTEGER[1]', 'DIRECTIVE_END[>]',
      'UNIFIED_CALL[<@]', 'ID[macro]', 'ID[arg]', 'EMPTY_DIRECTIVE_END[/>]', 'EOF[]',
    ]);
  });

  it('unified call with end name', () => {
    eq(tokenize('<@foo>body</@foo>'), [
      'UNIFIED_CALL[<@]', 'ID[foo]', 'DIRECTIVE_END[>]', 'STATIC_TEXT_NON_WS[body]',
      'UNIFIED_CALL_END[</@foo>]', 'EOF[]',
    ]);
  });

  it('#ftl trivial and non-trivial', () => {
    eq(tokenize('<#ftl><#t> x'), [
      'TRIVIAL_FTL_HEADER[<#ftl>]', 'TRIM[<#t>]', 'STATIC_TEXT_WS[ ]', 'STATIC_TEXT_NON_WS[x]', 'EOF[]',
    ]);
    eq(tokenize('<#ftl x=1>\ny'), [
      'FTL_HEADER[<#ftl ]', 'ID[x]', 'EQUALS[=]', 'INTEGER[1]', 'DIRECTIVE_END[>]',
      'STATIC_TEXT_NON_WS[y]', 'EOF[]',
    ]);
  });

  it('trivial header swallows one newline', () => {
    eq(tokenize('<#ftl>\nfoo'), [
      'TRIVIAL_FTL_HEADER[<#ftl>]', 'STATIC_TEXT_NON_WS[foo]', 'EOF[]',
    ]);
  });

  it('simple directives (t, noparse, compress)', () => {
    eq(tokenize('<#compress>a</#compress>'), [
      'COMPRESS[<#compress>]', 'STATIC_TEXT_NON_WS[a]', 'END_COMPRESS[</#compress>]', 'EOF[]',
    ]);
  });
});

describe('lexer: comments and unparsed', () => {
  it('terse comment', () => {
    eq(tokenize('<#-- hi -->x'), [
      'TERSE_COMMENT[<#--]', 'UNPARSED[ hi ]', 'STATIC_TEXT_NON_WS[x]', 'EOF[]',
    ]);
  });

  it('terse comment with no content', () => {
    eq(tokenize('<#---->y'), [
      'TERSE_COMMENT[<#--]', 'UNPARSED[]', 'STATIC_TEXT_NON_WS[y]', 'EOF[]',
    ]);
  });

  it('comment directive', () => {
    eq(tokenize('<#comment> a </#comment>x'), [
      'COMMENT[<#comment>]', 'UNPARSED[ a ]', 'STATIC_TEXT_NON_WS[x]', 'EOF[]',
    ]);
  });

  it('noparse keeps text verbatim', () => {
    eq(tokenize('<#noparse>${x} <#if></#noparse>'), [
      'NOPARSE[<#noparse>]', 'UNPARSED[${x} <#if>]', 'EOF[]',
    ]);
  });

  it('unclosed terse comment reports as unclosed', () => {
    const tm = new TokenManager('<#-- x', new Configuration());
    tm.nextToken();
    const c = tm.readUnparsedContent();
    eq(c.closed, false);
    snapshot(c.text, ' x');
  });

  it('mismatched terse-comment end does not close (angle syntax)', () => {
    eq(tokenize('<#-- x --] -->y'), [
      'TERSE_COMMENT[<#--]', 'UNPARSED[ x --] ]', 'STATIC_TEXT_NON_WS[y]', 'EOF[]',
    ]);
  });
});

describe('lexer: tag syntax', () => {
  it('angle syntax rejects square-bracket tags as static text', () => {
    eq(tokenize('[#if x]y[/#if]'), [
      'STATIC_TEXT_NON_WS[[#if ]', 'STATIC_TEXT_NON_WS[x]y]', 'STATIC_TEXT_NON_WS[[/#if]]', 'EOF[]',
    ]);
  });

  it('square-bracket syntax rejects angle tags as static text', () => {
    const cfg = new Configuration();
    cfg.setTagSyntax(Configuration.SQUARE_BRACKET_TAG_SYNTAX);
    eq(tokenize('[#if x]y[/#if]', cfg), [
      'IF[[#if ]', 'ID[x]', 'DIRECTIVE_END[]]', 'STATIC_TEXT_NON_WS[y]', 'END_IF[[/#if]]', 'EOF[]',
    ]);
    eq(tokenize('<#if x>y</#if>', cfg), [
      'STATIC_TEXT_NON_WS[<#if ]', 'STATIC_TEXT_NON_WS[x>y]', 'STATIC_TEXT_NON_WS[</#if>]', 'EOF[]',
    ]);
  });

  it('auto-detect takes over from the first tag', () => {
    const cfg = new Configuration();
    cfg.setTagSyntax(Configuration.AUTO_DETECT_TAG_SYNTAX);
    eq(tokenize('[#if x]y[/#if]', cfg), [
      'IF[[#if ]', 'ID[x]', 'DIRECTIVE_END[]]', 'STATIC_TEXT_NON_WS[y]', 'END_IF[[/#if]]', 'EOF[]',
    ]);
  });

  it('mismatched closer is an error', () => {
    throwsMatch(() => tokenize('<#if x>y</#if]'), TokenMgrError, ['The tag shouldn\'t end with "]"']);
    throwsMatch(() => tokenize('<#attempt]'), TokenMgrError, ['The tag shouldn\'t end with "]"']);
  });

  it('angle tag closed with ] is an error at 2.3.36 baseline', () => {
    throwsMatch(() => tokenize('<#if x]y'), TokenMgrError, ["You can't have an \"]\" here"]);
  });

  it('unexpected closing token is an error', () => {
    throwsMatch(() => tokenize('<#if }'), TokenMgrError, ["You can't have an \"}\" here"]);
    throwsMatch(() => tokenize('<#if (1}>'), TokenMgrError, ["You can't have an \"}\" here"]);
  });
});

describe('lexer: unknown and malformed directives', () => {
  it('unknown directive', () => {
    throwsMatch(() => tokenize('<#foo>'), TokenMgrError, ['Unknown directive: #foo']);
  });

  it('common legacy-name hints', () => {
    throwsMatch(() => tokenize('<#set x = 1>'), TokenMgrError, ['Unknown directive: #set', 'Use #assign']);
    throwsMatch(() => tokenize('<#elif x>'), TokenMgrError, ['Unknown directive: #elif', 'Use #elseif']);
    throwsMatch(() => tokenize('<#else_if x>'), TokenMgrError, ['Use #elseif']);
    throwsMatch(() => tokenize('<#method foo>'), TokenMgrError, ['Use #function']);
    throwsMatch(() => tokenize('<#try>'), TokenMgrError, ['You may have meant #attempt']);
    throwsMatch(() => tokenize('<#for x>'), TokenMgrError, ['You may have meant #list']);
  });

  it('existing directive in wrong form is malformed-tag error', () => {
    throwsMatch(() => tokenize('<#elseif>'), TokenMgrError, ['existing directive, but the tag is malformed']);
    throwsMatch(() => tokenize('<#items xs>'), TokenMgrError, ['existing directive, but the tag is malformed']);
  });

  it('malformed tag without a name', () => {
    throwsMatch(() => tokenize('<#>'), TokenMgrError, ['directive name']);
  });
});

describe('lexer: naming convention', () => {
  it('camel and legacy variants are accepted', () => {
    eq(tokenize('<#forEach xs as x>1</#forEach>').slice(0, 2), ['FOREACH[<#forEach ]', 'ID[xs]']);
    eq(tokenize('<#foreach xs as x>1</#foreach>').slice(0, 2), ['FOREACH[<#foreach ]', 'ID[xs]']);
  });

  it('mixing conventions is an error', () => {
    throwsMatch(() => tokenize('<#elseIf x>1<#elseif y>'), TokenMgrError, ['Naming convention mismatch']);
    throwsMatch(() => tokenize('<#forEach xs as x>y<#foreach a; b>'), TokenMgrError, ['Naming convention mismatch']);
  });

  it('explicit camel convention rejects legacy spelling', () => {
    const cfg = new Configuration();
    cfg.setNamingConvention(Configuration.CAMEL_CASE_NAMING_CONVENTION);
    throwsMatch(() => tokenize('<#elseif x>', cfg), TokenMgrError, ['Naming convention mismatch']);
  });
});
