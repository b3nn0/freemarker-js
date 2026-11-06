// Settings object mirroring upstream Configuration names/defaults (behavior lands with milestones).

import { VERSION } from './version.js';
import { SimpleObjectWrapper } from './model/objectWrapper.js';
import { ZeroArgumentNonVoidMethodPolicy } from './model/policy.js';
import { UndefinedOutputFormat, getStandardOutputFormat } from './outputFormat.js';

/**
 * Settings object mirroring upstream `freemarker.core.Configuration` names/defaults;
 * behavior lands milestone by milestone.
 */
export class Configuration {
  /** Baseline version constant (never branched on). */
  static VERSION = VERSION;

  // ← Configuration.java exact values:
  /** @type {number} ← Configurable.AUTO_DETECT_TAG_SYNTAX */
  static AUTO_DETECT_TAG_SYNTAX = 0;
  /** @type {number} ← Configurable.ANGLE_BRACKET_TAG_SYNTAX */
  static ANGLE_BRACKET_TAG_SYNTAX = 1;
  /** @type {number} ← Configurable.SQUARE_BRACKET_TAG_SYNTAX */
  static SQUARE_BRACKET_TAG_SYNTAX = 2;
  /** @type {number} ← Configurable.LEGACY_INTERPOLATION_SYNTAX */
  static LEGACY_INTERPOLATION_SYNTAX = 20;
  /** @type {number} ← Configurable.DOLLAR_INTERPOLATION_SYNTAX */
  static DOLLAR_INTERPOLATION_SYNTAX = 21;
  /** @type {number} ← Configurable.SQUARE_BRACKET_INTERPOLATION_SYNTAX */
  static SQUARE_BRACKET_INTERPOLATION_SYNTAX = 22;
  /** @type {number} ← Configurable.AUTO_DETECT_NAMING_CONVENTION */
  static AUTO_DETECT_NAMING_CONVENTION = 10;
  /** @type {number} ← Configurable.LEGACY_NAMING_CONVENTION */
  static LEGACY_NAMING_CONVENTION = 11;
  /** @type {number} ← Configurable.CAMEL_CASE_NAMING_CONVENTION */
  static CAMEL_CASE_NAMING_CONVENTION = 12;

  /**
   * @param {string} [version] - kept for API parity; behavior never branches on it
   */
  constructor(version = VERSION) {
    this.version = version;
    this._tagSyntax = Configuration.ANGLE_BRACKET_TAG_SYNTAX;
    // ← Configuration.java:573 — 2.3.x default is LEGACY (${} and #{}).
    this._interpolationSyntax = Configuration.LEGACY_INTERPOLATION_SYNTAX;
    this._namingConvention = Configuration.AUTO_DETECT_NAMING_CONVENTION;
    this._whitespaceStripping = true;
    // ← Configuration.java:566-567 defaults
    this._autoEscapingPolicy = Configuration.ENABLE_IF_DEFAULT_AUTO_ESCAPING_POLICY;
    this._outputFormat = UndefinedOutputFormat.INSTANCE;
    // ← Configurable format defaults (en_US locale fixed; see UPSTREAM.md):
    this._numberFormat = 'number';
    this._booleanFormat = 'true,false';
    this._cFormat = 'c';
    this._dateFormat = 'M/d/yy';
    this._timeFormat = 'H:mm:ss';
    this._dateTimeFormat = 'M/d/yy H:mm:ss';
    this._locale = null;
    this._timeZone = null; // accepted but inert (browser-local times)
    this._outputEncoding = null; // inert in the browser
    this._urlEscapingCharset = null; // inert: ?url is always UTF-8
    this._classicCompatible = false;
    this._tabSize = 8;
    this._objectWrapper = new SimpleObjectWrapper();
    // ← ClassIntrospectorBuilder defaults at baseline 2.3.36:
    this._defaultZeroArgumentNonVoidMethodPolicy = ZeroArgumentNonVoidMethodPolicy.METHOD_ONLY;
    this._recordZeroArgumentNonVoidMethodPolicy
      = ZeroArgumentNonVoidMethodPolicy.BOTH_METHOD_AND_PROPERTY_UNLESS_BEAN_PROPERTY_READ_METHOD;
    this._includeResolver = null;
    this._templateCache = new Map(); // referenced-template parse cache ← TemplateCache
  }

  /**
   * @param {string} p - a ZeroArgumentNonVoidMethodPolicy constant
   * @throws {TypeError} on an unknown constant
   */
  setDefaultZeroArgumentNonVoidMethodPolicy(p) {
    this._assertPolicy(p);
    this._defaultZeroArgumentNonVoidMethodPolicy = p;
  }
  /** @returns {string} a ZeroArgumentNonVoidMethodPolicy constant */
  getDefaultZeroArgumentNonVoidMethodPolicy() {
    return this._defaultZeroArgumentNonVoidMethodPolicy;
  }
  /**
   * @param {string} p - a ZeroArgumentNonVoidMethodPolicy constant
   * @throws {TypeError} on an unknown constant
   */
  setRecordZeroArgumentNonVoidMethodPolicy(p) {
    this._assertPolicy(p);
    this._recordZeroArgumentNonVoidMethodPolicy = p;
  }
  /** @returns {string} a ZeroArgumentNonVoidMethodPolicy constant */
  getRecordZeroArgumentNonVoidMethodPolicy() {
    return this._recordZeroArgumentNonVoidMethodPolicy;
  }
  /** @param {string} p - policy constant @throws {BugException} */
  _assertPolicy(p) {
    if (!Object.values(ZeroArgumentNonVoidMethodPolicy).includes(p)) {
      throw new TypeError(`Invalid ZeroArgumentNonVoidMethodPolicy: ${String(p)}`);
    }
  }

  /** @param {import('./model/objectWrapper.js').SimpleObjectWrapper} w */
  setObjectWrapper(w) { this._objectWrapper = w; }
  getObjectWrapper() { return this._objectWrapper; }

  /**
   * @param {number} size - column width used for tab position calculations
   * @throws {RangeError} outside 1..256
   */
  setTabSize(size) {
    if (size < 1 || size > 256) throw new RangeError(`tabSize must be 1..256, but it was ${size}.`);
    this._tabSize = size;
  }

  /** @returns {number} 1..256 (default 8) */
  getTabSize() { return this._tabSize; }

  setTagSyntax(v) { this._tagSyntax = v; }
  getTagSyntax() { return this._tagSyntax; }

  setInterpolationSyntax(v) { this._interpolationSyntax = v; }
  getInterpolationSyntax() { return this._interpolationSyntax; }

  setNamingConvention(v) { this._namingConvention = v; }
  getNamingConvention() { return this._namingConvention; }

  setWhitespaceStripping(v) { this._whitespaceStripping = !!v; }

  /**
   * Sets the sync source resolver used by #include/#import. ← Configuration.setTemplateLoader
   * (a function of name -> source string in this port; see UPSTREAM.md).
   * @param {((name: string) => string)|null} fn
   * @returns {void}
   */
  setIncludeResolver(fn) { this._includeResolver = fn ?? null; }

  /** @returns {((name: string) => string)|null} */
  getIncludeResolver() { return this._includeResolver; }
  getWhitespaceStripping() { return this._whitespaceStripping; }

  setOutputFormat(name) { this._outputFormat = getStandardOutputFormat(String(name)); }
  getOutputFormat() { return this._outputFormat; }

  // ← Configuration auto-escaping policy constants (strings instead of ints;
  // see UPSTREAM.md). "force" is not supported by this port.
  /** @type {string} ← Configurable.DISABLE_AUTO_ESCAPING_POLICY */
  static DISABLE_AUTO_ESCAPING_POLICY = 'disable';
  /** @type {string} ← Configurable.ENABLE_IF_DEFAULT_AUTO_ESCAPING_POLICY */
  static ENABLE_IF_DEFAULT_AUTO_ESCAPING_POLICY = 'enableIfDefault';
  /** @type {string} ← Configurable.ENABLE_IF_SUPPORTED_AUTO_ESCAPING_POLICY */
  static ENABLE_IF_SUPPORTED_AUTO_ESCAPING_POLICY = 'enableIfSupported';
  /** @type {string} ← Configurable.FORCE_AUTO_ESCAPING_POLICY */
  static FORCE_AUTO_ESCAPING_POLICY = 'force'; // recognized, never settable via #ftl=false cases

  /**
   * @param {string} p - one of the *_AUTO_ESCAPING_POLICY constants
   * @throws {TypeError} on an unknown constant
   */
  setAutoEscapingPolicy(p) {
    const ok = [
      Configuration.DISABLE_AUTO_ESCAPING_POLICY,
      Configuration.ENABLE_IF_DEFAULT_AUTO_ESCAPING_POLICY,
      Configuration.ENABLE_IF_SUPPORTED_AUTO_ESCAPING_POLICY,
      Configuration.FORCE_AUTO_ESCAPING_POLICY,
    ];
    if (!ok.includes(p)) throw new TypeError(`Invalid autoEscapingPolicy: ${String(p)}`);
    this._autoEscapingPolicy = p;
  }

  /** @returns {string} a *_AUTO_ESCAPING_POLICY constant */
  getAutoEscapingPolicy() { return this._autoEscapingPolicy; }

  setNumberFormat(f) { this._numberFormat = String(f); }
  getNumberFormat() { return this._numberFormat; }

  setDateFormat(f) { this._dateFormat = String(f); }
  getDateFormat() { return this._dateFormat; }

  setTimeFormat(f) { this._timeFormat = String(f); }
  getTimeFormat() { return this._timeFormat; }

  setDateTimeFormat(f) { this._dateTimeFormat = String(f); }
  getDateTimeFormat() { return this._dateTimeFormat; }

  setBooleanFormat(f) { this._booleanFormat = String(f); }
  getBooleanFormat() { return this._booleanFormat; }

  setCFormat(f) { this._cFormat = String(f); }
  getCFormat() { return this._cFormat; }

  setLocale(l) { this._locale = l == null ? null : String(l); }
  getLocale() { return this._locale; }
}
