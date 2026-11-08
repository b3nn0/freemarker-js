import { describe, it, snapshot, throwsMatch, rejectsMatch, ok } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  ParseException, InvalidReferenceException, UnsupportedFeatureException,
  UnassignedVariableException,
} from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}
function parse(src) {
  return new Template('t.ftl', src, new Configuration());
}

describe('Directive: #macro / #function / <@call>', () => {
  it('basic macro call with named and positional arguments', async () => {
    snapshot(await out('<#macro greet name>Hi ${name}!</#macro><@greet name="W"/>'), 'Hi W!');
    snapshot(await out('<#macro greet name>Hi ${name}!</#macro><@greet "W"/>'), 'Hi W!');
    snapshot(await out('<#macro m a, b>[${a}]${b}</#macro><@m 1 2>x</@m>'), '[1]2');
    snapshot(await out('<#macro m a, b>[${a}]${b}</#macro><@m 1, 2/>'), '[1]2');
  });
  it('argument expressions', async () => {
    snapshot(await out('<#macro m a>[${a}]</#macro><@m 1 + 2/>'), '[3]');
    snapshot(await out('<#macro m a>[${a}]</#macro><@m s[1]/>', { s: [7, 8] }), '[8]');
  });
  it('default parameter values (can reference earlier parameters)', async () => {
    snapshot(await out('<#macro row(a, b=a*2)>[${a}][${b}]</#macro><@row 3/>'), '[3][6]');
    snapshot(await out('<#macro row(a, b=a*2)>[${a}][${b}]</#macro><@row a=3 b=9/>'), '[3][9]');
  });
  it('catch-all parameter collects extra named arguments', async () => {
    snapshot(await out(
      '<#macro m rest...>[${rest.x}][${rest.y}]</#macro><@m x=1 y=2/>', {}), '[1][2]');
    snapshot(await out(
      '<#macro m p, rest...>${p}:${rest.x}:${rest.y}</#macro><@m p=0 x=1 y=2/>', {}), '0:1:2');
  });
  // <- JVM-verified (Drv75/76): ".args" holds the declared parameters (plus
  // call-order extras only when a catch-all exists); unknown named arguments
  // are a runtime error, not ".args" material.
  it('the .args special variable', async () => {
    snapshot(await out(
      '<#macro m a b><#list .args as k, v>${k}=${v}<#sep>, </#list></#macro><@m a=11 b=22 />'),
    'a=11, b=22');
    snapshot(await out(
      '<#macro m a b c=3><#list .args as k, v>${k}=${v}<#sep>, </#list></#macro><@m a=11 b=22 />'),
    'a=11, b=22, c=3');
    snapshot(await out(
      '<#macro m a b others...><#list .args as k, v>${k}=${v}<#sep>, </#list></#macro>'
      + '<@m a=1 b=2 c=3 />'), 'a=1, b=2, c=3');
    await rejectsMatch(() => out('<#macro m>total=${.args.total}</#macro><@m total=7/>'),
      InvalidReferenceException, ['has no parameter with name', 'total']);
    await rejectsMatch(() => out('<#macro m a>given=${.args.a}</#macro><@m a=1 e=2/>'),
      InvalidReferenceException, ['has no parameter with name', 'e']);
  });
  it('.args outside a macro/function is a parse error', () => {
    const e = throwsMatch(() => parse('${.args}'), ParseException);
    ok(e.message.includes('inside a macro or function'));
  });
  it('#nested renders the call body; without a body it prints nothing', async () => {
    snapshot(await out('<#macro box>[<#nested>]</#macro><@box>x</@box>'), '[x]');
    snapshot(await out('<#macro box>[<#nested>]</#macro><@box/>'), '[]');
    snapshot(await out('<#macro box>[<#nested>]</#macro><@box></@box>'), '[]');
  });
  it('#nested with body parameters binds them in the body', async () => {
    snapshot(await out(
      '<#macro each n><#if n gt 0>[<#nested n>]<@each n=n-1></@each></#if></#macro>'
      + '<@each 3; i>i${i}</@each>'),
    '[i3][][]');
  });
  it('the nested body runs in the caller context (macro params are hidden)', async () => {
    snapshot(await out(
      '<#assign v = "outer"><#macro m v>body:<@nested2/><#nested></#macro>'
      + '<#macro nested2>[v=${v}]</#macro><@m v="inner">v=${v}</@m>'),
    'body:[v=outer]v=outer');
  });
  it('#nested outside a macro is a parse error', () => {
    throwsMatch(() => parse('<#nested>'), ParseException, ['outside a macro']);
  });
  it('#return exits a macro early', async () => {
    snapshot(await out(
      '<#macro m n><#if n gt 1><#return></#if>small</#macro><@m 1/><@m 9/>'), 'small');
  });
  it('a macro cannot return a value; a function must', () => {
    throwsMatch(() => parse('<#macro m><#return 1></#macro>'), ParseException,
      ['macro cannot return a value']);
    throwsMatch(() => parse('<#function f()><#return></#function>'), ParseException,
      ['function must return a value']);
    throwsMatch(() => parse('<#return>'), ParseException,
      ['only occur inside a macro or function']);
  });
  it('#function called from ${...}', async () => {
    snapshot(await out('<#function f(x)><#return x * 2></#function>${f(21)}'), '42');
    snapshot(await out('<#function g()><#return "s">ignored</#function>[${g()}]'), '[s]');
    await rejectsMatch(out('<#function h()><#local q = 1></#function>${h()}'),
      InvalidReferenceException);
  });
  it('functions cannot be called with <@...>', async () => {
    const e = await rejectsMatch(out('<#function f()><#return 1></#function><@f/>'),
      InvalidReferenceException);
    ok(e.message.includes('#function'));
  });
  it('argument errors: missing, extra, unknown, duplicate', async () => {
    await rejectsMatch(out('<#macro m a>x</#macro><@m/>'), InvalidReferenceException);
    await rejectsMatch(out('<#macro m a>x</#macro><@m 1 2/>'), InvalidReferenceException);
    await rejectsMatch(out('<#macro m x>y</#macro><@m k=1/>'), InvalidReferenceException);
    await rejectsMatch(out('<#macro m a>a=${a}</#macro><@m 1, a=2/>'), InvalidReferenceException);
  });
  it('nested macro definitions are a parse error', () => {
    throwsMatch(() => parse('<#macro m><#macro n>x</#macro></#macro>'), ParseException,
      ['nested into each other']);
  });
  it('#break is not visible inside a macro body', () => {
    throwsMatch(() => parse('<#macro m><#break></#macro>'), ParseException,
      ['"#break" directive here']);
  });
  it('loop variables are hidden inside a macro body', async () => {
    await rejectsMatch(out(
      '<#list [1] as x><#macro m>${x}</#macro><@m/></#list>'), UnassignedVariableException);
  });
  it('recursion works', async () => {
    snapshot(await out(
      '<#macro rec n>[<#if n gt 0><@rec n=n-1></@rec></#if>]</#macro><@rec 2/>'), '[[[]]]');
  });
  it('mismatched end tag of a call is a parse error', () => {
    throwsMatch(() => parse('<@m>x</@n>'), ParseException, ['Expecting </@> or </@m>']);
    throwsMatch(() => parse('<#macro m>x</#function>'), ParseException, ['Unexpected end tag']);
  });
  it('#fallback must parse inside a macro but is unsupported at runtime', async () => {
    const t = parse('<#macro m>a<#fallback/>b</#macro><@m/>');
    ok(t.getCanonicalForm().includes('<#fallback/>'));
    await rejectsMatch(t.processToString({}), UnsupportedFeatureException);
    throwsMatch(() => parse('<#fallback/>'), ParseException, ['outside a macro']);
  });
  it('canonical form round trip', () => {
    snapshot(parse('<#macro m a b=2 q...><#nested a b></#macro>').getCanonicalForm(),
      '<#macro m a b=2 q...><#nested a b></#macro>');
    snapshot(parse('<#function f(x)><#return x+1></#function>').getCanonicalForm(),
      '<#function f(x)><#return x + 1/></#function>');
    snapshot(parse('<@m x=1 qz=9; p1, p2>${p1}</@m>').getCanonicalForm(),
      '<@m qz=9 x=1; p1, p2>${p1}</@m>');
    snapshot(parse('<@m 1, 2>x</@m>').getCanonicalForm(), '<@m 1, 2>x</@m>');
    snapshot(parse('<@m/>').getCanonicalForm(), '<@m/>');
    snapshot(parse('<@m></@m>').getCanonicalForm(), '<@m/>');
    snapshot(parse('<#macro m><#return/></#macro>').getCanonicalForm(), '<#macro m><#return/></#macro>');
  });
  it('macros are in the namespace and shadow the data model', async () => {
    snapshot(await out('<#macro m>macro</#macro><@m/>', { m: 'model' }), 'macro');
    // A data-model value that is not macro-like stays an error:
    await rejectsMatch(out('<@m/>', { m: 'model' }), InvalidReferenceException);
  });
});
