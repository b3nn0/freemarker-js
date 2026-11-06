// Static-text pass-through: TextBlock.execute → env output.
// Intent ported from freemarker/core/TextBlock.java accept() + Template.process(model, writer).
import { describe, it, snapshot, eq } from '../harness.js';
import { Configuration, Template } from '../../src/index.js';

const cfg = new Configuration(Configuration.VERSION);

async function out(source) {
  return new Template('t', source, cfg).processToString({});
}

describe('TextBlock pass-through', () => {
  it('plain text passes through untouched', async () => {
    snapshot(await out('Hello World'), 'Hello World');
  });

  it('empty template outputs empty string', async () => {
    snapshot(await out(''), '');
  });

  it('newlines (CRLF / CR / LF) preserved as-is', async () => {
    snapshot(await out('a\r\nb\rc\nd'), 'a\r\nb\rc\nd');
  });

  it('unicode + special chars preserved', async () => {
    snapshot(await out('Ünïcödé — $ < [ # { end'), 'Ünïcödé — $ < [ # { end');
  });

  it('model may be omitted', async () => {
    snapshot(await new Template('t', 'x', cfg).processToString(), 'x');
  });

  it('process(model, { out }) writes through the given writer', async () => {
    const chunks = [];
    let closed = 0;
    await new Template('t', 'ab\ncd', cfg).process({}, {
      out: { write: (c) => chunks.push(c), close: () => closed++ },
    });
    eq(chunks.join(''), 'ab\ncd');
    eq(closed, 0); // like Java process(): doesn't close the caller's writer
  });

  it('getCanonicalForm reproduces static text', () => {
    eq(new Template('t', 'Hello\r\nWorld', cfg).getCanonicalForm(), 'Hello\r\nWorld');
  });
});
