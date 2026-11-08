// #include / #import / #stop / #flush (M14).

import { describe, it, eq, throwsMatch, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import { TemplateException, StopException } from '../../src/errors.js';

const LIBS = {
  'footer.ftl': '<hr>${footer}',
  'lib.ftl': '<#assign greeting = "hi">\n<#macro greet name>Hello ${name}!</#macro>',
  'a.ftl': 'A<#include "b.ftl">',
  'b.ftl': 'B',
  'broken.ftl': '<#if>',
};

function cfg(resolver = (name) => LIBS[name] ?? null) {
  const c = new Configuration();
  c.setIncludeResolver(resolver);
  return c;
}

function render(source, c = cfg(), model = null) {
  return new Template('main.ftl', source, c).processToString(model);
}

describe('runtime: #include', () => {
  it('visits the included template with the same data model', async () => {
    eq(await render('a<#include "footer.ftl">b', cfg(), { footer: 'F' }), 'a<hr>Fb');
  });

  it('chains: included template can include another', async () => {
    eq(await render('<#include "a.ftl">'), 'AB');
  });

  it('assignments in the included file land in the caller scope', async () => {
    eq(await render('<#include "lib.ftl">${greeting}'), 'hi');
  });

  it('parses each referenced template once (cache)', async () => {
    let calls = 0;
    const c = cfg((name) => { calls++; return LIBS[name] ?? null; });
    await render('<#include "b.ftl"><#include "b.ftl">', c);
    eq(calls, 1);
  });

  it('ignore_missing=true suppresses missing templates and parse errors', async () => {
    eq(await render('[<#include "nope" ignore_missing=true/>]'), '[]');
    eq(await render('[<#include "broken.ftl" ignore_missing=true/>]'), '[]');
  });

  it('missing template without ignore_missing throws', async () => {
    await rejectsMatch(render('<#include "nope"/>'), TemplateException,
      ['Could not find the included template "nope"']);
  });

  it('parse=false writes the file source verbatim (JVM-pinned)', async () => {
    eq(await render('[<#include "footer.ftl" parse=false/>]', cfg(), { footer: 'F' }),
      '[<hr>\${footer}]');
    eq(await render('[<#include "broken.ftl" parse=false/>]'), '[<#if>]');
  });

  it('legacy string values for parse/ignore_missing are honored', async () => {
    eq(await render('[<#include "b.ftl" parse="no"/>]'), '[B]');
    eq(await render('[<#include "nope" ignore_missing="yes"/>]'), '[]');
    eq(await render('[<#include "nope" parse=false ignore_missing="yes"/>]'), '[]');
  });

  it('unknown named parameter errors with the supported list', async () => {
    throwsMatch(() => render('<#include "b.ftl" foo=1/>'), null,
      ['Unsupported named #include parameter: "foo"']);
  });

  it('semicolon after the template name is accepted', async () => {
    eq(await render('<#include "b.ftl";>'), 'B');
  });
});

describe('runtime: #import', () => {
  it('exposes the imported template top level as a namespace hash', async () => {
    eq(await render('<#import "lib.ftl" as l>${l.greeting} <@l.greet name="Bob"/>'), 'hi Hello Bob!');
  });

  it('re-import reuses the namespace (top level runs once)', async () => {
    eq(await render('<#import "lib.ftl" as l1><#import "lib.ftl" as l2><#assign greeting="x">${l1.greeting}'), 'hi');
    eq(await render('<#import "lib.ftl" as l1><#import "lib.ftl" as l2>${l2.greeting}'), 'hi');
  });

  it('namespace output during initialization is suppressed', async () => {
    eq(await render('<#import "lib.ftl" as l>'), '');
  });

  it('imported macro sees the data model', async () => {
    eq(await render('<#import "lib.ftl" as l><@l.greet name=n/>', cfg(), { n: 'Zed' }), 'Hello Zed!');
  });

  it('"as" requires an identifier', async () => {
    throwsMatch(() => render('<#import "lib.ftl" as 1/>'), null,
      ['Expected a namespace variable name after "as"']);
  });
});

describe('runtime: #stop and #flush', () => {
  it('#stop aborts with the given message', async () => {
    await rejectsMatch(render('a<#stop "boom"/>b'), StopException,
      ['Encountered stop instruction', 'Cause given: boom']);
  });

  it('#stop without message', async () => {
    await rejectsMatch(render('a<#stop/>b'), StopException, ['Encountered stop instruction']);
  });

  it('#stop evaluates and coerces its expression', async () => {
    await rejectsMatch(render('<#stop 1+2/>'), StopException, ['Cause given: 3']);
  });

  it('#flush is a no-op for string output', async () => {
    eq(await render('a<#flush/>b'), 'ab');
  });
});

describe('syntax: include/import/stop/flush canonical forms', () => {
  it('canonical round-trips', () => {
    const src = '<#include "a" parse=false ignore_missing=b/><#import "l" as n/><#stop "x"/><#stop/><#flush/>';
    eq(new Template('m.ftl', src).getCanonicalForm(), src);
  });

  it('processing-level includeResolver option is used', async () => {
    const t = new Template('m.ftl', '<#include "x.ftl">');
    eq(await t.processToString(null, { includeResolver: (n) => `[${n}]` }), '[x.ftl]');
  });

  it('missing resolver: clear error', async () => {
    await rejectsMatch(new Template('m.ftl', '<#include "x">').processToString(), TemplateException,
      ['Could not find the included template "x"', 'includeResolver']);
  });
});
