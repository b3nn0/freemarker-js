// Runnable demo: node examples/demo.mjs

import { Configuration, Template } from '../src/index.js';

const cfg = new Configuration();
cfg.setOutputFormat('HTML');
cfg.setIncludeResolver((name) => name === 'footer.ftl'
  ? '<p>&copy; 2026 \${company}</p>'
  : null);

const source = `
<#macro greet who>Welcome, <b>\${who}</b>!</#macro>
<@greet who=user.name />
Prices: <#list items as it>
  - \${it.name}: \${it.price?string("currency")} (\${it.qty}x)</#list>
<#setting datetime_format="yyyy-MM-dd">
Today: \${now}
Auto-escaped: \${user.bio}
\${user.bio?no_esc}
<#include "footer.ftl" />`;

const template = new Template('demo.ftl', source, cfg);
const out = await template.processToString({
  user: { name: 'Ada', bio: '<script>alert(1)</script> safe' },
  items: [
    { name: 'Pencil', price: 1.5, qty: 3 },
    { name: 'Eraser', price: 0.75, qty: 2 },
  ],
  now: new Date(2026, 10, 6),
  company: 'ACME',
});
console.log(out);
