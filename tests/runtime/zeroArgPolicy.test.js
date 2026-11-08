// ZeroArgumentPolicy: single knob, no record/class split (simplified from upstream).

import { describe, it, snapshot, throwsMatch, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import { ZeroArgumentPolicy as P } from '../../src/index.js';
import {
  NonStringException, NonStringOrTemplateOutputException, InvalidPropertyException, NonMethodException,
} from '../../src/errors.js';

function out(src, model, cfg) {
  return new Template('t.ftl', src, cfg ?? new Configuration()).processToString(model ?? {});
}

describe('ZeroArgumentPolicy: AUTO_INVOKE (default)', () => {
  it('bare dot and parenthesized call both give the value', async () => {
    const model = { p: { x() { return 5; }, s() { return 'str'; } } };
    snapshot(await out('${p.x}', model), '5');
    snapshot(await out('${p.x()}', model), '5');
    snapshot(await out('${p["s"]}', model), 'str');
    snapshot(await out('${p.s?? ?c}', model), 'true');
    snapshot(await out('${p.x + 1}', model), '6');
  });
  it('getX/isX names are NOT special anymore (no bean carve-out)', async () => {
    const model = { p: { getV() { return 1; }, isOn() { return true; } } };
    snapshot(await out('${p.getV}', model), '1');
    snapshot(await out('${p.getV()}', model), '1');
    snapshot(await out('${p.isOn?c}', model), 'true');
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

// Root-scope identifiers. Upstream applies the policy inside the object wrapper's
// get(), and that same get() serves root variables (JVM, root data model = the bean:
// ${bare} -> "bare-yes" under BOTH_METHOD_AND_PROPERTY_/PROPERTY_ONLY_, and a
// method+sequence error under the default METHOD_ONLY).
describe('ZeroArgumentPolicy at root scope (data-model variables)', () => {
  const model = () => ({ x() { return 5; }, s() { return 'str'; }, one(a) { return a + 1; } });

  it('AUTO_INVOKE: bare root reads auto-invoke, ${f()} still calls', async () => {
    snapshot(await out('${x}', model()), '5');
    snapshot(await out('${x()}', model()), '5');
    snapshot(await out('${x + 1}', model()), '6');
    snapshot(await out('${x?? ?c}', model()), 'true');
    snapshot(await out('${x?string}', model()), '5');
    snapshot(await out('[${s}][${x}]', model()), '[str][5]');
    snapshot(await out('${one(4)}', model()), '5');
    snapshot(await out('${one?with_args([9])()}', model()), '10');
  });

  it('AUTO_INVOKE: argument-taking functions stay method values (JVM-pinned)', async () => {
    snapshot(await out('${one?is_method?c}', model()), 'true');
    await rejectsMatch(out('${one}', model()), NonStringOrTemplateOutputException, ['evaluated to a method']);
    // JVM-pinned: an auto-invoking upstream policy also reports the 0-arg method as a
    // value (${cust.bare?is_method?c} -> false under BOTH_METHOD_AND_PROPERTY_...).
    snapshot(await out('${x?is_method?c}', model()), 'false');
    await rejectsMatch(out('${x?with_args([])()}', model()), NonMethodException,
      ['Expected a macro, function, directive, or method']);
  });

  it('METHOD_ONLY: bare root reads give the method; calls still work', async () => {
    const cfg = new Configuration();
    cfg.setZeroArgumentPolicy(P.METHOD_ONLY);
    snapshot(await out('${x()}', model(), cfg), '5');
    snapshot(await out('${x?is_method?c}', model(), cfg), 'true');
    await rejectsMatch(out('${x}', model(), cfg), NonStringOrTemplateOutputException, ['evaluated to a method']);
  });

  it('template-set variables, macros and functions are not data-model reads', async () => {
    snapshot(await out('<#function g><#return 7></#function>${g?is_method?c}/${g()}', {}), 'true/7');
    snapshot(await out('<#macro m>x</#macro>${m?is_macro?c}/${m?is_method?c}', {}), 'true/false');
    snapshot(await out('<#assign h = one>${h(3)}/${h?is_method?c}', model()), '4/true');
    const cfg = new Configuration();
    cfg.setZeroArgumentPolicy(P.METHOD_ONLY);
    snapshot(await out('<#assign h = x>${h?is_method?c}/${h()}', model(), cfg), 'true/5');
    snapshot(await out('<#list [x] as v>${v?is_method?c}</#list>', model(), cfg), 'true');
  });

  it('#global writes into the data model, so its reads are policy reads', async () => {
    snapshot(await out('<#global g = s>${g}', model()), 'str');
    const cfg = new Configuration();
    cfg.setZeroArgumentPolicy(P.METHOD_ONLY);
    snapshot(await out('<#global g = x>${g?is_method?c}/${g()}', model(), cfg), 'true/5');
  });
});
