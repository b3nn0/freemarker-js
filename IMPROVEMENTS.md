# Improvement notes (post-M17 review)

Self-review of the implementation, as items to work through one by one.
Reference: HEAD `a422783`, suite 406 green.

## A. Design tensions / deliberate compromises

- [x] **A1. Sync engine, async API.** DONE via M18: kept the Promise and backed it with a
  real async core (green-threads, src/async.js) - async data-model values, async JS
  methods, async include resolvers are awaited on demand. Strict sync drivers
  (`process`/`processToStringSync`) match upstream semantics and throw
  AsyncOperationNotAllowedException at async attempts. Documented in README + UPSTREAM.md.
- [x] **A2. `?string` number override is a mutation hack.** DONE: `env._formatNumber(v,
  fracOpts, formatString)` takes the explicit override; `applyNumberFormatString` deleted.
- [x] **A3. Loose hash detection in `?string(hash)`.** DONE: `arg instanceof HashModel`.
- [x] **A4. Dead metadata:** DONE (removed): expr-level wiring proved wrong - method-style
  built-ins (`x?contains` bare) legally take 0 expr args and enforce arity later in
  BuiltinArgMethod; all registration minArgs/maxArgs fields deleted as dead metadata.
- [ ] **A5. Structural simplifications to keep in mind for future work:**
  `#compress` implemented at string level (not writer stack); interpolation
  output-format/auto-esc bound at parse time with the runtime `env.outputFormat` stack
  only serving `?no_esc`/legacy bypass; `?interpret` would need the upstream writer
  stack — flag before porting it.

## B. Fidelity risks (no differential testing — no JVM in this environment)

- [ ] **B1. Error message texts are approximations** of upstream style, never compared
  against real 2.3.36 output. Rare-path divergence plausible (operator-precedence
  corners, multi-line hint blocks absent). Consider a fixture file with captured
  upstream messages if a JVM becomes available.
- [ ] **B2. `#{x;m2 M4}`**: format split by whitespace into two ID tokens is rejected;
  upstream may tolerate it. Verify FTL.jj `hashInterpolationFormat` and relax if so.
- [ ] **B3. Locale/timezone subset** (documented deviations, but list of gaps):
  fixed en_US number symbols; no `Locale`-dependent formats; `time_zone` /
  `sql_date_and_time_time_zone` settings inert; browser-local rendering;
  `c` format digits differ from BigDecimal for irrational values (e.g. `1/3?c`);
  sorting uses JS code-unit order, not java.text.Collator (visible for non-ASCII).
- [ ] **B4. ISO format modifiers partial**: `_h/_m/_s/_ms/_nz/_fz` only; `_u`/UTC
  variants and fractional-second accuracy unsupported; `?iso_*` hardcodes `'iso'`
  (ignores `date_format` modifiers like `_m`).
- [ ] **B5. Unported surfaces** (all documented in UPSTREAM.md/README):
  MarkupModel concatenation in expressions; RTF/CSS/JSON output formats;
  `?new`, `?api`, XML/DOM models, `#visit/#recurse`, `classic_compatible`
  (parse-accepted but inert), TemplateLoader/relative names, `#include parse=false`.
- [ ] **B6. Auto-escaping off by default** (Undefined format — faithful to 2.3, but a
  security foot-gun). Consider a loud README warning + recommended
  `cfg.setOutputFormat('HTML')` snippet.

## C. Performance

- [ ] **C1. Format patterns re-parsed on every output.** Every
  `${x?string("#,##0")}` / date output inside a loop calls `parseNumberPattern` /
  date-pattern parsing per iteration. Add a per-Configuration (or env) cache:
  format-string → parsed pattern/printer. Biggest single win; the 26 ms / 10k
  iteration benchmark already contains this waste.
- [ ] **C2. Micro:** date formatting allocates per-field; number formatting does
  `toFixed` + manual grouping loop. Fine at current scale; revisit only with real
  profiles.

## D. Polish leftovers

- [ ] **D1. JSDoc quality**: coverage is 100% (checker-enforced), but several parser
  docs are generic (`@returns {Object}`); a few `// ← FTL.jj ...` comments are now
  duplicated directly above the equivalent new JSDoc line. Tighten opportunistically.
- [x] **D2. Repo hygiene**: stray `core.*` crash dumps were silently committed at M9
  and removed at M17 — `git add -A` swept them for 8 milestones. Add a `.gitignore`
  (`core.*`, `*.log`, editor cruft) so it cannot recur.
- [ ] **D3. Test-suite gaps to fill while touching the above**: no tests for
  `?sort` non-ASCII ordering, no canonical-form sweep over all node types (spot
  checks only), `?eval` under non-default tag syntax untested.
