import { describe, it, snapshot, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import { TemplateException, NonNumericalException, NonStringException } from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}

describe('Built-ins: basic strings', () => {
  it('upper_case / lower_case / trim / length', async () => {
    snapshot(await out('${"aBc"?upper_case}'), 'ABC');
    snapshot(await out('${"aBc"?lower_case}'), 'abc');
    snapshot(await out('${"  x  "?trim}|'), 'x|');
    snapshot(await out('${"abc"?length}'), '3');
    snapshot(await out('${""?length}'), '0');
  });

  it('trim keeps NBSP (Java trim only strips <= U+0020)', async () => {
    snapshot(await out('${"\u00a0x\u00a0"?trim}'), '\u00a0x\u00a0');
  });

  it('cap_first / capitalize / chop_linebreak', async () => {
    snapshot(await out('${" hello"?cap_first}'), ' Hello');
    snapshot(await out('${""?cap_first}|'), '|');
    snapshot(await out('${"hello WORLD"?capitalize}'), 'Hello World');
    snapshot(await out('${"two words here"?capitalize}'), 'Two Words Here');
    snapshot(await out('${"a\r\n"?chop_linebreak}|'), 'a|');
    snapshot(await out('${"a\r"?chop_linebreak}|'), 'a|');
    snapshot(await out('${"a"?chop_linebreak}|'), 'a|');
  });

  it('contains / starts_with / ends_with (as method-call built-ins)', async () => {
    snapshot(await out('${"abc"?contains("b")}'), 'true');
    snapshot(await out('${"abc"?contains("z")}'), 'false');
    snapshot(await out('${"abc"?starts_with("ab")}'), 'true');
    snapshot(await out('${"abc"?ends_with("c")}'), 'true');
  });

  it('bare built-in evaluates to a callable method', async () => {
    snapshot(await out('<#assign f = "abc"?contains>${f("b")}${f("z")}'), 'truefalse');
    snapshot(await out('<#assign p = "a-b"?split>${p("-")?size}', {}), '2');
  });

  it('index_of / last_index_of with optional from-index', async () => {
    snapshot(await out('${"abcabc"?index_of("c")}'), '2');
    snapshot(await out('${"abcabc"?index_of("c", 3)}'), '5');
    snapshot(await out('${"abc"?index_of("c", 3)}'), '-1');
    snapshot(await out('${"abc"?index_of("z")}'), '-1');
    snapshot(await out('${"abcabc"?last_index_of("c")}'), '5');
  });

  it('split / replace / left_pad / right_pad', async () => {
    snapshot(await out('<#list "a,b,"?split(",") as p>[${p}]</#list>'), '[a][b][]');
    snapshot(await out('${"aXbXc"?replace("X", "-")}'), 'a-b-c');
    snapshot(await out('${"7"?left_pad(3)}|'), '  7|');
    snapshot(await out('${"7"?left_pad(3, "0")}'), '007');
    snapshot(await out('${"7"?right_pad(3)}|'), '7  |');
    snapshot(await out('${"toolong"?left_pad(3)}'), 'toolong');
  });

  it('string built-in argument errors', async () => {
    await rejectsMatch(out('${"a"?index_of(1)}'), NonStringException, ['string']);
    await rejectsMatch(out('${"a"?index_of("x", "y")}'), NonNumericalException, ['number']);
    await rejectsMatch(out('${"a"?left_pad("x")}'), NonNumericalException, ['number']);
  });
});
