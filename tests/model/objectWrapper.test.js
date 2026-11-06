import { describe, it, eq, ok } from '../harness.js';
import { SimpleObjectWrapper } from '../../src/model/objectWrapper.js';
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

describe('ObjectWrapper: collections', () => {
  it('arrays become sequences with lazy wrapping', () => {
    const s = w.wrap([1, 'two', null]);
    ok(s instanceof SequenceModel);
    eq(s.size(), 3);
    eq(s.getByIndex(0).getAsNumber(), 1);
    eq(s.getByIndex(1).getAsString(), 'two');
    eq(s.getByIndex(2), null); // null element reads as missing
    eq(s.getByIndex(3), null); // out of range
    eq(s.getByIndex(-1), null);
  });
  it('Maps become hashes keyed by string', () => {
    const h = w.wrap(new Map([['a', 1], ['b', 'x']]));
    ok(h instanceof HashModel);
    eq(h.get('a').getAsNumber(), 1);
    eq(h.get('b').getAsString(), 'x');
    eq(h.get('zz'), null);
    eq(h.keys(), ['a', 'b']);
    eq(h.size(), 2);
  });
  it('plain objects become hashes; prototype members stay hidden', () => {
    const h = w.wrap({ n: 7, s: 'x' });
    eq(h.get('n').getAsNumber(), 7);
    eq(h.get('toString'), null);
    eq(h.get('hasOwnProperty'), null);
    eq(h.keys(), ['n', 's']);
    eq(h.size(), 2);
  });
  it('nested structures wrap lazily on access', () => {
    const s = w.wrap([{ v: 1 }, { v: 2 }]);
    const h = s.getByIndex(1);
    ok(h instanceof HashModel);
    eq(h.get('v').getAsNumber(), 2);
  });
});
