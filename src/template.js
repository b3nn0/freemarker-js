// Template: parse once, render many.

import { Parser } from './parser/parser.js';
import { Configuration } from './configuration.js';
import { Environment } from './environment.js';
import { StringWriter } from './io/writer.js';

/**
 * A parsed template: parse once, render many times.
 */
export class Template {
  /**
   * Parses the source eagerly; parse errors (ParseException) are thrown here.
   * @param {string|null} name - template name for messages/stack traces
   * @param {string} source
   * @param {import('./configuration.js').Configuration} [configuration]
   */
  constructor(name, source, configuration) {
    if (typeof source !== 'string') throw new TypeError('Template source must be a string');
    this.name = name ?? null;
    this.source = source;
    this.configuration = configuration ?? new Configuration();
    this.rootElement = this._parse();
  }

  /**
   * Runs the parser; keeps the declared macros for namespace seeding.
   * @returns {Object} the root element
   */
  _parse() {
    const parser = new Parser(this.source, this.configuration, this.name);
    const root = parser.parse();
    this.macros = parser.macros;
    if (root.beginLine === -1) {
      const { line, column } = endPosition(this.source);
      root.setLocation(this.name, 1, 1, line, column);
    }
    return root;
  }

  /**
   * Renders into a string (convenience over process()).
   * @param {Object|import('./model/templateModel.js').TemplateModel|null} [model]
   * @param {{ includeResolver?: Function }} [options]
   * @returns {Promise<string>}
   */
  async processToString(model = null, options = {}) {
    const w = new StringWriter();
    await this.process(model, { ...options, out: w });
    return w.getAsString();
  }

  /**
   * Renders into options.out (a StringWriter when omitted).
   * @param {Object|import('./model/templateModel.js').TemplateModel|null} [model]
   * @param {{ out?: import('./io/writer.js').StringWriter, includeResolver?: Function }} [options]
   * @returns {Promise<void>}
   */
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

/**
 * 1-based position after the last char; CR / LF / CRLF are each one line break.
 * @param {string} source
 * @returns {{ line: number, column: number }}
 */
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
