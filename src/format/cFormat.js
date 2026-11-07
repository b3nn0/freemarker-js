// <- freemarker.core.CTemplateNumberFormat + JavaCFormat/StringUtil.javaStringEnc:
// the ?c / ?cn number and string literal formats (2.3.32+ C format).

/**
 * C/Java literal escaping of a string, quoted (-> StringUtil.javaStringEnc).
 * @param {string} s @returns {string}
 */
export function cStringLiteral(s) {
  let out = '"';
  for (const ch of s) {
    switch (ch) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\b': out += '\\b'; break;
      case '\t': out += '\\t'; break;
      case '\n': out += '\\n'; break;
      case '\f': out += '\\f'; break;
      case '\r': out += '\\r'; break;
      default: {
        const c = ch.codePointAt(0);
        if (c < 0x20 || c === 0x7f) out += `\\u${c.toString(16).padStart(4, '0')}`;
        else out += ch;
      }
    }
  }
  return `${out}"`;
}

/**
 * The ?c number rendering <- CTemplateNumberFormat.formatToPlainText (double
 * branch; the port only has JS doubles).
 * @param {number} n @returns {string}
 */
export function cNumberFormat(n) {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Number.POSITIVE_INFINITY) return 'Infinity';
  if (n === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (Number.isInteger(n)) {
    if (Math.abs(n) <= Number.MAX_SAFE_INTEGER) return String(n);
    // falls through to exponential form (upperstream "1E20" style)
    return exponentialC(n);
  }
  const absN = Math.abs(n);
  if (absN < 1e-3 && absN > 1e-7) return trimNumber(n);
  if (absN >= 1e7) return trimNumber(n);
  return trimNumber(n);
}

/**
 * @param {number} n @returns {string} exponential form without a "+" sign and
 *   without a redundant ".0" (matches Java's "1E20" / "1E-8" style)
 */
function exponentialC(n) {
  return n.toExponential().replace('e+', 'E').replace('e', 'E').replace('.0E', 'E');
}

/**
 * Plain (non-exponential) form where JS already provides one; otherwise
 * exponential. Java's Double.toString and JS String(n) agree on the shortest
 * round-trip representation; only the exponent syntax differs.
 * @param {number} n @returns {string}
 */
function trimNumber(n) {
  let s = String(n);
  if (s.includes('e') || s.includes('E')) {
    s = n.toExponential().replace('e+', 'E').replace('e', 'E').replace('.0E', 'E');
  }
  return s;
}
