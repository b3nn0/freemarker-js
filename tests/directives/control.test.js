import { describe, it, snapshot, throwsMatch, rejectsMatch, ok } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  ParseException, NonBooleanException, UnassignedVariableException, TemplateException,
} from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}
function parse(src) {
  return new Template('t.ftl', src, new Configuration());
}

describe('Directive: #if', () => {
  it('if/else', async () => {
    snapshot(await out('<#if b>yes<#else>no</#if>', { b: true }), 'yes');
    snapshot(await out('<#if b>yes<#else>no</#if>', { b: false }), 'no');
    snapshot(await out('<#if b>yes</#if>', { b: false }), '');
  });
  it('elseif chain picks first match', async () => {
    const t = '<#if x == 1>a<#elseif x == 2>b<#elseif x == 3>c<#else>d</#if>';
    snapshot(await out(t, { x: 1 }), 'a');
    snapshot(await out(t, { x: 2 }), 'b');
    snapshot(await out(t, { x: 3 }), 'c');
    snapshot(await out(t, { x: 9 }), 'd');
  });
  it('non-boolean condition', async () => {
    await rejectsMatch(out('<#if n>x</#if>', { n: 1 }), NonBooleanException, ['boolean', 'number']);
    await rejectsMatch(out('<#if z>x</#if>', {}), UnassignedVariableException, ['"z"']);
  });
  it('canonical round trip', () => {
    snapshot(parse('<#if x == 1>a<#else>b</#if>').getCanonicalForm(), '<#if x == 1>a<#else>b</#if>');
  });
  it('error inside branch carries FTL stack', async () => {
    const e = await rejectsMatch(out('<#if true>${missing}</#if>', {}), UnassignedVariableException);
    ok(e.errorStackTrace.includes('${missing}'), 'stack frame for interpolation');
  });
});

describe('Directive: #attempt/#recover', () => {
  it('recovery runs on error', async () => {
    snapshot(await out('<#attempt>${missing}<#recover>oops</#recover></#attempt>', {}), 'oops');
    snapshot(await out('<#attempt>fine<#recover>oops</#recover></#attempt>', {}), 'fine');
  });
  it('recovery without end tag also works', async () => {
    snapshot(await out('<#attempt>${missing}<#recover>oops</#attempt>', {}), 'oops');
  });
  it('#recover is mandatory', () => {
    throwsMatch(() => parse('<#attempt>x</#attempt>'), ParseException, ['#recover']);
  });
  it('break/continue markers are not swallowed by recover', async () => {
    snapshot(await out('<#list xs as x><#attempt>${x}<#break><#recover>r</#recover></#attempt></#list>',
      { xs: [1, 2] }), '1');
  });
});

describe('Directive: #switch/#case/#default/#break/#on', () => {
  it('case match and default', async () => {
    const t = '<#switch v><#case 1>one<#case 2>two<#default>other</#switch>';
    snapshot(await out(t, { v: 1 }), 'one');
    snapshot(await out(t, { v: 2 }), 'two');
    snapshot(await out(t, { v: 3 }), 'other');
    snapshot(await out(t, { v: 'x' }), 'other');
  });
  it('string case with natural comparison', async () => {
    snapshot(await out('<#switch s><#case "a">A<#case "b">B</#switch>', { s: 'b' }), 'B');
  });
  it('#break stops the #switch body', async () => {
    snapshot(await out('<#switch v><#case 1>before<#break>skipped<#case 2>x</#switch>', { v: 1 }), 'before');
  });
  it('no fall-through: body ends at next #case', async () => {
    snapshot(await out('<#switch v><#case 1>one<#case 2>two</#switch>', { v: 1 }), 'one');
  });
  it('#on takes a positional argument list (commas optional)', async () => {
    const t = '<#switch v><#on 1, 2>low<#default>other</#switch>';
    snapshot(await out(t, { v: 1 }), 'low');
    snapshot(await out(t, { v: 2 }), 'low');
    snapshot(await out(t, { v: 3 }), 'other');
    snapshot(await out('<#switch v><#on 1 2>x</#switch>', { v: 2 }), 'x');
  });
  it('whitespace before the first #case is dropped', async () => {
    snapshot(await out('<#switch v>   \n  <#case 1>x</#switch>', { v: 1 }), 'x');
    snapshot(await out('<#switch v>   <#default>d</#switch>', { v: 9 }), 'd');
  });
  it('#break outside breakable context is a parse error', () => {
    throwsMatch(() => parse('<#break>'), ParseException, ['can\'t use', '#break']);
  });
  it('two #default is a parse error', () => {
    throwsMatch(() => parse('<#switch v><#default>a<#default>b</#switch>'), ParseException,
      ['already had', '#default']);
  });
  it('#case/#default body errors carry location', async () => {
    const e = await rejectsMatch(out('<#switch v><#case 1>${missing}</#switch>', { v: 1 }),
      UnassignedVariableException);
    ok(e.beginLine === 1 && e.beginColumn >= 1, `pos ${e.beginLine}:${e.beginColumn}`);
  });
});
