import { describe, it, snapshot, throwsMatch, rejectsMatch, ok } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  ParseException, TemplateException, UnsupportedFeatureException,
} from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}
function parse(src) {
  return new Template('t.ftl', src, new Configuration());
}
const asList = (tpl) => `<#list ${tpl} as x>[\${x}]</#list>`;

describe('Lambda expressions and ?filter/?map/?sort/?sort_by', () => {
  it('?filter with a lambda keeps matching items', async () => {
    snapshot(await out(asList('[1, 2, 3]?filter(it -> it == 1 || it == 3)'), {}), '[1][3]');
    snapshot(await out(asList('[1, 2, 3]?filter((x) -> x gt 1)'), {}), '[2][3]');
  });
  it('nested lambda: a lambda calling another builtin in its body', async () => {
    snapshot(await out(
      '<#list [[1, 2], [3]]?map(p -> p?map(x -> x * 2)) as p>'
      + '[<#list p as x>${x}</#list>]</#list>', {}), '[24][6]');
  });
  it('?map with a lambda replaces items', async () => {
    snapshot(await out(asList('[1, 2]?map(it -> it * 10)'), {}), '[10][20]');
    snapshot(await out(asList('(1..3)?map(i -> i * 2)'), {}), '[2][4][6]');
  });
  it('lambda params shadow outer vars; body sees caller vars at call time', async () => {
    snapshot(await out('<#assign it = "!"><#list ["a"]?map(it -> it + "?") as x>[${x}]</#list>', {}),
      '[a?]');
    snapshot(await out('<#assign s = "!"><#list ["a"]?map(q -> s + q) as x>[${x}]</#list>', {}),
      '[!a]');
  });
  it('non-lambda transformer: #function and JS method references work', async () => {
    snapshot(await out('<#function dbl(x)><#return x * 3></#function>'
      + asList('[1, 2]?map(dbl)'), {}), '[3][6]');
    snapshot(await out(asList('hs?map(m)'), { hs: ['a'], m: (x) => x.toUpperCase() }), '[A]');
  });
  it('a lambda outside a builtin argument is a parse error', () => {
    throwsMatch(() => parse('<#assign f = x -> x>'), ParseException);
  });
  it('?filter/?map argument and arity errors', async () => {
    throwsMatch(() => parse('${x?map}'), ParseException, ['parentheses']);
    throwsMatch(() => parse('${x?map((a, b) -> a)}'), ParseException,
      ['exactly 1 parameter', 'declared 2']);
    throwsMatch(() => parse('${x?filter(() -> true)}'), ParseException,
      ['exactly 1 parameter', 'declared 0']);
    await rejectsMatch(out('${[1, 2]?filter(it -> it)}'), TemplateException,
      ['boolean value', 'number']);
    await rejectsMatch(out('${[1, 2]?filter(it -> nosuch!)}'), TemplateException,
      ['no value']);
    await rejectsMatch(out('${[1, 2]?map(it -> nosuch!)}'), TemplateException,
      ['no return value']);
    await rejectsMatch(out('${{}?map(it -> it)}'), TemplateException, ['sequences']);
  });
  it('?sort sorts scalars; the first key type wins', async () => {
    snapshot(await out(asList('["c", "a", "b"]?sort'), {}), '[a][b][c]');
    snapshot(await out(asList('[3, -1, 2]?sort'), {}), '[-1][2][3]');
    snapshot(await out(asList('[true, false]?sort'), {}), '[false][true]');
    snapshot(await out(asList('[]?sort'), {}), '');
    await rejectsMatch(out('${[1, "a"]?sort}'), TemplateException,
      ['?sort failed at sequence index 1', 'must be numbers']);
    await rejectsMatch(out('${[[1]]?sort}'), TemplateException,
      ['Values used for sorting must be']);
  });
  it('?sort_by with a string key or a string path sorts hashes', async () => {
    snapshot(await out('<#list hs?sort_by("age") as x>${x.n}</#list>', {
      hs: [{ n: 'o', age: 70 }, { n: 'y', age: 3 }],
    }), 'yo');
    snapshot(await out('<#list hs?sort_by(["loc", "zip"]) as x>${x.n}</#list>', {
      hs: [{ n: 'a', loc: { zip: 5 } }, { n: 'b', loc: { zip: 2 } }],
    }), 'ba');
  });
  it('?sort_by errors mirror upstream wording', async () => {
    await rejectsMatch(out('${[1]?sort_by("k")}'), TemplateException,
      ['Sequence items must be hashes']);
    await rejectsMatch(out('${[{ "a": 1 }]?sort_by("k")}'), TemplateException,
      ['was null or missing']);
    await rejectsMatch(out('${[{ "a": [1] }]?sort_by(["a", "b"])}'), TemplateException,
      ['is not a hash']);
    await rejectsMatch(out('${[{ "a": { "b": 1 } }]?sort_by([1])}'), TemplateException,
      ['sequence of strings']);
  });
  it('?sort_by evaluates to a method (callable later)', async () => {
    snapshot(await out('<#assign f = hs?sort_by><#list f("name") as x>${x.name}</#list>', {
      hs: [{ name: 'b' }, { name: 'a' }],
    }), 'ab');
  });
  it('lambda canonical form: "->", single parameter without parens', () => {
    snapshot(parse('${x?filter((x) -> !x)}').getCanonicalForm(), '${x?filter(x -> !x)}');
    snapshot(parse('${x?map(z -> z + 1)}').getCanonicalForm(), '${x?map(z -> z + 1)}');
    snapshot(parse('${x?sort_by("k")}').getCanonicalForm(), '${x?sort_by("k")}');
  });
  it('multi-parameter lambdas are rejected for ?filter/?map', () => {
    const e = throwsMatch(() => parse('${x?filter((a, b) -> a)}'), ParseException,
      ['exactly 1 parameter', 'declared 2']);
    ok(e.message.includes('?filter'));
  });
  it('built-in arguments are parsed now; ?string takes at most one argument', async () => {
    parse('${x?string("y", "n")}'); // parses fine since M11
    await rejectsMatch(out('${x?string("y", "n")}', { x: 1 }), TemplateException,
      ['expects 0 or 1 argument', 'received 2 arguments']);
  });
});
