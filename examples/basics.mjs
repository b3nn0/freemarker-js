// Getting started 1: the template renders a plain JS data model.
// Run: node examples/basics.mjs

import { Configuration, Template } from '../src/index.js';

const source = `
<#assign greeting = "Hello">
\${greeting}, \${user.name}!
Missing value with default: \${user.nickname!"(nobody yet)"}
Presence check: <#if user.age??>age = \${user.age}<#else>age unknown</#if>
List loop: <#list roles as role>[\${role?upper_case}]</#list>
Hash loop: <#list user as key, value>\${key}=\${value}<#sep>, </#list>
String built-ins: \${"  padded  "?trim?replace("d","D")}
Number math/format: \${3 * 1.1} / \${(3 * 1.1)?round} / \${1234.5?string("number")}
Sequence built-ins: \${[3, 1, 2]?sort?join(", ")} / \${[1..3]?size} / \${[1, 2]?seq_contains(2)?then("yes", "no")}
`;

const t = new Template('basics.ftl', source, new Configuration());
console.log(t.processToStringSync({
  user: { name: 'Ada', age: 36 },
  roles: ['admin', 'dev'],
}));
