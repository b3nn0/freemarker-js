import { describe, it, snapshot, throwsMatch, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import { ZeroArgumentNonVoidMethodPolicy as P } from '../../src/index.js';
import { NonStringException, InvalidPropertyException } from '../../src/errors.js';

function out(src, model, cfg) {
  return new Template('t.ftl', src, cfg ?? new Configuration()).processToString(model ?? {});
}

describe('ZeroArgumentNonVoidMethodPolicy: record-like (plain objects)', () => {
  it('default BOTH: bare dot and call both give the value', async () => {
    const model = { p: { x() { return 5; }, s() { return 'str'; } } };
    snapshot(await out('${p.x}', model), '5');
    snapshot(await out('${p.x()}', model), '5');
    snapshot(await out('${p["s"]}', model), 'str');
    snapshot(await out('${p.s??}', model), 'true');
    snapshot(await out('${p.x + 1}', model), '6');
  });
  it('bean-reader style names stay methods (carve-out)', async () => {
    const model = { p: { getV() { return 1; }, isOn() { return true; } } };
    snapshot(await out('${p.getV()}', model), '1');
    snapshot(await out('${p.isOn()}', model), 'true');
    await rejectsMatch(out('${p.getV}', model), NonStringException, ['method']);
    await rejectsMatch(out('${p.v}', model), InvalidPropertyException, ['has not been found']);
  });
  it('1-argument functions are not property-like', async () => {
    const model = { p: { f(a) { return a + 1; } } };
    snapshot(await out('${p.f(2)}', model), '3');
    await rejectsMatch(out('${p.f}', model), NonStringException, ['method']);
  });
});

describe('ZeroArgumentNonVoidMethodPolicy: non-record objects', () => {
  class Holder { m() { return 3; } }
  it('default METHOD_ONLY: bare dot gives the method', async () => {
    const model = { h: new Holder() };
    snapshot(await out('${h.m()}', model), '3');
    await rejectsMatch(out('${h.m}', model), NonStringException, ['method']);
  });
  it('PROPERTY_ONLY makes class-instance dots values too', async () => {
    const cfg = new Configuration();
    cfg.setDefaultZeroArgumentNonVoidMethodPolicy(P.PROPERTY_ONLY_UNLESS_BEAN_PROPERTY_READ_METHOD);
    snapshot(await out('${h.m}', { h: new Holder() }, cfg), '3');
  });
  it('policy setter validates values', () => {
    throwsMatch(() => new Configuration().setDefaultZeroArgumentNonVoidMethodPolicy('NOPE'), TypeError);
  });
});

describe('ZeroArgumentNonVoidMethodPolicy: record policy override', () => {
  it('METHOD_ONLY for records: bare dot gives the method', async () => {
    const cfg = new Configuration();
    cfg.setRecordZeroArgumentNonVoidMethodPolicy(P.METHOD_ONLY);
    await rejectsMatch(out('${p.x}', { p: { x() { return 5; } } }, cfg), NonStringException, ['method']);
    snapshot(await out('${p.x()}', { p: { x() { return 5; } } }, cfg), '5');
  });
});
