// <#compress> ... </#compress> ← CompressedBlock + StandardCompress writer (string-level port).

import { TemplateElement } from '../templateElement.js';
import { StringWriter } from '../../../io/writer.js';

const AT_BEGINNING = 0;
const INIT = 1;
const SAW_CR = 2;
const LINEBREAK_CR = 3;
const LINEBREAK_CRLF = 4;
const LINEBREAK_LF = 5;

function isWs(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

/**
 * ← StandardCompress.StandardCompressWriter: each consecutive whitespace run
 * becomes a single line break (if it contains one) or a single space;
 * leading/trailing whitespace is removed.
 * @param {string} s
 * @param {boolean} [singleLine] - always compress to a space instead of a line break
 * @returns {string}
 */
export function standardCompress(s, singleLine = false) {
  let out = '';
  let inWhitespace = true; // leading whitespace removed
  let lbState = AT_BEGINNING;
  const writeLineBreakOrSpace = () => {
    switch (lbState) {
      case SAW_CR: // whitespace ended with CR
      case LINEBREAK_CR:
        out += '\r';
        break;
      case LINEBREAK_CRLF:
        out += '\r';
        out += '\n';
        break;
      case LINEBREAK_LF:
        out += '\n';
        break;
      case AT_BEGINNING:
        break; // ignore leading whitespace
      default: // INIT / SINGLE_LINE
        out += ' ';
    }
    lbState = singleLine ? 6 /* SINGLE_LINE */ : INIT;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (isWs(c)) {
      inWhitespace = true;
      if (lbState === INIT) {
        if (c === '\r') lbState = SAW_CR;
        else if (c === '\n') lbState = LINEBREAK_LF;
      } else if (lbState === SAW_CR) {
        lbState = c === '\n' ? LINEBREAK_CRLF : LINEBREAK_CR;
      }
    } else if (inWhitespace) {
      inWhitespace = false;
      writeLineBreakOrSpace();
      out += c;
    } else {
      out += c;
    }
  }
  return out; // pending trailing whitespace is dropped (no line-break write at close)
}

export class CompressedBlock extends TemplateElement {
  /**
   * @param {import('../templateElement.js').TemplateElement[]} children - block contents
   */
  constructor(children) {
    super();
    for (const c of children) this.addChild(c);
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  execute(env) {
    const w = new StringWriter();
    const savedOut = env.output;
    env.output = w;
    try {
      for (const c of this.children) env.visit(c);
    } finally {
      env.output = savedOut;
    }
    env.output.write(standardCompress(w.getAsString()));
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `<#compress>${this.children.map((c) => c.getCanonicalForm()).join('')}</#compress>`;
  }
}
