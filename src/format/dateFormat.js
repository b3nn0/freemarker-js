// Date/time formatting ← Environment.getTemplateDateFormat + ISOLikeTemplateDateFormat
// + JavaTemplateDateFormatFactory (SimpleDateFormat subset) (2.3.36).
// Locale and time zone handling are not ported (browser-local times; see UPSTREAM.md).

import { InvalidFormatStringException } from '../errors.js';

export const DATE_TYPES = { NONE: 0, DATE: 1, TIME: 2, DATE_TIME: 3, FULL: 4 };

/**
 * @param {string} name - a format string
 * @returns {boolean} true when it starts with the "iso" prefix
 */
export function isIsoDateFormat(name) {
  return name.length >= 3 && name.slice(0, 3) === 'iso';
}

/**
 * Formats a date with an "iso" format string. Supported modifier suffixes:
 * _h, _m, _s (accuracy), _ms, _nz (hide zone offset), _fz (force zone offset).
 * Other upstream modifiers (utc, zoneless variants) are unsupported (deviation).
 * @param {Date} d
 * @param {string} formatString
 * @param {number} dateType - one of DATE_TYPES
 * @returns {string}
 */
export function formatIsoDate(d, formatString, dateType) {
  const bad = () => new InvalidFormatStringException(
    `Unsupported ISO date format modifier in "${formatString}" `
    + '(the port supports "iso" with the modifiers _h, _m, _s, _ms, _nz, _fz).');
  if (!isIsoDateFormat(formatString)) {
    throw bad();
  }
  let accuracy = 's'; // h | m | s (ms renders like s; fractional seconds unsupported)
  let showOffset = dateType === DATE_TYPES.DATE_TIME ? true : false;
  let i = 3;
  while (i < formatString.length) {
    const sep = formatString[i];
    if (sep !== '_' && sep !== ' ') throw bad();
    i++;
    const tok = formatString.slice(i).slice(0, 2);
    if (tok === 'ms' || tok === 'nz' || tok === 'fz') {
      if (tok === 'nz') showOffset = false;
      else if (tok === 'fz') showOffset = true;
      i += 2;
    } else if (tok[0] === 'h' || tok[0] === 'm' || tok[0] === 's') {
      accuracy = tok[0];
      i += 1;
    } else {
      throw bad();
    }
  }
  const y = pad(d.getFullYear(), 4);
  const mo = pad(d.getMonth() + 1, 2);
  const day = pad(d.getDate(), 2);
  if (dateType === DATE_TYPES.DATE) return `${y}-${mo}-${day}`;
  let t = `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
  if (accuracy !== 'h') t += `:${pad(d.getSeconds(), 2)}`;
  if (dateType === DATE_TYPES.TIME) return t;
  const off = showOffset ? zoneOffsetString(d) : '';
  return `${y}-${mo}-${day}T${t}${off}`;
}

/**
 * @param {Date} d
 * @returns {string} ISO zone offset like "+01:00" / "Z" (UTC input)
 */
function zoneOffsetString(d) {
  const off = -d.getTimezoneOffset();
  if (off === 0) return 'Z';
  const sign = off > 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Formats a date with a SimpleDateFormat-pattern subset:
 * y/yy/yyy/yyyy, M/MM, d/dd, H/HH, h/hh, m/mm, s/ss, E/EE/EEE/EEEE, a, S, 'literal'.
 * @param {Date} d
 * @param {string} pattern
 * @param {number} [_dateType] - unused; kept for signature parity
 * @returns {string}
 */
export function formatJavaDate(d, pattern, _dateType) {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '\'') {
      i++;
      if (pattern[i] === '\'') { out += '\''; i++; continue; }
      while (i < pattern.length && pattern[i] !== '\'') { out += pattern[i]; i++; }
      if (i === pattern.length) {
        throw new InvalidFormatStringException(
          `Unterminated quoted literal in date format pattern: ${JSON.stringify(pattern)}`);
      }
      i++; // closing quote
      continue;
    }
    if (isLetter(c)) {
      let j = i;
      while (j < pattern.length && pattern[j] === c) j++;
      out += formatField(c, j - i, d);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * @param {string} c
 * @returns {boolean}
 */
function isLetter(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

/**
 * @param {string} c - the field letter
 * @param {number} width - repetition count
 * @param {Date} d
 * @returns {string}
 */
function formatField(c, width, d) {
  switch (c) {
    case 'y': {
      const y = d.getFullYear();
      if (width === 2) return pad(y % 100, 2);
      return pad(y, width < 4 ? 4 : width);
    }
    case 'M': {
      const m = d.getMonth() + 1;
      if (width >= 3) return monthName(m, width);
      return width === 2 ? pad(m, 2) : String(m);
    }
    case 'd': return width === 2 ? pad(d.getDate(), 2) : String(d.getDate());
    case 'H': return width === 2 ? pad(d.getHours(), 2) : String(d.getHours());
    case 'h': {
      const h = d.getHours() % 12;
      const v = h === 0 ? 12 : h;
      return width === 2 ? pad(v, 2) : String(v);
    }
    case 'm': return width === 2 ? pad(d.getMinutes(), 2) : String(d.getMinutes());
    case 's': return width === 2 ? pad(d.getSeconds(), 2) : String(d.getSeconds());
    case 'S': return pad(d.getMilliseconds(), width);
    case 'E': return width >= 4 ? DAY_NAMES_FULL[d.getDay()] : DAY_NAMES[d.getDay()];
    case 'a': return d.getHours() < 12 ? 'AM' : 'PM';
    default:
      throw new InvalidFormatStringException(
        `Unsupported letter "${c}" in date format pattern; `
        + 'the port supports the subset y M d H h m s E a S.');
  }
}

const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * @param {number} m - 1..12
 * @param {number} width
 * @returns {string}
 */
function monthName(m, width) {
  return width >= 4 ? MONTH_NAMES[m - 1] : MONTH_NAMES[m - 1].slice(0, 3);
}

/**
 * @param {number} v
 * @param {number} width
 * @returns {string}
 */
function pad(v, width) {
  let s = String(v);
  while (s.length < width) s = '0' + s;
  return s;
}

/**
 * Formats a date model value: resolves "iso"-prefixed and pattern formats,
 * choosing date_format/time_format/datetime_format when formatString is null.
 * ← Environment.formatDateFormatModel.
 * @param {Date} d
 * @param {string|null} formatString - explicit format (?string("x"), #{} has none)
 * @param {number} dateType - DATE_TYPES member
 * @param {{ date?: string, time?: string, datetime?: string }} defaults
 * @returns {string}
 */
export function formatDate(d, formatString, dateType, defaults) {
  let fmt = formatString;
  if (fmt === null || fmt === undefined) {
    fmt = dateType === DATE_TYPES.DATE ? defaults.date
      : dateType === DATE_TYPES.TIME ? defaults.time
        : defaults.datetime;
  }
  if (isIsoDateFormat(fmt)) {
    return formatIsoDate(d, fmt, dateType);
  }
  return formatJavaDate(d, fmt, dateType);
}
