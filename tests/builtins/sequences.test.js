import { describe, it, snapshot, throwsMatch, rejectsMatch, ok } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  ParseException, TemplateException, UnsupportedFeatureException,
  NonSequenceOrCollectionException, NonMethodException,
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
    // <- JVM: missing! -> the empty-string model; a bare missing name throws at the Dot
    await rejectsMatch(out('${[1, 2]?filter(it -> nosuch!)}'), TemplateException,
      ['boolean value', 'string']);
    await rejectsMatch(out('${[1, 2]?map(it -> nosuch!)}'), TemplateException,
      ['evaluated to a sequence']);
    await rejectsMatch(out('${[1, 2]?map(it -> nosuch)}'), TemplateException,
      ['null or missing']);
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

  it('?take_while / ?drop_while <- BuiltInsForSequences (JVM-pinned)', async () => {
    snapshot(await out('${[1, 2, 3, 1, 2]?take_while(x -> x lt 3)?join(",")}', {}), '1,2');
    snapshot(await out('${[1, 2, 3, 1, 2]?drop_while(x -> x lt 3)?join(",")}', {}), '3,1,2');
    await rejectsMatch(out('${"a"?take_while(x -> true)}', {}),
      NonSequenceOrCollectionException, ['sequence', 'string']);
    await rejectsMatch(out('${[1]?take_while(3)}', {}), TemplateException,
      ['lambda expression or a function/method']);
  });

  it('?with_args / ?with_args_last <- BuiltInsForCallables (JVM-pinned)', async () => {
    const fn = (...a) => a.join('|');
    snapshot(await out('${fn?with_args([1, 2])()}', { fn }), '1|2');
    snapshot(await out('${fn?with_args([1])(2)}', { fn }), '1|2');
    snapshot(await out('${fn?with_args_last([2])(1)}', { fn }), '1|2');
    await rejectsMatch(out('${fn?with_args(1)}', { fn }), TemplateException,
      ['extended hash or sequence as argument #1', 'number']);
    await rejectsMatch(out('${fn?with_args()()}', { fn }), TemplateException,
      ['expects 1 argument but has received none']);
    await rejectsMatch(out('${fn?with_args(1, 2)()}', { fn }), TemplateException,
      ['expects 1 argument but has received 2']);
    await rejectsMatch(out('${fn?with_args({"a": 1})()}', { fn }), TemplateException,
      ["can't have a hash argument. Use a sequence argument"]);
    await rejectsMatch(out('${1?with_args([1])}', {}), NonMethodException,
      ['Expected a macro, function, directive, or method']);
  });

  it('?with_args over an FTL #function (JVM-pinned: hash argument rejected)', async () => {
    const f = '<#function f(a, b)><#return "[" + a + "|" + b + "]"/></#function>';
    snapshot(await out(f + '${f?with_args([1, 2])()}', {}), '[1|2]');
    await rejectsMatch(out(f + '${f?with_args({"a": 1, "b": 2})()}', {}), TemplateException,
      ['When applied on a function, ?with_args can\'t have a hash argument']);
    snapshot(await out(f + '${f?with_args_last([2])(1)}', {}), '[1|2]');
  });

  it('?with_args over a #macro accepts the named hash', async () => {
    snapshot(await out('<#macro m a>[${a}]</#macro><#assign w = m?with_args({"a": 1})><@w/>', {}), '[1]');
  });
});
