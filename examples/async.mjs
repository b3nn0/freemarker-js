// Getting started 5: async data (the port's addition; upstream is sync).
// Run: node examples/async.mjs

import { Configuration, Template } from '../src/index.js';

const cfg = new Configuration();
cfg.setIncludeResolver(async (name) => {
  await new Promise((r) => setTimeout(r, 10)); // pretend this hits the network
  return name === 'remote.ftl' ? '<p>fetched include</p>' : null;
});

const source = `
Name (a Promise value):        \${name}
Greeting (async method call):  \${greet("Ada")}
Computed (sync method):        \${double(21)}
<#include 'remote.ftl'>
`;

const t = new Template('async.ftl', source, cfg);
console.log(await t.processToString({
  name: Promise.resolve('Ada'),
  greet: (who) => Promise.resolve(`Hello, ${who}!`),
  double: (n) => n * 2,
}));

// Sync drivers refuse async work instead of suspending:
try {
  t.processToStringSync({ name: Promise.resolve('Ada'), greet: () => '', double: (n) => n });
} catch (e) {
  console.log('processToStringSync refused as expected:', e.constructor.name);
}
