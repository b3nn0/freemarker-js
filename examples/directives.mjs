// Getting started 3: macros, functions, lambdas, switch, error handling.
// Run: node examples/directives.mjs

import { Configuration, Template } from '../src/index.js';

const source = `
<#macro card title class="panel">
  <div class="\${class}"><h2>\${title}</h2><#nested></div>
</#macro>
<@card title="Hello">card body text</@card>
<@card title="Second title" class="wide">different style</@card>

<#function priceOf item>
  <#return item.price * (1 - (item.discount!0))>
</#function>
Net total: \${priceOf({ "price": 10, "discount": 0.25 })}

<#assign names = ["ada", "bob", "alice"]>
Lambda filter: \${names?filter(n -> n?starts_with("a"))?join(", ")}
Lambda map:    \${names?map(n -> n?cap_first)?join(", ")}

<#switch role>
  <#case "admin">full access<#break>
  <#case "dev">commit access<#break>
  <#default>read only
</#switch>

<#attempt>
  This would fail: \${missing.deep.path}
<#recover>
  Recovered after the error above.
</#attempt>
`;

const t = new Template('directives.ftl', source, new Configuration());
console.log(t.processToStringSync({ role: 'dev' }));
