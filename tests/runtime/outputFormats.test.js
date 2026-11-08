// Output formats, auto-escaping, escaping built-ins (M15).

import { describe, it, eq, throwsMatch, rejectsMatch } from '../harness.js';
import { Template } from '../../src/template.js';
import { Configuration } from '../../src/configuration.js';
import { ParseException, TemplateException, UnsupportedFeatureException } from '../../src/errors.js';
import {
  xmlEnc, xhtmlEnc, urlEnc, jsStringEnc,
} from '../../src/utility/stringUtil.js';

function render(source, c = new Configuration(), model = null) {
  return new Template('main.ftl', source, c).processToString(model);
}

describe('runtime: output formats and auto-escaping', () => {
  it('escapes with HTML when #ftl output_format=HTML (enableIfDefault policy)', async () => {
    eq(await render('<#ftl output_format="HTML">${v}', new Configuration(), { v: `it's "x" & <y>` }),
      'it&#39;s &quot;x&quot; &amp; &lt;y&gt;');
  });

  it('auto_esc=false disables escaping under a markup format', async () => {
    eq(await render('<#ftl output_format="HTML" auto_esc=false>${v}', new Configuration(), { v: '<b>' }), '<b>');
  });

  it('auto_esc=true does nothing without a markup format', async () => {
    eq(await render('<#ftl auto_esc=true>${v}', new Configuration(), { v: '<b>' }), '<b>');
  });

  it('no escaping with the default Undefined format', async () => {
    eq(await render('${v}', new Configuration(), { v: '<b>&' }), '<b>&');
  });

  it('#outputformat block switches the format inside the block only', async () => {
    eq(await render('a<#outputformat "HTML">${v}</#outputformat>b<#outputformat "XML">${v}</#outputformat>c',
      new Configuration(), { v: '<&>\'' }),
    'a&lt;&amp;&gt;&#39;b&lt;&amp;&gt;\'c');
  });

  it('#autoesc is rejected when the current format can\'t escape', () => {
    throwsMatch(() => new Template('m', '<#autoesc>${v}</#autoesc>', new Configuration()),
      ParseException, ['The current output format can\'t do escaping: undefined']);
  });

  it('#autoesc enables escaping inside an already-markup format', async () => {
    eq(await render('<#outputformat "HTML"><#noautoesc>${v}</#noautoesc>|<#autoesc>${v}</#autoesc></#outputformat>',
      new Configuration(), { v: '<b>' }), '<b>|&lt;b&gt;');
  });

  it('Configuration.setOutputFormat applies template-wide', async () => {
    const c = new Configuration();
    c.setOutputFormat('HTML');
    eq(await render('${v}', c, { v: '<b>' }), '&lt;b&gt;');
  });

  it('unknown format names produce the upstream unregistered-format error', () => {
    throwsMatch(() => new Template('m', '<#ftl output_format="xhtml">${v}', new Configuration()),
      ParseException, ['Unregistered output format name, "xhtml"',
        'The output formats registered in the Configuration are: HTML, XHTML, XML, plainText, undefined.']);
  });

  it('#outputformat requires a parse-time constant', () => {
    throwsMatch(() => new Template('m', '<#outputformat fmt>${v}</#outputformat>', new Configuration()),
      ParseException, ['Parameter expression must be parse-time evaluable (constant): fmt']);
  });

  it('combined "{outer{inner}}" format names are unsupported here', () => {
    throwsMatch(() => new Template('m', '<#outputformat "{HTML{XML}}">x</#outputformat>', new Configuration()),
      UnsupportedFeatureException, ['Combined output format names']);
  });

  it('#ftl header survives; nested blocks restore the parser format', async () => {
    eq(await render('<#ftl output_format="XML"><#outputformat "HTML">${a}</#outputformat>${b}',
      new Configuration(), { a: '<>', b: '<>' }), '&lt;&gt;&lt;&gt;');
  });

  it('canonical form of the new blocks', () => {
    const t = new Template('m', '<#outputformat "HTML"><#autoesc>x<#noautoesc>y</#noautoesc></#autoesc></#outputformat>',
      new Configuration());
    eq(t.rootElement.getCanonicalForm(),
      '<#outputformat "HTML"><#autoesc>x<#noautoesc>y</#noautoesc></#autoesc></#outputformat>');
  });
});

describe('runtime: escaping built-ins', () => {
  it('?html escapes < > & " \'', async () => {
    eq(await render('${v?html}', new Configuration(), { v: `<&"'a>` }),
      '&lt;&amp;&quot;&#39;a&gt;');
  });

  it('?xml leaves the apostrophe alone', async () => {
    eq(await render('${v?xml}', new Configuration(), { v: `<&"'` }), '&lt;&amp;&quot;\'');
  });

  it('?url percent-encodes UTF-8, space becomes +', async () => {
    eq(await render('${v?url}', new Configuration(), { v: 'a b/c?\u00e9\u65e5' }), 'a+b%2Fc%3F%C3%A9%E6%97%A5');
  });

  it('?json_string escapes per JSON rules', async () => {
    eq(await render('${v?json_string}', new Configuration(), { v: `a"b'c\\d\nx]]>` }),
      'a\\"b\'c\\\\d\\nx]]\\u003E');
  });

  it('?js_string escapes \' and control chars with \\x', async () => {
    eq(await render('${v?js_string}', new Configuration(), { v: `a'b"\\c\td\u0007` }),
      'a\\\'b\\"\\\\c\\td\\x07');
  });

  it('?no_esc skips auto-escaping under HTML', async () => {
    eq(await render('<#ftl output_format="HTML">${v?no_esc}', new Configuration(), { v: '<b>ok</b>' }),
      '<b>ok</b>');
  });

  it('?html is banned at parse time with auto-escaping + markup format', () => {
    // <- FMParser BuiltInBannedWhenAutoEscaping (JVM: ParseException, not runtime).
    throwsMatch(() => new Template('m', '<#ftl output_format="HTML">${v?no_esc?html}', new Configuration()),
      ParseException, ['Using ?html (legacy escaping) is not allowed', 'to avoid double-escaping mistakes']);
    throwsMatch(() => new Template('m', '<#ftl output_format="HTML">${v?html?no_esc}', new Configuration()),
      ParseException, ['Using ?html (legacy escaping) is not allowed']);
  });

  it('#escape is banned at parse time with auto-escaping + markup format', () => {
    throwsMatch(() => new Template('m', '<#ftl output_format="HTML"><#escape x as x?html>${v}</#escape>', new Configuration()),
      ParseException, ['Using the "escape" directive (legacy escaping) is not allowed',
        'to avoid confusion and double-escaping mistakes']);
  });

  it('?c returns the computer form', async () => {
    eq(await render('${1.5?c}|${42?c}|${true?c}|${"a"?c}', new Configuration()), '1.5|42|true|"a"');
  });

  it('?eval evaluates the string as an expression', async () => {
    eq(await render('${"1 + x"?eval}', new Configuration(), { x: 2 }), '3');
    eq(await render('${"\\"ab\\"?upper_case"?eval}', new Configuration()), 'AB');
  });

  it('?eval reports parse failures', async () => {
    await rejectsMatch(render('${"1 +"?eval}'), TemplateException, ['Could not parse the expression']);
  });
});

describe('stringUtil escapers', () => {
  it('xmlEnc/xhtmlEnc', () => {
    eq(xmlEnc(`<&"'>`), '&lt;&amp;&quot;\'&gt;');
    eq(xhtmlEnc(`<&"'>`), '&lt;&amp;&quot;&#39;&gt;');
  });

  it('urlEnc keeps the path form', () => {
    eq(urlEnc('a/b', true), 'a/b');
    eq(urlEnc('a/b', false), 'a%2Fb');
  });

  it('jsStringEnc quotes-against rules', () => {
    eq(jsStringEnc('</script>', false), '<\\/script>');
    eq(jsStringEnc('a>b', false), 'a>b');
    eq(jsStringEnc('-->', false), '--\\>');
    eq(jsStringEnc('x-->y', true), 'x--\\u003Ey');
  });
});
