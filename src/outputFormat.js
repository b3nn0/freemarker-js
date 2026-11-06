// Output formats ← freemarker.core.OutputFormat / MarkupOutputFormat /
// UndefinedOutputFormat / PlainTextOutputFormat / HTMLOutputFormat /
// XHTMLOutputFormat / XMLOutputFormat (2.3.36). RTF/CSS/JSON formats and
// CombinedMarkupOutputFormat ("{outer{inner}}") are out of scope (see UPSTREAM.md).

import { xhtmlEnc, xmlEnc } from './utility/stringUtil.js';
import { UnregisteredOutputFormatException } from './errors.js';

/** Base: no escaping capability. ← OutputFormat */
export class OutputFormat {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
  }

  get isMarkup() {
    return false;
  }

  /** ← OutputFormat.isOutputFormatMixingAllowed() = true */
  get isOutputFormatMixingAllowed() {
    return true;
  }

  /**
   * @returns {string} plain text as-is (only valid when this is not a markup format)
   */
  escapePlainText(text) {
    throw new Error(`Can't escape text for output format ${this.name}`);
  }

  toString() {
    return this.name;
  }
}

/** Output format "Undefined": format-agnostic. ← UndefinedOutputFormat */
export class UndefinedOutputFormat extends OutputFormat {
  static INSTANCE = new UndefinedOutputFormat();

  constructor() {
    super('Undefined');
  }
}

/** Output format "PlainText": still not a markup format. ← PlainTextOutputFormat */
export class PlainTextOutputFormat extends OutputFormat {
  static INSTANCE = new PlainTextOutputFormat();

  constructor() {
    super('PlainText');
  }
}

/** Base for escaping formats. ← MarkupOutputFormat */
export class MarkupOutputFormat extends OutputFormat {
  get isMarkup() {
    return true;
  }

  /** ← CommonMarkupOutputFormat.isAutoEscapedByDefault() = true */
  get isAutoEscapedByDefault() {
    return true;
  }

  /** ← CommonMarkupOutputFormat.isOutputFormatMixingAllowed() = false */
  get isOutputFormatMixingAllowed() {
    return false;
  }

  /**
   * @param {string} text
   * @returns {string} the escaped (markup) form
   */
  escapePlainText(text) {
    throw new Error(`Not implemented for ${this.name}`);
  }
}

/** HTML: escapes via StringUtil.XHTMLEnc. ← HTMLOutputFormat */
export class HTMLOutputFormat extends MarkupOutputFormat {
  static INSTANCE = new HTMLOutputFormat();

  constructor() {
    super('HTML');
  }

  /**
   * @param {string} text
   * @returns {string} XHTMLEnc(text)
   */
  escapePlainText(text) {
    return xhtmlEnc(text);
  }

  /**
   * @param {string} builtInName
   * @returns {boolean} html/xml/xhtml built-ins are bypassed for HTML markup values
   */
  isLegacyBuiltInBypassed(builtInName) {
    return builtInName === 'html' || builtInName === 'xml' || builtInName === 'xhtml';
  }
}

/** XHTML: same escaper as HTML. ← XHTMLOutputFormat */
export class XHTMLOutputFormat extends MarkupOutputFormat {
  static INSTANCE = new XHTMLOutputFormat();

  constructor() {
    super('XHTML');
  }

  /**
   * @param {string} text
   * @returns {string} XHTMLEnc(text)
   */
  escapePlainText(text) {
    return xhtmlEnc(text);
  }
}

/** XML: StringUtil.XMLEnc (the apostrophe is not escaped). ← XMLOutputFormat */
export class XMLOutputFormat extends MarkupOutputFormat {
  static INSTANCE = new XMLOutputFormat();

  constructor() {
    super('XML');
  }

  /**
   * @param {string} text
   * @returns {string} XMLEnc(text)
   */
  escapePlainText(text) {
    return xmlEnc(text);
  }
}

// ← Configuration.STANDARD_OUTPUT_FORMATS (the ones this port registers)
const STANDARD_OUTPUT_FORMATS = new Map([
  ['Undefined', UndefinedOutputFormat.INSTANCE],
  ['PlainText', PlainTextOutputFormat.INSTANCE],
  ['HTML', HTMLOutputFormat.INSTANCE],
  ['XHTML', XHTMLOutputFormat.INSTANCE],
  ['XML', XMLOutputFormat.INSTANCE],
]);

/**
 * ← Configuration.getOutputFormat(String): exact name match, then
 * UnregisteredOutputFormatException listing the registered names.
 * @param {string} name
 * @returns {OutputFormat}
 * @throws {import('./errors.js').UnregisteredOutputFormatException}
 */
export function getStandardOutputFormat(name) {
  if (name.length === 0) {
    throw new Error('0-length format name');
  }
  const fmt = STANDARD_OUTPUT_FORMATS.get(name);
  if (fmt === undefined) {
    const names = [...STANDARD_OUTPUT_FORMATS.keys()].sort().join(', ');
    throw new UnregisteredOutputFormatException(
      `Unregistered output format name, "${name}". The output formats registered in the Configuration are: ${names}.`);
  }
  return fmt;
}
