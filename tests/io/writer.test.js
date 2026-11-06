// StringWriter / Writer-sink basics (src/io/writer.js ← java.io.Writer/StringWriter).
import { describe, it, eq, snapshot } from '../harness.js';
import { StringWriter } from '../../src/index.js';

describe('StringWriter', () => {
  it('collects all written chunks', () => {
    const w = new StringWriter();
    w.write('a');
    w.write('bc');
    w.write('');
    snapshot(w.getAsString(), 'abc');
  });

  it('close is safe and idempotent', () => {
    const w = new StringWriter();
    w.write('x');
    w.close();
    w.close();
    snapshot(w.getAsString(), 'x');
  });
});
