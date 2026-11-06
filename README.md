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

No runtime/dev dependencies, no build step. Run tests: `node tests/cli.mjs` or open `tests/index.html`.

Runnable examples: `node examples/demo.mjs` (data model, macros, auto-escaping, `#setting`,
includes) and `examples/browser.html` (plain browser `<script type="module">`, no server needed).

## Support matrix

| Feature | Status | Notes |
|---|---|---|
| Static text pass-through (M1) | done | |
| `${...}`/`#{...}` interpolation, expression language (M2–M3) | done | |
| Directives `#if #list #items #sep #switch #attempt #assign #macro #function ...` (M7–M9) | done | |
| Lambdas, `?filter ?map ?sort ?sort_by` (M10) | done | |
| Built-ins ~60 target (M11) | done | deferred regex/flag variants (UPSTREAM.md) |
| Tag/interpolation syntax modes, naming conventions (M12) | done | angle + square bracket |
| Whitespace stripping, `#t #lt #rt #nt`, `#compress`, `#noparse` (M13) | done | |
| `#include`/`#import` via `setIncludeResolver`/`options.includeResolver`, `#stop`, `#flush` (M14) | done | sync resolver; name-only parse cache |
| Output formats + escaping (M15) | done | HTML/XHTML/XML escapers; auto-esc; built-in escapers |
| Number/date formatting subset (M16) | done | #setting; #{exp;m2M4}; named+pattern number formats; SimpleDateFormat+ISO subset; ?string |
| Zero-arg method policy (M6) | done | all 3 policy values |
| TemplateLoader / filesystem / URL loading | out of scope | |
| XML/DOM nodes, `#visit`, `#recurse`, `?node_*`, `?new`, `?api` | out of scope | parse OK, runtime `UnsupportedFeatureException` |
| `classic_compatible`, `?interpret`, locale-aware formatting | out of scope | |

All milestones (M0–M17) are complete; the suite has 406 tests.

## Engineering audit

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

## Performance sanity (Node 20, dev machine)

- Parse: ~0.1 ms for a 12-line template with a macro and a `#list` (100 parses ≈ 10 ms).
- Render: 10 000 iterations of `<#list 1..10000>` with `#if`/macro/number-format ≈ 26 ms.

These are order-of-magnitude figures, not a benchmark suite.
