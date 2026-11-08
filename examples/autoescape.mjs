// Getting started 2: output formats and auto-escaping.
// Run: node examples/autoescape.mjs

import { Configuration, Template } from '../src/index.js';

// Either set the format once for the Configuration:
const cfg = new Configuration();
// cfg.setOutputFormat('HTML');
// ...or per template with <#ftl output_format="HTML"> as below.

const source = `
<#ftl output_format="HTML">
Model values are escaped: \${bio}
Opt out per value:      \${bio?no_esc}
Escape explicitly:      [\${bio?html}]
Compose trusted markup (plain operands get escaped, the tags survive):
  <#assign snippet = "<strong>"?esc + name?esc + "</strong>"?esc>
  rendered: \${snippet}
URL encoding for attributes: <a href="/search?q=\${query?url}">search</a>
`;

const t = new Template('autoescape.ftl', source, cfg);
console.log(t.processToStringSync({
  name: '<script>x</script>',
  bio: 'Tom & "Jerry" <b>friends</b>',
  query: 'a b&c',
}));
