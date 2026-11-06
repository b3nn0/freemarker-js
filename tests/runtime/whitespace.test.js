// Whitespace stripping + #t/#lt/#rt/#nt + #compress + stripText (M13).
// Expected values ported from upstream WhitespaceStrippingTest.java and
// templatesuite/whitespace-trim.ftl/.txt.

import { describe, it, eq } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';

function render(source, cfg = new Configuration()) {
  return new Template('t.ftl', source, cfg).processToString();
}

describe('runtime: whitespace stripping (upstream WhitespaceStrippingTest)', () => {
  it('assign-surrounded whitespace-only lines are removed', async () => {
    eq(await render('<#assign x = 1>\n<#assign y = 2>\n${x}\n${y}'), '1\n2');
    eq(await render(' <#assign x = 1> \n <#assign y = 2> \n${x}\n${y}'), '1\n2');
  });

  it('FTL header eats the following newline, not a no-newline whitespace run', async () => {
    eq(await render('<#ftl>x'), 'x');
    eq(await render('  <#ftl>  x'), '  x');
    eq(await render('\n<#ftl>\nx'), 'x');
    eq(await render('\n<#ftl>\t \nx'), 'x');
    eq(await render('  \n \n  <#ftl> \n \n  x'), ' \n  x');
  });

  it('comment-surrounded stripping (incl. the quirky 2.3 compat cases)', async () => {
    eq(await render(' a <#-- --> b '), ' a  b ');
    eq(await render(' a \n<#-- -->\n b '), ' a \n b ');
    eq(await render(' a \n <#-- --> \n b '), ' a \n  b ');
    eq(await render(' a \n\t<#-- --> \n b '), ' a \n\t b ');
  });

  it('interpolations heed whitespace: no stripping next to them', async () => {
    eq(await render('${1}\n${2}'), '1\n2');
    eq(await render('<#if true>\nfoo\n</#if>'), 'foo\n');
  });

  it('strip_whitespace=false disables the auto stripping', async () => {
    const cfg = new Configuration();
    cfg.setWhitespaceStripping(false);
    eq(await render('<#assign x=1>\n<#assign y=2>\n${x}', cfg), '\n\n1');
    eq(await render('<#ftl strip_whitespace=false><#assign x=1>\na'), '\na');
  });

  it('whitespaceStripping=false config is honored', async () => {
    const cfg = new Configuration();
    cfg.setWhitespaceStripping(false);
    eq(await render('  a  ', cfg), '  a  ');
    eq(await render('  a<#lt>\n  b', cfg), 'a\n  b'); // deliberate trims still apply
  });
});

describe('runtime: trim directives', () => {
  it('#lt trims the left side of its line', async () => {
    eq(await render('  LB<#lt>\n  LB<#lt>\n\tLB<#lt>\nLB<#lt>\n'), 'LB\nLB\nLB\nLB\n');
  });

  it('#rt trims the right side of its line', async () => {
    eq(await render('  IC1<#rt>\n  IC2<#rt>\nC1<#rt>\nC2<#rt>\n'), '  IC1  IC2C1C2');
  });

  it('#t trims both sides', async () => {
    eq(await render('  CS2 <#t>\n  C3<#t>\n  C1<#t>\nC2\n'), 'CS2 C3C1C2\n');
  });

  it('#nt prevents the automatic stripping on that line', async () => {
    eq(await render('a  <#nt>\n  b'), 'a  \n  b');
    eq(await render('  a<#nt>\n  b'), '  a\n  b');
  });
});

describe('runtime: trim with macros (whitespace-trim suite)', () => {
  const TPL = '<#macro x t>${t}</#macro>'
    + '${""}<@x t="LB"/><#lt>\n  <@x t="LB"/><#lt>${""}\n\t<@x t="LB"/><#lt>${""}\n'
    + '<@x t="LB"/><#lt>${""}\n  <@x t="IB"/>${""}\n';
  it('macro-call trim lines', async () => {
    eq(await render(TPL), 'LB\nLB\nLB\nLB\n  IB\n');
  });
});

describe('runtime: #compress', () => {
  it('collapses whitespace runs; keeps one line break per run', async () => {
    eq(await render('<#compress>\n  a   b\n    c\n</#compress>'), 'a b\nc');
  });

  it('compresses the merged output stream, not per text node', async () => {
    eq(await render('<#compress>a  b<#if true>c   d</#if>e  f</#compress>'), 'a bc de f');
  });

  it('leading and trailing whitespace inside the block is removed', async () => {
    eq(await render('<#compress>   x   </#compress>'), 'x');
  });

  it('CRLF runs are kept as CRLF', async () => {
    eq(await render('<#compress>a\r\n  \r\nb</#compress>'), 'a\r\nb');
  });
});

describe('runtime: strip_text', () => {
  it('#ftl strip_text=true removes all top-level static text', async () => {
    eq(await render('<#ftl strip_text=true>a\n  b${1}'), '1');
  });

  it('strip_text does not reach inside blocks', async () => {
    eq(await render('<#ftl strip_text=true><#if true>a b</#if>'), 'a b');
  });
});
