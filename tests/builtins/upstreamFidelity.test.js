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

describe('Upstream BreakAndContinuePlacementTest (ported subset)', () => {
  it('valid break/continue placements', async () => {
    snapshot(await out('<#assign x = 1><#switch x><#case 1>one<#break><#case 2>two</#switch>', {}), 'one');
    snapshot(await out('<#list 1..2 as x>${x}<#break></#list>', {}), '1');
    snapshot(await out('<#list 1..2 as x>${x}<#continue></#list>', {}), '12');
    // a break inside #items exits only the #items loop; the list body finishes first
    snapshot(await out('<#list 1..2>[<#items as x>${x}<#break></#items>]</#list>', {}), '[1]');
    // a break in an items-form body (outside #items) escapes to the enclosing loop
    snapshot(await out('<#list 1..2 as x>${x}<#list 1..3>B<#break>E<#items as y></#items></#list>E</#list>.', {}), '1B.');
    snapshot(await out('<#list 1..2 as x>${x}<#list 3..4 as x>${x}<#break></#list>;</#list>', {}), '13;23;');
    snapshot(await out('<#list [1..2, 3..4, [], 5..6] as xs>[<#list xs as x>${x}<#else><#break></#list>]</#list>.', {}),
      '[12][34][.');
    snapshot(await out('<#list [1..2, 3..4, [], 5..6] as xs>'
      + '<#list xs>[<#items as x>${x}</#items>]<#else><#break></#list></#list>.', {}), '[12][34].');
    snapshot(await out('<#list 1..2 as x><#switch x><#on 1>one<#break></#switch>;</#list>', {}), 'one');
    snapshot(await out('<#list 1..2 as x><#switch x><#on 1>one<#continue></#switch>;</#list>', {}), 'one;');
    snapshot(await out('<#forEach x in 1..2>${x}<#break></#forEach>', {}), '1');
    snapshot(await out('<#forEach x in 1..2>${x}<#continue></#forEach>', {}), '12');
    snapshot(await out('<#switch 1><#case 1>1<#break>unreachable</#switch>.', {}), '1.');
    snapshot(await out('<#switch 1><#default>1<#break>unreachable</#switch>.', {}), '1.');
  });

  it('invalid placements fail at parse time with a position', () => {
    for (const tpl of [
      '<#break>', '<#continue>',
      '<#switch 1><#case 1>1<#continue></#switch>',
      '<#switch 1><#on 1>1<#continue></#switch>',
      '<#switch 1><#on 1>1<#break></#switch>',
      '<#switch 1><#on 1>1<#default><#break></#switch>',
      '<#list 1..2 as x>${x}</#list><#break>',
      '<#if false><#break></#if>',
      '<#list xs><#break></#list>',
      '<#list 1..2 as x>${x}<#else><#break></#list>',
    ]) {
      const e = throwsMatch(() => new Template('t.ftl', tpl, new Configuration()),
        ParseException, ['directive here']);
      if (!/#(break|continue)/.test(e.message) || !/in line 1, column \d+/.test(e.message)) {
        throw new Error('missing position for ' + tpl + ': ' + e.message);
      }
    }
  });

  it('#break cannot cross a #macro boundary (upstream i23 behavior)', () => {
    throwsMatch(() => new Template('t.ftl',
      '<#list 1..2 as x>${x}<#macro m><#break></#macro></#list>', new Configuration()),
      ParseException, ['#break']);
  });
});

describe('Upstream SwitchTest (ported subset)', () => {
  it('#case fall-through basics', async () => {
    for (let i = 1; i <= 6; i++) {
      for (const hd of [true, false]) {
        snapshot(await out('[<#switch ' + i + '>\n<#case 3>Case 3<#break><#case 1>Case 1<#break>'
          + '<#case 4><#case 5>Case 4 or 5<#break><#case 2>Case 2<#break>'
          + (hd ? '<#default>D' : '') + '</#switch>]', {}),
          i < 6 ? '[Case ' + (i < 4 ? i : '4 or 5') + ']' : (hd ? '[D]' : '[]'));
      }
    }
  });

  it('#on stops at first match, supports multi-value #on', async () => {
    for (let i = 1; i <= 6; i++) {
      for (const hd of [true, false]) {
        snapshot(await out('[<#switch ' + i + '>\n<#on 3>On 3<#on 1>On 1<#on 4, 5>On 4 or 5'
          + '<#on 2>On 2' + (hd ? '<#default>D' : '') + '</#switch>]', {}),
          i < 6 ? '[On ' + (i < 4 ? i : '4 or 5') + ']' : (hd ? '[D]' : '[]'));
      }
    }
  });

  it('oddly-placed #default and #default-only still work', async () => {
    snapshot(await out('<#list 1..3 as i><#switch i><#case 1>1<#default>D<#case 3>3</#switch>;</#list>', {}),
      '1D3;D;3;');
    snapshot(await out('<#switch 1><#default>D</#switch>', {}), 'D');
    snapshot(await out('<#list 1..2 as i><#switch 1><#default>D<#break>unreachable</#switch></#list>', {}), 'DD');
  });

  it('whitespace handling: #on is not a whitespace-stripping tag', async () => {
    snapshot(await out('<#list 1..3 as i>\n[\n  <#switch i>\n    <#case 1>C1\n    <#case 2>C2<#break>\n'
      + '    <#default>D\n  </#switch>\n]\n</#list>', {}), '[\nC1\n    C2]\n[\nC2]\n[\nD\n]\n');
    snapshot(await out('<#list 1..3 as i>\n[\n  <#switch i>\n    <#on 1>C1\n    <#on 2>C2\n'
      + '    <#default>D\n  </#switch>\n]\n</#list>', {}), '[\nC1\n    ]\n[\nC2\n    ]\n[\nD\n]\n');
    snapshot(await out('<#list 1..3 as i>\n[\n  <#switch i>\n    <#on 1>C1<#t>\n    <#on 2>C2<#t>\n'
      + '    <#default>D<#t>\n  </#switch>\n]\n</#list>', {}), '[\nC1]\n[\nC2]\n[\nD]\n');
  });

  it('#on/#case/#default mixing errors (upstream message parts)', () => {
    const errs = [
      ['<#switch x><#on 1>On 1<#default>D<#on 2>On 2</#switch>', '#on after #default'],
      ['<#switch x><#on 1>On 1<#default>D<#on 2>On 2</#switch>', '#default must come last'],
      ['<#switch x><#on 1>On 1<#case 2>On 2</#switch>', "can't use both #on, and #case"],
      ['<#switch x><#on 1>On 1<#case 2>On 2</#switch>', 'already had an #on'],
      ['<#switch x><#case 1>On 1<#on 2>On 2</#switch>', 'already had a #case'],
      ['<#switch x><#on 1>On 1<#default>D1<#default>D2</#switch>', 'already had a #default'],
      ['<#switch x><#default>D<#on 2>On 2</#switch>', '#on after #default'],
    ];
    for (const [tpl, part] of errs) {
      throwsMatch(() => new Template('t.ftl', tpl, new Configuration()), ParseException, [part]);
    }
  });
});

describe('Upstream UnclosedCommentTest (ported; modern i21+ behavior)', () => {
  it('unclosed comment/noparse fail at parse time blaming the open tag', () => {
    const cases = [
      ['foo<#--', 'Unclosed'],
      ['foo<#-- ', 'Unclosed'],
      ['foo<#--bar', 'Unclosed'],
      ['foo\n<#--\n', 'Unclosed'],
      ['foo<#noparse>', 'Unclosed'],
      ['foo<#noparse> ', 'Unclosed'],
      ['foo<#noparse>bar', 'Unclosed'],
      ['foo\n<#noparse>\n', 'Unclosed'],
    ];
    for (const [tpl, part] of cases) {
      throwsMatch(() => new Template('t.ftl', tpl, new Configuration()), ParseException, [part]);
    }
  });
});

describe('Loop-variable built-in parse check (FTL.jj checkLoopVariableBuiltInLHO)', () => {
  it('left-hand operand must be a simple loop-variable identifier', () => {
    const bad = [
      ['${"abc"?index}', 'must be a simple loop variable name'],
      ['<#assign y=1><#list 1..2 as x>${y?index}</#list>',
        'must be a loop variable, but there\'s no loop variable in scope with this name: y'],
      ['<#list 1..2 as x>${(1..3)?has_next}</#list>', 'must be a simple loop variable name'],
      ['${x?counter}', 'no loop variable in scope with this name: x'],
    ];
    for (const [tpl, part] of bad) {
      const e = throwsMatch(() => new Template('t.ftl', tpl, new Configuration()),
        ParseException, [part]);
      if (!/in line 1, column \d+/.test(e.message)) throw new Error('no position: ' + e.message);
    }
  });

  it('loop variables (as + #items + hash value var) are accepted', async () => {
    snapshot(await out('<#list 1..2 as x>${x?index}${x?counter}</#list>', {}), '0112');
    snapshot(await out('<#list 1..2>[<#items as x>${x?index}</#items>]</#list>', {}), '[01]');
    snapshot(await out('<#list h as k, v>${k?index}-${v?index}</#list>', { h: { k1: 'v1', k2: 'v2' } }), '0-01-1');
  });
});
