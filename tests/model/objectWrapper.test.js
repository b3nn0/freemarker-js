import { describe, it, eq, ok, throwsMatch } from '../harness.js';
import { SimpleObjectWrapper } from '../../src/model/objectWrapper.js';
import { runSync, runAsync } from '../../src/async.js';
import { AsyncOperationNotAllowedException } from '../../src/errors.js';
import {
  StringModel, NumberModel, BooleanModel, DateModel, SequenceModel, HashModel, MethodModel,
} from '../../src/model/models.js';

const w = new SimpleObjectWrapper();

describe('ObjectWrapper: primitives', () => {
  it('wraps strings', () => {
    const m = w.wrap('hi');
    ok(m instanceof StringModel);
    eq(m.getAsString(), 'hi');
  });
  it('wraps numbers', () => {
    const m = w.wrap(3.5);
    ok(m instanceof NumberModel);
    eq(m.getAsNumber(), 3.5);
  });
  it('wraps booleans as shared constants', () => {
    eq(w.wrap(true), BooleanModel.TRUE);
    eq(w.wrap(false), BooleanModel.FALSE);
    eq(w.wrap(true).getAsBoolean(), true);
  });
  it('null/undefined wrap to null (missing)', () => {
    eq(w.wrap(null), null);
    eq(w.wrap(undefined), null);
  });
  it('TemplateModels pass through unwrapped', () => {
    const s = w.wrap('a');
    eq(w.wrap(s), s);
  });
  it('wraps Dates', () => {
    const d = new Date(Date.UTC(2020, 0, 2, 10, 30));
    const m = w.wrap(d);
    ok(m instanceof DateModel);
    eq(m.getAsDate().getTime(), d.getTime());
  });
  it('wraps functions as methods (invoke lands in M5)', () => {
    ok(w.wrap(() => 1) instanceof MethodModel);
  });
});

// Drain a sync-only model-protocol generator (see src/async.js).
const gv = (g) => {
  const r = g.next();
  if (!r.done) throw new Error('unexpected async step in sync drain');
  return r.value;
};

describe('ObjectWrapper: collections', () => {
  it('arrays become sequences with lazy wrapping', () => {
    const s = w.wrap([1, 'two', null]);
    ok(s instanceof SequenceModel);
    eq(s.size(), 3);
    eq(gv(s.getByIndex(0)).getAsNumber(), 1);
    eq(gv(s.getByIndex(1)).getAsString(), 'two');
    eq(gv(s.getByIndex(2)), null); // null element reads as missing
    eq(gv(s.getByIndex(3)), null); // out of range
    eq(gv(s.getByIndex(-1)), null);
  });
  it('Maps become hashes keyed by string', () => {
    const h = w.wrap(new Map([['a', 1], ['b', 'x']]));
    ok(h instanceof HashModel);
    eq(gv(h.get('a')).getAsNumber(), 1);
    eq(gv(h.get('b')).getAsString(), 'x');
    eq(gv(h.get('zz')), null);
    eq(h.keys(), ['a', 'b']);
    eq(h.size(), 2);
  });
  it('plain objects become hashes; prototype members stay hidden', () => {
    const h = w.wrap({ n: 7, s: 'x' });
    eq(gv(h.get('n')).getAsNumber(), 7);
    eq(gv(h.get('toString')), null);
    eq(gv(h.get('hasOwnProperty')), null);
    eq(h.keys(), ['n', 's']);
    eq(h.size(), 2);
  });
  it('same object wraps to the same model (identity cache)', () => {
    const o = { a: 1 };
    eq(w.wrap(o), w.wrap(o));
    const arr = [1];
    eq(w.wrap(arr), w.wrap(arr));
  });
  it('nested structures wrap lazily on access', () => {
    const s = w.wrap([{ v: 1 }, { v: 2 }]);
    const h = gv(s.getByIndex(1));
    ok(h instanceof HashModel);
    eq(gv(h.get('v')).getAsNumber(), 2);
  });
  it('promise elements are awaited in async mode, rejected in sync mode', async () => {
    const s = w.wrap([Promise.resolve('late'), 'now']);
    eq((await runAsync(s.getByIndex(0))).getAsString(), 'late');
    eq(gv(s.getByIndex(1)).getAsString(), 'now');
    throwsMatch(() => runSync(s.getByIndex(0)), AsyncOperationNotAllowedException,
      ['sequence element at index 0']);
    const h = w.wrap({ k: Promise.resolve(5) });
    eq((await runAsync(h.get('k'))).getAsNumber(), 5);
    throwsMatch(() => runSync(h.get('k')), AsyncOperationNotAllowedException, ['data-model key "k"']);
  });
});
