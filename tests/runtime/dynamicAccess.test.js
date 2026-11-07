import { describe, it, snapshot, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  InvalidReferenceException, InvalidPropertyException,
  NonHashException, NonNumericalException, NonMethodException,
} from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}

describe('Dynamic keys', () => {
  it('sequence indexing', async () => {
    snapshot(await out('${a[0]}', { a: [10, 20] }), '10');
    snapshot(await out('${a[1]}', { a: [10, 20] }), '20');
    snapshot(await out('${a[n]}', { a: [10, 20], n: 1 }), '20');
    snapshot(await out('${a[1.7]}', { a: [10, 20] }), '20'); // index truncated
    await rejectsMatch(out('${a[5]}', { a: [10] }), InvalidReferenceException, ['null or missing']);
    await rejectsMatch(out('${a[-1]}', { a: [10] }), InvalidReferenceException, ['null or missing']);
  });
  it('hash dynamic keys', async () => {
    snapshot(await out('${h["k"]}', { h: { k: 'v' } }), 'v');
    snapshot(await out('${h[k2]}', { h: { k: 'v' }, k2: 'k' }), 'v');
    snapshot(await out('${h[1]}', { h: { 1: 'x' } }), 'x'); // number key coerced to string
    await rejectsMatch(out('${h["zz"]}', { h: { k: 'v' } }), InvalidReferenceException,
      ['null or missing']);
  });
  it('empty dynamic key', async () => {
    await rejectsMatch(out('${h[]}', { h: { k: 'v' } }), InvalidPropertyException,
      ['==> h[]']);
    // <- upstream blames the null key expression itself (the m identifier throws)
    await rejectsMatch(out('${h[m]}', { h: { k: 'v' }, m: null }), InvalidReferenceException,
      ['==> m']);
    snapshot(await out('${h[]!"d"}', { h: { k: 'v' } }), 'd');
    snapshot(await out('${h[m]??}', { h: { k: 'v' } }), 'false');
  });
  it('errors on wrong targets', async () => {
    await rejectsMatch(out('${n[0]}', { n: 5 }), NonHashException, ['Expected a hash or sequence']);
    await rejectsMatch(out('${a["x"]}', { a: [1] }), NonNumericalException, ['index']);
  });
  it('nested dynamic access', async () => {
    snapshot(await out('${m.a[1].b}', { m: { a: [{ b: 0 }, { b: 9 }] } }), '9');
  });
});

describe('Method calls', () => {
  it('calls wrapped JS functions', async () => {
    snapshot(await out('${f(3)}', { f: (x) => x * 2 }), '6');
    snapshot(await out('${f()}', { f: () => 'zero-arg' }), 'zero-arg');
    snapshot(await out('${o.m("x")}', { o: { m: (s) => s + '!' } }), 'x!');
    snapshot(await out('${f(g(2))}', { f: (x) => x + 1, g: (x) => x * 10 }), '21');
  });
  it('arguments are deep-unwrapped plain JS values', async () => {
    const f = (...args) => args.map(v => Array.isArray(v) ? `arr(${v.length})` : typeof v).join(',');
    snapshot(await out('${f(1, "s", true, [1, 2])}', { f }), 'number,string,boolean,arr(2)');
    snapshot(await out('${f({"a": 1})}', { f }), 'object');
    const h = (m) => String(m.get('a') + m.get('b'));
    snapshot(await out('${f({"a": 1, "b": 2})}', { f: h }), '3');
  });
  it('results are re-wrapped', async () => {
    snapshot(await out('${f()[1]}', { f: () => [7, 8] }), '8');
    snapshot(await out('${f().k}', { f: () => ({ k: 'v' }) }), 'v');
    await rejectsMatch(out('${f()}', { f: () => [1] }), null, ['sequence']);
  });
  it('errors', async () => {
    await rejectsMatch(out('${x(1)}', { x: 5 }), NonMethodException, ['number']);
    await rejectsMatch(out('${o.zz()}', { o: {} }), InvalidPropertyException, ['==> o.zz']);
    await rejectsMatch(out('${missing()}', {}), InvalidReferenceException, ['==> missing']);
  });
});
