// Interpolation-syntax matrix (token-level port of InterpolationSyntaxTest concepts):
// which opening forms start an interpolation, and what happens to the disabled forms.

import { describe, it, eq } from '../harness.js';
import { TokenManager } from '../../src/parser/tokenManager.js';
import { TT } from '../../src/parser/tokenType.js';
import { Configuration } from '../../src/configuration.js';

function openings(source, interpolationSyntax) {
  const cfg = new Configuration();
  cfg.setInterpolationSyntax(interpolationSyntax);
  const tm = new TokenManager(source, cfg);
  const out = [];
  for (;;) {
    const t = tm.nextToken();
    out.push(`${t.type.name}[${t.image}]`);
    if (t.type === TT.EOF) return out;
  }
}

const D = Configuration.DOLLAR_INTERPOLATION_SYNTAX;
const S = Configuration.SQUARE_BRACKET_INTERPOLATION_SYNTAX;
const L = Configuration.LEGACY_INTERPOLATION_SYNTAX;

describe('lexer: interpolation syntax matrix', () => {
  it('DOLLAR: ${ starts it', () => {
    eq(openings('${a}', D), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[a]', 'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
  });

  it('DOLLAR: [= and #{ stay static text', () => {
    eq(openings('[=a]#{a}', D), [
      'STATIC_TEXT_NON_WS[[=]', 'STATIC_TEXT_NON_WS[a]]', 'STATIC_TEXT_NON_WS[#{]',
      'STATIC_TEXT_NON_WS[a}]', 'EOF[]',
    ]);
  });

  it('SQUARE: [= starts it', () => {
    eq(openings('[=a]', S), [
      'SQUARE_BRACKET_INTERPOLATION_OPENING[[=]', 'ID[a]', 'CLOSE_BRACKET[]]', 'EOF[]',
    ]);
  });

  it('SQUARE: ${ and #{ stay static text', () => {
    eq(openings('${a}#{a}', S), [
      'STATIC_TEXT_NON_WS[${]', 'STATIC_TEXT_NON_WS[a}]', 'STATIC_TEXT_NON_WS[#{]',
      'STATIC_TEXT_NON_WS[a}]', 'EOF[]',
    ]);
  });

  it('hash interpolation starts an interpolation only under LEGACY syntax', () => {
    for (const syntax of [D, S]) {
      const t = openings('#{a}', syntax);
      eq(t[0], 'STATIC_TEXT_NON_WS[#{]');
    }
    eq(openings('#{a}', L)[0], 'HASH_INTERPOLATION_OPENING[#{]');
  });

  it('LEGACY: ${ and #{ both start interpolations; [= stays static text', () => {
    eq(openings('${a}#{b}', L), [
      'DOLLAR_INTERPOLATION_OPENING[${]', 'ID[a]', 'CLOSING_CURLY_BRACKET[}]',
      'HASH_INTERPOLATION_OPENING[#{]', 'ID[b]', 'CLOSING_CURLY_BRACKET[}]', 'EOF[]',
    ]);
    eq(openings('[=a]', L), [
      'STATIC_TEXT_NON_WS[[=]', 'STATIC_TEXT_NON_WS[a]]', 'EOF[]',
    ]);
  });

  it('disabled openings merge into one static-text run', () => {
    eq(openings('a[=b]c', D), [
      'STATIC_TEXT_NON_WS[a]', 'STATIC_TEXT_NON_WS[[=]', 'STATIC_TEXT_NON_WS[b]c]', 'EOF[]',
    ]);
  });
});
