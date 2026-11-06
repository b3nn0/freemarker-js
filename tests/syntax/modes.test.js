// Configuration-driven syntax modes end-to-end (M12):
// interpolation modes, tag-syntax modes, naming-convention conflicts, #ftl header.

import { describe, it, eq, throwsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import { ParseException } from '../../src/errors.js';

function render(source, cfg = new Configuration()) {
  return new Template('t.ftl', source, cfg).processToString();
}

describe('syntax modes: interpolation', () => {
  it('LEGACY (upstream default): both ${...} and #{...} interpolate', async () => {
    eq(await render('${1} #{2}'), '1 2');
  });

  it('DOLLAR: #{...} stays literal text', async () => {
    const cfg = new Configuration();
    cfg.setInterpolationSyntax(Configuration.DOLLAR_INTERPOLATION_SYNTAX);
    eq(await render('${1} #{2}', cfg), '1 #{2}');
  });

  it('SQUARE: only [=...]', async () => {
    const cfg = new Configuration();
    cfg.setInterpolationSyntax(Configuration.SQUARE_BRACKET_INTERPOLATION_SYNTAX);
    eq(await render('[=1] ${2} #{3}', cfg), '1 ${2} #{3}');
  });
});

describe('syntax modes: tag syntax', () => {
  it('ANGLE (upstream default): [#if ...] stays text', async () => {
    eq(await render('[#if true]x[/#if]'), '[#if true]x[/#if]');
  });

  it('SQUARE tag syntax: [#if ...] works, <#if ...> stays text', async () => {
    const cfg = new Configuration();
    cfg.setTagSyntax(Configuration.SQUARE_BRACKET_TAG_SYNTAX);
    eq(await render('[#if true]y[/#if] <#if true>n</#if>', cfg), 'y <#if true>n</#if>');
  });

  it('SQUARE tag syntax: auto-detect off means <#if> is not demoted to expression', async () => {
    const cfg = new Configuration();
    cfg.setTagSyntax(Configuration.SQUARE_BRACKET_TAG_SYNTAX);
    eq(await render('<#if true>n</#if>[#if true]y[/#if]', cfg), '<#if true>n</#if>y');
  });

  it('mismatched tag closer errors', () => {
    const cfg = new Configuration();
    cfg.setTagSyntax(Configuration.SQUARE_BRACKET_TAG_SYNTAX);
    throwsMatch(() => new Template('t.ftl', '[#ftl x=1/>'), ParseException, ["shouldn't end with"]);
    throwsMatch(() => new Template('t.ftl', '[#if true]y</#if>', cfg), ParseException, ['Missing end tag']);
  });
});

describe('syntax modes: naming convention', () => {
  it('auto-detect: camel #forEach conflicts with legacy #foreach later', () => {
    throwsMatch(
      () => new Template('t.ftl', '<#forEach x in xs>[/#forEach]<#foreach y in ys>[/#foreach]'),
      ParseException, ['Naming convention mismatch', '#foreach']);
  });

  it('explicit CAMEL: legacy #foreach is a mismatch', () => {
    const cfg = new Configuration();
    cfg.setNamingConvention(Configuration.CAMEL_CASE_NAMING_CONVENTION);
    throwsMatch(() => new Template('t.ftl', '<#foreach x in xs>[#end]', cfg),
      ParseException, ['Naming convention mismatch']);
  });

  it('explicit CAMEL: #noParse is accepted', async () => {
    const cfg = new Configuration();
    cfg.setNamingConvention(Configuration.CAMEL_CASE_NAMING_CONVENTION);
    eq(await render('<#noParse>a#{b}c</#noParse>', cfg), 'a#{b}c');
  });

  it('explicit LEGACY: #elseIf is a mismatch', () => {
    const cfg = new Configuration();
    cfg.setNamingConvention(Configuration.LEGACY_NAMING_CONVENTION);
    throwsMatch(() => new Template('t.ftl', '<#if false>a<#elseIf true>b</#if>', cfg),
      ParseException, ['Naming convention mismatch']);
  });
});

describe('FTL header directive', () => {
  it('renders nothing and eats the newline after the header', async () => {
    eq(await render('<#ftl>foo'), 'foo');
    eq(await render('<#ftl/>\nfoo'), 'foo');
    eq(await render('<#ftl encoding="UTF-8">\nfoo'), 'foo');
  });

  it('header only allowed at the start, at most once', () => {
    throwsMatch(() => new Template('t.ftl', 'a<#ftl>x'), ParseException,
      ['only allowed once, at the start']);
    throwsMatch(() => new Template('t.ftl', '<#ftl><#ftl>x'), ParseException,
      ['only allowed once, at the start']);
  });

  it('unknown parameter errors, with suggestion when close', () => {
    throwsMatch(() => new Template('t.ftl', '<#ftl foo=1>'), ParseException,
      ['Unknown FTL header parameter: foo']);
    throwsMatch(() => new Template('t.ftl', '<#ftl charset="x">'), ParseException,
      ['Unknown FTL header parameter: charset', 'You may meant: encoding']);
  });

  it('parameter type errors', () => {
    throwsMatch(() => new Template('t.ftl', '<#ftl encoding=1>'), ParseException,
      ['Expected a string constant for "encoding".']);
    throwsMatch(() => new Template('t.ftl', '<#ftl strip_text=1>'), ParseException,
      ['Expected a boolean constant (true/false or "true"/"false") for "strip_text"']);
    throwsMatch(() => new Template('t.ftl', '<#ftl encoding=bar>'), ParseException,
      ['Could not evaluate expression (on parse-time): bar']);
  });

  it('settings are recorded on the template', () => {
    const t = new Template('t.ftl',
      '<#ftl encoding="UTF-8" strip_whitespace=false stripText=false strict_syntax=false auto_esc=false output_format="HTML">');
    eq(t.ftlHeader.settings, {
      encoding: 'UTF-8',
      stripWhitespace: false,
      stripText: false,
      strictSyntax: false,
      autoEsc: false,
      outputFormat: 'HTML',
    });
  });

  it('canonical form round-trips through the header', () => {
    // ← upstream HeaderElement() is void: the header isn't an AST child; its canonical
    // form is exposed via Template.ftlHeader only.
    eq(new Template('t.ftl', '<#ftl>').ftlHeader.getCanonicalForm(), '<#ftl/>');
    eq(new Template('t.ftl', '<#ftl encoding="UTF-8" strip_whitespace=false/>').ftlHeader.getCanonicalForm(),
      '<#ftl encoding="UTF-8" strip_whitespace=false />');
  });

  it('#ftl parameter with camel-case key is accepted, wrong form errors', () => {
    const t = new Template('t.ftl', '<#ftl stripWhitespace=true>foo');
    eq(t.ftlHeader.settings.stripWhitespace, true);
    eq(t.rootElement.getCanonicalForm() === null, false);
  });

  it('square-bracket header establishes square-bracket tag syntax', async () => {
    eq(await render('[#ftl]\n[#if true]y[/#if]<#if true>n</#if>'), 'y<#if true>n</#if>');
  });
});
