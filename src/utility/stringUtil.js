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
