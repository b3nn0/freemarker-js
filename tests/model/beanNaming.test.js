// JavaBeans reader naming: a getFoo/isFoo member stands for the property foo.
// <- freemarker.ext.beans._MethodUtil.getBeanPropertyNameFromReaderMethodName and the
// property entries of ClassIntrospector's introspection map (JVM-pinned with probes over
// the built 2.3.36 classes; see UPSTREAM.md, tenth fidelity round).

import { describe, it, snapshot, eq, throwsMatch, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import { ZeroArgumentPolicy } from '../../src/index.js';
import {
  InvalidPropertyException, NonMethodException, NonStringOrTemplateOutputException,
  AsyncOperationNotAllowedException,
} from '../../src/errors.js';
import { beanPropertyNameFromReaderName, readerNameCandidates } from '../../src/model/beanNaming.js';

function out(src, model, cfg) {
  return new Template('t.ftl', src, cfg ?? new Configuration()).processToString(model ?? {});
}

/** The bean behind most specs below. */
class Cust {
  constructor() { this.plain = 'plain-field'; } // plain data member; readers are methods
  getName() { return 'getter-name'; }
  getURL() { return 'url-value'; }
  getaBc() { return 'abc-value'; }
  get_x() { return 'underscore-value'; }
  isFlag() { return true; }
  getLabel() { return 'label-value'; }
  getBoth() { return 'from-getFoo'; }
  isBoth() { return 'from-isFoo'; }
  getOneArg(a) { return 'one:' + a; }
  getVoid() { return undefined; }
  bare() { return 'bare-method'; }
}

describe('Bean reader naming: derivation rules (unit)', () => {
  it('matches the upstream reader-name rule', () => {
    // <- _MethodUtil.getBeanPropertyNameFromReaderMethodName
    eq(beanPropertyNameFromReaderName('getFoo'), 'foo');
    eq(beanPropertyNameFromReaderName('getURL'), 'URL'); // two leading upper-case: kept whole
    eq(beanPropertyNameFromReaderName('getaBc'), 'aBc');
    eq(beanPropertyNameFromReaderName('get_x'), '_x');
    eq(beanPropertyNameFromReaderName('getfoo'), 'foo');
    eq(beanPropertyNameFromReaderName('gettable'), 'table');
    eq(beanPropertyNameFromReaderName('isFoo'), 'foo');
    eq(beanPropertyNameFromReaderName('isURL'), 'URL');
    eq(beanPropertyNameFromReaderName('get'), null); // prefix alone is not a reader
    eq(beanPropertyNameFromReaderName('is'), null);
    eq(beanPropertyNameFromReaderName('name'), null);
    eq(beanPropertyNameFromReaderName('getIt'), 'it');
  });
  it('candidates: get before is, upper-first before as-is, derived-back only', () => {
    eq(readerNameCandidates('foo'), ['getFoo', 'getfoo', 'isFoo', 'isfoo']);
    eq(readerNameCandidates('URL'), ['getURL', 'isURL']); // upper-first(URL) == URL, and getaBc-style noise dropped
    eq(readerNameCandidates('aBc'), ['getaBc', 'isaBc']); // getABc would derive ABc, not aBc
    eq(readerNameCandidates('_x'), ['get_x', 'is_x']);
    eq(readerNameCandidates(''), []);
    eq(readerNameCandidates(5), []); // non-string keys (coerced by the callers) get no naming
  });
});

describe('Bean reader naming: getFoo() reads as the property (JVM-pinned)', () => {
  it('the reader is invoked and its value is the property value', async () => {
    const m = { cust: new Cust() };
    snapshot(await out('${cust.name}', m), 'getter-name');
    snapshot(await out('${cust.URL}', m), 'url-value');
    snapshot(await out('${cust.aBc}', m), 'abc-value');
    snapshot(await out('${cust._x}', m), 'underscore-value');
    snapshot(await out('${cust.label}', m), 'label-value');
    snapshot(await out('${cust["URL"]}', m), 'url-value'); // bracket keys use the same map
  });
  it('only the derived spelling resolves, not the near-misses (JVM-pinned)', async () => {
    const m = { cust: new Cust() };
    snapshot(await out('${cust.uRL!"-"}', m), '-'); // getURL -> URL, never uRL
    snapshot(await out('${cust.ABc!"-"}', m), '-'); // getaBc -> aBc, never ABc
    snapshot(await out('${cust.x!"-"}', m), '-'); // get_x -> _x, never x
    snapshot(await out('${cust.nam!"-"}', m), '-');
    await rejectsMatch(out('${cust.uRL}', m), InvalidPropertyException, ['==> cust.uRL']);
  });
  it('the property is a value, not a callable (JVM-pinned)', async () => {
    const m = { cust: new Cust() };
    snapshot(await out('${cust.name?is_method?c}', m), 'false');
    await rejectsMatch(out('${cust.name()}', m), NonMethodException, ['not a method']);
    await rejectsMatch(out('${cust.name?with_args([])()}', m), NonMethodException,
      ['Expected a macro, function, directive, or method']);
  });
  it('a getter returning undefined reads as missing (JVM: void readers are no readers)', async () => {
    snapshot(await out('${cust.void!"fb"}', { cust: new Cust() }), 'fb');
  });
  it('naming does not depend on the zero-argument policy (JVM: bean properties never do)', async () => {
    const cfg = new Configuration();
    cfg.setZeroArgumentPolicy(ZeroArgumentPolicy.METHOD_ONLY);
    const m = { cust: new Cust() };
    snapshot(await out('${cust.name}', m), 'getter-name');
    snapshot(await out('${cust.name}', m, cfg), 'getter-name');
    snapshot(await out('${cust.name?is_method?c}', m, cfg), 'false');
  });
});

describe('Bean reader naming: which member wins', () => {
  it('a member with the exact name beats the reader (JVM-pinned)', async () => {
    const m = { o: { foo: 'exact-data', getFoo: () => 'from-getFoo' } };
    snapshot(await out('${o.foo}', m), 'exact-data');
    // JVM: class with foo() and getFoo() -> ${bg.foo} is foo() (methodShadowsProperty default).
    const call = { foo: () => 'from-foo', getFoo: () => 'from-getFoo' };
    snapshot(await out('${o.foo}', { o: call }), 'from-foo');
    const cfg = new Configuration();
    cfg.setZeroArgumentPolicy(ZeroArgumentPolicy.METHOD_ONLY);
    await rejectsMatch(out('${o.foo}', { o: call }, cfg), NonStringOrTemplateOutputException,
      ['evaluated to a method']);
  });
  it('a present-but-undefined exact key still wins (port choice; JS data is explicit)', async () => {
    snapshot(await out('${o.foo!"fb"}', { o: { foo: undefined, getFoo: () => 'from-getFoo' } }), 'fb');
  });
  it('JS data plus a getName method: the data wins (upstream merges by name and picks the getter)', async () => {
    // JVM pin: a public field "name" and getName() share one name in the introspection map
    // and the property (getter) beats the field. In JS "name" and "getName" are different
    // members, so there is nothing to merge and the exact member wins.
    class B { constructor() { this.name = 'from-data'; } getName() { return 'from-getName'; } }
    snapshot(await out('${o.name}', { o: new B() }), 'from-data');
  });
  it('getFoo beats isFoo for the same property (JVM-pinned)', async () => {
    snapshot(await out('${cust.both}', { cust: new Cust() }), 'from-getFoo');
  });
  it('the upper-first spelling wins when both getFoo and getfoo exist (port tie-break)', async () => {
    // Upstream has no specified order here (it comes out of BeanInfo ordering); the port
    // always tries getFoo/getfoo before the is-forms, so the conventional name wins.
    snapshot(await out('${o.foo}', { o: { getfoo: () => 'lower', getFoo: () => 'upper' } }), 'upper');
  });
  it('an exact-name member that is not a 0-argument function shadows the inherited reader', async () => {
    class Base { getFoo() { return 'base-reader'; } }
    class Sub extends Base { getFoo(a) { return 'sub-one-arg'; } }
    snapshot(await out('${o.foo!"fb"}', { o: new Sub() }), 'fb');
    snapshot(await out('${o.getFoo(1)}', { o: new Sub() }), 'sub-one-arg');
  });
});

describe('Bean reader naming: reader names stay callable (JVM-pinned carve-out)', () => {
  it('getFoo/isFoo members are methods under AUTO_INVOKE too', async () => {
    const m = { cust: new Cust() };
    snapshot(await out('${cust.getName?is_method?c}', m), 'true');
    snapshot(await out('${cust.isFlag?is_method?c}', m), 'true');
    snapshot(await out('${cust.getLabel()}', m), 'label-value');
    await rejectsMatch(out('${cust.getName}', m), NonStringOrTemplateOutputException,
      ['evaluated to a method']);
  });
  it('and under METHOD_ONLY as well', async () => {
    const cfg = new Configuration();
    cfg.setZeroArgumentPolicy(ZeroArgumentPolicy.METHOD_ONLY);
    const m = { cust: new Cust() };
    snapshot(await out('${cust.getName?is_method?c}', m, cfg), 'true');
    snapshot(await out('${cust.getName()}', m, cfg), 'getter-name');
  });
  it('non-reader 0-argument members keep the AUTO_INVOKE behavior', async () => {
    snapshot(await out('${cust.bare}', { cust: new Cust() }), 'bare-method');
    snapshot(await out('${o.get}', { o: { get: () => 'just-get' } }), 'just-get'); // "get" alone is not a reader name
    snapshot(await out('[${o.is}][${o.get}]', { o: { is: () => 'A', get: () => 'B' } }), '[A][B]');
  });
  it('the carve-out is only for the kinds of model that get the naming (Maps excluded)', async () => {
    const m = new Map([['getFoo', () => 'map-getter']]);
    snapshot(await out('${m.getFoo}', { m }), 'map-getter'); // AUTO_INVOKE still applies to Map values
    snapshot(await out('${m.foo!"fb"}', { m }), 'fb');
  });
});

describe('Bean reader naming: which model kinds', () => {
  it('class instances and plain objects both get it', async () => {
    snapshot(await out('${o.foo}', { o: { getFoo: () => 'plain-reader' } }), 'plain-reader');
    class Bean { getFoo() { return 'class-reader'; } }
    snapshot(await out('${o.foo}', { o: new Bean() }), 'class-reader');
  });
  it('inherited (prototype-chain) readers work (JVM-pinned: superclass readers too)', async () => {
    class Base { getInherited() { return 'inherited-value'; } fromBase() { return 'base-value'; } }
    class Sub extends Base { isBool() { return true; } }
    const m = { o: new Sub() };
    snapshot(await out('${o.inherited}', m), 'inherited-value');
    snapshot(await out('${o.bool?c}', m), 'true');
    snapshot(await out('${o.fromBase}', m), 'base-value');
  });
  it('Maps are exact-key only (JVM-pinned: MapModel has no bean naming)', async () => {
    const m = new Map([['getFoo', () => 'map-reader'], ['plain', 'plain-value']]);
    snapshot(await out('${m.foo!"fb"}', { m }), 'fb');
    snapshot(await out('${m.plain}', { m }), 'plain-value');
  });
  it('a duck bean implements its own keys; no naming is injected', async () => {
    class Duck {
      get(k) { return k === 'x' ? 'duck-x' : null; }
      keys() { return ['x']; }
      values() { return ['duck-x']; }
      getY() { return 'duck-y'; } // a reader-looking member, but the duck decides its own keys
    }
    const m = { d: new Duck() };
    snapshot(await out('${d.x}', m), 'duck-x');
    snapshot(await out('${d.y!"fb"}', m), 'fb');
    snapshot(await out('${d?keys?join(",")}', m), 'x');
  });
  it('the data-model root gets it too (root identifiers read the root hash)', async () => {
    class Root { constructor() { this.top = 'field-top'; } getFoo() { return 'root-reader'; } }
    snapshot(await out('${foo}', new Root()), 'root-reader');
    snapshot(await out('${getFoo()}', new Root()), 'root-reader');
    snapshot(await out('${foo?is_method?c}', new Root()), 'false');
    snapshot(await out('${top}', new Root()), 'field-top');
    await rejectsMatch(out('${foo()}', new Root()), NonMethodException, ['not a method']);
  });
});

describe('Bean reader naming: edges and non-readers', () => {
  it('isFoo() is a reader whatever it returns (upstream wants a boolean return; deviation)', async () => {
    snapshot(await out('${o.ready}', { o: { isReady() { return 'yes'; } } }), 'yes');
    snapshot(await out('${o.flag?c}', { o: { isFlag: () => false } }), 'false');
  });
  it('one-argument readers are not readers (JVM-pinned)', async () => {
    snapshot(await out('${o.one!"fb"}', { o: { getOne: (a) => 'one:' + a } }), 'fb');
    snapshot(await out('${o.getOne(2)}', { o: { getOne: (a) => 'one:' + a } }), 'one:2');
  });
  it('a rest-parameter getter counts as zero-argument (JS has no varargs arity)', async () => {
    // JVM-pinned: getRest(String...) is a 1-parameter method, so ${b.rest} is missing there.
    snapshot(await out('${o.rest}', { o: { getRest: (...a) => 'rest:' + a.length } }), 'rest:0');
  });
  it('a non-function member under a reader name is not a reader', async () => {
    snapshot(await out('${o.foo!"fb"}', { o: { getFoo: 'just-a-string' } }), 'fb');
  });
  it('async readers are awaited in async mode, refused in sync mode', async () => {
    const m = { o: { getSlow: async () => 'slow-value' } };
    snapshot(await out('${o.slow}', m), 'slow-value');
    throwsMatch(() => new Template('t.ftl', '${o.slow}', new Configuration()).processToStringSync(m),
      AsyncOperationNotAllowedException, ['read-only call "getSlow"']);
  });
  it('the reader sees the object as this', async () => {
    class Bean {
      constructor() { this.base = 'base'; }
      getFull() { return this.base + '-full'; }
    }
    snapshot(await out('${o.full}', { o: new Bean() }), 'base-full');
  });
  it('?keys/?size/?values keep the data-key view (upstream lists bean properties there)', async () => {
    const m = { cust: new Cust() };
    snapshot(await out('${cust?keys?join(",")}', m), 'plain');
    snapshot(await out('${cust?size}', m), '1');
    snapshot(await out('${cust?has_content?c}', m), 'true');
  });
});
