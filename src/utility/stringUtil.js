// Canonical-form helpers mirrored from upstream StringUtil / _CoreStringUtils.

// ← StringUtil.isBackslashEscapedFTLIdentifierCharacter
/**
 * @param {string} c - a single character
 * @returns {boolean} whether backslash-escaping identifiers applies to it
 */
export function isBackslashEscapedFTLIdentifierChar(c) {
  return c === '-' || c === '.' || c === ':' || c === '#';
}

// ← _CoreStringUtils.backslashEscapeIdentifier
/**
 * @param {string} name
 * @returns {string} the identifier with backslash escapes where required
 */
export function backslashEscapeIdentifier(name) {
  let out = null;
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (isBackslashEscapedFTLIdentifierChar(c)) {
      if (out === null) out = name.slice(0, i);
      out += '\\';
    }
    if (out !== null) out += c;
  }
  return out === null ? name : out;
}

// ← StringUtil.createEscapes
const ESCAPES = (() => {
  const e = new Array(0x5c + 1).fill(0);
  for (let i = 0; i < 32; i++) e[i] = 1; // hex-escaped control chars
  e['\\'.charCodeAt(0)] = '\\';
  e["'".charCodeAt(0)] = '\'';
  e['"'.charCodeAt(0)] = '"';
  e['<'.charCodeAt(0)] = 'l';
  e['>'.charCodeAt(0)] = 'g';
  e['&'.charCodeAt(0)] = 'a';
  e['\b'.charCodeAt(0)] = 'b';
  e['\t'.charCodeAt(0)] = 't';
  e['\n'.charCodeAt(0)] = 'n';
  e['\f'.charCodeAt(0)] = 'f';
  e['\r'.charCodeAt(0)] = 'r';
  return e;
})();

function isInterpolationStart(c) {
  return c === '$' || c === '#';
}

// ← StringUtil.ftlQuote + FTLStringLiteralEnc(s, q, true)
/**
 * @param {string} s - arbitrary string
 * @returns {string} it as a safe FTL string literal (upstream escaping table)
 */
export function ftlQuote(s) {
  const quotation = s.indexOf('"') !== -1 && s.indexOf('\'') === -1 ? '\'' : '"';
  const otherQuotation = quotation === '"' ? '\'' : '"';
  let buf = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = c.charCodeAt(0);
    let escape;
    if (c === '=') {
      escape = i > 0 && s[i - 1] === '[' ? '=' : 0;
    } else if (code < ESCAPES.length) {
      escape = ESCAPES[code];
    } else if (c === '{' && i > 0 && isInterpolationStart(s[i - 1])) {
      escape = '{';
    } else {
      escape = 0;
    }
    if (escape === 0 || escape === otherQuotation) {
      if (buf !== null) buf += c;
    } else {
      if (buf === null) buf = quotation + s.slice(0, i);
      if (escape === 1) {
        const hi = (code >> 4) & 0x0f;
        const lo = code & 0x0f;
        buf += '\\x00' + (hi < 10 ? hi : String.fromCharCode(hi - 10 + 'A'.charCodeAt(0)))
          + (lo < 10 ? lo : String.fromCharCode(lo - 10 + 'A'.charCodeAt(0)));
      } else {
        buf += '\\' + escape;
      }
    }
  }
  return buf === null ? quotation + s + quotation : buf + quotation;
}

// ← FTL.jj <ESCAPED_CHAR> decoding (grammar: n t r f b g l a \\ ' " { = xHH)
/**
 * Decodes an FTL string literal body (escape sequences per the grammar's ESCAPED_CHAR).
 * @param {string} body
 * @returns {string}
 * @throws {Error} on an unknown or malformed escape
 */
export function unescapeFTLStringLiteral(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = body[++i];
    switch (e) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'f': out += '\f'; break;
      case 'b': out += '\b'; break;
      case 'g': out += '>'; break;
      case 'l': out += '<'; break;
      case 'a': out += '&'; break;
      case '\\': out += '\\'; break;
      case '\'': out += '\''; break;
      case '"': out += '"'; break;
      case '{': out += '{'; break;
      case '=': out += '='; break;
      case 'x': {
        const isHex = c2 => (c2 >= '0' && c2 <= '9') || (c2 >= 'a' && c2 <= 'f') || (c2 >= 'A' && c2 <= 'F');
        const h1 = body[i + 1], h2 = body[i + 2];
        if (!isHex(h1) || !isHex(h2)) {
          throw new Error(`Invalid hex escape "\\x${String(h1) ?? ''}${String(h2) ?? ''}" in string literal.`);
        }
        out += String.fromCharCode(parseInt(h1 + h2, 16));
        i += 2;
        break;
      }
      default:
        throw new Error(`Unknown escape sequence "\\${e}" in string literal.`);
    }
  }
  return out;
}

/**
 * ← StringUtil.isTrimmableToEmpty: true when every char in [from, to) is
 * whitespace per Java's String.trim() rule (c <= ' ').
 * @param {string} s
 * @param {number} [from]
 * @param {number} [to]
 * @returns {boolean}
 */
export function isTrimmableToEmpty(s, from = 0, to = s.length) {
  for (let i = from; i < to; i++) {
    if (s[i] > ' ') return false;
  }
  return true;
}

const HEX_DIGITS = '0123456789ABCDEF';

/**
 * @param {string} s
 * @returns {string} StringUtil.XMLEnc(s) equivalent
 */
export function xmlEnc(s) {
  return escapeChars(s, false);
}

/**
 * @param {string} s
 * @returns {string} StringUtil.XHTMLEnc(s) equivalent (also escapes the apostrophe)
 */
export function xhtmlEnc(s) {
  return escapeChars(s, true);
}

/**
 * @param {string} s
 * @param {boolean} escApos - escape the apostrophe too (XHTML mode)
 * @returns {string}
 */
function escapeChars(s, escApos) {
  let sb = null;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    let esc = null;
    if (c === '<') esc = '&lt;';
    else if (c === '>') esc = '&gt;';
    else if (c === '&') esc = '&amp;';
    else if (c === '"') esc = '&quot;';
    else if (c === '\'' && escApos) esc = '&#39;';
    if (esc === null) continue;
    sb = sb === null ? s.slice(0, i) : sb + s.slice(last, i);
    sb += esc;
    last = i + 1;
  }
  return sb === null ? s : sb + s.slice(last);
}

// StringUtil.URLEnc(s): safe chars pass, space becomes '+', everything else is
// percent-encoded UTF-8 octets. (Charset fixed to UTF-8 — deviation.)
/**
 * @param {string} s
 * @param {boolean} [keepSlash] - URLPathEnc variant: '/' stays unescaped
 * @returns {string}
 */
export function urlEnc(s, keepSlash = false) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (safeInUrl(c, keepSlash)) {
      out += ch;
    } else if (ch === ' ') {
      out += '+';
    } else {
      for (const b of utf8Bytes(c)) out += `%${HEX_DIGITS[b >> 4]}${HEX_DIGITS[b & 0xF]}`;
    }
  }
  return out;
}

/**
 * @param {number} c - code point
 * @param {boolean} keepSlash
 * @returns {boolean} StringUtil.safeInURL equivalent
 */
function safeInUrl(c, keepSlash) {
  return c >= 97 && c <= 122 || c >= 65 && c <= 90 || c >= 48 && c <= 57
    || c === 95 || c === 45 || c === 46 || c === 33 || c === 126
    || c >= 39 && c <= 42
    || keepSlash && c === 47;
}

/**
 * @param {number} cp - code point
 * @returns {number[]} its UTF-8 octets
 */
function utf8Bytes(cp) {
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xC0 | cp >> 6, 0x80 | cp & 0x3F];
  if (cp < 0x10000) return [0xE0 | cp >> 12, 0x80 | cp >> 6 & 0x3F, 0x80 | cp & 0x3F];
  return [0xF0 | cp >> 18, 0x80 | cp >> 12 & 0x3F, 0x80 | cp >> 6 & 0x3F, 0x80 | cp & 0x3F];
}

// StringUtil.jsStringEnc(s, JAVA_SCRIPT|JSON) with quotation=null, per 2.3.32
// rules: backslash escapes for " \ , \/ against "</" at i==0/after '<',
// \> (JS) or \u003E (JSON) against "]]>"/"-->", \u003C against "<!"/"<?",
// hex escapes for control chars and U+2028/2029 (' is only escaped for JS).
/**
 * @param {string} s
 * @param {boolean} json - JSON-compatible escaping (jsonStringEnc)
 * @returns {string}
 */
export function jsStringEnc(s, json) {
  let sb = null;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const cp = c.codePointAt(0);
    let esc = null;
    if (cp <= 0x1F) {
      if (c === '\n') esc = '\\n';
      else if (c === '\r') esc = '\\r';
      else if (c === '\f') esc = '\\f';
      else if (c === '\b') esc = '\\b';
      else if (c === '\t') esc = '\\t';
      else esc = hexEscape(cp, json);
    } else if (c === '"') {
      esc = '\\"';
    } else if (c === '\'') {
      if (!json) esc = '\\\'';
    } else if (c === '\\') {
      esc = '\\\\';
    } else if (c === '/' && (i === 0 || s[i - 1] === '<')) {
      esc = '\\/';
    } else if (c === '>') {
      let dangerous = false;
      if (i === 0) dangerous = true;
      else {
        const prev = s[i - 1];
        if (prev === ']' || prev === '-') {
          dangerous = i === 1 || s[i - 2] === prev;
        }
      }
      if (dangerous) esc = json ? '\\u003E' : '\\>';
    } else if (c === '<') {
      const dangerous = i === s.length - 1 || s[i + 1] === '!' || s[i + 1] === '?';
      if (dangerous) esc = '\\u003C';
    } else if (cp >= 0x7F && cp <= 0x9F || cp === 0x2028 || cp === 0x2029) {
      esc = hexEscape(cp, json);
    }
    if (esc === null) continue;
    sb = sb === null ? s.slice(0, i) : sb + s.slice(last, i);
    sb += esc;
    last = i + 1;
  }
  return sb === null ? s : sb + s.slice(last);
}

/**
 * @param {number} cp - code point (< 0x100 in JS mode)
 * @param {boolean} json
 * @returns {string}
 */
function hexEscape(cp, json) {
  if (!json && cp < 0x100) {
    return `\\x${HEX_DIGITS[cp >> 4]}${HEX_DIGITS[cp & 0xF]}`;
  }
  return `\\u${HEX_DIGITS[cp >> 12 & 0xF]}${HEX_DIGITS[cp >> 8 & 0xF]}${HEX_DIGITS[cp >> 4 & 0xF]}${HEX_DIGITS[cp & 0xF]}`;
}
