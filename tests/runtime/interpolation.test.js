import { describe, it, snapshot, rejectsMatch, ok } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  UnassignedVariableException, InvalidPropertyException, InvalidReferenceException,
  NonHashException, NonStringException, NonNumericalException, NonBooleanException,
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
  it('dates use the interim ISO format (M16 replaces)', async () => {
    snapshot(await out('${d}', { d: new Date(Date.UTC(2020, 0, 2, 10, 30)) }),
      '2020-01-02T10:30:00.000Z');
  });
});

describe('Interpolation: missing values', () => {
  it('unassigned variable is a template exception with location', async () => {
    const e = await rejectsMatch(out('${x}', {}), UnassignedVariableException,
      ['not in the data model', '"x"']);
    ok(e.beginLine === 1 && e.beginColumn === 1, `pos ${e.beginLine},${e.beginColumn}`);
    ok(e.templateName === 't.ftl', `templateName ${e.templateName}`);
    ok(e.errorStackTrace.includes('in template "t.ftl"'), 'errorStackTrace');
    ok(e.errorStackTrace.includes('line 1, column 1'), 'stack frame position');
  });
  it('missing property', async () => {
    await rejectsMatch(out('${a.z}', { a: {} }), InvalidPropertyException, ['has not been found']);
  });
  it('dotted on non-hash', async () => {
    await rejectsMatch(out('${n.k}', { n: 5 }), NonHashException, ['is not a hash', 'number']);
  });
  it('null model value reads as missing', async () => {
    await rejectsMatch(out('${x}', { x: null }), UnassignedVariableException, ['"x"']);
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
  });
  it('comparisons', async () => {
    snapshot(await out('${1 < 2}'), 'true');
    snapshot(await out('${2 gte 2}'), 'true');
    snapshot(await out('${(2 >= 2)}'), 'true'); // "gte" form needed outside parens (FTL.jj)
    snapshot(await out('${"a" < "b"}'), 'true');
    snapshot(await out('${1 == 1}'), 'true');
    snapshot(await out('${1 != 2}'), 'true');
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
    await rejectsMatch(out('${h}', { h: [1, 2] }), NonStringException, ['sequence']);
    await rejectsMatch(out('${h}', { h: { a: 1 } }), NonStringException, ['hash']);
    await rejectsMatch(out('${f}', { f: () => 1 }), NonStringException, ['method']);
  });
  it('non-numerical in arithmetic', async () => {
    await rejectsMatch(out('${s * 2}', { s: 'a' }), NonNumericalException, ['string']);
  });
  it('non-boolean in &&', async () => {
    await rejectsMatch(out('${s && true}', { s: 'a' }), NonBooleanException, ['string']);
    await rejectsMatch(out('${!s}', { s: 'a' }), NonBooleanException, ['string']);
  });
  it('unknown builtin', async () => {
    await rejectsMatch(out('${s?foo}', { s: 'a' }), TemplateException, ['Unknown builtin', 'foo']);
  });
});

describe('Interpolation: error positions beyond line 1', () => {
  it('reports the failing element line/column', async () => {
    const e = await rejectsMatch(out('a\n\n${x}', {}), UnassignedVariableException);
    ok(e.beginLine === 3, `line ${e.beginLine}`);
    ok(e.beginColumn === 1, `column ${e.beginColumn}`);
  });
});
