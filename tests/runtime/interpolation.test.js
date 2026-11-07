import { describe, it, snapshot, rejectsMatch, ok } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  UnassignedVariableException, InvalidPropertyException, InvalidReferenceException,
  NonHashException, NonStringOrTemplateOutputException, NonNumericalException, NonBooleanException,
  TemplateException,
} from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}

describe('Interpolation: basic output', () => {
  it('prints wrapped scalars', async () => {
    snapshot(await out('${x}', { x: 5 }), '5');
    snapshot(await out('${s}', { s: 'hi' }), 'hi');
    snapshot(await out('${b}', { b: true }), 'true');
    snapshot(await out('${b}', { b: false }), 'false');
    snapshot(await out('${x}!', { x: 5 }), '5!');
  });
  it('dotted lookups', async () => {
    snapshot(await out('${a.b.c}', { a: { b: { c: 'deep' } } }), 'deep');
    snapshot(await out('${m.k}', { m: new Map([['k', 'v']]) }), 'v');
  });
  it('dates use the default medium (en_US-style) datetime format', async () => {
    snapshot(await out('${d}', { d: new Date(2020, 0, 2, 10, 30) }), 'Jan 2, 2020, 10:30:00 AM');
  });
});

describe('Interpolation: missing values', () => {
  it('unassigned variable is a template exception with location', async () => {
    const e = await rejectsMatch(out('${x}', {}), UnassignedVariableException,
      ['The following has evaluated to null or missing', '==> x']);
    ok(e.beginLine === 1 && e.beginColumn === 3, `pos ${e.beginLine},${e.beginColumn}`);
    ok(e.templateName === 't.ftl', `templateName ${e.templateName}`);
    ok(e.errorStackTrace.includes('in template "t.ftl"'), 'errorStackTrace');
    ok(e.errorStackTrace.includes('at line 1, column 1'), 'stack frame position');
  });
  it('missing property', async () => {
    await rejectsMatch(out('${a.z}', { a: {} }), InvalidPropertyException,
      ['==> a.z', "step after the last dot"]);
  });
  it('dotted on non-hash', async () => {
    await rejectsMatch(out('${n.k}', { n: 5 }), NonHashException, ['Expected a hash', 'number']);
  });
  it('null model value reads as missing', async () => {
    await rejectsMatch(out('${x}', { x: null }), UnassignedVariableException, ['==> x']);
  });
});

describe('Interpolation: ! and ??', () => {
  it('default-to on missing variable or property', async () => {
    snapshot(await out('${x!"def"}', {}), 'def');
    snapshot(await out('${a.z!"d2"}', { a: {} }), 'd2');
    snapshot(await out('${(x + 1)!99}', {}), '99');
    await rejectsMatch(out('${a.z!}', { a: {} }), InvalidReferenceException, ['null or missing']);
  });
  it('bare ! with no default still errors', async () => {
    await rejectsMatch(out('${x!}', {}), InvalidReferenceException, ['null or missing']);
  });
  it('exists', async () => {
    snapshot(await out('${x??}', {}), 'false');
    snapshot(await out('${s??}', { s: 'a' }), 'true');
    snapshot(await out('${a.z??}', { a: {} }), 'false');
    snapshot(await out('${(x + 1)??}', {}), 'false');
  });
});

describe('Interpolation: operators', () => {
  it('arithmetic with upstream precedence', async () => {
    snapshot(await out('${2 + 3 * 4}'), '14');
    snapshot(await out('${(2 + 3) * 4}'), '20');
    snapshot(await out('${7 - 2 - 1}'), '4');
    snapshot(await out('${7 / 2}'), '3.5');
    snapshot(await out('${7 % 3}'), '1');
    snapshot(await out('${-3 + 5}', {}), '2');
    snapshot(await out('${x * 2}', { x: 21 }), '42');
  });
  it('division and modulo by zero', async () => {
    await rejectsMatch(out('${1 / 0}'), TemplateException, ['Division by zero']);
    await rejectsMatch(out('${1 % 0}'), TemplateException, ['Division by zero']);
  });
  it('string and mixed concatenation', async () => {
    snapshot(await out('${s + "!"}', { s: 'hi' }), 'hi!');
    snapshot(await out('${"n" + 2}', {}), 'n2');
    snapshot(await out('${2 + 2}'), '4');
    snapshot(await out('${((0..2) + (3..4))??}'), 'true'); // ranges concatenate
    snapshot(await out('${(h + {n: v}).nn}', { h: {}, n: 'nn', v: 3 }), '3'); // identifier hash keys evaluate
  });
  it('comparisons', async () => {
    snapshot(await out('${1 < 2}'), 'true');
    snapshot(await out('${2 gte 2}'), 'true');
    snapshot(await out('${(2 >= 2)}'), 'true'); // "gte" form needed outside parens (FTL.jj)
    snapshot(await out('${1 == 1}'), 'true');
    snapshot(await out('${1 != 2}'), 'true');
    // <- 2.3: relational operators on strings are errors (only ==/!= allowed)
    await rejectsMatch(out('${"a" < "b"}'), TemplateException, ['Can\'t use operator "<" on string values']);
    // cross-type equality is an error too
    await rejectsMatch(out('${1 == "a"}'), TemplateException, ['Can\'t compare values of these types']);
  });
  it('boolean operators short-circuit', async () => {
    snapshot(await out('${true && false}'), 'false');
    snapshot(await out('${false && x}', {}), 'false');
    snapshot(await out('${true || x}', {}), 'true');
    snapshot(await out('${!true}'), 'false');
    snapshot(await out('${!(1 < 2)}'), 'false');
  });
});

describe('Interpolation: coercion errors', () => {
  it('sequences and hashes have no string form', async () => {
    await rejectsMatch(out('${h}', { h: [1, 2] }), NonStringOrTemplateOutputException,
      ['evaluated to a sequence']);
    await rejectsMatch(out('${h}', { h: { a: 1 } }), NonStringOrTemplateOutputException,
      ['evaluated to an extended_hash']);
    await rejectsMatch(out('${f}', { f: () => 1 }), NonStringOrTemplateOutputException,
      ['evaluated to a method']);
  });
  it('non-numerical in arithmetic', async () => {
    await rejectsMatch(out('${s * 2}', { s: 'a' }), NonNumericalException, ['string']);
  });
  it('non-boolean in &&', async () => {
    await rejectsMatch(out('${s && true}', { s: 'a' }), NonBooleanException, ['string']);
    await rejectsMatch(out('${!s}', { s: 'a' }), NonBooleanException, ['string']);
  });
  it('unknown builtin', async () => {
    await rejectsMatch(out('${s?foo}', { s: 'a' }), TemplateException, ['no such built-in', 'foo']);
  });
});

describe('Interpolation: error positions beyond line 1', () => {
  it('reports the failing expression line/column (<- upstream blames the expression)', async () => {
    const e = await rejectsMatch(out('a\n\n${x}', {}), UnassignedVariableException);
    ok(e.beginLine === 3, `line ${e.beginLine}`);
    ok(e.beginColumn === 3, `column ${e.beginColumn}`);
  });
});
