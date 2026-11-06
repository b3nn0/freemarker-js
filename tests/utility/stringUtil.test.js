// Canonical-form string escaping, mirroring StringUtil.ftlQuote/ESCAPES and
// _CoreStringUtils.backslashEscapeIdentifier.

import { describe, it, eq } from '../harness.js';
import { backslashEscapeIdentifier, ftlQuote, unescapeFTLStringLiteral } from '../../src/utility/stringUtil.js';

describe('stringUtil: identifier escaping', () => {
  it('plain names untouched', () => {
    eq(backslashEscapeIdentifier('a_b1'), 'a_b1');
  });
  it('escapes - . : # with backslashes', () => {
    eq(backslashEscapeIdentifier('a-b'), 'a\\-b');
    eq(backslashEscapeIdentifier('a.b:c#d'), 'a\\.b\\:c\\#d');
  });
});

describe('stringUtil: ftlQuote', () => {
  it('simple string', () => {
    eq(ftlQuote('abc'), '"abc"');
  });
  it('contains double quote but not single: use single quotes', () => {
    eq(ftlQuote('a"b'), "'a\"b'");
  });
  it('contains both quote chars: escape inner double quotes', () => {
    eq(ftlQuote('it\'s "x"'), "\"it's \\\"x\\\"\"");
  });
  it('escapes control chars with names or hex', () => {
    eq(ftlQuote('a\nb'), '"a\\nb"');
    eq(ftlQuote('a\tb\rc'), '"a\\tb\\rc"');
    eq(ftlQuote('\x01'), '"\\x0001"');
  });
  it('escapes backslash', () => {
    eq(ftlQuote('a\\b'), '"a\\\\b"');
  });
  it('markup chars are escaped as l g a', () => {
    eq(ftlQuote('a<b>c&d'), '"a\\lb\\gc\\ad"');
  });
  it('brace after $ or # is escaped', () => {
    eq(ftlQuote('${'), "\"$\\{\"");
    eq(ftlQuote('a{b'), '"a{b"');
  });
  it('= after [ is escaped', () => {
    eq(ftlQuote('[='), '"[\\="');
    eq(ftlQuote('a=b'), '"a=b"');
  });
});

describe('stringUtil: unescapeFTLStringLiteral', () => {
  it('named escapes', () => {
    eq(unescapeFTLStringLiteral('a\\nb\\tc\\rd\\fe\\bf\\g\\l\\ah'), 'a\nb\tc\rd\fe\bf><&h');
  });
  it('backslash and quotes', () => {
    eq(unescapeFTLStringLiteral('\\\\a\\"b\\\'c'), '\\a"b\'c');
  });
  it('hex escape', () => {
    eq(unescapeFTLStringLiteral('\\x41\\x01'), 'A\x01');
  });
  it('escaped brace and equals', () => {
    eq(unescapeFTLStringLiteral('$\\{\\='), '${=');
  });
  it('unknown escape throws', () => {
    let threw = false;
    try { unescapeFTLStringLiteral('a\\qb'); } catch { threw = true; }
    eq(threw, true);
  });
});
