# freemarker-js

Browser-targeted, dependency-free JavaScript port of the [Apache FreeMarker](https://freemarker.apache.org)
template engine (FTL). API-inspired by the Java implementation; baseline FreeMarker 2.3.36 semantics.
See `UPSTREAM.md` for the decision log. This project is inspired by (and derived from the ideas of)
Apache FreeMarker, licensed Apache-2.0.

## Usage (will land with M1+)

```js
import { Configuration, Template } from './src/index.js';

const cfg = new Configuration(Configuration.VERSION);
const t = new Template('greeting', 'Hello ${user.name}!', cfg);
const out = await t.processToString({ user: { name: 'World' } });
```

No runtime/dev dependencies, no build step. Run tests: `node tests/cli.mjs` or open `tests/index.html`.

## Support matrix

| Feature | Status | Notes |
|---|---|---|
| Static text pass-through (M1) | planned | |
| `${...}` interpolation, expression language (M2–M3) | planned | |
| Directives `#if #list #items #sep #switch #attempt #assign #macro #function ...` (M7–M9) | planned | |
| Lambdas, `?filter ?map ?sort ?sort_by` (M10) | planned | |
| Built-ins ~60 target (M11) | planned | see section 3.3 of the plan |
| Tag/interpolation syntax modes, naming conventions (M12) | planned | angle + square bracket |
| Whitespace stripping, `#compress`, `#noparse` (M13) | planned | |
| `#include`/`#import` via `options.includeResolver` (M14) | planned | no loaders/cache |
| Output formats + escaping (M15) | planned | HTML escaper; others passthrough |
| Number/date formatting subset (M16) | planned | named formats + pattern subset |
| Zero-arg method policy (M6) | planned | all 3 policy values |
| TemplateLoader / filesystem / URL loading | out of scope | |
| XML/DOM nodes, `#visit`, `#recurse`, `?node_*`, `?new`, `?api` | out of scope | parse OK, runtime `UnsupportedFeatureException` |
| `classic_compatible`, `?interpret`, locale-aware formatting | out of scope | |
