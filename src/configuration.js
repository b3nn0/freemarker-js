// Settings object mirroring upstream Configuration names/defaults (behavior lands with milestones).

import { VERSION } from './version.js';
import { SimpleObjectWrapper } from './model/objectWrapper.js';

export class Configuration {
  static VERSION = VERSION;

  // ← Configuration.java exact values:
  static AUTO_DETECT_TAG_SYNTAX = 0;
  static ANGLE_BRACKET_TAG_SYNTAX = 1;
  static SQUARE_BRACKET_TAG_SYNTAX = 2;
  static DOLLAR_INTERPOLATION_SYNTAX = 21;
  static SQUARE_BRACKET_INTERPOLATION_SYNTAX = 22;
  static AUTO_DETECT_NAMING_CONVENTION = 10;
  static LEGACY_NAMING_CONVENTION = 11;
  static CAMEL_CASE_NAMING_CONVENTION = 12;

  constructor(version = VERSION) {
    this.version = version;
    this._tagSyntax = Configuration.ANGLE_BRACKET_TAG_SYNTAX;
    // Upstream default is LEGACY (${} + #{}); #{} is out of scope, so default is DOLLAR.
    this._interpolationSyntax = Configuration.DOLLAR_INTERPOLATION_SYNTAX;
    this._namingConvention = Configuration.AUTO_DETECT_NAMING_CONVENTION;
    this._whitespaceStripping = true;
    this._outputFormat = null;
    this._numberFormat = null;
    this._dateFormat = null;
    this._tabSize = 8;
    this._objectWrapper = new SimpleObjectWrapper();
  }

  setObjectWrapper(w) { this._objectWrapper = w; }
  getObjectWrapper() { return this._objectWrapper; }

  setTabSize(size) {
    if (size < 1 || size > 256) throw new RangeError(`tabSize must be 1..256, but it was ${size}.`);
    this._tabSize = size;
  }

  getTabSize() { return this._tabSize; }

  setTagSyntax(v) { this._tagSyntax = v; }
  getTagSyntax() { return this._tagSyntax; }

  setInterpolationSyntax(v) { this._interpolationSyntax = v; }
  getInterpolationSyntax() { return this._interpolationSyntax; }

  setNamingConvention(v) { this._namingConvention = v; }
  getNamingConvention() { return this._namingConvention; }

  setWhitespaceStripping(v) { this._whitespaceStripping = !!v; }
  getWhitespaceStripping() { return this._whitespaceStripping; }

  setOutputFormat(name) { this._outputFormat = name; }
  getOutputFormat() { return this._outputFormat; }

  setNumberFormat(f) { this._numberFormat = f; }
  getNumberFormat() { return this._numberFormat; }

  setDateFormat(f) { this._dateFormat = f; }
  getDateFormat() { return this._dateFormat; }
}
