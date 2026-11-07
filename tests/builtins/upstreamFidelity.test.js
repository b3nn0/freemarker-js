// Assertions ported from upstream freemarker-core test classes
// (CAndCnBuiltInTest, IndentAndWrapBuiltInTest, TruncateBuiltInTest,
// DefaultTruncateBuiltinAlgorithmTest, LinesBuiltInTest, MinMaxBITest,
// TakeWhileAndDropWhileBiTest, WithArgsBuiltInTest) plus semantics pinned
// against the JVM via differential probes. Wording of error messages follows
// the port's style; line/column blaming is asserted separately elsewhere.

import { describe, it, snapshot, throwsMatch, rejectsMatch, ok } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  ParseException, TemplateException, InvalidReferenceException, NonStringOrTemplateOutputException,
  NonNumericalException, NonSequenceOrCollectionException,
} from '../../src/errors.js';
import { SETTING_NAMES, CAMEL_SETTING_NAMES } from '../../src/parser/ast/directives/setting.js';
import { DOT_VAR_NAMES } from '../../src/parser/parser.js';

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
    // <- BigDecimalEngine division: minScale 12, ROUND_HALF_UP (JVM-verified)
    snapshot(await out('${(1 / 3)?c}', {}), '0.333333333333');
    snapshot(await out('${(2 / 3)?c}', {}), '0.666666666667');
    snapshot(await out('${(100 / 3)?c}', {}), '33.333333333333');
    snapshot(await out('${((1 / 3) * 3)?c}', {}), '0.999999999999');
    snapshot(await out('${(0.1 + 0.2)?c}', {}), '0.3');
    snapshot(await out('${(0.1 + 0.2 == 0.3)?c}', {}), 'true');
    snapshot(await out('${(7.5 % 2)?c}', {}), '1');
    snapshot(await out('${(-7.5 % 2)?c}', {}), '-1');
    snapshot(await out('${(10 / 4)?c}', {}), '2.5');
    snapshot(await out('${(100000000000000000000000)?c}', {}), '100000000000000000000000');
    snapshot(await out('${(0.10000000000000000001)?c}', {}), '0.10000000000000000001');
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

describe('Upstream ListBreakContinueTest + SepParsingBugTest (ported subset)', () => {
  it('break/continue skip the rest of the body but keep the loop going', async () => {
    const listed = [1, 2, 3, 4, 5];
    snapshot(await out('<#list listed as i>B(${i}) <#if i == 3>Break!<#break></#if>A(${i})<#sep>, </#list>',
      { listed }), 'B(1) A(1), B(2) A(2), B(3) Break!');
    snapshot(await out('<#list listed as i>B(${i}) <#if i == 3>Continue! <#continue></#if>A(${i})'
      + '<#sep>, </#list>', { listed }),
      'B(1) A(1), B(2) A(2), B(3) Continue! B(4) A(4), B(5) A(5)');
  });

  it('hash listings break/continue', async () => {
    const listed = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]);
    snapshot(await out("<#list listed as k, v>B(${k}=${v}) <#if k == 'c'>Break!<#break></#if>"
      + 'A(${k}=${v})<#sep>, </#list>', { listed }), 'B(a=1) A(a=1), B(b=2) A(b=2), B(c=3) Break!');
    snapshot(await out("<#list listed as k, v>B(${k}=${v}) <#if k == 'c'>Continue! <#continue></#if>"
      + 'A(${k}=${v})<#sep>, </#list>', { listed }),
      'B(a=1) A(a=1), B(b=2) A(b=2), B(c=3) Continue! B(d=4) A(d=4), B(e=5) A(e=5)');
  });

  it('#sep only works as a tag of the active syntax', async () => {
    snapshot(await out('<#list [1, 2] as i>${i}<#sep>, </#list>', {}), '1, 2');
    snapshot(await out('<#list [1, 2] as i>${i}[#sep], </#list>', {}), '1[#sep], 2[#sep], ');
    snapshot(await out('<#list [1, 2] as i>${i}<sep>, </#list>', {}), '1<sep>, 2<sep>, ');
    throwsMatch(() => new Template('t.ftl', '<#sep>', new Configuration()),
      ParseException, ['#sep must be inside']);
  });
});

describe('Upstream ConcatenatedSequenceTest / + operator (ported subset)', () => {
  it('seq + seq makes a listable concatenated sequence, not printable directly', async () => {
    snapshot(await out('<#list [1,2]+[3] as x>${x}</#list>', {}), '123');
    snapshot(await out('${([1,2]+[3])?size}', {}), '3');
    snapshot(await out('<#assign c = [1]+[2]>${c?first}-${c?last}', {}), '1-2');
    await rejectsMatch(out('${[1,2]+[3]?size}', {}), NonStringOrTemplateOutputException,
      ['Expected a string or something automatically convertible to string']);
    snapshot(await out('${"a"+[1,2]?size}', {}), 'a2'); // "a" + 2
  });

  it('?map / ?filter lambda built-ins', async () => {
    snapshot(await out('[${[1, 2]?map(x -> x*2)?join(",")}] [${[1,2,3]?filter(x -> x>1)?join(",")}]', {}),
      '[2,4] [2,3]');
  });
});

describe('Upstream iso() time-zone arguments (JVM-pinned)', () => {
  it('accepts offset-style and IANA zone ids, DST-aware', async () => {
    const d = new Date(1600000000000); // 2020-09-13T12:26:40Z
    snapshot(await out('${d?datetime?iso("UTC")}', { d }), '2020-09-13T12:26:40Z');
    snapshot(await out('${d?datetime?iso("GMT+2")}', { d }), '2020-09-13T14:26:40+02:00');
    snapshot(await out('${d?datetime?iso("Europe/Berlin")}', { d }), '2020-09-13T14:26:40+02:00');
    snapshot(await out('${d?datetime?iso_h("Europe/Berlin")}', { d }), '2020-09-13T14+02:00');
    snapshot(await out('${d?datetime?iso("America/New_York")}', { d }), '2020-09-13T08:26:40-04:00');
    snapshot(await out('${d?datetime?iso_m("Australia/Eucla")}', { d }), '2020-09-13T21:11+08:45');
  });

  it('rejects "Z" and unknown zone names', async () => {
    const d = new Date(1600000000000);
    await rejectsMatch(out('${d?datetime?iso("Z")}', { d }),
      TemplateException, ['is not recognized as a valid time zone name: "Z"']);
    await rejectsMatch(out('${d?datetime?iso("bogus/zone")}', { d }),
      TemplateException, ['is not recognized as a valid time zone name: "bogus/zone"']);
  });
});

describe('time_zone setting (JVM-pinned, Drv26)', () => {
  it('shifts java-pattern and iso_local rendering', async () => {
    const d = new Date(1600000000000); // 2020-09-13T12:26:40Z
    snapshot(await out('<#setting time_zone="Asia/Tokyo">'
      + '${d?datetime?string("yyyy-MM-dd HH:mm:ss")}', { d }), '2020-09-13 21:26:40');
    snapshot(await out('<#setting time_zone="Asia/Tokyo">${d?datetime?iso_local}', { d }),
      '2020-09-13T21:26:40+09:00');
    snapshot(await out('<#setting time_zone="GMT+2">${d?datetime?iso_local_h}', { d }),
      '2020-09-13T14+02:00');
  });

  it('unresolvable time_zone keeps the default (no error)', async () => {
    const d = new Date(1600000000000);
    snapshot(await out('<#setting time_zone="bogus/x">${d?datetime?string("yyyy-MM")}', { d }),
      '2020-09');
  });
});

describe('#attempt/#recover (JVM-pinned, FTL.jj Attempt/Recover)', () => {
  it('runs recovery body once on failure; #recover required', async () => {
    snapshot(await out('[<#attempt>${s.missing}<#recover>rec</#attempt>]', { s: 'abc' }), '[rec]');
    snapshot(await out('[<#attempt>before<#recover>after</#attempt>]', { s: 'abc' }), '[before]');
    snapshot(await out('[<#attempt>${s.x}<#recover><#if false>y</#if></#attempt>]', { s: 'abc' }), '[]');
  });

  it('exactly one of </#recover> / </#attempt> closes; both is a parse error', async () => {
    throwsMatch(() => new Template('t.ftl',
      '[<#attempt>${s.missing}<#recover>${nosuch}</#recover></#attempt>]', new Configuration()),
      ParseException, ['line 1, column 54']);
    throwsMatch(() => new Template('t.ftl',
      '[<#attempt><#if true>${s.y}<#else>x</#if><#recover>seen</#recover></#attempt>]',
      new Configuration()), ParseException, ['line 1, column 67']);
  });

  it('#attempt without #recover is a parse error; recover-body errors propagate', async () => {
    throwsMatch(() => new Template('t.ftl', '[<#attempt>z</#attempt>]', new Configuration()),
      ParseException, ['line 1']);
    await rejectsMatch(
      out('[<#attempt>x${s.q}<#recover>a${s.r}b</#attempt>]', { s: 'abc' }),
      TemplateException, ['Expected a hash']);
  });

  it('break/continue inside #attempt propagate to the enclosing loop', async () => {
    snapshot(await out('[<#list [1,2,3] as i><#attempt><#if i==2><#break></#if>${i}'
      + '<#recover>r</#attempt></#list>]', {}), '[1]');
    snapshot(await out('[<#list [1,2,3] as i><#attempt><#if i==2><#continue></#if>${i}'
      + '<#recover>r</#attempt></#list>]', {}), '[13]');
  });
});

describe('Upstream ?word_list (JVM-pinned)', () => {
  it('splits on whitespace, no empty words', async () => {
    snapshot(await out('${" a  b\tc\n "?word_list?join("|")}', {}), 'a|b|c');
    snapshot(await out('${""?word_list?size}', {}), '0');
    snapshot(await out('${" "?word_list?size}', {}), '0');
    snapshot(await out('${"abc"?word_list?size}', {}), '1');
    snapshot(await out('${"a b"?word_list?last}', {}), 'b');
  });
});

describe('Upstream ?matches (JVM-pinned)', () => {
  it('full-string java-style regex matching with inline i/s/m flags', async () => {
    snapshot(await out('${("abc")?matches("a.c")?c}', {}), 'true');
    snapshot(await out('${("abc")?matches("ab")?c}', {}), 'false');
    snapshot(await out('${("a.c")?matches("a\\\\.c")?c}', {}), 'true');
    snapshot(await out('${("ab")?matches("^[ab]+$")?c}', {}), 'true');
    snapshot(await out('${("Hello")?matches("(?i)hello")?c}', {}), 'true');
    snapshot(await out('${("abc")?matches(1)?c}', {}), 'false'); // number arg coerced
  });

  it('malformed patterns throw', async () => {
    await rejectsMatch(out('${("abc")?matches("(")?c}', {}),
      TemplateException, ['Malformed regular expression', 'line 1, column 1']);
  });
});

describe('Upstream hex number literals (JVM-pinned)', () => {
  it('0x literals evaluate exactly like BigDecimalEngine.hexadecimalToNumber', async () => {
    snapshot(await out('${0xFF}|${0Xff?c}', {}), '255|255');
    snapshot(await out('${0xFFFFFFFF?c}', {}), '4294967295');
    snapshot(await out('${0xFFFFFFFFFFFFFFFFFF?c}', {}), '4722366482869645213695');
    snapshot(await out('${0x08?c}', {}), '8');
    snapshot(await out('${(0xFF + 1)?c}', {}), '256');
  });

  it('0x without digits is a parse error', async () => {
    throwsMatch(() => out('${0x?c}', {}), ParseException, ['line 1, column 4']);
  });
});

describe('Upstream ?interpret (JVM-pinned)', () => {
  it('assign + <@d/> renders the parsed string in current scope', async () => {
    snapshot(await out('<#assign x="W"><#assign d="Hi ${x}"?interpret>[<@d/>]', {}), '[Hi W]');
    snapshot(await out('<#assign d="A<#if false>B</#if>C"?interpret>[<@d/>]', {}), '[AC]');
  });

  it('macros defined inside the body are callable inside the body', async () => {
    snapshot(await out('<#assign d="<#macro zz>Z</#macro><@zz/>"?interpret>[<@d/>]', {}), '[Z]');
  });

  it('parse failure reports the ?interpret wrapper error', async () => {
    await rejectsMatch(out('<#assign d="bad <#if>"?interpret>', {}),
      TemplateException, ['Template parsing with "?interpret" has failed', 'line 1, column 1']);
  });

  it('non-string left-hand operand and interpolation are rejected', async () => {
    await rejectsMatch(out('<#assign d=1?interpret>', {}),
      TemplateException, ['Expected a sequence or string', 'number']);
    await rejectsMatch(out('<#assign d="x"?interpret>[${d}]', {}),
      TemplateException, ['has evaluated to a transform']);
  });

  it('#nested inside the body fails to parse (2.3.36)', async () => {
    await rejectsMatch(out('<#assign d="X<#nested>Y"?interpret>[<@d/>]', {}),
      TemplateException, ['Template parsing with "?interpret" has failed']);
  });
});

describe('Upstream !/?? last-step-only semantics (JVM-pinned)', () => {
  it('"!" covers only the failing last step', async () => {
    snapshot(await out('${h.miss!"d"}', { h: {} }), 'd');
    await rejectsMatch(out('${a.miss!"d"}', {}), InvalidReferenceException, ['==> a']);
    await rejectsMatch(out('${h.miss.deeper!"d"}', { h: {} }), InvalidReferenceException,
      ['==> h.miss']);
    snapshot(await out('${(a.miss.deeper)!"d"}', {}), 'd');
  });

  it('bare "x!" prints empty like EmptyStringAndSequenceAndHash', async () => {
    snapshot(await out('${x!}', {}), '');
    snapshot(await out('${h.miss!}', { h: {} }), '');
  });

  it('"h[]" with empty key is a parse error', async () => {
    throwsMatch(() => out('${h[]}', {}), ParseException, ['Expected an expression between']);
  });
});

describe('Upstream .output_format special variable (JVM-pinned)', () => {
  it('prints the current format name (lowercase "undefined" default)', async () => {
    snapshot(await out('${.output_format}', {}), 'undefined');
    snapshot(await out('${.output_format?is_string?c}|${.output_format?length}', {}), 'true|9');
    const cfg = new Configuration();
    cfg.setOutputFormat('HTML');
    snapshot(await new Template('t', '${.output_format}', cfg).processToString({}), 'HTML');
  });
});

describe('Upstream boolean_format legacy semantics (JVM-pinned)', () => {
  it('auto-printing a boolean errors while boolean_format is the legacy default', async () => {
    await rejectsMatch(out('${true}', {}), TemplateException,
      ['legacy deprecated default', 'line 1, column 1']);
    await rejectsMatch(out('<#setting boolean_format="true,false">${true}', {}), TemplateException,
      ['legacy deprecated default']);
    await rejectsMatch(out('${false && x}', {}), TemplateException, ['legacy deprecated default']);
  });

  it('explicit formats print; ?string/?c/?string(y,n) bypass the legacy error', async () => {
    snapshot(await out('<#setting boolean_format="y,n">${true}/${false}', {}), 'y/n');
    snapshot(await out('<#setting boolean_format="c">${true}', {}), 'true');
    snapshot(await out('${true?string}|${true?c}|${true?string("Y","N")}', {}), 'true|true|Y');
    snapshot(await out('<#setting boolean_format="y,n">${true?string}', {}), 'y');
  });
});

// <- Upstream StringBuiltInTest (blank/trim/empty-to-null; HTML output format,
// number_format ",##0.###"). Wording of type errors follows the port's style.
describe('Upstream StringBuiltInTest (ported)', () => {
  const cfg = () => {
    const c = new Configuration();
    c.setOutputFormat('HTML');
    c.setNumberFormat(',##0.###');
    return c;
  };
  const o = (src) => new Template('t.ftl', src, cfg()).processToString({});

  it('blank_to_null', async () => {
    snapshot(await o("${nonExisting?blank_to_null!'-'}"), '-');
    snapshot(await o("${nonExisting!?blank_to_null!'-'}"), '-');
    snapshot(await o("${''?blank_to_null!'-'}"), '-');
    snapshot(await o("${' '?blank_to_null!'-'}"), '-');
    snapshot(await o("${'  a  '?blank_to_null!'-'}"), '  a  ');
    snapshot(await o("${'a '?blank_to_null!'-'}"), 'a ');
    snapshot(await o("${' a'?blank_to_null!'-'}"), ' a');
    snapshot(await o("${'a'?blank_to_null!'-'}"), 'a');
    snapshot(await o("${'a b'?blank_to_null!'-'}"), 'a b');
    snapshot(await o("${(nonExisting + '.')?blank_to_null!'-'}"), '-');
    snapshot(await o("${1234?blank_to_null!'-'}"), '1,234');
    // all UNICODE whitespace counts as blank here (unlike ?trim):
    snapshot(await o("${' \u2003  '?blank_to_null!'-'}"), '-');
    snapshot(await o("${' \u00A0  '?blank_to_null!'-'}"), '-');
    // camel case alias:
    snapshot(await o("${nonExisting?blankToNull!'-'}"), '-');
  });

  it('blank_to_null type errors', async () => {
    const e1 = await rejectsMatch(o("${[]?blank_to_null!'-'}"), TemplateException);
    ok(e1.message.includes('Expected a string'), e1.message);
    ok(e1.message.includes('sequence'), e1.message);
    const e2 = await rejectsMatch(o("<#assign html></#assign>${html?blank_to_null!'-'}"), TemplateException);
    ok(e2.message.includes('Expected a string'), e2.message);
    ok(e2.message.includes('markup_output'), e2.message);
  });

  it('trim_to_null', async () => {
    snapshot(await o("${nonExisting?trim_to_null!'-'}"), '-');
    snapshot(await o("${nonExisting!?trim_to_null!'-'}"), '-');
    snapshot(await o("${''?trim_to_null!'-'}"), '-');
    snapshot(await o("${' '?trim_to_null!'-'}"), '-');
    snapshot(await o("${'    '?trim_to_null!'-'}"), '-');
    snapshot(await o("${'  a  '?trim_to_null!'-'}"), 'a');
    snapshot(await o("${'a '?trim_to_null!'-'}"), 'a');
    snapshot(await o("${' a'?trim_to_null!'-'}"), 'a');
    snapshot(await o("${'a'?trim_to_null!'-'}"), 'a');
    snapshot(await o("${'a b'?trim_to_null!'-'}"), 'a b');
    snapshot(await o("${(nonExisting + '.')?trim_to_null!'-'}"), '-');
    snapshot(await o("${1234?trim_to_null!'-'}"), '1,234');
    // consistent with ?trim / String.trim(): only code points <= 32 are whitespace:
    snapshot(await o("${'  \u2003  '?trim_to_null!'-'}"), '\u2003');
    // camel case alias:
    snapshot(await o("${nonExisting?trimToNull!'-'}"), '-');
  });

  it('trim_to_null type errors', async () => {
    const e1 = await rejectsMatch(o("${[]?trim_to_null!'-'}"), TemplateException);
    ok(e1.message.includes('Expected a string'), e1.message);
    const e2 = await rejectsMatch(o("<#assign html></#assign>${html?trim_to_null!'-'}"), TemplateException);
    ok(e2.message.includes('markup_output'), e2.message);
  });

  it('empty_to_null', async () => {
    snapshot(await o("${nonExisting?empty_to_null!'-'}"), '-');
    snapshot(await o("${nonExisting!?empty_to_null!'-'}"), '-');
    snapshot(await o("${''?empty_to_null!'-'}"), '-');
    snapshot(await o("${' '?empty_to_null!'-'}"), ' ');
    snapshot(await o("${'    '?empty_to_null!'-'}"), '    ');
    snapshot(await o("${'  a  '?empty_to_null!'-'}"), '  a  ');
    snapshot(await o("${'a '?empty_to_null!'-'}"), 'a ');
    snapshot(await o("${' a'?empty_to_null!'-'}"), ' a');
    snapshot(await o("${'a'?empty_to_null!'-'}"), 'a');
    snapshot(await o("${'a b'?empty_to_null!'-'}"), 'a b');
    snapshot(await o("${(nonExisting + '.')?empty_to_null!'-'}"), '-');
    snapshot(await o("${1234?empty_to_null!'-'}"), '1,234');
    // camel case alias:
    snapshot(await o("${nonExisting?emptyToNull!'-'}"), '-');
  });

  it('empty_to_null type errors', async () => {
    const e1 = await rejectsMatch(o("${[]?empty_to_null!'-'}"), TemplateException);
    ok(e1.message.includes('Expected a string'), e1.message);
    const e2 = await rejectsMatch(o("<#assign html></#assign>${html?empty_to_null!'-'}"), TemplateException);
    ok(e2.message.includes('markup_output'), e2.message);
  });
});

// <- Upstream CamelCaseTest (ported subset; JVM-verified). The header-parameter
// twins are covered in tests/syntax/modes.test.js.
describe('Upstream CamelCaseTest (ported subset)', () => {
  it('camelCase built-in names', async () => {
    snapshot(await out("${'x'?upperCase}", {}), 'X');
    snapshot(await out("${'x'?upper_case}", {}), 'X');
    throwsMatch(() => new Template('t.ftl', "${'x'?upperCase}${'y'?upper_case}", new Configuration()),
      ParseException, ['Naming convention mismatch', 'upper_case']);
  });

  it('camelCase special variables', async () => {
    snapshot(await out('${.dataModel?isHash?c}', {}), 'true');
    snapshot(await out('${.templateName?length?c}', {}), '5');
    throwsMatch(() => new Template('t.ftl', '${.dataModel?isHash?c}${.template_name}', new Configuration()),
      ParseException, ['Naming convention mismatch']);
  });

  it('camelCase setting names', async () => {
    snapshot(await out("<#setting booleanFormat='Y,N'>${true} <#setting booleanFormat='+,-'>${true}", {}), 'Y +');
    // still works inside ?interpret:
    snapshot(await out('<@r"<#setting booleanFormat=\'Y,N\'>${true}"?interpret />', {}), 'Y');
    throwsMatch(() => new Template('t.ftl',
      '<#if true><#elseIf false>x</#if><#setting boolean_format=\'Y,N\'>', new Configuration()),
    ParseException, ['Naming convention mismatch']);
    throwsMatch(() => new Template('t.ftl', '<#setting fooBar=1>', new Configuration()),
      ParseException, ['Unknown setting name']);
  });

  it('camelCase #include parameters', async () => {
    snapshot(await out("<#ftl stripWhitespace=true>[<#include 'noSuch' ignoreMissing=true>]", {}), '[]');
    snapshot(await out("<#ftl strip_whitespace=true>[<#include 'noSuch' ignore_missing=true>]", {}), '[]');
    throwsMatch(() => new Template('t.ftl',
      "<#ftl stripWhitespace=true>[<#include 'noSuch' ignore_missing=true>]", new Configuration()),
    ParseException, ['Naming convention mismatch']);
    throwsMatch(() => new Template('t.ftl',
      "<#ftl strip_whitespace=true>[<#include 'noSuch' ignoreMissing=true>]", new Configuration()),
    ParseException, ['Naming convention mismatch']);
  });

  it("?eval and ?interpret don't leak naming convention <- CamelCaseTest", async () => {
    snapshot(await out("${\"'x'?upperCase\"?eval}${'x'?upper_case}", {}), 'XX');
    snapshot(await out("<@r\"${'x'?upperCase}\"?interpret />${'x'?upper_case}", {}), 'XX');
  });

  it('unknown names keep convention-aware suggestions', async () => {
    throwsMatch(() => new Template('t.ftl', '<#ftl strip_text=true xmlns={}>', new Configuration()),
      ParseException, ['ns_prefixes']);
    throwsMatch(() => new Template('t.ftl', "<#ftl ns_prefixes={'p':'u'}><#p:if true>x</#p:if>",
      new Configuration()), ParseException, ['Unknown directive']);
  });
});

// <- Upstream SequenceBuiltInTest (ported subset; the collection-adapter cases
// need Java collections and are JVM-only). JVM-verified via probe Drv65.
describe('Upstream SequenceBuiltInTest (ported subset)', () => {
  it('?sequence on sequences, incl. unbounded ranges', async () => {
    snapshot(await out('${[11, 12]?sequence[1]}', {}), '12');
    snapshot(await out('${(11..)?sequence[1]}', {}), '12');
    snapshot(await out('${(11..)?size}', {}), '2,147,483,647');
    snapshot(await out('${(11..)?seq_index_of(12)?c}', {}), '1');
    snapshot(await out('${(11..)?take_while(x -> x < 13)?join(",")}', {}), '11,12');
    snapshot(await out('<#list (11..) as x>${x}<#break></#list>', {}), '11');
  });

  it('?sequence rejects non-sequences', async () => {
    const e = await rejectsMatch(out('${"a"?sequence}', {}), TemplateException);
    ok(e.message.includes('Expected a sequence or collection'), e.message);
    const e2 = await rejectsMatch(out('${1?sequence}', {}), TemplateException);
    ok(e2.message.includes('a number'), e2.message);
  });
});

// <- Upstream NumberBiTest (ported; upstream pins i2=2.3.21 whose legacy ?c
// prints "INF"/"-INF". The port targets current 2.3.36 behavior, JVM-verified:
// "Infinity"/"-Infinity", and exact BigDecimal parsing).
describe('Upstream NumberBiTest (ported)', () => {
  /** @param {string} input @param {string} output */
  async function assertNumberBi(input, output) {
    snapshot(await out(`\${'${input}'?number?c}`, {}), output);
  }

  it('parses numbers exactly', async () => {
    await assertNumberBi('1', '1');
    await assertNumberBi('-1', '-1');
    await assertNumberBi('1.9000', '1.9');
    await assertNumberBi('19E-1', '1.9');
    await assertNumberBi('1.5E-5', '0.000015');
    await assertNumberBi('12345678901234567890', '12345678901234567890');
  });

  it('accepts + prefix', async () => {
    await assertNumberBi('+1', '1');
  });

  it('special values', async () => {
    await assertNumberBi('INF', 'Infinity');
    await assertNumberBi('-Infinity', '-Infinity');
    await assertNumberBi('NaN', 'NaN');
    snapshot(await out("${'INF'?number}", {}), '\u221E');
    snapshot(await out("<#setting number_format='$#,##0'>${'-INF'?number}", {}), '-$\u221E');
    snapshot(await out("${'NaN'?number}", {}), 'NaN');
  });

  it('rejects non-numbers (no trim, no grouping)', async () => {
    const e1 = await rejectsMatch(out("${'abc'?number}", {}), NonNumericalException);
    ok(e1.message.includes("Can't convert this string to number"), e1.message);
    await rejectsMatch(out("${'1,234'?number?c}", {}), NonNumericalException);
    await rejectsMatch(out("${' 5 '?number?c}", {}), NonNumericalException);
    await rejectsMatch(out("${''?number}", {}), NonNumericalException);
    await rejectsMatch(out("${'+INF'?number?c}", {}), NonNumericalException);
    const e2 = await rejectsMatch(out('${true?number}', {}), TemplateException);
    ok(e2.message.includes('boolean_format'), e2.message);
  });
});

// <- Upstream StringLiteralInterpolationTest (ported; markup()/iciInheritanceBugFixed
// need custom number-format factories, RTF output format and the i2 knob -> JVM-only).
describe('Upstream StringLiteralInterpolationTest (ported)', () => {
  it('basics', async () => {
    snapshot(await out("${'${x}'}", { x: 1 }), '1');
    snapshot(await out("${'#{x}'}", { x: 1 }), '1');
    snapshot(await out("${'a${x}b${x*2}c'}", { x: 1 }), 'a1b2c');
    snapshot(await out("${'a#{x}b#{x*2}c'}", { x: 1 }), 'a1b2c');
    snapshot(await out("${'a#{x; m2}'}", { x: 1 }), 'a1.00');
    snapshot(await out("${'${x} ${x}'}", { x: 1 }), '1 1');
    snapshot(await out("${'$\\{x}'}", { x: 1 }), '${x}');
    snapshot(await out("${'$\\{x} $\\{x}'}", { x: 1 }), '${x} ${x}');
    snapshot(await out("${'<#-- not a comment -->${x}'}", { x: 1 }), '<#-- not a comment -->1');
    snapshot(await out("${'<#-- not a comment -->$\\{x}'}", { x: 1 }),
      '<#-- not a comment -->${x}');
    snapshot(await out("${'<#assign x = 2> ${x} <#assign x = 2>'}", { x: 1 }),
      '<#assign x = 2> 1 <#assign x = 2>');
    snapshot(await out("${'<#assign x = 2> $\\{x} <#assign x = 2>'}", { x: 1 }),
      '<#assign x = 2> ${x} <#assign x = 2>');
    snapshot(await out("${'<@x/>${x}<@x/>'}", { x: 1 }), '<@x/>1<@x/>');
    snapshot(await out("${'<@x/>$\\{x}<@x/>'}", { x: 1 }), '<@x/>${x}<@x/>');
    snapshot(await out("${'<@ ${x}<@'}", { x: 1 }), '<@ 1<@');
    snapshot(await out("${'<@ $\\{x}<@'}", { x: 1 }), '<@ ${x}<@');
    snapshot(await out("${'</@x>${x}'}", { x: 1 }), '</@x>1');
    snapshot(await out("${'</@x>$\\{x}'}", { x: 1 }), '</@x>${x}');
    snapshot(await out("${'</@ ${x}</@'}", { x: 1 }), '</@ 1</@');
    snapshot(await out("${'</@ $\\{x}</@'}", { x: 1 }), '</@ ${x}</@');
    snapshot(await out("${'[@ ${x}'}", { x: 1 }), '[@ 1');
    snapshot(await out("${'[@ $\\{x}'}", { x: 1 }), '[@ ${x}');
  });

  it('legacy escaping bug still present', async () => {
    snapshot(await out("${'$\\{x} ${x}'}", { x: 1 }), '1 1');
    snapshot(await out("${'${x} $\\{x}'}", { x: 1 }), '1 1');
  });

  it('legacy length glitch', async () => {
    snapshot(await out("${'${'}", {}), '${');
    snapshot(await out("${'${1'}", {}), '${1');
    snapshot(await out("${'${}'}", {}), '${}');
    snapshot(await out("${'${1}'}", {}), '1');
    throwsMatch(() => new Template('t.ftl', "${'${  '}", new Configuration()), ParseException);
  });

  it('errors', async () => {
    const e1 = await rejectsMatch(out("${'${noSuchVar}'}", { x: 1 }), InvalidReferenceException);
    ok(e1.message.includes('noSuchVar'), e1.message);
    ok(/line \d+, column \d+/.test(e1.message), e1.message);
    const e2 = await rejectsMatch(out("${'${x/0}'}", { x: 1 }), TemplateException);
    ok(e2.message.includes('0'), e2.message);
  });

  it('escaping', async () => {
    snapshot(await out("<#escape x as x?html><#assign x = '&'>${x} ${'${x}'}</#escape> ${x}", {}),
      '&amp; &amp; &');
  });
});

describe('Upstream TagSyntaxVariationsTest (ported subset)', () => {
  const A = Configuration.ANGLE_BRACKET_TAG_SYNTAX;
  const S = Configuration.SQUARE_BRACKET_TAG_SYNTAX;
  const X = Configuration.AUTO_DETECT_TAG_SYNTAX;
  function tagOut(src, tagSyntax) {
    const cfg = new Configuration();
    cfg.setTagSyntax(tagSyntax);
    return new Template('t.ftl', src, cfg).processToString({});
  }
  it('fixed syntax: tags of the other bracket style are plain text', async () => {
    snapshot(await tagOut('<#if true>i</#if>[#wrong]<#if true>i</#if>', A), 'i[#wrong]i');
    snapshot(await tagOut('<#if true>i</#if>[/#wrong]<#if true>i</#if>', A), 'i[/#wrong]i');
    snapshot(await tagOut('<#ftl>[#wrong]<#if true>i</#if>', A), '[#wrong]i');
    snapshot(await tagOut('[@compress] z [/@]', A), '[@compress] z [/@]');
    snapshot(await tagOut('[#if true]i[/#if]<#wrong>[#if true]i[/#if]', S), 'i<#wrong>i');
    snapshot(await tagOut('[#if true]i[/#if]</#wrong>[#if true]i[/#if]', S), 'i</#wrong>i');
    snapshot(await tagOut('[#ftl]<#wrong>[#if true]i[/#if]', S), '<#wrong>i');
    snapshot(await tagOut('<@compress> z </@>', S), '<@compress> z </@>');
  });
  it('fixed syntax: unknown tag of the active style is a parse error', async () => {
    const mk = (syn) => { const c = new Configuration(); c.setTagSyntax(syn); return c; };
    throwsMatch(() => new Template('t.ftl', '<#wrong>', mk(A)), ParseException, ['Unknown directive']);
    throwsMatch(() => new Template('t.ftl', '<#wrong><#if true>i</#if>', mk(A)),
      ParseException, ['Unknown directive']);
    throwsMatch(() => new Template('t.ftl', '</#wrong><#if true>i</#if>', mk(A)),
      ParseException, ['Unknown directive']);
    throwsMatch(() => new Template('t.ftl', '<#if true>i</#if><#wrong>', mk(A)),
      ParseException, ['Unknown directive']);
    throwsMatch(() => new Template('t.ftl', '<#ftl><#wrong>', mk(A)), ParseException,
      ['Unknown directive']);
    throwsMatch(() => new Template('t.ftl', '[#wrong][#if true]i[/#if]', mk(S)),
      ParseException, ['Unknown directive']);
    // active-style unknown after a mismatched-opener call was demoted to text:
    throwsMatch(() => new Template('t.ftl', '<@compress> z </@>[#wrong]<#if true>i</#if>',
      mk(S)), ParseException, ['Unknown directive']);
  });
  it('auto-detect: unknown tag of either style before establishment errors', async () => {
    const mk = () => { const c = new Configuration(); c.setTagSyntax(X); return c; };
    throwsMatch(() => new Template('t.ftl', '<#wrong><#if true>i</#if>', mk()),
      ParseException, ['Unknown directive']);
    throwsMatch(() => new Template('t.ftl', '[#wrong]<#if true>i</#if>', mk()),
      ParseException, ['Unknown directive']);
  });
  it('auto-detect: first recognized tag establishes the style', async () => {
    snapshot(await tagOut('<#if true>i</#if>[#wrong]<#if true>i</#if>', X), 'i[#wrong]i');
    snapshot(await tagOut('<#ftl>[#wrong]<#if true>i</#if>', X), '[#wrong]i');
    snapshot(await tagOut('[#if true]i[/#if]<#wrong>[#if true]i[/#if]', X), 'i<#wrong>i');
    snapshot(await tagOut('<@compress> z </@>[#wrong]<#if true>i</#if>', X), 'z[#wrong]i');
    snapshot(await tagOut('[@compress] z [/@]<#wrong>[#if true]i[/#if]', X), 'z<#wrong>i');
    snapshot(await tagOut('<@compress> z </@>[/#wrong]<#if true>i</#if>', X), 'z[/#wrong]i');
  });
  it('<@compress> / [@compress] is the built-in compress directive', async () => {
    snapshot(await out('<#if true>i</#if><@compress> z </@>'), 'iz');
    snapshot(await out('x<@compress> a b </@compress>y'), 'xa by');
    snapshot(await out('<#assign x = 1>a<@compress> z </@>'), 'az');
    snapshot(await tagOut('[#if true]i[/#if][@compress] z [/@]', S), 'iz');
    // user definition shadows the core name; the body is then an ordinary macro body:
    snapshot(await out('<#macro compress>H</#macro><@compress>x</@>'), 'H');
    // non-directive shadow fails at runtime with a type error:
    rejectsMatch(() => out('<#assign compress = 1><@compress>x</@>'),
      InvalidReferenceException, ['can\'t be called']);
    // end tag name may be omitted for named calls:
    snapshot(await out('<#macro m>x</#macro><@m>a</@>'), 'x');
    snapshot(await out('<#macro m>x</#macro><@m>a</@m>'), 'x');
  });
});

describe('Upstream EndTagSyntaxTest (ported)', () => {
  const PRE = '<#macro m a=1>${a}[<#nested />]</#macro><#assign ns={"m":m}>';
  const outEnd = (src) => out(PRE + src);
  it('testSimple', async () => {
    snapshot(await outEnd('<@m>nested</@>'), '1[nested]');
    snapshot(await outEnd('<@m a=2>nested</@>'), '2[nested]');
    snapshot(await outEnd('<@ns.m>nested</@ns.m>'), '1[nested]');
    snapshot(await outEnd('<@ns.m a=2>nested</@ns.m>'), '2[nested]');
    snapshot(await outEnd('<@m>nested</@m>'), '1[nested]');
    snapshot(await outEnd('<@m a=2>nested</@m>'), '2[nested]');
    // namespaced callees need the full dotted path in the end tag:
    throwsMatch(() => new Template('t.ftl', PRE + '<@ns.m a=2>nested</@m>', new Configuration()),
      ParseException, ['</@ns.m>']);
    throwsMatch(() => new Template('t.ftl', PRE + '<@m a=2>nested</@n>', new Configuration()),
      ParseException, ['</@m>']);
  });
  it('testWithArgs', async () => {
    snapshot(await outEnd('<@m?withArgs({})>nested</@m>'), '1[nested]');
    snapshot(await outEnd('<@m?withArgs({}) a=2>nested</@m>'), '2[nested]');
    snapshot(await outEnd('<@ns.m?withArgs({})>nested</@ns.m>'), '1[nested]');
    snapshot(await outEnd('<@ns.m?withArgs({}) a=2>nested</@ns.m>'), '2[nested]');
    throwsMatch(() => new Template('t.ftl', PRE + '<@ns.m?withArgs({})>nested</@m>',
      new Configuration()), ParseException, ['</@ns.m>']);
    throwsMatch(() => new Template('t.ftl', PRE + '<@m?withArgs({})>nested</@n>',
      new Configuration()), ParseException, ['</@m>']);
  });
});

describe('Upstream HeaderParsingTest (ported)', () => {
  function headerOut(ftl, i, stripped) {
    let ftlPermutation = ftl;
    if ((i & 1) === 1) ftlPermutation = ftlPermutation.replace('<#ftl>', "<#ftl encoding='utf-8'>");
    if ((i & 2) === 2) ftlPermutation = ftlPermutation.replace(/</g, '[').replace(/>/g, ']');
    const cfg = new Configuration();
    cfg.setWhitespaceStripping(stripped);
    return new Template('t.ftl', ftlPermutation, cfg).processToString({});
  }
  async function assertHeader(ftl, expected) {
    for (let i = 0; i < 4; i++) {
      snapshot(await headerOut(ftl, i, true), expected);
      snapshot(await headerOut(ftl, i, false), expected);
    }
  }
  it('test', async () => {
    await assertHeader('<#ftl>text', 'text');
    await assertHeader(' <#ftl> text', ' text');
    await assertHeader('\n<#ftl>\ntext', 'text');
    await assertHeader('\n \n\n<#ftl> \ntext', 'text');
    await assertHeader('\n \n\n<#ftl>\n\ntext', '\ntext');
  });
});

describe('Upstream SettingDirectiveTest (ported)', () => {
  it('testGetSettingNamesSorted', () => {
    for (const names of [SETTING_NAMES, CAMEL_SETTING_NAMES]) {
      for (let i = 1; i < names.length; i++) ok(names[i] > names[i - 1], 'not sorted');
    }
    // the union matches JVM PropertySetting.SETTING_NAMES exactly:
    snapshot([...new Set([...SETTING_NAMES, ...CAMEL_SETTING_NAMES])].sort().join(','),
      'booleanFormat,boolean_format,cFormat,c_format,classicCompatible,classic_compatible,'
      + 'dateFormat,date_format,datetimeFormat,datetime_format,locale,numberFormat,number_format,'
      + 'outputEncoding,output_encoding,sqlDateAndTimeTimeZone,sql_date_and_time_time_zone,'
      + 'timeFormat,timeZone,time_format,time_zone,urlEscapingCharset,url_escaping_charset');
  });
});

describe('Upstream TabSizeTest (ported)', () => {
  async function errCol(src, tabSize) {
    const cfg = new Configuration();
    cfg.setTabSize(tabSize);
    let msg = '';
    try { await new Template('t.ftl', src, cfg).processToString({}); }
    catch (e) { msg = e.message || ''; }
    ok(msg !== '', 'expected an error for ' + JSON.stringify(src));
    return msg;
  }
  it('testBasics', async () => {
    for (const [col, src] of [[3, '${*}'], [8 + 3, '\t${*}'], [16 + 3, '\t\t${*}'],
      [16 + 3, '  \t  \t${*}']]) {
      ok((await errCol(src, 8)).includes(`column ${col}`),
        `tab 8: column ${col} missing in ${JSON.stringify(src)}`);
    }
    for (const [col, src] of [[3, '${*}'], [1 + 3, '\t${*}'], [2 + 3, '\t\t${*}'],
      [6 + 3, '  \t  \t${*}']]) {
      ok((await errCol(src, 1)).includes(`column ${col}`),
        `tab 1: column ${col} missing in ${JSON.stringify(src)}`);
    }
  });
  it('testEvalBI', async () => {
    ok((await errCol("${r'\t~'?eval}", 8)).includes('column 9'), 'evalBI tab 8');
    ok((await errCol("${r'\t~'?eval}", 4)).includes('column 5'), 'evalBI tab 4');
  });
  it('testInterpretBI', async () => {
    ok((await errCol("<@'\t$\\{*}'?interpret />", 8)).includes('column 11'), 'interpretBI tab 8');
    ok((await errCol("<@'\t$\\{*}'?interpret />", 4)).includes('column 7'), 'interpretBI tab 4');
  });
  it('testStringLiteralInterpolation', async () => {
    ok((await errCol("${'${*}'}", 8)).includes('column 6'), 'SLI no tab');
    ok((await errCol("${'${\t*}'}", 8)).includes('column 9'), 'SLI tab 8');
    ok((await errCol("${'${\t*}'}", 16)).includes('column 17'), 'SLI tab 16');
  });
});

// (IteratorIssuesTest not ported: it exercises BeansWrapper/DefaultObjectWrapper
// wrapping of java.util.Iterator - JVM model-layer API outside the port's scope.)

describe('Upstream ListErrorsTest (ported subset)', () => {
  it('testValid', async () => {
    snapshot(await out('<#list 1..2 as x><#list 3..4>${x}:<#items as x>${x}</#items></#list>;</#list>'),
      '1:34;2:34;');
    snapshot(await out('<#list [] as x>${x}<#else><#list 1..2 as x>${x}<#sep>, </#list></#list>'),
      '1, 2');
    snapshot(await out('<#macro m>[<#nested 3>]</#macro>'
      + '<#list 1..2 as x>'
      + '${x}@${x?index}'
      + '<@m ; x>'
      + '${x},'
      + '<#list 4..4 as x>${x}@${x?index}</#list>'
      + '</@>'
      + '${x}@${x?index}; '
      + '</#list>'),
    '1@0[3,4@0]1@0; 2@1[3,4@0]2@1; ');
  });
  it('stringInterpolationBugFixTest', async () => {
    snapshot(await out("<#list 1..3 as x>${'${x?index}'}</#list>"), '012');
  });
  it('testInvalidItemsParseTime', async () => {
    const listCtx = { xs: [1, 2] };
    for (const [src, subs] of [
      ['<#items as x>${x}</#items>', ['#items', 'must be inside', '#list']],
      ['<#list xs><#macro m><#items as x></#items></#macro></#list>', ['#items', 'must be inside', '#list']],
      ['<#list xs><#forEach x in xs><#items as x></#items></#forEach></#list>', ['#forEach', 'doesn\'t support', '#items']],
      ['<#list xs as x><#items as x>${x}</#items></#list>', ['#list', 'must not have', '#items', 'as loopVar']],
      ['<#list xs><#list xs as x><#items as x>${x}</#items></#list></#list>', ['#list', 'must not have', '#items', 'as loopVar']],
      ['<#list xs></#list>', ['#list', 'must have', '#items', 'as loopVar']],
      ['<#forEach x in xs><#items as x></#items></#forEach>', ['#forEach', 'doesn\'t support', '#items']],
    ]) {
      throwsMatch(() => new Template('t.ftl', src, new Configuration()), ParseException, subs);
      void listCtx;
    }
  });
  it('testInvalidSepParseTime', async () => {
    for (const src of ['<#sep>, </#sep>', '<#sep>, ', '<#list xs as x><#else><#sep>, </#list>',
      '<#list xs as x><#macro m><#sep>, </#macro></#list>']) {
      throwsMatch(() => new Template('t.ftl', src, new Configuration()), ParseException,
        ['#sep', 'must be inside', '#list']);
    }
  });
  it('testInvalidItemsRuntime', async () => {
    rejectsMatch(() => out('<#list 1..1><#items as x></#items><#items as x></#items></#list>'),
      TemplateException, ['#items', 'already entered earlier']);
    throwsMatch(() => new Template('t.ftl',
      '<#list 1..1><#items as x><#items as y>${x}/${y}</#items></#items></#list>',
      new Configuration()), ParseException, ['#items', 'Can\'t nest #items into each other']);
  });
  it('testInvalidLoopVarBuiltinLHO', async () => {
    for (const src of [
      '<#list foos>${foo?index}</#list>',
      '<#list foos as foo></#list>${foo?index}',
      '<#list foos as foo><#macro m>${foo?index}</#macro></#list>',
      '<#list foos as foo><#function f>${foo?index}</#function></#list>',
      '<#list xs as x>${foo?index}</#list>',
    ]) {
      throwsMatch(() => new Template('t.ftl', src, new Configuration()), ParseException,
        ['?index', 'foo', 'no loop variable']);
    }
    for (const src of [
      '<#list foos as foo><@m; foo>${foo?index}</@></#list>',
      '<#list foos as foo><@m; foo><@m; foo>${foo?index}</@></@></#list>',
      '<#list foos as foo><@m; foo>'
      + '<#list foos as foo><@m; foo>${foo?index}</@></#list>'
      + '</@></#list>',
    ]) {
      throwsMatch(() => new Template('t.ftl', src, new Configuration()), ParseException,
        ['?index', 'foo', 'user defined directive']);
    }
  });
  it('testKeyValueSameName', () => {
    throwsMatch(() => new Template('t.ftl', '<#list {} as foo, foo></#list>', new Configuration()),
      ParseException, ['key', 'value', 'both', 'foo']);
  });
  it('testCollectionVersusHash', async () => {
    rejectsMatch(() => out('<#list {} as i></#list>'),
      NonSequenceOrCollectionException, ['as k, v']);
    rejectsMatch(() => out('<#list [] as k, v></#list>'),
      NonSequenceOrCollectionException, ['only one loop variable']);
  });
});

describe('Upstream ListBreakContinueTest (ported subset)', () => {
  const SEQ = { listed: [1, 2, 3, 4, 5] };
  const HASH = { listed: { a: 1, b: 2, c: 3, d: 4, e: 5 } };
  it('testNonHash', async () => {
    snapshot(await out('<#list listed as i>B(${i}) <#if i == 3>Break!<#break></#if>A(${i})<#sep>, </#list>', SEQ),
      'B(1) A(1), B(2) A(2), B(3) Break!');
    snapshot(await out('<#list listed as i>B(${i}) <#if i == 3>Continue! <#continue></#if>A(${i})<#sep>, </#list>', SEQ),
      'B(1) A(1), B(2) A(2), B(3) Continue! B(4) A(4), B(5) A(5)');
  });
  it('testHash', async () => {
    snapshot(await out("<#list listed as k, v>B(${k}=${v}) <#if k == 'c'>Break!<#break></#if>A(${k}=${v})<#sep>, </#list>", HASH),
      'B(a=1) A(a=1), B(b=2) A(b=2), B(c=3) Break!');
    snapshot(await out("<#list listed as k, v>B(${k}=${v}) <#if k == 'c'>Continue! <#continue></#if>A(${k}=${v})<#sep>, </#list>", HASH),
      'B(a=1) A(a=1), B(b=2) A(b=2), B(c=3) Continue! B(d=4) A(d=4), B(e=5) A(e=5)');
  });
});

describe('Upstream ConcatenatedSequenceTest (ported subset)', () => {
  it('concatenation across empty and non-empty segments', async () => {
    snapshot(await out('<#assign s = [] + ["b"]>${s?size}=${s[0]}'), '1=b');
    snapshot(await out('<#assign s = ["a"] + []>${s?size}=${s[0]}'), '1=a');
    snapshot(await out('<#assign s = [] + []>${s?size}'), '0');
    snapshot(await out('<#assign s = ["a"] + ["b"]>${s?size}'), '2');
  });
  it('nested concatenation trees flatten like upstream does', async () => {
    snapshot(await out('<#assign s = (["a"] + ["b"]) + (["c"] + [])>${s?size}|<#list s as i>${i}</#list>'),
      '3|abc');
    snapshot(await out('<#assign s = ([] + (["a"] + ["b"])) + ([] + [])>${s?size}|<#list s as i>${i}</#list>'),
      '2|ab');
    snapshot(await out('<#assign s = ["a"] + ["b"] + ["c"] + ["d"] + ["e"]>${s?size}|${s?first}|${s?last}'),
      '5|a|e');
  });
  it('index access and string coercion of concatenated sequences', async () => {
    snapshot(await out('${([1] + [2] + [3])?join(",")}'), '1,2,3');
    snapshot(await out('<#assign s = [1,2] + [3] + ["a"]>${s[2]}'), '3');
  });
  // (The JVM test drives AddConcatExpression.ConcatenatedSequence directly with
  // TemplateCollectionModel/Iterator segments and asserts TemplateModelIterator
  // contracts - JVM model-layer internals outside the port's scope.)
});

// Upstream InterpretAndEvalTemplateNameTest (ported): .current_template_name /
// .main_template_name (direct and via ?eval) across #include and ?interpret,
// plus relative template-name resolution inside interpreted parts. Expectations
// are the live JVM 2.3.36 outputs (the upstream .java test's expected string
// carries stray extra braces that the JVM itself doesn't emit).
describe('Upstream InterpretAndEvalTemplateNameTest (ported)', () => {
  const NAMES_VARIANTS = [
    'c=${.current_template_name}, m=${.main_template_name}',
    'c=${".current_template_name"?eval}, m=${".main_template_name"?eval}',
  ];
  for (const g of NAMES_VARIANTS) {
    const templates = {
      'main.ftl': `${g} {<#include 'sub/t.ftl'>}`,
      'sub/t.ftl': `${g} i{<@r'${g} {<#include "a.ftl">'?interpret />} `
        + `i{<@[r'${g} {<#include "a.ftl">','named_interpreted']?interpret />}}`,
      'sub/a.ftl': `In sub/a.ftl, ${g}`,
      'a.ftl': 'In a.ftl',
    };
    const build = (name) => {
      const cfg = new Configuration();
      cfg.setIncludeResolver((n) => (templates[n] ?? null));
      return new Template(name, templates[name], cfg);
    };
    it(`variant: ${g.slice(0, 40)}... -> main.ftl`, async () => {
      snapshot(await build('main.ftl').processToString({}),
        `c=main.ftl, m=main.ftl {c=sub/t.ftl, m=main.ftl `
        + `i{c=sub/t.ftl->anonymous_interpreted, m=main.ftl {In sub/a.ftl, c=sub/a.ftl, m=main.ftl} `
        + `i{c=sub/t.ftl->named_interpreted, m=main.ftl {In sub/a.ftl, c=sub/a.ftl, m=main.ftl}}}`);
    });
    it(`variant: ${g.slice(0, 40)}... -> sub/t.ftl`, async () => {
      snapshot(await build('sub/t.ftl').processToString({}),
        `c=sub/t.ftl, m=sub/t.ftl `
        + `i{c=sub/t.ftl->anonymous_interpreted, m=sub/t.ftl {In sub/a.ftl, c=sub/a.ftl, m=sub/t.ftl} `
        + `i{c=sub/t.ftl->named_interpreted, m=sub/t.ftl {In sub/a.ftl, c=sub/a.ftl, m=sub/t.ftl}}`);
    });
  }
});

// Upstream InterpretSettingInheritanceTest (ported): the ?interpret-ed template
// sees Configuration settings + its own <#ftl> header, never the outer
// template's tag syntax / whitespace-stripping. All 26 cases are JVM-verified
// byte-identical (Drv72 probe).
describe('Upstream InterpretSettingInheritanceTest (ported)', () => {
  const run = (src, cfg) => new Template('t', src, cfg).processToString({});
  const mkCfg = (syn, ws) => {
    const c = new Configuration();
    if (syn !== null) c.setTagSyntax(syn);
    if (ws !== null) c.setWhitespaceStripping(ws);
    return c;
  };
  const A = '<#if true>a</#if>';
  const Sq = '[#if true]s[/#if]';
  const SQ_FIRST = (hdr) => (hdr === 'a'
    ? `<#ftl><@'[#if true]s[/#if]<#if true>a</#if>'?interpret />`
    : `[#ftl][@'[#if true]s[/#if]<#if true>a</#if>'?interpret /]`);
  const AN_FIRST = (hdr) => (hdr === 'a'
    ? `<#ftl><@'<#if true>a</#if>[#if true]s[/#if]'?interpret />`
    : `[#ftl][@'<#if true>a</#if>[#if true]s[/#if]'?interpret /]`);
  const syntaxMatrix = [
    [1, [[SQ_FIRST('s'), `${Sq}a`], [AN_FIRST('s'), `a${Sq}`],
      [SQ_FIRST('a'), `${Sq}a`], [AN_FIRST('a'), `a${Sq}`]]],
    [2, [[SQ_FIRST('s'), `s${A}`], [AN_FIRST('s'), `${A}s`],
      [SQ_FIRST('a'), `s${A}`], [AN_FIRST('a'), `${A}s`]]],
    [0, [[SQ_FIRST('s'), `s${A}`], [AN_FIRST('s'), `a${Sq}`],
      [SQ_FIRST('a'), `s${A}`], [AN_FIRST('a'), `a${Sq}`]]],
  ];
  it('[#ftl] inside interpret fixes square syntax only for the rest', async () => {
    snapshot(await run("<@'[#ftl]x'?interpret />[#if true]y[/#if]", mkCfg(0, null)),
      'x[#if true]y[/#if]');
  });
  const WS_SRC = [
    ["<#assign x = 1>\nX<@'<#assign x = 1>\\nY'?interpret />", 'true'],
    ["<#ftl stripWhitespace=false><#assign x = 1>\nX<@'<#assign x = 1>\\nY'?interpret />", 'true'],
    ["<#assign x = 1>\nX<@'<#ftl stripWhitespace=false><#assign x = 1>\\nY'?interpret />", 'true'],
    ["<#assign x = 1>\nX<@'<#assign x = 1>\\nY'?interpret />", 'false'],
    ["<#ftl stripWhitespace=true><#assign x = 1>\nX<@'<#assign x = 1>\\nY'?interpret />", 'false'],
    ["<#assign x = 1>\nX<@'<#ftl stripWhitespace=true><#assign x = 1>\\nY'?interpret />", 'false'],
  ];
  it('whitespace_stripping from Configuration or own header', async () => {
    snapshot(await run(WS_SRC[0][0], mkCfg(1, true)), 'XY');
    snapshot(await run(WS_SRC[1][0], mkCfg(1, true)), '\nXY');
    snapshot(await run(WS_SRC[2][0], mkCfg(1, true)), 'X\nY');
    snapshot(await run(WS_SRC[3][0], mkCfg(1, false)), '\nX\nY');
    snapshot(await run(WS_SRC[4][0], mkCfg(1, false)), 'X\nY');
    snapshot(await run(WS_SRC[5][0], mkCfg(1, false)), '\nXY');
  });
  it('via ?eval of "?interpret"', async () => {
    const e1 = `<@'"[#if true]s[/#if]<#if true>a</#if>"?interpret'?eval />`;
    const e2 = `[#ftl][@'"[#if true]s[/#if]<#if true>a</#if>"?interpret'?eval /]`;
    snapshot(await run(e1, mkCfg(1, null)), `${Sq}a`);
    snapshot(await run(e2, mkCfg(1, null)), `${Sq}a`);
    snapshot(await run(e2, mkCfg(2, null)), `s<#if true>a</#if>`);
    // JVM quirk (pinned via Drv72): under square syntax the inner ?interpret of
    // the eval'ed string parses the square tags at EVAL time, and the result
    // prints as the canonical form of the outer expression:
    snapshot(await run(e1, mkCfg(2, null)),
      `<@'"s<#if true>a</#if>"?interpret'?eval />`);
  });
});

// Upstream ArgsSpecialVariableTest (ported): .args in macros is a hash in
// declared-parameter order (extras only with a catch-all), in functions a
// sequence of values; null call arguments count as "not given"; defaults are
// resolved in multiple passes.
describe('Upstream ArgsSpecialVariableTest (ported)', () => {
  it('.args in macros (named and positional calls)', async () => {
    const md = '<#macro m a b><#list .args as k, v>${k}=${v}<#sep>, </#list></#macro>';
    snapshot(await out(md + '<@m a=11 b=22 />', {}), 'a=11, b=22');
    snapshot(await out(md + '<@m 11 22 />', {}), 'a=11, b=22');
    snapshot(await out('<#macro m>${.args?size}</#macro><@m />', {}), '0');
    snapshot(await out('<#macro m others...>${.args?size}</#macro><@m />', {}), '0');
  });
  it('.args with defaults', async () => {
    const md = '<#macro m a b c=3><#list .args as k, v>${k}=${v}<#sep>, </#list></#macro>';
    const exp = 'a=11, b=22, c=33; a=11, b=22, c=3';
    snapshot(await out(md + '<@m a=11 b=22 c=33 />; <@m a=11 b=22 />', {}), exp);
    snapshot(await out(md + '<@m 11 22 33 />; <@m 11 22 />', {}), exp);
  });
  it('.args with multi-pass defaults', async () => {
    const md = '<#macro m a=c b=c c=b><#list .args as k, v>${k}=${v}<#sep>, </#list></#macro>';
    const exp = 'a=33, b=33, c=33; a=22, b=22, c=22; a=11, b=33, c=33; a=11, b=22, c=22';
    snapshot(await out(md + '<@m c=33 />; <@m b=22 />; <@m a=11 c=33 />; <@m a=11 b=22 />', {}), exp);
    snapshot(await out(md + '<@m null, null, 33 />; <@m null, 22, null />; '
      + '<@m 11, null, 33 />; <@m 11, 22, null />', {}), exp);
  });
  it('.args with catch-all', async () => {
    const md = '<#macro m a b=2 others...><#list .args as k, v>${k}=${v}<#sep>, </#list></#macro>';
    snapshot(await out(md + '<@m a=11 b=22 c=33 d=44 />; <@m a=11 b=22 />; '
      + '<@m a=11 />; <@m a=11 c=33 />', {}),
    'a=11, b=22, c=33, d=44; a=11, b=22; a=11, b=2; a=11, b=2, c=33');
    snapshot(await out(md + '<@m 1, 2 />', {}), 'a=1, b=2');
    rejectsMatch(() => out(md + '<@m 1, 2, 3 />', {}),
      TemplateException, ['.args', 'catch-all']);
  });
  it('.args in functions (sequence of values)', async () => {
    const fd = '<#function f a b><#return .args?join(\', \')></#function>';
    snapshot(await out(fd + '${f(11, 22)}', {}), '11, 22');
    snapshot(await out('<#function f><#return .args?size></#function>${f()}', {}), '0');
    snapshot(await out('<#function f others...><#return .args?size></#function>${f()}', {}), '0');
    const fd2 = '<#function f a b c=3><#return .args?join(\', \')></#function>';
    snapshot(await out(fd2 + '${f(11, 22, 33)}; ${f(11, 22)}', {}), '11, 22, 33; 11, 22, 3');
    const fd3 = '<#function f a=c b=c c=b><#return .args?join(\', \')></#function>';
    snapshot(await out(fd3 + '${f(null, null, 33)}; ${f(null, 22)}; '
      + '${f(11, null, 33)}; ${f(11, 22)}', {}),
    '33, 33, 33; 22, 22, 22; 11, 33, 33; 11, 22, 22');
    snapshot(await out(fd3 + '${f(11, 22)}; ${f(11, 22, 33)}', {}), '11, 22, 22; 11, 22, 33');
    const fd4 = '<#function f a b=2 others...><#return .args?join(\', \')></#function>';
    snapshot(await out(fd4 + '${f(11, 22, 33, 44)}; ${f(11, 22)}; ${f(11)}; '
      + '${f(11, null, 33)}', {}), '11, 22, 33, 44; 11, 22; 11, 2; 11, 2, 33');
  });
  it('.args in wrong context', () => {
    throwsMatch(() => new Template('t.ftl', '${.args}', new Configuration()),
      ParseException, ['args', 'macro', 'function']);
    rejectsMatch(() => out("<#macro m>${'.args'?eval}</#macro><@m />", {}),
      TemplateException, ['args', 'macro', 'function']);
  });
});

// Upstream SpecialVariableTest (ported FTL-level subset): .version /
// .incompatible_improvements, the 27 snake_case special-variable names (JVM
// SPEC_VAR_NAMES, camel twins handled via the naming convention), and the
// .autoEsc policy/format/region matrix (JVM-pinned via Drv77).
describe('Upstream SpecialVariableTest (ported subset)', () => {
  it('special-variable names: port set equals JVM snake names, sorted', () => {
    const portNames = [...DOT_VAR_NAMES].sort();
    const jvmSnake = [
      'args', 'auto_esc', 'caller_template_name', 'current_node', 'current_template_name',
      'data_model', 'error', 'get_optional_template', 'globals', 'incompatible_improvements',
      'lang', 'locale', 'locale_object', 'locals', 'main', 'main_template_name', 'namespace',
      'node', 'now', 'output_encoding', 'output_format', 'pass', 'template_name', 'time_zone',
      'url_escaping_charset', 'vars', 'version',
    ].sort();
    snapshot(JSON.stringify(portNames), JSON.stringify(jvmSnake));
    let prev = null;
    for (const n of jvmSnake) {
      ok(prev === null || n > prev, `not sorted: ${prev} -> ${n}`);
      prev = n;
    }
  });
  it('.version and .incompatible_improvements', async () => {
    snapshot(await out('${.version}', {}), '2.3.36');
    snapshot(await out('${.incompatible_improvements}', {}), '2.3.36');
  });
  it('.autoEsc policy x output-format matrix', async () => {
    const mk = (policy, fmt) => {
      const c = new Configuration();
      c.setAutoEscapingPolicy(policy);
      c.setOutputFormat(fmt);
      return c;
    };
    const run = (src, cfg) => new Template('t', src, cfg).processToString({});
    for (const policy of ['enableIfDefault', 'enableIfSupported']) {
      const c = mk(policy, 'HTML');
      snapshot(await run('${.autoEsc?c}', c), 'true');
      snapshot(await run('<#ftl autoEsc=false>${.autoEsc?c}', c), 'false');
      snapshot(await run('${.autoEsc?c}', mk(policy, 'PlainText')), 'false');
      snapshot(await run('${.autoEsc?c}', mk(policy, 'undefined')), 'false');
    }
    snapshot(await run('${.autoEsc?c}', mk('disable', 'HTML')), 'false');
    snapshot(await run('<#ftl autoEsc=true>${.autoEsc?c}', mk('disable', 'HTML')), 'true');
    snapshot(await run('${.autoEsc?c}', mk('disable', 'PlainText')), 'false');
    snapshot(await run('${.autoEsc?c}', mk('disable', 'undefined')), 'false');
    const c = mk('enableIfDefault', 'undefined');
    snapshot(await run('${.autoEsc?c} '
      + "<#outputFormat 'HTML'>${.autoEsc?c}</#outputFormat> "
      + "<#outputFormat 'undefined'>${.autoEsc?c}</#outputFormat> "
      + "<#outputFormat 'HTML'>"
      + '${.autoEsc?c} <#noAutoEsc>${.autoEsc?c} '
      + '<#autoEsc>${.autoEsc?c}</#autoEsc> ${.autoEsc?c}</#noAutoEsc> ${.autoEsc?c}'
      + '</#outputFormat>', c),
    'false true false true false true false true');
    throwsMatch(() => new Template('t.ftl', '${.autoEscaping?c}', new Configuration()),
      ParseException, ['autoEscaping', 'You may meant: "autoEsc"']);
  });
});

// Upstream NullTransparencyTest (ported): null loop variables fall back on an
// outer same-named variable per fallbackOnNullLoopVariable (JVM 2.3.36 default
// true; the setting is JVM-API-only). Lambda arguments never fall back.
// Expected outputs copied byte-identical from the live-JVM Drv79 probe.
describe('Upstream NullTransparencyTest (ported)', () => {
  const mkModel = (withIt) => {
    const m = { list: ['a', null, 'b'], map: new Map([['ak', 'av'], [null, 'bv'], ['ck', null]]) };
    if (withIt) m.it = 'fallback';
    return m;
  };
  const run = (src, cfg, model) => new Template('t', src, cfg).processToString(model);
  const srcs = [
    "<#list list?filter(it -> it??) as it>${it!'null'}<#sep>, </#list>",
    "<#list list?takeWhile(it -> it??) as it>${it!'null'}<#sep>, </#list>",
    "<#list list?map(it -> it!'null') as it>${it}<#sep>, </#list>",
    "<#list list as it>${it!'null'}<#sep>, </#list>",
    "<#list list><#items as it>${it!'null'}<#sep>, </#items></#list>",
    "<#list map?values as it>${it!'null'}<#sep>, </#list>",
    "<#list map as k, it>${k!'null'}=${it!'null'}<#sep>, </#list>",
    "<#list map><#items as k, it>${k!'null'}=${it!'null'}<#sep>, </#items></#list>",
    "<#list map?keys as it>${it!'null'}<#sep>, </#list>",
    "<#list map as it, v>${it!'null'}=${v!'null'}<#sep>, </#list>",
    "<#list map><#items as it, v>${it!'null'}=${v!'null'}<#sep>, </#items></#list>",
    "<#macro loop><#nested 1>, <#nested totallyMissing></#macro>\n"
    + "<@loop; it>${it!'null'}</@loop>",
  ];
  const cases = [
    [false, true, ['a, b', 'a', 'a, null, b', 'a, null, b', 'a, null, b', 'av, bv, null',
      'ak=av, null=bv, ck=null', 'ak=av, null=bv, ck=null', 'ak, null, ck',
      'ak=av, null=bv, ck=null', 'ak=av, null=bv, ck=null', '1, null']],
    [false, false, ['a, b', 'a', 'a, null, b', 'a, null, b', 'a, null, b', 'av, bv, null',
      'ak=av, null=bv, ck=null', 'ak=av, null=bv, ck=null', 'ak, null, ck',
      'ak=av, null=bv, ck=null', 'ak=av, null=bv, ck=null', '1, null']],
    [true, true, ['a, b', 'a', 'a, null, b', 'a, fallback, b', 'a, fallback, b', 'av, bv, fallback',
      'ak=av, null=bv, ck=fallback', 'ak=av, null=bv, ck=fallback', 'ak, fallback, ck',
      'ak=av, fallback=bv, ck=null', 'ak=av, fallback=bv, ck=null', '1, fallback']],
    [true, false, ['a, b', 'a', 'a, null, b', 'a, null, b', 'a, null, b', 'av, bv, null',
      'ak=av, null=bv, ck=null', 'ak=av, null=bv, ck=null', 'ak, null, ck',
      'ak=av, null=bv, ck=null', 'ak=av, null=bv, ck=null', '1, null']],
  ];
  for (const [withIt, fallback, expected] of cases) {
    it(`withIt=${withIt} fallbackOnNullLoopVariable=${fallback}`, async () => {
      const c = new Configuration();
      c.setFallbackOnNullLoopVariable(fallback);
      const model = mkModel(withIt);
      for (let i = 0; i < srcs.length; i++) {
        snapshot(await run(srcs[i], c, model), expected[i]);
      }
    });
  }
});
