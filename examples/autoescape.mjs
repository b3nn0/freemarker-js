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
Compose trusted markup (the tags survive, the value stays escaped):
  rendered: \${"<strong>"?no_esc + name + "</strong>"?no_esc}
URL encoding for attributes: <a href="/search?q=\${query?url}">search</a>
(With auto-escaping on, the legacy ?html escapes the already-escaped value,
so templates reject it at parse time; ?no_esc above is the modern spelling.)
`;

const t = new Template('autoescape.ftl', source, cfg);
console.log(t.processToStringSync({
  name: '<script>x</script>',
  bio: 'Tom & "Jerry" <b>friends</b>',
  query: 'a b&c',
}));
