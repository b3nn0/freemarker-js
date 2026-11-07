import { describe, it, snapshot, rejectsMatch, throwsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  TemplateException, InvalidReferenceException, NonBooleanException, NonStringException, ParseException,
} from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}

describe('Built-ins: existence handling', () => {
  it('?if_exists turns a missing value into an empty string', async () => {
    snapshot(await out('${nosuch?if_exists}|'), '|');
    snapshot(await out('${x?if_exists}|', { x: 'v' }), 'v|');
  });

  it('?has_content: missing/empty are false, scalars are true', async () => {
    snapshot(await out('${nosuch?has_content}'), 'false');
    snapshot(await out('${""?has_content}'), 'false');
    snapshot(await out('${[]?has_content}'), 'false');
    snapshot(await out('${{}?has_content}'), 'false');
    snapshot(await out('${0?has_content}'), 'true');
    snapshot(await out('${false?has_content}'), 'true');
    snapshot(await out('${[1]?has_content}'), 'true');
  });

  it('?default: target wins, else first non-null argument', async () => {
    snapshot(await out('${nosuch?default("d")}'), 'd');
    snapshot(await out('${x?default("d")}', { x: 'v' }), 'v');
    snapshot(await out('${nosuch?default(nosuch2, "x")}'), 'x');
    snapshot(await out('${nosuch?default(nosuch2)?if_exists}'), '');
  });

  it('?default without parentheses is a method', async () => {
    snapshot(await out('<#assign g = nosuch?default>${g("y")}'), 'y');
    snapshot(await out('<#assign g = x?default>${g("y")}', { x: 'x' }), 'x');
  });

  it('?blank_to_null / ?empty_to_null / ?trim_to_null', async () => {
    snapshot(await out('${" "?blank_to_null?if_exists}|'), '|');
    snapshot(await out('${"x"?blank_to_null}|'), 'x|');
    snapshot(await out('${""?empty_to_null?if_exists}|'), '|');
    snapshot(await out('${"  x  "?trim_to_null}|'), 'x|');
  });

  it('a non-missing but wrong-typed target still errors', async () => {
    await rejectsMatch(out('${[1]?if_exists}'), TemplateException);
  });
});

describe('Built-ins: ?then and ?switch (lazy)', () => {
  it('?then picks one branch, leaving the other unevaluated', async () => {
    snapshot(await out('${true?then("y", "n")}'), 'y');
    snapshot(await out('${false?then("y", "n")}'), 'n');
    snapshot(await out('${true?then("y", nosuch)}'), 'y');
    snapshot(await out('${false?then(nosuch, "n")}'), 'n');
  });

  it('?then errors: non-boolean target, wrong arity, null result', async () => {
    await rejectsMatch(out('${"x"?then(1, 2)}'), NonBooleanException, ['boolean']);
    throwsMatch(() => new Template('t', '${true?then(1)}', new Configuration()),
      ParseException, ['?then(...) requires exactly 2 parameters']);
    await rejectsMatch(out('${true?then(nosuch, 2)}'), InvalidReferenceException, ['nosuch']);
  });

  it('?switch matches pairs; odd last argument is the default', async () => {
    snapshot(await out('${2?switch(1, "a", 2, "b", "d")}'), 'b');
    snapshot(await out('${9?switch(1, "a", "d")}'), 'd');
    snapshot(await out('${"k"?switch("k", "hit", "miss")}'), 'hit');
  });

  it('?switch with no default and no match fails', async () => {
    await rejectsMatch(out('${9?switch(1, "a")}'), TemplateException, ["didn't match"]);
    throwsMatch(() => new Template('t', '${true?then()}', new Configuration()),
      ParseException, ['?then(...) requires exactly 2 parameters']);
  });
});

describe('Built-ins: multi-type, hashes, sequences, numbers, type checks', () => {
  it('?size on sequences and hashes (not strings)', async () => {
    snapshot(await out('${[1, 2, 3]?size}'), '3');
    snapshot(await out('${{"a": 1, "b": 2}?size}'), '2');
    await rejectsMatch(out('${"ab"?size}'), TemplateException, ['extended-hash or sequence']);
  });

  it('?first / ?last return null on empty sequences', async () => {
    snapshot(await out('${[5, 6]?first}/${[5, 6]?last}'), '5/6');
    snapshot(await out('${[]?first?if_exists}|'), '|');
    await rejectsMatch(out('${"ab"?first}'), TemplateException, ['sequences']);
  });

  it('?join / ?seq_contains / ?seq_index_of / ?reverse', async () => {
    snapshot(await out('${["a", "b"]?join("-")}'), 'a-b');
    snapshot(await out('<#assign j = ["a", "b"]?join>${j("+")}'), 'a+b');
    snapshot(await out('${[1, "x"]?seq_contains("x")}'), 'true');
    snapshot(await out('${[1, 2]?seq_contains(3)}'), 'false');
    snapshot(await out('${["a", "b"]?seq_index_of("b")}'), '1');
    snapshot(await out('${["a"]?seq_index_of("z")}|'), '-1|');
    snapshot(await out('<#list [1, 2, 3]?reverse as i>${i}</#list>'), '321');
  });

  it('?keys / ?values on hashes', async () => {
    const dm = { h: new Map([['z', 1], ['a', 2]]) };
    snapshot(await out('<#list h?keys as k>[${k}]</#list>', dm), '[z][a]');
    snapshot(await out('<#list h?values as v>[${v}]</#list>', dm), '[1][2]');
    await rejectsMatch(out('${[1]?keys}'), TemplateException, ['extended-hash']);
  });

  it('number built-ins: abs / ceiling / floor / round', async () => {
    snapshot(await out('${-3?abs}'), '-3');
    snapshot(await out('${(-3)?abs}'), '3');
    snapshot(await out('${2.5?round}/${-2.5?round}'), '3/-3');
    snapshot(await out('${2.7?floor}/${2.1?ceiling}'), '2/3');
    await rejectsMatch(out('${"x"?abs}'), TemplateException, ['number']);
  });

  it('type-check built-ins', async () => {
    snapshot(await out('${"a"?is_string}/${1?is_number}/${true?is_boolean}'), 'true/true/true');
    snapshot(await out('${{}?is_hash}/${{}?is_hash_ex}/${[1]?is_sequence}'),
      'true/true/true');
    snapshot(await out('${"a"?is_sequence}/${[1]?is_string}/${1?is_string}'), 'false/false/false');
    snapshot(await out('${nosuch?is_string}'), 'false');
  });

  it('method / macro type checks', async () => {
    snapshot(await out(
      '<#macro m>x</#macro>${m?is_directive}/${m?is_macro}/${m?is_method}'),
    'true/true/false');
    snapshot(await out(
      '<#function f><#return 1></#function>${f?is_method}/${f?is_macro}'),
    'true/false');
    snapshot(await out('${x?is_method}', { x: () => 1 }), 'true');
  });

  it('?is_date and the date-kind built-ins', async () => {
    snapshot(await out('${d?is_date}', { d: new Date('2020-01-01T00:00:00Z') }), 'true');
    snapshot(await out('${d?is_time}', { d: new Date() }), 'false');
    snapshot(await out('${d?is_datetime}', { d: new Date() }), 'true');
    snapshot(await out('${d?is_date_only}', { d: new Date() }), 'false');
    snapshot(await out('${d?is_date_like}', { d: new Date() }), 'true');
    snapshot(await out('${d?is_date_like}', { d: 1 }), 'false');
  });

  it('zero-arg built-ins followed by (args) hit the method-call error', async () => {
    await rejectsMatch(out('${"a"?upper_case("b")}'), TemplateException, ['not a method']);
  });
});
