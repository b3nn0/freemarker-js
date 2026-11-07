// Async-capable data models/callbacks (green-threads core, src/async.js).

import { describe, it, eq, rejectsMatch, throwsMatch } from '../harness.js';
import { Configuration } from '../../src/configuration.js';
import { Template } from '../../src/template.js';
import { AsyncOperationNotAllowedException } from '../../src/errors.js';

const cfg = new Configuration();

describe('Async-capable core (green-threads)', () => {
  it('promise-valued hash keys are awaited', async () => {
    const t = new Template(null, '${v}', cfg);
    eq(await t.processToString({ v: Promise.resolve('late') }), 'late');
  });
  it('promise sequence elements are awaited', async () => {
    const t = new Template(null, '<#list xs as x>${x};</#list>', cfg);
    eq(await t.processToString({ xs: [Promise.resolve(1), 2] }), '1;2;');
  });
  it('promise-valued keys work under ?has_content-style reads too', async () => {
    const t = new Template(null, '${h.k?cap_first}', cfg);
    eq(await t.processToString({ h: { k: Promise.resolve('ab') } }), 'Ab');
  });
  it('async JS methods are awaited', async () => {
    const t = new Template(null, '${f("x")}!${g()}', cfg);
    eq(await t.processToString({ f: async (s) => s + '-', g: () => Promise.resolve('y') }), 'x-!y');
  });
  it('async include resolvers are awaited', async () => {
    const t = new Template(null, 'a<#include "b">c', cfg);
    eq(await t.processToString(null, { includeResolver: async (n) => `<${n}>` }), 'a<b>c');
  });
  it('a rejected promise rejects the render', async () => {
    const t = new Template(null, '${v}', cfg);
    const e = await rejectsMatch(t.processToString({ v: Promise.reject(new Error('boom')) }));
    eq(e.message, 'boom');
  });
  it('rejections recover inside #attempt when they are template errors', async () => {
    const t = new Template(null, '<#attempt>${v}<#recover>E</#attempt>', cfg);
    eq(await t.processToString(
      { v: Promise.reject(new AsyncOperationNotAllowedException('deliberate')) }), 'E');
  });
  it('sync mode throws AsyncOperationNotAllowedException with the op label', () => {
    const t = new Template(null, '${v}', cfg);
    throwsMatch(() => t.processToStringSync({ v: Promise.resolve('late') }),
      AsyncOperationNotAllowedException, ['data-model key "v"']);
    const t2 = new Template(null, '${xs[0]}', cfg);
    throwsMatch(() => t2.processToStringSync({ xs: [Promise.resolve(1)] }),
      AsyncOperationNotAllowedException, ['sequence element at index 0']);
  });
  it('sync mode: async method and async resolver are rejected', () => {
    const t = new Template(null, '${f()}', cfg);
    throwsMatch(() => t.processToStringSync({ f: async () => 1 }),
      AsyncOperationNotAllowedException, ['method call']);
    const t2 = new Template(null, '<#include "x"/>', cfg);
    throwsMatch(() => t2.processToStringSync(null, { includeResolver: async () => 's' }),
      AsyncOperationNotAllowedException, ['include resolver']);
  });
  it('sync mode: #attempt recovers AsyncOperationNotAllowedException', () => {
    const t = new Template(null, '<#attempt>${v}<#recover>fb</#attempt>', cfg);
    eq(t.processToStringSync({ v: Promise.resolve('late') }), 'fb');
  });
  it('sync templates render identically in both drivers', async () => {
    const t = new Template(null, '<#list 1..3 as i>${i}</#list>', cfg);
    eq(t.processToStringSync({}), '123');
    eq(await t.processToString({}), '123');
  });
});
