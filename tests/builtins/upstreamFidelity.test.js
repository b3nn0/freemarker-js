// Assertions ported from upstream freemarker-core test classes
// (CAndCnBuiltInTest, IndentAndWrapBuiltInTest, TruncateBuiltInTest,
// DefaultTruncateBuiltinAlgorithmTest, LinesBuiltInTest, MinMaxBITest,
// TakeWhileAndDropWhileBiTest, WithArgsBuiltInTest) plus semantics pinned
// against the JVM via differential probes. Wording of error messages follows
// the port's style; line/column blaming is asserted separately elsewhere.

import { describe, it, snapshot, throwsMatch, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  ParseException, TemplateException, InvalidReferenceException,
} from '../../src/errors.js';

function out(src, model) {
  return new Template('t.ftl', src, new Configuration()).processToString(model ?? {});
}

describe('Upstream CAndCnBuiltInTest (ported subset)', () => {
  it('?c numbers use the C-template format', async () => {
    snapshot(await out('${1.0?c}|${1.000000000000001?c}', {}), '1|1.000000000000001');
    snapshot(await out('${0.0000000000000001?c}|${(-0.0000000000000001)?c}', {}),
      '1E-16|-1E-16');
    snapshot(await out('${2147483647?c}', {}), '2147483647');
    // no scientific-notation number literals in FTL (upstream rejects "1e-16" too);
    // exponential output forms come from small/large plain literals:
    snapshot(await out('${0.000001?c}', {}), '0.000001');
    throwsMatch(() => new Template('t.ftl', '${1e20?c}', new Configuration()),
      ParseException, ['Expected "}"']);
    snapshot(await out('${(1 / 3)?c}', {}), '0.3333333333333333'); // <- deviation:
    // upstream divides with BigDecimal scale 12 ("0.333333333333")
  });

  it('?c/?cn strings get quoted and escaped', async () => {
    snapshot(await out('${"a\nb\u0000c"?cn}', {}), '"a\\nb\\u0000c"');
    snapshot(await out('${"quote\\"here"?cn}', {}), '"quote\\"here"');
  });

  it('?c/?cn booleans; dates rejected', async () => {
    snapshot(await out('${true?c}|${false?cn}', {}), 'true|false');
    await rejectsMatch(out('${newDate?cn}', { newDate: new Date(0) }),
      TemplateException, ['Expected a number, boolean, or string']);
  });

  it('?cn on null renders the literal "null"; ?c errors', async () => {
    snapshot(await out('${nosuch?cn}', {}), 'null');
    await rejectsMatch(out('${nosuch?c}', {}), InvalidReferenceException,
      ['null or missing']);
  });
});

describe('Upstream IndentAndWrapBuiltInTest (ported subset)', () => {
  it('?indent indents every line and right-trims', async () => {
    snapshot(await out('${"x  \ny"?indent("# ")}', {}), '# x\n# y');
    snapshot(await out('${"a\r\nb"?indent("..")}', {}), '..a\r\n..b');
    snapshot(await out('${"x\ny"?indent("", false)}', {}), 'x\ny');
  });

  it('?indent arity and argument types', async () => {
    await rejectsMatch(out('${""?indent()}', {}), TemplateException,
      ['?indent(...) expects 1 or 2 arguments']);
    await rejectsMatch(out('${""?indent(1, 2, 3)}', {}), TemplateException,
      ['?indent(...) expects 1 or 2 arguments']);
    await rejectsMatch(out('${""?indent(1)}', {}), TemplateException,
      ['string as argument #1']);
    await rejectsMatch(out('${""?indent(" ", "yes")}', {}), TemplateException,
      ['boolean as argument #2']);
    await rejectsMatch(out('${"a b"?indent}', {}), TemplateException,
      ['evaluated to a method']);
  });

  it('?dedent: bare form strips common indentation; method form a prefix', async () => {
    snapshot(await out('${"  a\n  b"?dedent}', {}), 'a\nb');
    snapshot(await out('${"  a\n b"?dedent}', {}), ' a\nb');
    snapshot(await out('${"\ta\n b"?dedent}', {}), '\ta\n b');
    snapshot(await out('${"  a\n b"?dedent(" ")}', {}), ' a\nb');
    snapshot(await out('${""?dedent}', {}), '');
  });

  it('?dedent arity', async () => {
    await rejectsMatch(out('${""?dedent()}', {}), TemplateException,
      ['?dedent(...) expects 1 or 2 arguments']);
    await rejectsMatch(out('${""?dedent(1)}', {}), TemplateException,
      ['string as argument #1']);
    await rejectsMatch(out('${""?dedent("  ", 2)}', {}), TemplateException,
      ['boolean as argument #2']);
  });

  it('?wrap reflows words with prefixes', async () => {
    snapshot(await out('${"a b c d e f g h"?wrap(5)}', {}), 'a b c\nd e f\ng h\n');
    snapshot(await out('${"a b c d e f g h"?wrap(5, "|", ">>")}', {}),
      '|a b\n>>c d\n>>e f\n>>g h\n');
    snapshot(await out('${""?wrap(3)}', {}), '\n');
    snapshot(await out('${"abcd"?wrap(2)}', {}), 'abcd\n');
  });

  it('?wrap arity and width validation', async () => {
    await rejectsMatch(out('${""?wrap()}', {}), TemplateException,
      ['?wrap(...) expects 1 to 3 arguments']);
    await rejectsMatch(out('${""?wrap(4, "*", "**", "***")}', {}), TemplateException,
      ['?wrap(...) expects 1 to 3 arguments']);
    await rejectsMatch(out('${""?wrap(0)}', {}), TemplateException,
      ['(width) must be at least 1']);
    await rejectsMatch(out('${""?wrap("4")}', {}), TemplateException,
      ['number as argument #1']);
  });
});

describe('Upstream Truncate / DefaultTruncateBuiltinAlgorithmTest (ported subset)', () => {
  it('?truncate default algorithm', async () => {
    snapshot(await out('${"abcdefgh"?truncate(5)}', {}), '[...]');
    snapshot(await out('${"abcdefgh"?truncate(6)}', {}), 'a[...]');
    snapshot(await out('${"abcdefgh"?truncate(7)}', {}), 'ab[...]');
    snapshot(await out('${"abcdefgh"?truncate(8)}', {}), 'abcdefgh');
    snapshot(await out('${"abcdefgh"?truncate_c(6)}', {}), 'a[...]');
  });

  it('?truncate_w keeps whole words', async () => {
    snapshot(await out('${"ab cd ef gh"?truncate_w(9)}', {}), 'ab [...]');
    snapshot(await out('${"ab cd ef gh"?truncate_w(8)}', {}), 'ab [...]');
  });

  it('?truncate_m uses the markup terminator (keep = maxLength - 3)', async () => {
    snapshot(await out('${"abcdefgh"?truncate_m(8)}', {}), 'abcdefgh');
    snapshot(await out('${"abcdefgh"?truncate_m(5)}', {}),
      'ab<span class=\'truncateTerminator\'>[&#8230;]</span>');
  });

  it('bare truncate variants are methods', async () => {
    await rejectsMatch(out('${"abc"?truncate}', {}), TemplateException,
      ['evaluated to a method']);
  });
});

describe('Upstream LinesBuiltInTest + MinMaxBITest (ported subset)', () => {
  it('?lines splits at every line-break kind', async () => {
    snapshot(await out('[<#list "a\nb\r\nc\n"?lines as l>${l};</#list>]', {}),
      '[a;b;c;]');
  });

  it('?min/?max over sequences and ranges', async () => {
    snapshot(await out('${[3, 1, 2]?min}-${[3, 1, 2]?max}', {}), '1-3');
    snapshot(await out('${(1..2)?min}-${(1..2)?max}', {}), '1-2');
  });
});

describe('Error-message line/column blaming (user-facing requirement)', () => {
  it('parse errors carry the exact position', () => {
    const e = throwsMatch(() => new Template('t.ftl', '${1?even}', new Configuration()),
      ParseException, ['Unknown built-in: "even"']);
    if (!/in line 1, column \d+/.test(e.message)) throw new Error('missing position: ' + e.message);
  });

  it('runtime errors blame the failing expression', async () => {
    await rejectsMatch(out('${x[5]!\n}', { x: 1 }), TemplateException,
      ['String index out of range', 'in template "t.ftl" at line 1']);
  });
});
