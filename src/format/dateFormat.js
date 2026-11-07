// Date/time formatting <- Environment.getTemplateDateFormat + ISOLikeTemplateDateFormat
// + JavaTemplateDateFormatFactory (SimpleDateFormat subset) (2.3.36).
// Locale and time zone handling are not ported (browser-local times; see UPSTREAM.md).

import { InvalidFormatStringException } from '../errors.js';

/** <- TemplateDateModel date types. @type {{ NONE: number, DATE: number, TIME: number, DATE_TIME: number, FULL: number }} */
export const DATE_TYPES = { NONE: 0, DATE: 1, TIME: 2, DATE_TIME: 3, FULL: 4 };

/**
 * @param {string} name - a format string
 * @returns {boolean} true when it starts with the "iso" prefix
 */
export function isIsoDateFormat(name) {
  return name.length >= 3 && name.slice(0, 3) === 'iso';
}

/**
 * Formats a date with an "iso" format string. Modifier tokens (each preceded by
 * "_" or " ", any order): utc / local (zone shift), fz / nz (show/hide offset),
 * h / m / s (accuracy), ms (accepted, rendered like s; fraction unsupported).
 * <- ISOLikeTemplateDateFormat.
 * @param {Date} d
 * @param {string} formatString
 * @param {number} dateType - one of DATE_TYPES
 * @param {number|null} [tzOffsetMinutes] - explicit zone shift; null = follow the token
 * @returns {string}
 */
export function formatIsoDate(d, formatString, dateType, tzOffsetMinutes = null) {
  const bad = () => new InvalidFormatStringException(
    `Unsupported ISO date format modifier in "${formatString}".`);
  if (!isIsoDateFormat(formatString)) {
    throw bad();
  }
  let accuracy = 's'; // h | m | s (ms renders like s; fractional seconds unsupported)
  let showOffset = dateType === DATE_TYPES.DATE_TIME;
  let zone = null; // 'utc' | 'local'
  let i = 3;
  while (i < formatString.length) {
    const sep = formatString[i];
    if (sep !== '_' && sep !== ' ') throw bad();
    i++;
    if (formatString.startsWith('utc', i) || formatString.startsWith('local', i)) {
      zone = formatString.startsWith('utc', i) ? 'utc' : 'local';
      i += zone.length;
    } else {
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
  }
  let view = d;
  let offMin = null; // rendered zone offset, in minutes
  if (tzOffsetMinutes !== null) {
    offMin = tzOffsetMinutes;
    view = shiftedDate(d, tzOffsetMinutes);
  } else if (zone === 'utc') {
    offMin = 0;
    view = shiftedDate(d, 0);
  } else if (zone === 'local') {
    showOffset = false;
  }
  if (zone === 'utc' || tzOffsetMinutes !== null) showOffset = true;
  if (showOffset && offMin === null) offMin = -view.getTimezoneOffset();
  const y = pad(view.getFullYear(), 4);
  const mo = pad(view.getMonth() + 1, 2);
  const day = pad(view.getDate(), 2);
  if (dateType === DATE_TYPES.DATE) {
    return `${y}-${mo}-${day}${showOffset && offMin !== null ? offsetString(offMin) : ''}`;
  }
  let t = `${pad(view.getHours(), 2)}:${pad(view.getMinutes(), 2)}`;
  if (accuracy === 's') t += `:${pad(view.getSeconds(), 2)}`;
  if (dateType === DATE_TYPES.TIME) {
    return t + (showOffset && offMin !== null ? offsetString(offMin) : '');
  }
  const off = showOffset && offMin !== null ? offsetString(offMin)
    : showOffset ? zoneOffsetString(view) : '';
  return `${y}-${mo}-${day}T${t}${off}`;
}

/**
 * Re-bases the wall-clock fields of d as if displayed in a zone whose offset
 * (minutes) is targetMin; the current local offset of d is the baseline.
 * @param {Date} d
 * @param {number} targetMin
 * @returns {Date}
 */
function shiftedDate(d, targetMin) {
  return new Date(d.getTime() + (targetMin + d.getTimezoneOffset()) * 60000);
}

/**
 * @param {number} off - minutes east of UTC
 * @returns {string}
 */
function offsetString(off) {
  if (off === 0) return 'Z';
  const sign = off > 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
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

/** @type {string[]} */
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
  for (const seg of compiledPattern(pattern)) {
    out += seg.field !== undefined ? formatField(seg.field, seg.width, d) : seg.text;
  }
  return out;
}

// Pattern -> pre-split segments, cached (IMPROVEMENTS C1); formatField
// errors ("Unsupported letter ...") still surface at format time.
/** @type {Map<string, Array<Object>>} */
const PATTERN_CACHE = new Map();
const PATTERN_CACHE_LIMIT = 512;

/**
 * Splits a pattern into literal / field-run segments.
 * @param {string} pattern
 * @returns {Array<{ text?: string, field?: string, width?: number }>}
 */
function parseJavaDatePattern(pattern) {
  const segs = [];
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '\'') {
      i++;
      if (pattern[i] === '\'') { segs.push({ text: '\'' }); i++; continue; }
      while (i < pattern.length && pattern[i] !== '\'') {
        segs.push({ text: pattern[i] }); i++;
      }
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
      segs.push({ field: c, width: j - i });
      i = j;
      continue;
    }
    segs.push({ text: c });
    i++;
  }
  return segs;
}

/**
 * @param {string} pattern
 * @returns {Array<Object>} cached segment list
 */
function compiledPattern(pattern) {
  let segs = PATTERN_CACHE.get(pattern);
  if (segs === undefined) {
    segs = parseJavaDatePattern(pattern);
    if (PATTERN_CACHE.size >= PATTERN_CACHE_LIMIT) PATTERN_CACHE.delete(PATTERN_CACHE.keys().next().value);
    PATTERN_CACHE.set(pattern, segs);
  }
  return segs;
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
    case 'z': return width >= 4 ? 'Greenwich Mean Time' : 'GMT';
    default:
      throw new InvalidFormatStringException(
        `Unsupported letter "${c}" in date format pattern; `
        + 'the port supports the subset y M d H h m s E a S z.');
  }
}

/** @type {string[]} */
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** @type {string[]} */
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
 * Named format-style names -> en_US CLDR patterns (JDK 17 output).
 * <- getNamedTemplateFormatString. @type {Object<string, Object<number, string>>}
 */
export const NAMED_DATE_STYLES = {
  default: { [DATE_TYPES.DATE]: 'MMM d, yyyy', [DATE_TYPES.TIME]: 'h:mm:ss a',
    [DATE_TYPES.DATE_TIME]: 'MMM d, yyyy, h:mm:ss a', [DATE_TYPES.FULL]: 'MMM d, yyyy, h:mm:ss a' },
  short: { [DATE_TYPES.DATE]: 'M/d/yy', [DATE_TYPES.TIME]: 'h:mm a',
    [DATE_TYPES.DATE_TIME]: 'M/d/yy, h:mm a', [DATE_TYPES.FULL]: 'M/d/yy, h:mm a' },
  medium: { [DATE_TYPES.DATE]: 'MMM d, yyyy', [DATE_TYPES.TIME]: 'h:mm:ss a',
    [DATE_TYPES.DATE_TIME]: 'MMM d, yyyy, h:mm:ss a', [DATE_TYPES.FULL]: 'MMM d, yyyy, h:mm:ss a' },
  long: { [DATE_TYPES.DATE]: 'MMMM d, yyyy', [DATE_TYPES.TIME]: 'h:mm:ss a z',
    [DATE_TYPES.DATE_TIME]: "MMMM d, yyyy 'at' h:mm:ss a z", [DATE_TYPES.FULL]: "MMMM d, yyyy 'at' h:mm:ss a z" },
  full: { [DATE_TYPES.DATE]: 'EEEE, MMMM d, yyyy', [DATE_TYPES.TIME]: 'h:mm:ss a zzzz',
    [DATE_TYPES.DATE_TIME]: 'EEEE, MMMM d, yyyy \'at\' h:mm:ss a zzzz',
    [DATE_TYPES.FULL]: 'EEEE, MMMM d, yyyy \'at\' h:mm:ss a zzzz' },
};

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isNamedDateStyle(name) {
  return Object.prototype.hasOwnProperty.call(NAMED_DATE_STYLES, name);
}

/**
 * Formats a date model value: resolves "iso"-prefixed and pattern formats,
 * choosing date_format/time_format/datetime_format when formatString is null.
 * <- Environment.formatDateFormatModel.
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
  if (isNamedDateStyle(fmt)) {
    fmt = NAMED_DATE_STYLES[fmt][dateType] || NAMED_DATE_STYLES[fmt][DATE_TYPES.DATE_TIME];
  }
  if (isIsoDateFormat(fmt)) {
    return formatIsoDate(d, fmt, dateType);
  }
  return formatJavaDate(d, fmt, dateType);
}
