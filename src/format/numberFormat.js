// Number formatting <- Environment.getTemplateNumberFormatWithoutCache +
// JavaTemplateNumberFormatFactory (en_US locale fixed, see UPSTREAM.md) +
// CTemplateNumberFormat ("c"/"computer") (2.3.36).

import { Decimal } from './decimal.js';
import { InvalidFormatStringException } from '../errors.js';

/**
 * @typedef {Object} NumberPattern
 * @property {string} prefix - literal text before the number
 * @property {string} suffix - literal text after the number
 * @property {boolean} grouping - thousands grouping (a "," appeared in the integer part)
 * @property {number} minIntDigits - '0' count in the integer part (0 means '#' only)
 * @property {number} minFrac - '0' count in the fraction part
 * @property {number} maxFrac - '0' plus '#' count in the fraction part
 * @property {boolean} percent - multiply by 100 and show '%'
 */

/**
 * Parses the DecimalFormat-pattern subset supported by this port
 * (prefix text, 0/# digits, grouping comma, decimal point, '%' and suffix text).
 * @param {string} pattern
 * @returns {NumberPattern}
 */
export function parseNumberPattern(pattern) {
  const spec = { prefix: '', suffix: '', grouping: false, minIntDigits: 0,
    minFrac: 0, maxFrac: 0, percent: false };
  let i = 0;
  let phase = "prefix";
  while (i < pattern.length) {
    const c = pattern[i];
    if (phase === "prefix") {
      // digit chars fall through to the int phase WITHOUT being consumed:
      // "0.00" needs minIntDigits=1 (DecimalFormat("0.00").format(0) = "0.00")
      if (c === '0' || c === '#') phase = "int";
      else if (c === ',') {
        // <- DecimalFormat: a leading "," is the grouping marker, not prefix text
        spec.grouping = true;
        phase = "int";
        i++;
      } else {
        if (c === '.') throw invalidPattern(pattern);
        spec.prefix += c;
        i++;
      }
    } else if (phase === "int") {
      if (c === '0') { spec.minIntDigits++; i++; }
      else if (c === '#') i++;
      else if (c === ',') { spec.grouping = true; i++; }
      else if (c === '.') { phase = "frac"; i++; }
      else phase = "suffix";
    } else if (phase === "frac") {
      if (c === '0') { spec.minFrac++; spec.maxFrac++; i++; }
      else if (c === '#') { spec.maxFrac++; i++; }
      else phase = "suffix";
    } else { // suffix
      if (c === '%') { spec.percent = true; i++; }
      else { spec.suffix += c; i++; }
    }
  }
  if (spec.minIntDigits === 0 && spec.minFrac === 0 && spec.maxFrac === 0
    && !spec.percent) {
    throw invalidPattern(pattern);
  }
  return spec;
}

/** @param {string} p @returns {import('../errors.js').InvalidFormatStringException} */
function invalidPattern(p) {
  return new InvalidFormatStringException(
    `Invalid number format pattern: ${JSON.stringify(p)}. `
    + 'The pattern must contain 0/# digit characters.');
}

// <- upstream FormatFactory caches Format objects per format string;
// cache custom compiled patterns here instead of re-parsing per output
// (IMPROVEMENTS C1). FIFO eviction above the cap bounds memory.
/** @type {Map<string, NumberPattern>} */
const CUSTOM_CACHE = new Map();
const CACHE_LIMIT = 512;

/**
 * Named format or cached compiled custom pattern.
 * Invalid patterns throw on every call (parse failures are not cached).
 * @param {string} fmt
 * @returns {NumberPattern}
 */
function compiled(fmt) {
  const named = NAMED.get(fmt);
  if (named !== undefined) return named;
  let spec = CUSTOM_CACHE.get(fmt);
  if (spec === undefined) {
    spec = parseNumberPattern(fmt);
    if (CUSTOM_CACHE.size >= CACHE_LIMIT) CUSTOM_CACHE.delete(CUSTOM_CACHE.keys().next().value);
    CUSTOM_CACHE.set(fmt, spec);
  }
  return spec;
}

/** named number formats (en_US symbols). @type {Map<string, Object>} */
const NAMED = new Map([
  // DecimalFormat("#,##0.###") -- the en_US "number" instance
  ['number', { prefix: '', suffix: '', grouping: true, minIntDigits: 1, minFrac: 0, maxFrac: 3, percent: false }],
  // NumberFormat.getCurrencyInstance(Locale.US)
  ['currency', { prefix: '$', suffix: '', grouping: true, minIntDigits: 1, minFrac: 2, maxFrac: 2, percent: false }],
  // NumberFormat.getPercentInstance(Locale.US)
  ['percent', { prefix: '', suffix: '', grouping: true, minIntDigits: 1, minFrac: 0, maxFrac: 3, percent: true }],
]);

// <- CTemplateNumberFormat: the shortest representation that round-trips
// (Java Double/BigDecimal.toString equivalent: JS String()).
/**
 * @param {number} v
 * @returns {string}
 */
export function cFormat(v) {
  if (!Number.isFinite(v)) {
    throw new InvalidFormatStringException(`The number ${String(v)} can't be converted to a string.`);
  }
  return String(v);
}

/**
 * Formats a number with the given format string, or null for the default.
 * <- Environment.formatNumberModel (+ min/max fraction digits from #{}).
 * @param {number} v
 * @param {string|null|undefined} formatString - named ("number", "c"/"computer",
 *   "currency", "percent") or a custom pattern; null/undefined -> "number"
 * @param {{ minFrac?: number, maxFrac?: number }} [fracOpts] - #{exp;mNMM} overrides
 * @returns {string}
 */
export function formatNumber(v, formatString, fracOpts, dec = null) {
  if (!Number.isFinite(v)) {
    throw new InvalidFormatStringException(`The number ${String(v)} can't be converted to a string.`);
  }
  const fmt = formatString === null || formatString === undefined ? 'number' : formatString;
  if (fmt === 'c' || fmt === 'computer') {
    // CTemplateNumberFormat ignores the #{exp;mN} fraction-digit limits (deviation).
    if (dec !== null && dec !== undefined) return dec.toJavaString();
    return cFormat(v);
  }
  const spec = compiled(fmt);
  let minFrac = spec.minFrac;
  let maxFrac = spec.maxFrac;
  if (fracOpts !== undefined && fracOpts !== null) {
    if (fracOpts.minFrac !== undefined) minFrac = fracOpts.minFrac;
    if (fracOpts.maxFrac !== undefined) maxFrac = fracOpts.maxFrac;
  }
  return applyPattern(v, spec, minFrac, maxFrac, dec);
}

/**
 * @param {number} v
 * @param {NumberPattern} spec
 * @param {number} minFrac
 * @param {number} maxFrac
 * @returns {string}
 */
function applyPattern(v, spec, minFrac, maxFrac, dec = null) {
  const neg = v < 0;
  let fixed;
  if (dec !== null && dec !== undefined && Number.isFinite(v)) {
    // <- exact BigDecimal path: setScale(maxFrac, HALF_UP) then plain digits
    let d = dec.signum() < 0 ? dec.neg() : dec;
    if (spec.percent) d = d.mul(Decimal.fromLiteral('100'));
    fixed = d.setScale(maxFrac).toPlainString();
  } else {
    let a = Math.abs(v);
    if (spec.percent) a *= 100;
    fixed = a.toFixed(maxFrac);
  }
  // trim fraction zeros down to minFrac (toFixed gave exactly maxFrac digits)
  if (maxFrac > 0) {
    let end = fixed.length;
    while (end - (fixed.indexOf('.') + 1) > minFrac && fixed[end - 1] === '0') end--;
    if (minFrac === 0 && fixed[end - 1] === '.') end--;
    fixed = fixed.slice(0, end);
  }
  let intPart = fixed;
  let fracPart = '';
  const dot = fixed.indexOf('.');
  if (dot !== -1) {
    intPart = fixed.slice(0, dot);
    fracPart = fixed.slice(dot + 1);
  }
  while (intPart.length < spec.minIntDigits) intPart = '0' + intPart; // "0000": 7 -> "0007"
  if (spec.minIntDigits === 0 && intPart === '0') {
    intPart = ''; // "#" pattern: 0.5 prints ".5"
  }
  if (spec.grouping) intPart = addGrouping(intPart);
  let out = (neg ? '-' : '') + spec.prefix + intPart;
  if (fracPart) out += '.' + fracPart;
  if (spec.percent) out += '%';
  out += spec.suffix;
  return out;
}

/**
 * Inserts thousands separators (no regex).
 * @param {string} digits
 * @returns {string}
 */
function addGrouping(digits) {
  let out = '';
  let count = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    out = digits[i] + out;
    count++;
    if (count % 3 === 0 && i > 0) out = ',' + out;
  }
  return out;
}

/**
 * @param {string} s - a format string
 * @returns {boolean} true when it names one of the built-in formats
 */
export function isNamedNumberFormat(s) {
  return NAMED.has(s) || s === 'c' || s === 'computer';
}