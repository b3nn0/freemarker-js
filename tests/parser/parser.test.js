// Expression parser: precedence chain, literals, ranges, escaped ids, .x vars, !/?exists,
// canonical forms, root-level text + interpolation + comments. Directive bodies land later.

import { describe, it, eq, ok, snapshot, throwsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import { ParseException, UnsupportedFeatureException } from '../../src/errors.js';
import { MixedContentElements } from '../../src/parser/ast/mixedContentElements.js';

function parseTemplate(source, cfg = new Configuration()) {
  return new Template('test.ftl', source, cfg);
}

function exprOf(source, cfg = new Configuration()) {
  let root = parseTemplate('${' + source + '}', cfg).rootElement;
  if (root instanceof MixedContentElements) {
    eq(root.children.length, 1, `expected one interpolation for ${JSON.stringify(source)}`);
    root = root.children[0];
  }
  return root.expression;
}

function canon(source, cfg = new Configuration()) {
  return exprOf(source, cfg).getCanonicalForm();
}

// Bare expression (not a direct ${...} output) via a wrapping parenthesis.
function bare(source, cfg = new Configuration()) {
  return exprOf('(' + source + ')', cfg).expression;
}

function canonBare(source, cfg = new Configuration()) {
  return bare(source, cfg).getCanonicalForm();
}

function name(n) {
  return n && n.constructor ? n.constructor.name : String(n);
}

describe('parser: literals', () => {
  it('numbers canonicalize plainly', () => {
    eq(canon('1'), '1');
    eq(canon('1.5'), '1.5');
    eq(canon('0x1F'), '31');
  });
  it('strings decode escapes; canonical re-quotes', () => {
    eq(canon('"a\\nb"'), '"a\\nb"');
    eq(canon("'it\\'s'"), "\"it's\"");
    eq(canon('r"a\\nb"'), '"a\\\\nb"');
  });
  it('booleans', () => {
    eq(canon('true'), 'true');
    eq(canon('false'), 'false');
  });
  it('list literals', () => {
    eq(canonBare('[]'), '[]');
    eq(canonBare('[1, "a", [2]]'), '[1, "a", [2]]');
    eq(name(bare('[1]')), 'ListLiteral');
  });
  it('hash literal keys: any expression except number/list/hash/boolean literals', () => {
    eq(canonBare('{"a": 1, "b": [2, 3]}'), '{"a": 1, "b": [2, 3]}');
    eq(canonBare('{"a", 1}'), '{"a": 1}');
    eq(canonBare('{k: 1}'), '{k: 1}'); // identifier key, evaluated at render time (FTL.jj)
    throwsMatch(() => bare('{1: 2}'), ParseException, ['number', 'literal']);
    throwsMatch(() => bare('{[1]: 2}'), ParseException, ['list', 'literal']);
    throwsMatch(() => bare('{{"k": 1}: 2}'), ParseException, ['hash', 'literal']);
    throwsMatch(() => bare('{true: 2}'), ParseException, ['boolean', 'literal']);
  });
});

describe('parser: precedence and canonicalization', () => {
  it('multiplicative binds tighter than additive', () => {
    const e = exprOf('1 + 2 * 3');
    eq(name(e), 'AddConcatExpression');
    eq(name(e.right), 'ArithmeticExpression');
    eq(e.right.operator, 'multiply');
    eq(canon('1 + 2 * 3'), '1 + 2 * 3');
  });
  it('parentheses are preserved as ParentheticalExpression', () => {
    const e = exprOf('(1 + 2) * 3');
    eq(name(e), 'ArithmeticExpression');
    eq(name(e.left), 'ParentheticalExpression');
    eq(canon('(1 + 2) * 3'), '(1 + 2) * 3');
  });
  it('subtraction is arithmetic, plus is concat node', () => {
    eq(name(exprOf('4 - 2')), 'ArithmeticExpression');
    eq(name(exprOf('4 + 2')), 'AddConcatExpression');
    eq(canon('4 - 2 * 3'), '4 - 2 * 3');
  });
  it('comparison and equality', () => {
    eq(canon('a == b'), 'a == b');
    eq(canon('a != b'), 'a != b');
    eq(canon('a > b'), 'a > b');
    eq(canon('a <= b'), 'a <= b');
    eq(canon('a &lt;= b'), 'a &lt;= b');
    eq(name(exprOf('a == b')), 'ComparisonExpression');
    eq(name(exprOf('a < b')), 'ComparisonExpression');
  });
  it('>= is only usable inside parentheses', () => {
    eq(canon('(a >= b)'), '(a >= b)');
    throwsMatch(() => exprOf('a >= b'), ParseException, []);
  });
  it('and/or precedence, both spellings', () => {
    const hard = exprOf('a && b || c');
    eq(name(hard), 'OrExpression');
    eq(name(hard.left), 'AndExpression');
    const soft = exprOf('a and b or c');
    eq(name(soft), 'OrExpression');
    eq(name(soft.left), 'AndExpression');
    eq(soft.getCanonicalForm(), 'a && b || c');
    eq(canon('a & b | c'), 'a && b || c');
  });
  it('not: hard and soft spelling; canonical is !', () => {
    eq(canon('!a'), '!a');
    eq(canon('not a'), '!a');
    eq(canon('!!a'), '!!a');
  });
  it('unary plus/minus', () => {
    eq(canon('-1'), '-1');
    eq(canon('+1'), '+1');
    eq(canon('2 - -1'), '2 - -1');
    eq(name(exprOf('-1')), 'UnaryPlusMinusExpression');
    eq(exprOf('-1').isMinus, true);
  });
  it('range expressions', () => {
    eq(canon('0..9'), '0..9');
    eq(canon('0..<9'), '0..<9');
    eq(canon('0..*9'), '0..*9');
    eq(canon('0..'), '0..');
    eq(exprOf('0..<9').endType, 'exclusive');
  });
  it('default-to and exists', () => {
    eq(canon('x!'), 'x!');
    eq(canon('x!y'), 'x!y');
    eq(canon('x??'), 'x??');
    eq(canon('a!"b"'), 'a!"b"');
  });
});

describe('parser: variables and built-ins', () => {
  it('dotted paths', () => {
    const e = exprOf('a.b.c');
    eq(name(e), 'Dot');
    eq(name(e.target), 'Dot');
    eq(canon('a.b.c'), 'a.b.c');
  });
  it('escaped identifiers survive round-trip', () => {
    eq(canon('a\\-b'), 'a\\-b');
    eq(canon('x.a\\:b'), 'x.a\\:b');
    eq(exprOf('a\\-b').name, 'a-b');
  });
  it('keywords after dot are plain names', () => {
    eq(canon('x.lt'), 'x.lt');
    eq(canon('x.true'), 'x.true');
    eq(canon('x.and'), 'x.and');
  });
  it('built-ins without arguments', () => {
    eq(canon('x?has_content'), 'x?has_content');
    eq(name(exprOf('x?c')), 'BuiltIn');
  });
  it('built-in arguments land in M11', () => {
    throwsMatch(() => exprOf('x?string("y","n")'), UnsupportedFeatureException, ['M11']);
  });
  it('dynamic key access', () => {
    eq(canon('x["k"]'), 'x["k"]');
    eq(canon('x[1 + 1]'), 'x[1 + 1]');
    eq(canon('x[]'), 'x[]');
    eq(name(exprOf('x[]')), 'DynamicKeyName');
  });
  it('method calls', () => {
    eq(canon('x.m()'), 'x.m()');
    eq(canon('x.m("a", 2)'), 'x.m("a", 2)');
    eq(canon('f() + 1'), 'f() + 1');
  });
});

describe('parser: template root', () => {
  it('text + interpolation + comment canonical form', () => {
    const t = parseTemplate('A<#-- c -->${ x + 1 }B');
    eq(t.rootElement.children.map(c => c.constructor.name),
      ['TextBlock', 'TerseComment', 'Interpolation', 'TextBlock']);
    eq(t.getCanonicalForm(), 'A<#-- c -->${x + 1}B');
  });

  it('square-bracket interpolation canonicalizes to dollar', () => {
    const cfg = new Configuration();
    cfg.setInterpolationSyntax(Configuration.SQUARE_BRACKET_INTERPOLATION_SYNTAX);
    eq(parseTemplate('[=x]', cfg).getCanonicalForm(), '${x}');
  });

  it('comment directive element', () => {
    const t = parseTemplate('a<#comment>hidden</#comment>b');
    eq(t.rootElement.children.map(c => c.constructor.name),
      ['TextBlock', 'CommentDirective', 'TextBlock']);
    eq(t.getCanonicalForm(), 'a<#comment>hidden</#comment>b');
  });

  it('noparse element keeps text verbatim', () => {
    const t = parseTemplate('a<#noparse>${x}</#noparse>b');
    eq(t.getCanonicalForm(), 'a<#noparse>${x}</#noparse>b');
  });

  it('hash and list literals cannot be interpolated directly', () => {
    throwsMatch(() => parseTemplate('${{"a": 1}}'), ParseException, ['hash literal']);
    throwsMatch(() => parseTemplate('${[1, 2]}'), ParseException, ['list literal']);
  });

  it('empty template', () => {
    eq(parseTemplate('').rootElement.children.length, 0);
  });

  it('consecutive static text merges', () => {
    const t = parseTemplate('a ${"b"} c');
    eq(t.rootElement.children.map(c => c.constructor.name),
      ['TextBlock', 'Interpolation', 'TextBlock']);
  });
});

describe('parser: parse errors carry positions', () => {
  it('unclosed interpolation', () => {
    const e = throwsMatch(() => parseTemplate('${x'), ParseException, []);
    ok(e.beginLine === 1, `line ${e.beginLine}`);
  });

  it('empty interpolation', () => {
    throwsMatch(() => parseTemplate('${}'), ParseException, ['expression']);
  });

  it('dangling operator', () => {
    throwsMatch(() => parseTemplate('${1+}'), ParseException, ['expression']);
  });

  it('unexpected token after complete expression', () => {
    throwsMatch(() => parseTemplate('${x y}'), ParseException, ['}']);
  });

  it('unclosed terse comment', () => {
    throwsMatch(() => parseTemplate('<#-- x'), ParseException, ['Unclosed comment']);
  });

  it('#if now parses (M7)', () => {
    const t = parseTemplate('<#if x>y</#if>');
    eq(t.rootElement.constructor.name, 'IfBlock');
    snapshot(t.getCanonicalForm(), '<#if x>y</#if>');
  });

  it('multi-line error positions', () => {
    const e = throwsMatch(() => parseTemplate('a\nb ${1 +}'), ParseException, []);
    ok(e.beginLine === 2 && e.beginColumn === 8, `positions ${e.beginLine}:${e.beginColumn}`);
  });

  it('lexer error becomes ParseException with position', () => {
    const e = throwsMatch(() => parseTemplate('a<#foo>'), ParseException, ['Unknown directive: #foo']);
    ok(e.beginLine === 1 && e.beginColumn === 2, `positions ${e.beginLine}:${e.beginColumn}`);
  });
});

describe('parser: canonical round-trip', () => {
  it('reparsing canonical source yields identical canonical output', () => {
    const src = 'x ${a + b * (c - 1)!d}y <#-- z -->e ${a?has_content && !b or c}';
    const c1 = parseTemplate(src).getCanonicalForm();
    const c2 = parseTemplate(c1).getCanonicalForm();
    eq(c2, c1);
  });
});
