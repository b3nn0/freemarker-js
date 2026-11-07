# freemarker-js

Browser-targeted, dependency-free JavaScript port of the [Apache FreeMarker](https://freemarker.apache.org)
template engine (FTL). API-inspired by the Java implementation; baseline FreeMarker 2.3.36 semantics.
See `UPSTREAM.md` for the decision log. This project is inspired by (and derived from the ideas of)
Apache FreeMarker, licensed Apache-2.0.

## Usage

```js
import { Configuration, Template } from './src/index.js';

const cfg = new Configuration(Configuration.VERSION);
const t = new Template('greeting', 'Hello ${user.name}!', cfg);
const out = await t.processToString({ user: { name: 'World' } });
```

Data model values and callbacks may be async (Promises awaited on demand):

```js
const out2 = await t.processToString({ user: { name: fetchName() } }); // fetchName(): Promise
const syncOut = t.processToStringSync({ user: { name: 'World' } }); // throws on any async step
```

No runtime/dev dependencies, no build step. Run tests: `node tests/cli.mjs` or open `tests/index.html`.

Runnable examples: `node examples/demo.mjs` (data model, macros, auto-escaping, `#setting`,
includes) and `examples/browser.html` (plain browser `<script type="module">`, no server needed).

## Support matrix

| Feature | Status | Notes |
|---|---|---|
| Static text pass-through (M1) | done | |
| `${...}`/`#{...}` interpolation, expression language (M2-M3) | done | |
| Directives `#if #list #items #sep #switch #attempt #assign #macro #function ...` (M7-M9) | done | |
| Lambdas, `?filter ?map ?sort ?sort_by` (M10) | done | |
| Built-ins ~60 target (M11) | done | deferred regex/flag variants (UPSTREAM.md) |
| Tag/interpolation syntax modes, naming conventions (M12) | done | angle + square bracket |
| Whitespace stripping, `#t #lt #rt #nt`, `#compress`, `#noparse` (M13) | done | |
| `#include`/`#import` via `setIncludeResolver`/`options.includeResolver`, `#stop`, `#flush` (M14) | done | sync/async resolver; name-only parse cache |
| Output formats + escaping (M15) | done | HTML/XHTML/XML escapers; auto-esc; built-in escapers |
| Number/date formatting subset (M16) | done | #setting; #{exp;m2M4}; named+pattern number formats; SimpleDateFormat+ISO subset; ?string |
| Async data model / callbacks (M18) | done | Promises awaited on demand (`processToString`); strict sync via `processToStringSync` |
| Zero-arg function-property policy (M6, simplified M19) | done | one knob: AUTO_INVOKE (default) / METHOD_ONLY |
| TemplateLoader / filesystem / URL loading | out of scope | |
| XML/DOM nodes, `#visit`, `#recurse`, `?node_*`, `?new`, `?api` | out of scope | parse OK, runtime `UnsupportedFeatureException` |
| `classic_compatible`, `?interpret`, locale-aware formatting | out of scope | |

All milestones (M0-M18) are complete; the suite has 418 tests.
See `IMPROVEMENTS.md` for the post-M17 self-review backlog (A: design, B: fidelity,
C: performance, D: polish).

## Engineering audit

JSDoc types are verified with `npm run typecheck` (TypeScript via `npx --no-install`,
zero runtime/dev-install deps). Convention: for `function*` protocol generators
(`execute`, `impl`, model `get`/`getByIndex`/`exec`), `@returns {T}` documents the
value the generator RETURNS, not the Generator object. tsc therefore reports
expected noise (TS2322/2488/2339/2345/2739/2740/2416) at yield boundaries; the
script filters that class and fails only on other type errors.

- **No regular expressions in the parser or tag/text detection.** The lexer and template
  scanners are hand-written character state machines (`src/parser/tokenManager.js`).
  Outside the parser, string scanning uses explicit char/table logic;
  `grep -rnE "RegExp|\.match\(|\.replace\(/|\.search\(|\.split\(/|eval\(|new Function" src/`
  exits with no matches.
- **No `eval`/`new Function`.** `?eval` parses the string with this port's own Parser and
  evaluates the resulting AST (`src/builtins/encoding.js`, `parseExpression`).
- **Zero dependencies**; pure ES2022 modules, no Node-only APIs and no DOM in `src/`
  (browser and Node runtimes both work).
- All production declarations carry JSDoc type hints.
- Number/date format patterns are compiled once and cached per format string
  (FIFO cap 512; invalid patterns are never cached and keep throwing).
- **Green-thread async core** (`src/async.js`): the whole render/eval path is a generator tree that yields
  `{ op, promise }` tokens at model-callback boundaries (`get`/`getByIndex`/`exec`/resolver);
  `runAsync` awaits them, `runSync` throws `AsyncOperationNotAllowedException` instead.
  No `async` leaks into the engine: one core, two drivers.

## Performance sanity (Node 20, dev machine)

- Parse: ~0.06 ms for a 12-line template with a macro and a `#list` (100 parses ~ 6 ms);
  the parser is sync-only, so the M18 generator core costs nothing there.
- Render: 10 000 iterations of `<#list 1..10000>` with `#if`/number-format ~ 4 ms per render
  before M18 (commit `a422783`), ~ 9 ms async / ~ 11 ms sync after: the generator green-threads
  core costs ~2.5x on the hot render loop (measured warm, Node 20, dev machine).

These are order-of-magnitude figures, not a benchmark suite.
