// Getting started 4: sharing template files.
// Run: node examples/includes.mjs

import { Configuration, Template } from '../src/index.js';

const files = {
  'footer.ftl': '<footer>(c) \${company!"someone"}</footer>',
  'readme.txt': '<this is NOT parsed> raw text: ${anything}',
  'widgets.ftl':
    '<#assign bannerColor = "navy">'
    + '<#macro banner>Banner on \${bannerColor}</#macro>',
};

const cfg = new Configuration();
cfg.setIncludeResolver((name) => files[name] ?? null);

// #include: the file's directives run in THIS template's namespace.
const page = new Template('page.ftl', `
<#include 'widgets.ftl'>
<@banner/>
<#assign bannerColor = "red">      <- re-assign in the shared namespace
<@banner/>
<#include 'footer.ftl'>
<#include 'readme.txt' parse=false>
<#include 'optional.ftl' ignore_missing=true>
`, cfg);
console.log(await page.processToString({ company: 'ACME' }));

// #import: the file gets its own namespace; it loads only once.
const imp = new Template('importer.ftl', `
<#import 'widgets.ftl' as w>
<@w.banner/>
<#assign bannerColor = "teal" in w> <- assignment inside the namespace
<@w.banner/>
<#import 'widgets.ftl' as w2>       <- same namespace, not executed again
`, cfg);
console.log(await imp.processToString({}));

// Auto-includes / auto-imports run in every template, before its body:
const cfg2 = new Configuration();
cfg2.setIncludeResolver((name) => files[name] ?? null);
cfg2.addAutoImport('w', 'widgets.ftl');
cfg2.addAutoInclude('footer.ftl');
const auto = new Template('auto.ftl', 'auto part: <@w.banner/>', cfg2);
console.log(await auto.processToString({}));
