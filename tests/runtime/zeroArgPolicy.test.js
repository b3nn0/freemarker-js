// ZeroArgumentPolicy: single knob, no record/class split (simplified from upstream).

import { describe, it, snapshot, throwsMatch, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import { ZeroArgumentPolicy as P } from '../../src/index.js';
import { NonStringException, NonStringOrTemplateOutputException, InvalidPropertyException } from '../../src/errors.js';

function out(src, model, cfg) {
  return new Template('t.ftl', src, cfg ?? new Configuration()).processToString(model ?? {});
}

describe('ZeroArgumentPolicy: AUTO_INVOKE (default)', () => {
  it('bare dot and parenthesized call both give the value', async () => {
    const model = { p: { x() { return 5; }, s() { return 'str'; } } };
    snapshot(await out('${p.x}', model), '5');
    snapshot(await out('${p.x()}', model), '5');
    snapshot(await out('${p["s"]}', model), 'str');
    snapshot(await out('${p.s??}', model), 'true');
    snapshot(await out('${p.x + 1}', model), '6');
  });
  it('getX/isX names are NOT special anymore (no bean carve-out)', async () => {
    const model = { p: { getV() { return 1; }, isOn() { return true; } } };
    snapshot(await out('${p.getV}', model), '1');
    snapshot(await out('${p.getV()}', model), '1');
    snapshot(await out('${p.isOn}', model), 'true');
    await rejectsMatch(out('${p.v}', model), InvalidPropertyException, ['==> p.v']);
  });
  it('1-argument functions are not auto-invoked', async () => {
    const model = { p: { f(a) { return a + 1; } } };
    snapshot(await out('${p.f(2)}', model), '3');
    snapshot(await out('${p["f"](2)}', model), '3');
    await rejectsMatch(out('${p.f}', model), NonStringOrTemplateOutputException, ['evaluated to a method']);
  });
  it('class instances behave like plain objects', async () => {
    class Holder { m() { return 3; } m2(a) { return a * 2; } }
    const model = { h: new Holder() };
    snapshot(await out('${h.m}', model), '3');
    snapshot(await out('${h.m()}', model), '3');
    snapshot(await out('${h.m2(4)}', model), '8');
    snapshot(await out('${h["m2"](4)}', model), '8');
  });
});

describe('ZeroArgumentPolicy: METHOD_ONLY', () => {
  it('bare dot reads give the method; calls still work', async () => {
    const cfg = new Configuration();
    cfg.setZeroArgumentPolicy(P.METHOD_ONLY);
    const model = { p: { x() { return 5; } } };
    snapshot(await out('${p.x()}', model, cfg), '5');
    snapshot(await out('${p.x?is_method?then("m","v")}', model, cfg), 'm');
    await rejectsMatch(out('${p.x}', model, cfg), NonStringOrTemplateOutputException, ['evaluated to a method']);
    await rejectsMatch(out('${p["x"]}', model, cfg), NonStringOrTemplateOutputException, ['method']);
  });
  it('policy setter validates values', () => {
    throwsMatch(() => new Configuration().setZeroArgumentPolicy('NOPE'), TypeError);
  });
});
