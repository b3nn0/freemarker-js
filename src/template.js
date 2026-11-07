// Template: parse once, render many.

import { Parser } from './parser/parser.js';
import { Configuration } from './configuration.js';
import { Environment } from './environment.js';
import { StringWriter } from './io/writer.js';
import { runSync, runAsync } from './async.js';

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
    this.ftlHeader = parser.headerElement;
    // <- the template keeps the format/auto-escape state the parser ended with
    this.outputFormat = parser.outputFormat;
    this.autoEscaping = parser.autoEscaping;
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
    await this.processAsync(model, { ...options, out: w });
    return w.getAsString();
  }

  /**
   * Sync string render (see process() for the sync-mode caveat).
   * @param {Object|import('./model/templateModel.js').TemplateModel|null} [model]
   * @param {{ includeResolver?: Function }} [options]
   * @returns {string}
   */
  processToStringSync(model = null, options = {}) {
    const w = new StringWriter();
    this.process(model, { ...options, out: w });
    return w.getAsString();
  }

  /**
   * Creates an Environment for this template without rendering.
   * @param {Object|import('./model/templateModel.js').TemplateModel|null} [model]
   * @param {{ out?: import('./io/writer.js').StringWriter, includeResolver?: Function }} [options]
   * @returns {Environment}
   */
  createEnvironment(model = null, options = {}) {
    return new Environment(this.rootElement, this, {
      out: options.out ?? new StringWriter(),
      dataModel: model,
      includeResolver: options.includeResolver,
    });
  }

  /**
   * Sync render into options.out. Async data/callbacks make it throw
   * AsyncOperationNotAllowedException; use processToString for async data.
   * @param {Object|import('./model/templateModel.js').TemplateModel|null} [model]
   * @param {{ out?: import('./io/writer.js').StringWriter, includeResolver?: Function }} [options]
   * @returns {void}
   */
  process(model = null, options = {}) {
    runSync(this.createEnvironment(model, options).process());
  }

  /**
   * Async-capable render into options.out (<- deviation from upstream, which is
   * sync; the generator core pumps through runAsync, see async.js).
   * @param {Object|import('./model/templateModel.js').TemplateModel|null} [model]
   * @param {{ out?: import('./io/writer.js').StringWriter, includeResolver?: Function }} [options]
   * @returns {Promise<void>}
   */
  async processAsync(model = null, options = {}) {
    await runAsync(this.createEnvironment(model, options).process());
  }

  /** @returns {string} canonical source of the root element */
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
