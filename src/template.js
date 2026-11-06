// Template: parse once, render many.

import { Parser } from './parser/parser.js';
import { Configuration } from './configuration.js';
import { Environment } from './environment.js';
import { StringWriter } from './io/writer.js';

export class Template {
  constructor(name, source, configuration) {
    if (typeof source !== 'string') throw new TypeError('Template source must be a string');
    this.name = name ?? null;
    this.source = source;
    this.configuration = configuration ?? new Configuration();
    this.rootElement = this._parse();
  }

  _parse() {
    const root = new Parser(this.source, this.configuration, this.name).parse();
    const { line, column } = endPosition(this.source);
    root.setLocation(this.name, 1, 1, line, column);
    return root;
  }

  async processToString(model = null, options = {}) {
    const w = new StringWriter();
    await this.process(model, { ...options, out: w });
    return w.getAsString();
  }

  async process(model = null, options = {}) {
    const env = new Environment(this.rootElement, this, {
      out: options.out ?? new StringWriter(),
      dataModel: model,
      includeResolver: options.includeResolver,
    });
    env.process();
    // Sync core; Promise only at the API edge (upstream parity: process is sync, API is async).
  }

  getCanonicalForm() {
    return this.rootElement.getCanonicalForm();
  }
}

// 1-based position after the last char; CR / LF / CRLF are each one line break.
function endPosition(source) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\r') {
      if (source[i + 1] === '\n') i++;
      line++;
      column = 1;
    } else if (c === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
