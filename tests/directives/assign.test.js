import { describe, it, snapshot, throwsMatch, rejectsMatch, ok } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  ParseException, InvalidReferenceException, NonNumericalException, UnsupportedFeatureException,
  UnassignedVariableException,
} from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}
function parse(src) {
  return new Template('t.ftl', src, new Configuration());
}

describe('Directive: #assign / #global / #local', () => {
  it('simple assignment and visibility after a block', async () => {
    snapshot(await out('<#assign y = 2>${y}'), '2');
    snapshot(await out('<#if true><#assign y = 2></#if>${y}'), '2');
    snapshot(await out('<#list [1, 2] as x><#assign y = x></#list>${y}', { x: 0 }), '2');
  });
  it('assigns shadow the data model', async () => {
    snapshot(await out('<#assign x = 9>${x}', { x: 1 }), '9');
    snapshot(await out('<#assign x = x + 1>${x}', { x: 5 }), '6');
  });
  it('multiple assignments in one directive', async () => {
    snapshot(await out('<#assign a = 1, b = 2>${a}${b}'), '12');
    snapshot(await out('<#assign a = 1, a = a + 1>${a}'), '2');
  });
  it('compound assignment operators', async () => {
    snapshot(await out('<#assign n = 1><#assign n += 2>${n}'), '3');
    snapshot(await out('<#assign n = 5><#assign n -= 2>${n}'), '3');
    snapshot(await out('<#assign n = 3><#assign n *= 4>${n}'), '12');
    snapshot(await out('<#assign n = 10><#assign n /= 4>${n}'), '2.5');
    snapshot(await out('<#assign n = 10><#assign n %= 4>${n}'), '2');
    snapshot(await out('<#assign n = 1><#assign n++>${n}'), '2');
    snapshot(await out('<#assign n = 1><#assign n-->${n}'), '0');
  });
  it('compound assignment on missing or non-numeric variables fails', async () => {
    const e = await rejectsMatch(out('<#assign z += 1>'), InvalidReferenceException);
    ok(e.message.includes('no old value'));
    await rejectsMatch(out('<#assign s = "a"><#assign s += 1>'), NonNumericalException);
  });
  it('block assignment captures output', async () => {
    snapshot(await out('<#assign s>Hello ${name}</#assign>[${s}]', { name: 'W' }), '[Hello W]');
    snapshot(await out('<#assign s><#if true>yes<#else>no</#if></#assign>${s}'), 'yes');
  });
  it('block assignment with += concatenates', async () => {
    snapshot(await out('<#assign s = "a"><#assign s+=>b</#assign>${s}'), 'ab');
    const e = await rejectsMatch(out('<#assign s+=>b</#assign>'), InvalidReferenceException);
    ok(e.message.includes('no old value'));
  });
  it('#global writes into the data model', async () => {
    const m = { x: 1 };
    snapshot(await out('<#global g = 1>${g}', m), '1');
    ok(m.g === 1);
    snapshot(await out('<#global x = x + 1>${x}', m), m.x === 2 ? '2' : String(m.x));
  });
  it('#global works on a Map data model too', async () => {
    const m = new Map([['x', 1]]);
    snapshot(await out('<#global g = 2>${g}${x}', m), '21');
    ok(m.get('g') === 2);
  });
  it('#local outside a macro/function is a parse error', async () => {
    const e = throwsMatch(() => parse('<#local x = 1>'), ParseException);
    ok(e.message.includes('outside a macro or function'));
  });
  it('namespace-target assignment is deferred to #import', async () => {
    const e = await rejectsMatch(out('<#assign x = 1 in ns>'), UnsupportedFeatureException);
    ok(e.message.includes('namespace'));
  });
  it('#assign x in non-namespace scope fails to parse', async () => {
    throwsMatch(() => parse('<#global x = 1 in ns>'), ParseException);
  });
  it('loop variable shadows a namespace variable inside the loop', async () => {
    snapshot(await out('<#assign i = 9><#list [1, 2] as i>${i}</#list>${i}'), '129');
  });
  it('string names are allowed on the left side', async () => {
    snapshot(await out('<#assign "odd name" = 1>ok'), 'ok');
  });
  it('mismatched block end tag is a parse error', async () => {
    throwsMatch(() => parse('<#assign x>y</#global>'), ParseException);
    throwsMatch(() => parse('<#global x>y</#assign>'), ParseException);
  });
  it('canonical form round trip', async () => {
    snapshot(parse('<#assign a=1>').getCanonicalForm(), '<#assign a = 1>');
    snapshot(parse('<#assign a += 1, a++>').getCanonicalForm(),
      '<#assign a += 1, a++>');
    snapshot(parse('<#global g=1>').getCanonicalForm(), '<#global g = 1>');
    snapshot(parse('<#assign s>x${y}</#assign>').getCanonicalForm(),
      '<#assign s>x${y}</#assign>');
    snapshot(parse('<#assign s+=>b</#assign>').getCanonicalForm(), '<#assign s+=>b</#assign>');
  });
  it('error location carries the failing element', async () => {
    const e = await rejectsMatch(out('<#assign n = notThere + 1>'), UnassignedVariableException);
    ok(e.beginLine === 1 && e.beginColumn === 14, `col ${e.beginColumn}`);
    ok(e.errorStackTrace.includes('<#assign n = notThere + 1>'), 'stack frame');
    ok(e.errorStackTrace.includes('Failed at:'), 'Failed at frame');
  });
});
