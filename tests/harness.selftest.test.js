// Harness self-test: verifies the runner itself works.
import { describe, it, eq, ok, snapshot, throwsMatch, rejectsMatch } from './harness.js';

describe('harness', () => {
  it('eq compares primitives and deep structures', () => {
    eq(1, 1);
    eq('a', 'a');
    eq([1, [2]], [1, [2]]);
    eq({ a: { b: 1 } }, { a: { b: 1 } });
  });

  it('eq fails on mismatch', () => {
    throwsMatch(() => eq(1, 2), Error, ['expected 2', 'got 1']);
  });

  it('ok', () => {
    ok(true);
    throwsMatch(() => ok(false, 'boom'), Error, ['boom']);
  });

  it('snapshot', () => {
    snapshot('x\ny', 'x\ny');
    throwsMatch(() => snapshot('a', 'b'), Error, ['expected "b"', 'got "a"']);
  });

  it('throwsMatch checks class and message substrings', () => {
    class MyError extends Error {}
    const e = throwsMatch(() => { throw new MyError('bad thing'); }, MyError, ['bad']);
    eq(e.message, 'bad thing');
    throwsMatch(() => throwsMatch(() => { throw new Error('x'); }, MyError), Error, ['instanceof MyError']);
    throwsMatch(() => throwsMatch(() => {}, Error), Error, ['nothing was']);
  });

  it('rejectsMatch', async () => {
    class MyError extends Error {}
    await rejectsMatch(Promise.reject(new MyError('nope')), MyError, ['nope']);
    try {
      await rejectsMatch(Promise.resolve(1), Error);
      throw new Error('rejectsMatch should have failed on a resolved promise');
    } catch (e) {
      ok(e.message.includes('resolved'), 'wrong rejection message: ' + e.message);
    }
  });
});
