import { describe, it, snapshot, throwsMatch, rejectsMatch, ok } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  ParseException, NonSequenceOrCollectionException, UnassignedVariableException,
} from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}
function parse(src) {
  return new Template('t.ftl', src, new Configuration());
}

describe('Directive: #list', () => {
  it('sequence iteration with #sep', async () => {
    snapshot(await out('<#list xs as x>${x}<#sep>, </#list>', { xs: [1, 2, 3] }), '1, 2, 3');
    snapshot(await out('<#list xs as x>${x}<#sep>,</#list>', { xs: [7] }), '7');
    snapshot(await out('<#list xs as x>${x}<#sep>,</#sep></#list>', { xs: [1, 2] }), '1,2');
  });
  it('hash listing with two loop variables', async () => {
    snapshot(await out('<#list h as k, v>${k}=${v};</#list>', { h: { a: 1, b: 2 } }), 'a=1;b=2;');
    snapshot(await out('<#list h as k, v>${k};</#list>', { h: new Map([['x', 1]]) }), 'x;');
  });
  it('empty list with #else', async () => {
    snapshot(await out('<#list xs as x>${x}<#else>none</#list>', { xs: [] }), 'none');
    snapshot(await out('<#list xs as x>${x}<#else>none</#list>', { xs: [1] }), '1');
  });
  it('#items names the loop var of a loopless #list', async () => {
    snapshot(await out('<#list xs><#items as x>${x}</#items></#list>', { xs: [1, 2] }), '12');
    snapshot(await out('<#list h><#items as k, v>${k}${v}</#items></#list>', { h: { a: 1 } }), 'a1');
  });
  it('loop variables are scoped to the body', async () => {
    await rejectsMatch(out('<#list xs as x>${x}</#list>${x}', { xs: [1] }), UnassignedVariableException,
      ['"x"']);
  });
  it('shadowing in nested lists', async () => {
    snapshot(await out('<#list xs as x><#list ys as x>${x}</#list>${x}</#list>',
      { xs: [1], ys: [2] }), '21');
  });
  it('non-iterable source', async () => {
    await rejectsMatch(out('<#list n as x>${x}</#list>', { n: 5 }), NonSequenceOrCollectionException);
    await rejectsMatch(out('<#list h as x>${x}</#list>', { h: { a: 1 } }), NonSequenceOrCollectionException);
    await rejectsMatch(out('<#list xs as x>${x}</#list>', {}), UnassignedVariableException, ['"xs"']);
  });
  it('parse-time structural errors', () => {
    throwsMatch(() => parse('<#list xs>x</#list>'), ParseException, ['as loopVar', '#items']);
    throwsMatch(() => parse('<#list xs as x>x<#items as y>y</#items></#list>'), ParseException,
      ['must not have "as loopVar"']);
    throwsMatch(() => parse('<#items as x>x</#items>'), ParseException, ['must be inside a #list']);
    throwsMatch(() => parse('<#sep>,</#sep>'), ParseException, ['must be inside a #list']);
    throwsMatch(() => parse('<#list xs as k, k>x</#list>'), ParseException, ['must differ']);
  });
  it('canonical round trip', () => {
    snapshot(parse('<#list xs as x>${x}<#sep>,</#sep></#list>').getCanonicalForm(),
      '<#list xs as x>${x}<#sep>,</#sep></#list>');
    snapshot(parse('<#list h as k, v>${k}</#list><#list xs as x>${x}<#else>e</#list>')
      .getCanonicalForm(), '<#list h as k, v>${k}</#list><#list xs as x>${x}<#else>e</#list>');  });
});

describe('Directive: #break/#continue inside loops', () => {
  it('#continue skips the rest of the iteration', async () => {
    snapshot(await out('<#list xs as x><#if x == 2><#continue></#if>${x}</#list>', { xs: [1, 2, 3] }), '13');
  });
  it('#break stops the innermost #list', async () => {
    snapshot(await out('<#list xs as x>${x}<#if x == 2><#break></#if></#list>', { xs: [1, 2, 3] }), '12');
  });
  it('#break inside #items works', async () => {
    snapshot(await out('<#list xs><#items as x>${x}<#break></#items></#list>', { xs: [1, 2] }), '1');
  });
  it('nested lists: break hits only the inner loop', async () => {
    snapshot(await out('<#list xs as x><#list ys as y>${x}${y}<#break></#list>${x};</#list>',
      { xs: [1, 2], ys: [3, 4] }), '131;232;');
  });
  it('#continue outside continuable context is a parse error', () => {
    throwsMatch(() => parse('<#continue>'), ParseException, ['can\'t use', '#continue']);
  });
});

describe('Directive: #forEach', () => {
  it('iterates a sequence', async () => {
    snapshot(await out('<#forEach x in xs>[${x}]</#forEach>', { xs: [1, 2] }), '[1][2]');
    snapshot(await out('<#forEach x in xs>${x}<#sep>;</#forEach>', { xs: ['a', 'b'] }), 'a;b');
  });
  it('forEach with missing source errors', async () => {
    await rejectsMatch(out('<#forEach x in xs>${x}</#forEach>', {}), UnassignedVariableException, ['"xs"']);
  });
  it('canonical round trip', () => {
    snapshot(parse('<#forEach x in xs>[${x}]</#forEach>').getCanonicalForm(),
      '<#forEach x in xs>[${x}]</#forEach>');
  });
});

describe('Directive: error stack through directives', () => {
  it('stack lists the failing interpolation inside a list', async () => {
    const e = await rejectsMatch(out('<#list xs as x>${nope}</#list>', { xs: [1] }), UnassignedVariableException);
    ok(e.errorStackTrace.includes('${nope}'), 'stack frame');
    ok(e.errorStackTrace.includes('<#list'), 'iterator frame present');
  });
});
