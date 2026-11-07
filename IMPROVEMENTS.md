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
  stack -- flag before porting it.

## B. Fidelity risks (differential harness now available: upstream 2.3.36-SNAPSHOT
is checked out and built with a JDK; `/tmp/opencode` Drv drivers render a
123-case corpus on both JVM and port and `cmp.mjs` classifies status/payload)

- [x] **B1. Error message texts are approximations** of upstream style. DONE: three
  differential rounds pinned ground truth via JVM probes (Drv1..Drv8) and fixed real
  divergences (strict compare matrix, iso family split, C-format ?c/?cn, DynamicKeyName
  scalar/range indexing, truncate/indent/wrap, seq builtins -1 + safe equals,
  parse-time unknown-built-in and ?then-arity checks, canonical-dump shapes).
  Remaining corpus diffs are wording-only (both sides report the failing expression
  with line/column) or documented deviations in B3/B5.
- [x] **B2. `#{x;m2 M4}`**: DONE - verified against the JVM: upstream also rejects
  it ("Encountered \"M4\", but was expecting pattern"). The port matches, and
  `[#{1}]`/`<#{1}>` now lex as static text + hash interpolation instead of a
  malformed tag (FTL.jj: `[#`/`<#` followed by `{` is never a tag start).
- [ ] **B3. Locale/timezone subset** (documented deviations, but list of gaps):
  fixed en_US number symbols; no `Locale`-dependent formats; `time_zone` now
  honored (IANA + offset forms, Intl-resolved); `sql_date_and_time_time_zone`
  inert; browser-local rendering by default;
  FIXED in this round: arithmetic now ports the BigDecimalEngine exactly
  (literals exact, division minScale 12 HALF_UP, mul scale cap 100, `%`
  truncates to integers, `?c` renders BigDecimal.toString-style; verified
  against a 30-value JVM matrix). Residual: values from JS model numbers
  convert via shortest-repr like BigDecimal.valueOf (same as upstream);
  sorting now uses `Intl.Collator` (close to java.text.Collator for common locales,
  not byte-identical); iso time-zone arguments now accept IANA zone ids
  (Intl-resolved, DST-aware) besides offset forms; `Z` is rejected upstream-style.
- [x] **B4. ISO format modifiers partial.** DONE: the full 2.3.36 iso family is
  ported with the upstream method-vs-string split (`?iso*` without `_utc/_local`
  are methods taking one time-zone argument; `?iso_utc*` / `?iso_local*` are plain
  strings), `_h/_m/_ms/_nz/_fz` accuracy/padding modifiers, DATE never showing an
  offset, `_ms` fraction only when nonzero.
- [ ] **B5. Unported surfaces** (all documented in UPSTREAM.md/README):
  MarkupModel concatenation in expressions; RTF/CSS/JSON output formats;
  `?new`, `?api`, XML/DOM models, `#visit/#recurse`, `classic_compatible`
  (parse-accepted but inert), TemplateLoader/relative names. (`#include
  parse=false` was ported this round: verbatim source dump, JVM-pinned.)
- [x] **B6. Auto-escaping off by default** DONE (docs): loud README warning +
  recommended `cfg.setOutputFormat('HTML')` snippet added; default left at
  Undefined for upstream-2.3 fidelity.

## C. Performance

- [x] **C1. Format patterns re-parsed on every output.** FIXED: `numberFormat.js`
  caches compiled custom patterns (named formats were already constant specs) and
  `dateFormat.js` caches pattern -> segment splits; FIFO cap 512 each, parse
  failures are not cached (still throw per call). Measured win is modest, not the
  "biggest single win" guessed here: ~16% on `formatJavaDate` and ~7% on
  `formatNumber` micro-benchmarks (200k calls), invisible end-to-end (format
  parse cost is dwarfed by model/generator plumbing). The cache pass did expose a
  real fidelity bug: `parseNumberPattern` dropped the leading digit, so
  `0000`/`0.00`-style patterns had minIntDigits off by one (fixed;
  DecimalFormat("0000").format(7) = "0007" now).
- [ ] **C2. Micro:** date formatting allocates per-field; number formatting does
  `toFixed` + manual grouping loop. Fine at current scale; revisit only with real
  profiles.

## D. Polish leftovers

- [ ] **D1. JSDoc quality**: coverage is 100% (checker-enforced), but several parser
  docs are generic (`@returns {Object}`); a few `// <- FTL.jj ...` comments are now
  duplicated directly above the equivalent new JSDoc line. Tighten opportunistically.
- [x] **D2. Repo hygiene**: stray `core.*` crash dumps were silently committed at M9
  and removed at M17 -- `git add -A` swept them for 8 milestones. Add a `.gitignore`
  (`core.*`, `*.log`, editor cruft) so it cannot recur.
- [ ] **D3. Test-suite gaps to fill while touching the above**: canonical-form
  sweep over all node types (spot checks only), `?eval` under non-default tag
  syntax untested. (`?sort` collation and the iso/C/indexing/built-in areas gained
  fidelity tests in the differential rounds.)
