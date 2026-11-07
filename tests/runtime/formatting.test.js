// Number/date/boolean formatting, #setting, #{exp;fmt} (M16).

import { describe, it, eq, throwsMatch, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import {
  ParseException, InvalidSettingException, InvalidFormatStringException, TemplateException,
} from '../../src/errors.js';

function render(source, c = new Configuration(), model = null) {
  return new Template('main.ftl', source, c).processToString(model);
}

describe('runtime: number formatting', () => {
  it('the default "number" format groups and caps at 3 fraction digits', async () => {
    eq(await render('${x}', new Configuration(), { x: 1234.5 }), '1,234.5');
    eq(await render('${1 / 3}'), '0.333');
    eq(await render('${2}'), '2');
  });

  it('#setting number_format named and pattern formats', async () => {
    eq(await render(
      '<#setting number_format="currency">${x}|'
      + '<#setting number_format="percent">${x}|'
      + '<#setting number_format="computer">${x}|'
      + '<#setting number_format="#,##0">${x}',
      new Configuration(), { x: 1234.567 }),
    '$1,234.57|123,456.7%|1234.567|1,235');
  });

  it('custom pattern with fixed fraction digits and prefix', async () => {
    eq(await render('<#setting number_format="0.00">${x}', new Configuration(), { x: 5.5 }), '5.50');
    eq(await render('<#setting number_format="$0.00">${x}', new Configuration(), { x: 7 }), '$7.00');
  });

  it('invalid number pattern errors when used', async () => {
    await rejectsMatch(render('<#setting number_format="zz">${x}', new Configuration(), { x: 1 }),
      InvalidFormatStringException, ['Invalid number format pattern']);
  });

  it('Configuration number_format applies template-wide', async () => {
    const c = new Configuration();
    c.setNumberFormat('0.00');
    eq(await render('${x}', c, { x: 7 }), '7.00');
  });
});

describe('runtime: numeric interpolation #{...}', () => {
  it('m/M format specifiers set fraction digits', async () => {
    eq(await render('#{x;m2M4}|#{x;M3}|#{5;m2M2}', new Configuration(), { x: 3.14159 }),
      '3.1416|3.142|5.00');
  });

  it('#{x} without a specifier is the plain number format', async () => {
    eq(await render('#{x}', new Configuration(), { x: 1234.5 }), '1,234.5');
  });

  it('canonical form keeps the #{} form with its bounds', () => {
    const t = new Template('m', '#{x;m2M4}', new Configuration());
    eq(t.rootElement.getCanonicalForm(), '#{x ; m2M4}');
  });

  it('bad specifiers are parse errors', () => {
    throwsMatch(() => new Template('m', '#{x;q2}', new Configuration()),
      ParseException, ['Invalid format specifier']);
    throwsMatch(() => new Template('m', '#{x;m4M2}', new Configuration()),
      ParseException, ['min cannot be greater than max']);
    throwsMatch(() => new Template('m', '#{x;2}', new Configuration()),
      ParseException, ['Expected a format specifier']);
  });

  it('non-numeric literals are rejected in #{...}', () => {
    throwsMatch(() => new Template('m', '#{"s"}', new Configuration()),
      ParseException, ['Found string literal', 'Expecting: number']);
  });
});

describe('runtime: #setting and boolean/date/bool formats', () => {
  it('boolean_format pairs', async () => {
    eq(await render('<#setting boolean_format="yes,no">${true}|${false}', new Configuration()), 'yes|no');
    eq(await render('<#setting boolean_format="ja,nein">${true}', new Configuration()), 'ja');
  });

  it('a boolean_format without a comma fails at set time', async () => {
    await rejectsMatch(render('<#setting boolean_format="yes"/>'),
      InvalidSettingException,
      ['two comma-separated values', '"yes"']);
  });

  it('unknown setting names fail at parse time with the allowed list', () => {
    throwsMatch(() => new Template('m', '<#setting nosuch=1>', new Configuration()),
      ParseException,
      ['Unknown setting name: "nosuch"',
        'boolean_format, c_format, classic_compatible, date_format',
        'url_escaping_charset.']);
  });

  it('both ">" and "/>" close #setting; canonical keeps the expression', () => {
    const t = new Template('m', '<#setting number_format="computer"/>', new Configuration());
    eq(t.rootElement.getCanonicalForm(), '<#setting number_format="computer"/>');
  });

  it('inert settings (locale, time_zone, output_encoding) are accepted', async () => {
    eq(await render(
      '<#setting locale="hu_HU"><#setting time_zone="Europe/Budapest"><#setting output_encoding="UTF-8">ok',
      new Configuration()), 'ok');
  });

  it('camelCase setting keys are accepted too', async () => {
    eq(await render('<#setting numberFormat="0.0">${x}', new Configuration(), { x: 1 }), '1.0');
  });
});

describe('runtime: date/time formatting', () => {
  const d = () => new Date(2020, 0, 2, 10, 30, 15);
  const isoSuffix = () => {
    const off = -d().getTimezoneOffset();
    if (off === 0) return 'Z';
    const sign = off > 0 ? '+' : '-';
    const abs = Math.abs(off);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  };

  it('default datetime/date/time settings (medium en_US-style)', async () => {
    eq(await render('${d}', new Configuration(), { d: d() }), 'Jan 2, 2020, 10:30:15 AM');
  });

  it('pattern subsets: yyyy-MM-dd, HH:mm, dddd', async () => {
    eq(await render('<#setting datetime_format="yyyy-MM-dd HH:mm">${d}', new Configuration(), { d: d() }),
      '2020-01-02 10:30');
    eq(await render('<#setting date_format="EEEE, MMMM d, yyyy">${d?date}', new Configuration(), { d: d() }),
      'Thursday, January 2, 2020');
    eq(await render('<#setting time_format="h:mm a">${d?time}', new Configuration(), { d: d() }),
      '10:30 AM');
  });

  it('quoted literals in date patterns', async () => {
    eq(await render("<#setting date_format=\"yyyy'(y)'\">${d?date}", new Configuration(), { d: d() }),
      '2020(y)');
  });

  it('iso date formats by date type', async () => {
    eq(await render('<#setting date_format="iso">${d?date}', new Configuration(), { d: d() }),
      '2020-01-02');
    eq(await render('<#setting time_format="iso">${d?time}', new Configuration(), { d: d() }),
      `10:30:15${isoSuffix()}`);
  });

  it('iso built-in family (method vs plain-string shapes)', async () => {
    const iso = await render('${d?iso("GMT")}', new Configuration(), { d: d() });
    eq(iso.slice(0, 19), '2020-01-02T10:30:15');
    eq(await render('${d?iso_nz("GMT")}', new Configuration(), { d: d() }), '2020-01-02T10:30:15');
    eq(await render('${d?date?iso("GMT+2")}', new Configuration(), { d: d() }), '2020-01-02'); // <- upstream: DATE never shows an offset
    eq(await render('${d?date?iso_utc}', new Configuration(), { d: d() }), '2020-01-02');
    eq(await render('${d?date?iso_local}', new Configuration(), { d: d() }), '2020-01-02');
    eq(await render('${d?datetime?iso_utc}', new Configuration(), { d: d() }),
      `2020-01-02T10:30:15${isoSuffix()}`);
    eq(await render('${d?time?iso_utc_h}', new Configuration(), { d: d() }), `10${isoSuffix()}`);
    // the utc/local variants are plain strings: calling them fails
    await rejectsMatch(render('${d?date?iso_utc()}', new Configuration(), { d: d() }),
      null, ['not a method']);
    // the method forms require the time-zone argument
    await rejectsMatch(render('${d?iso()}', new Configuration(), { d: d() }),
      null, ['argument']);
    // 2.3.36 has no iso_date/iso_time/iso_datetime built-ins (parse-time check)
    throwsMatch(() => new Template('m', '${d?iso_datetime}', new Configuration()),
      ParseException, ['Unknown built-in: "iso_datetime"']);
  });

  it('?string(fmt) overrides per call', async () => {
    eq(await render('${x?string("currency")}|${true?string("ja,nein")}', new Configuration(), { x: 9.5 }),
      '$9.50|ja');
    eq(await render('${d?string("yyyy")}', new Configuration(), { d: d() }), '2020');
  });

  it('?string(hash) picks the format by type', async () => {
    eq(await render('${x?string({"number_format": "0.000"})}', new Configuration(), { x: 1 }), '1.000');
    eq(await render('${"ab"?string({"string_format": "upper_case"})}', new Configuration()), 'AB');
  });

  it('?date/?time/?datetime switch the formatting type', async () => {
    eq(await render('<#setting date_format="iso"><#setting time_format="iso"><#setting datetime_format="iso">'
      + '${d?date}|${d?time}|${d?datetime}', new Configuration(), { d: d() }),
    `2020-01-02|10:30:15${isoSuffix()}|2020-01-02T10:30:15${isoSuffix()}`);
  });

  it('custom patterns cached: repeats identical, invalid patterns not cached', async () => {
    const c = new Configuration();
    eq(await render('${x?string("#,##0.00#")}|${x?string("#,##0.00#")}', c, { x: 1234.5 }),
      '1,234.50|1,234.50');
    eq(await render('${x?string("0000")}|${x?string("0000")}', c, { x: 7 }), '0007|0007');
    eq(await render('${d?string("yyyy-MM-dd \'(X)\'")} | ${d?string("yyyy-MM-dd \'(X)\'")}', c, { d: d() }),
      '2020-01-02 (X) | 2020-01-02 (X)');
    for (let i = 0; i < 2; i++) {
      await rejectsMatch(render('${x?string(",,")}', new Configuration(), { x: 1 }),
        InvalidFormatStringException, ['Invalid number format pattern']);
      await rejectsMatch(render('<#setting date_format="a\'b">${d?date}', new Configuration(), { d: d() }),
        InvalidFormatStringException, ['Unterminated quoted literal']);
    }
  });

  it('unsupported letters in date patterns error', async () => {
    await rejectsMatch(render('<#setting date_format="Q">${d?date}', new Configuration(), { d: d() }),
      InvalidFormatStringException, ['Unsupported letter']);
  });
});
