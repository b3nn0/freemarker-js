# freemarker-js

A dependency-free JavaScript port of the [Apache FreeMarker](https://freemarker.apache.org)
template engine (FTL), targeting the browser (it also runs fine in Node). All credit goes to
upstream FreeMarker and its authors: this project is a re-implementation of their ideas and
semantics, baselined against FreeMarker 2.3.36, and inspired/derived from an Apache-2.0 licensed
codebase. It is not affiliated with, endorsed by, or supported by the Apache Software Foundation.

The upstream Java sources live in `../freemarker` in this checkout; `UPSTREAM.md` is the
decision log of every porting choice made along the way.

## No guarantees whatsoever

This project was completely vibe coded. Every line of it is AI-generated, reviewed only as much
as a passing test suite (418 tests) allowed. There is no warranty of correctness, security,
performance, or fitness for any purpose. Do not use it in production, do not trust it with
untrusted templates or data, do not file bug reports against FreeMarker because of it. If it
works for you, great; if it doesn't, that was on the table from the start.

## Usage

Pure ES2022 modules, zero dependencies, no build step:

```js
import { Configuration, Template } from 'freemarker-js'; // or './src/index.js'

const cfg = new Configuration();
const t = new Template('greeting', 'Hello ${user.name}!', cfg);
```

**Sync API** - strict, upstream-style; any async step throws
`AsyncOperationNotAllowedException` instead of suspending:

```js
const out = t.processToStringSync({ user: { name: 'World' } });
```

**Async API** - the port's own addition (upstream is fully synchronous); model values,
model methods, and include resolvers may return Promises, awaited on demand:

```js
const out = await t.processToString({ user: { name: fetchUserName() } });
// fetchUserName(): Promise<string>
```

**Security note - auto-escaping is OFF by default**, exactly like upstream 2.3
(the `Undefined` output format): `${...}` interpolations are not escaped, so
untrusted model values can inject markup. For HTML output set an output format;
the configured format then enables auto-escaping automatically:

```js
cfg.setOutputFormat('HTML'); // #ftl output_format=... works per template too
```

Runnable examples: `node examples/demo.mjs` and `examples/browser.html`.
Run the test suite: `node tests/cli.mjs`.

## What's missing or different vs upstream FTL

Honest summary; details and rationale in `UPSTREAM.md`.

**Out of scope entirely:**

- `TemplateLoader`, filesystem/URL loading, cache configuration - `#include`/`#import` resolve
  through a plain `setIncludeResolver((name) => source)` callback instead.
- XML/DOM node models: `#visit`, `#recurse`, `?node_*`, `?new`, `?api`, `#fallback` bodies.
- `classic_compatible`, `?interpret`, and the `?keep_* / ?remove_* / ?ensure_*`
  string built-ins (plus regex/flag string variants). `?substring`, `?split`,
  `?word_list`, `?truncate/_c/_m/_w` and `?indent / ?dedent /
  ?dedent_with_line_wraps / ?wrap` are supported.
- Locale-aware behavior everywhere: number/date formatting is fixed to en_US symbols;
  dates render in browser-local time unless a `time_zone` setting (IANA or offset
  form, DST-aware) is given; the `locale` setting parses but is inert.
- RTF/CSS/JSON output formats and nested `{outer{inner}}` format expressions.
- Java-bean concepts without a JS analogue: getter naming (`getFoo`/`isFoo`) is not magic, and
  the three-value zero-arg-method policy is collapsed to one knob,
  `ZeroArgumentPolicy.AUTO_INVOKE` (default) / `METHOD_ONLY`.

**Deliberate deviations:**

- Two API drivers instead of one: `processToString` (async-capable) vs `processToStringSync`
  / `process` (strict sync). The engine core is a generator tree that works for both.
- No `incompatible_improvements` branches: only current 2.3 syntax; `#set`, `#var`, `#elif`,
  `#{...}`-as-`#set`-alias and friends are parse errors.
- `#set`/`#assign` in-namespace targets (`#assign x in ns`) parse, but parsing of unknown
  built-ins is deferred to runtime; parse-error wording is simplified to human sentences.
- Comparison is code-point based for strings (no locale collation); `1 == "1"` is true.
- `?sort_by` is 2.3.36-style (string key paths only, no lambdas); `?map`/`?filter` require
  parentheses; filter/map results are always eagerly materialized.
- `?url` is UTF-8 only; `#ftl` parameters must be literals; a handful of upstream error
  messages/stack-frame details are shortened.
- `#flush` is a no-op (no streams in a pure string engine).

If upstream and this port disagree anywhere not written down here, upstream is right and this
port is buggy.
