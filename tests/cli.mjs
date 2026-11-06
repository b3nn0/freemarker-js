// Node test runner: discovers tests, checks manifest consistency, reports TAP-ish.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './harness.js';
import { TEST_FILES } from './manifest.js';

const here = dirname(fileURLToPath(import.meta.url));

function discover(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...discover(p));
    else if (e.name.endsWith('.test.js')) out.push(p);
  }
  return out.sort();
}

const found = discover(here);
const declared = TEST_FILES.map(f => join(here, f)).sort();
for (const d of declared) {
  if (!found.includes(d)) { console.error(`not ok - manifest entry missing on disk: ${d}`); process.exit(1); }
}
for (const f of found) {
  if (!declared.includes(f)) { console.error(`not ok - test file not in manifest: ${f}`); process.exit(1); }
}

for (const f of found) await import(pathToFileURL(f).href);
const { pass, fail } = await run();
process.exit(fail ? 1 : 0);
