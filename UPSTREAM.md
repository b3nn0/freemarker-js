# UPSTREAM.md -- decision log

Upstream reference: Apache FreeMarker clone at `../freemarker` (Gradle-modularised:
`freemarker-core/src/main/java|test/java|test/resources`, grammar `freemarker-core/src/main/javacc`).

## Version baseline

- Baseline = FreeMarker **2.3.36** (latest `Configuration.VERSION_2_3_36` in the clone); hard-coded once in `src/version.js`.
- Only current syntax: no `incompatibleImprovements` branches, no pre-2.3 quirks. `#set`/`#var`/`#elif`/`#else_if`/`#{...}` are parse errors; the `classic_compatible` setting parses but is inert (missing values still error -- documented B5 gap).

## Deviations (canonical list)

This is the actual, current difference surface against upstream 2.3.36. The milestone
notes and fidelity-round notes below are the decision history; where they disagree
with this section, this section wins (interim statements were superseded).

### Out of scope

- TemplateLoader chains and locale/encoding cache variants: template sources come from
  `Configuration.setIncludeResolver((name) => source)` (or the per-process
  `includeResolver` option); referenced templates are parse-cached per Configuration
  keyed by the normalized name. `TemplateLookupStrategy` and name-resolution strategies
  are not modeled.
- XML/DOM support: node models, `#visit`, `#recurse`, `?node_*`, `?new`, `?api`,
  `#fallback` execution; the special variables `.node`/`.current_node` throw.
- The unported remainder of the 2.3.36 built-in set (they parse and fail at runtime
  with "isn't supported in this port"): the XML family (`ancestors`, `api`, `children`,
  `has_api`, `namespace`, `new`, `next_sibling`, `node_name`, `node_namespace`,
  `node_type`, `parent`, `previous_sibling`, `root`), plus `c_lower_case`,
  `c_upper_case`, `groups` (deprecated alias of `group_by`), `number_to_date`,
  `number_to_time`, `number_to_datetime` (string-to-date parsing, M16), `rtf`,
  `url_path`, `web_safe`, and the `truncate_c_m`/`truncate_w_m` markup-hybrid variants.
- Locale-aware behavior: number formatting is fixed to en_US symbols, dates render in
  browser-local time (a `time_zone` setting is honored, DST-aware), the `locale`
  setting parses but is inert; string case mapping follows JS, not locale rules.
- RTF/CSS/JSON output formats and nested `{outer{inner}}` format expressions
  (`UnsupportedFeatureException`).
- Java-bean surface: getter naming (`getFoo`/`isFoo`) is not magic; the three-value
  zero-arg-method policy is one knob (`ZeroArgumentPolicy.AUTO_INVOKE` default /
  `METHOD_ONLY`); there is no `TemplateCollectionModel`, so `is_collection(_ex)`
  is always false and only sequences/vs-hashes are distinguished.
- `classic_compatible` (parses, inert) and the regex "flags" argument variants of the
  string built-ins; `?matches` supports only the inline `(?i)/(?s)(?m)` flags.
- `#transform`'s `TransformControl` protocol: transforms are plain `getWriter` sinks;
  a `#break`/`#continue` inside a transform body always propagates to the enclosing
  loop (upstream lets the control object intervene first).
- `.getOptionalTemplate(...)`'s `'encoding'` option is accepted and validated but has
  no effect (sources are always strings; there are no byte-array loaders).
- Java-only API surface with no FTL semantics (custom attributes, Environment custom
  state, TemplateConfiguration, TemplateCache/storage knobs, TemplateProcessingTracer,
  ObjectWrapper subclassing beyond the wrapper knobs) is simply absent.

### Behavior and API differences (deliberate or forced)

- Async core: the render/eval path is a generator tree; `processToString`/`processAsync`
  await model values, model methods and resolvers on demand (upstream is fully
  synchronous). `process`/`processToStringSync` are the strict sync drivers and throw
  `AsyncOperationNotAllowedException` at async attempts (catchable by `#attempt`).
- No `incompatible_improvements` branching: 2.3.24+ semantics always apply -- e.g. an
  `#import` executed in the main template also exposes the namespace variable as a
  global (inside a library it stays library-local), auto-include/auto-import,
  `setLazyImports`/`setLazyAutoImports`, and `.getOptionalTemplate` are always
  available; `#set`, `#var`, `#elif`, `#{...}` as `#set` alias are parse errors.
- Error wording is simplified to human sentences; PARSE-vs-runtime status classes,
  error classes' semantics and template line/column blaming match. Unknown built-ins
  and `?then` arity are checked at parse time against the full 2.3.36 name list. A few
  exception classes are simplified: markup left-operands of string built-ins throw
  `NonStringException` (upstream `NonStringOrTemplateOutputException`), `?with_args`
  type errors use `NonMethodException` (upstream `UnexpectedTypeException`).
- FTL stack traces print `Failed at:` / `Reached through:` frames; upstream's `~`
  nesting-related frames are not emitted.
- Comparison operators coerce sides to numbers/dates/booleans or code-point string
  order (`1 == "1"` is true); sorting (`?sort`, `?sort_by`) uses `Intl.Collator`
  (closer to the JDK Collator than code-point order, but not byte-identical).
- JS `Date` model values wrap as DATE_TIME and render; upstream wraps `java.util.Date`
  as an UNKNOWN date type whose plain interpolation throws.
- `?filter`/`?map` return lazy sequences (element-wise lambda calls during iteration;
  `?map`'s `size()` is the source size, like `LazyMappedList`), materialized when an
  eager-context operation takes them (e.g. `#assign`). Parentheses are required
  (upstream trips an internal AssertionError without them).
- `?interpret` is string-LHS only; the sequence LHS and the `interpret(callbackName)`
  nesting wiring are simplified (visits the parsed body through the normal element
  pipeline instead of the upstream writer stack).
- `#flush` is a no-op (string sinks); `#ftl` parameters must be literals;
  `#include`/`#import` "template not found" messages are short (no loader-details
  block).

## Decisions

- `src/model/objectWrapper.js` <- `freemarker/ext/beans/BeansWrapper.wrap` + `DefaultObjectWrapper`: plain JS object -> `GenericObjectModel`; Map -> `HashModel` with items first and methods shadowed (SimpleObjectWrapper-like `simpleObjectWrapper=true` semantics as the default).
- record-like vs class-like (for `recordZeroArgumentNonVoidMethodPolicy`): record-like = own prototype is `Object.prototype`/null AND own property value is a 0-arg function; everything else (custom prototype, Map/Set/Date/Array) uses the default policy. Upstream "record" concept has no JS equivalent, so this mapping stands in for `java.lang.Record` detection; overridable via `cfg.setRecordTest`.
- `#flush` <- `FlushInstruction`: no-op (no streams in a pure logic module).
- `ParseException` messages: upstream categories + exact positions kept, token-list wording ("Encountered X, was expecting...") intentionally simplified to human sentences.
- Renderer core is synchronous; `process()` returns a Promise only at the API edge; thenable-returning data-model methods throw `TemplateException` (no async AST walk).
- No TemplateLoader/cache: `#include`/`#import` resolve via per-render `options.includeResolver` callback.
- Output formats: `plainText` + markup family with HTML as the real escaper; XML/XHTML share the HTML escaper; others accepted-but-passthrough; `{...}` format nesting -> `UnsupportedFeatureException`.
- `memberFilter(target, key)` hook replaces `MemberAccessPolicy` (allow-all default).
- Operator spellings: lexer replicates FTL.jj exactly (`&`/`&&`/`&amp;&amp;`/`\and`, `|`/`||`, `!`, `lt`/`lte`/`gt`/`gte` and escaped forms, `->`/`-&gt;`); the M3 parser additionally accepts bare `and`/`or`/`not` IDs as soft keywords (accepted superset; identifiers named `and`/`or`/`not` keep working since they stay ID tokens).
- Lexer errors surface as `TokenMgrError` (`src/errors.js`), wrapped into `ParseException` by the M3 parser; upstream token-list wording simplified as above.
- `NO_SPACE_EXPRESSION` (after `<@`) lexes whitespace like `FM_EXPRESSION` (upstream `TERMINATING_WHITESPACE` token dropped); call-parameter structure is enforced at parser level.
- Built-in arguments (`?bi(...)`) throw `UnsupportedFeatureException` at parse time until M11 (planned partial build-out, not a permanent deviation). Method calls (`m()`) and dynamic keys (`[expr]`) landed in M5 with `[]`/missing-key -> `InvalidReferenceException` before `!`/`??`, matching upstream.
- Hash literal keys: identifiers and other expressions are legal and are evaluated at render time (FTL.jj `stringLiteralOnly` only rejects number/list/hash/boolean literals); keys are string-coerced.
- Introspection cache analogue: `SimpleObjectWrapper` keeps a `WeakMap` so the same object/Map/array always maps to the same model instance. JS has no JavaBean getters, so no getFoo/isFoo property readers are generated by the wrapper; the `ZeroArgumentPolicy` knob decides how 0-argument function properties surface (see the M6/M19 bullets).
- Interim output formats until M16: numbers use plain decimal (`String(n)`), dates use the ISO form (`Date.toISOString()`, UTC); no locale.
- Comparison v1 (M16 refines): both numbers -> numeric, both dates -> by time, both booleans -> identity, otherwise both sides are string-coerced (so `1 == "1"` is true); relational string order is code-point, not locale "natural" order.
- M6/M19 mapping (revised): upstream's ZeroArgumentNonVoidMethodPolicy (3 values, record-vs-class split, getFoo/isFoo carve-out) is simplified to ONE knob, `ZeroArgumentPolicy`: AUTO_INVOKE (default) auto-invokes 0-arg function properties on bare reads for every model source uniformly; METHOD_ONLY keeps them as callable values (upstream's non-record default). Rationale: "record" was already only a heuristic here (a plain object literal), the 3-way enum had a dead value (BOTH == PROPERTY_ONLY without bean introspection), and getFoo/isFoo naming is a Java-bean artifact meaningless in JS. `fn.length !== 0` still marks a value method-only, matching upstream's "non-void zero-argument" gating. Default flips for class instances (was METHOD_ONLY) and for getX/isX names on plain objects (were carve-out): both now auto-invoke. History: M6 originally ported the full 3-value API (see PLAN.md).
- `BeforeMethodCall` is a runtime hook (`_evaluateForMethodCall` on Dot/DynamicKeyName reached from MethodCall) instead of upstream's parse-time node pre-creation -- same observable semantics.
- Class (non-record) objects: HashModel.get walks the prototype chain but stops at `Object.prototype`, so class methods are members while `toString` etc. never leak.
- M7: reproduced upstream quirks -- no `</#else>`/`</#elseif>` end tags (bodies end at the next sibling/parent end tag); `>` right after a tag expression closes the tag (so `gt`/parens required inside `<#if a gt b>`); `#attempt` catches `TemplateException`s but never the internal `#break`/`#continue` markers; whitespace before the first `#case` is dropped.
- M8: single-child templates: the lone child *is* the root element (<- FTL.jj `Root()` / `TemplateElements.asSingleElement()`); evaluation errors are blamed at the failing expression's own line/column (<- upstream `InvalidReferenceException(bean)`); the FTL stack prints `- Failed at:` for frame 0 and `- Reached through:` for outer frames -- the `~` nesting-related frames (upstream `BodyInstruction`) are not emitted yet; `#assign x in ns` was deferred to the `#import` milestone and is now implemented (see the seventh fidelity round).
- M7 follow-up (found via upstream `ast-1.ftl`): `#on` takes `PositionalArgs()` like `<@>` calls -- `<#on 1, 2>` and `<#on 1 2>` are the grammatical forms; the parenthesized `<#on (1, 2)>` we originally pinned is not upstream syntax and was replaced (FTL.jj `On(): <ON> PositionalArgs() <DIRECTIVE_END>`, `On.dump` prints `<#on a, b>`).
- M9: `#fallback` is an XML node-processing marker (`FallbackInstruction.accept` -> `Environment.fallback()` for `#visit`), not a macro default body; the port parses it (inside macros only, <- `FallBack()`) but throws `UnsupportedFeatureException` at execution since `#visit` is out of scope.
- M9: macro/function bodies see only their own parameter scope plus the template namespace/data model -- caller loop/macro scopes are never visible (<- `Environment.pushMacroContext`); `<#nested>` bodies run in the caller scope saved at call time (<- `BodyInstruction.accept`), with `; p1, p2` body parameters bound on top.
- M9: `.args` is the hash of all parameters plus extra named args of the call (<- `Macro.getArgsSpecialVariableValue`); it is only parseable inside a macro/function, and extra named args that aren't declared become allowed whenever `.args` appears in the body (upstream `requireArgsSpecialVariable`). A catch-all `rest...` receives undeclared named args regardless.
- M9: a macro invoked with `<@...>` whose target is a `#function` (or vice versa) throws `InvalidReferenceException`; non-macro-like values likewise. `#return` without value in a macro = early normal exit; value in macro / no value in function / `#return` at root level are parse errors (<- FTL.jj `Return()`).
- M9: `<@target>` args are named-only (`x=1 y=2`, whitespace separated, no commas) or positional-only (commas optional); mixing is not upstream-legal (FTL.jj `UnifiedCall`/`NamedArgs`/`PositionalArgs`). End tag may be `</@>` always; a named end tag must match a simple target name.
- M9 canonical forms: `<#macro m a b=2 q...>` (params space-separated, no parens; functions use `f(a, b)`), `<@m qz=9 x=1; p1, p2>` (named args sorted by name, <- `UnifiedCall.getSortedNamedArgs`), `<#nested a b>`; `<@m></@m>` and `<@m/>` both canonicalize to `<@m/>`.
- M9 simplification: default parameter expressions and argument expressions are evaluated eagerly at call entry (upstream also evaluates defaults in the macro scope after earlier params are set -- Macro.java); `#assign x in ns`-style namespace targets unaffected.
- M10: lambdas exist only as builtin arguments (FTL.jj `PositionalMaybeLambdaArgs` + `ExpressionBuiltInOrDirective` lambda check); a lambda elsewhere is a parse error, and evaluating one as a value throws "Can't get lambda expression as a value..." (<- `LocalLambdaExpression.evaluate`). Only `?filter`/`?map` accept lambdas in 2.3.36 (`LAMBDA_ARG_BUILTINS`).
- M10: `?map`/`?filter` require parentheses in this port (ParseException "must be called with an argument in parentheses"); upstream instead fails with an internal AssertionError (deviation).
- M10: lambda arity is checked at parse time with upstream wording (<- `BuiltInWithParseTimeParameters`): exactly 1 parameter for ?filter/?map; `()` declares 0 -> same parse error.
- M10: lambda invocation pushes one plain scope on the env scope stack (not a macro scope) <- `LocalLambdaExpression.invokeLambdaDefinedFunction`/`evaluateWithNewLocal`; parameters are dynamic (shadowed at call time), not closure-captured.
- M10: 2.3.36 `?sort_by` takes a string or string-sequence key path only -- NO lambda keys (that is 3.0 `sort_by`); the built-in evaluates to a method model (<- `sort_byBI.BIMethod`), and `?sort_by` without parens falls into MethodCall handling.
- M10: `?sort` with arguments is not checked at parse time; it sorts and the trailing `(args)` becomes a method call on the sorted sequence (runtime "not a method" error) <- grammar fall-through via `BuiltInWithDirectCallOptimization` shape; `?sort_by(...)` is the intentional method-like exception (`METHOD_LIKE_BUILTINS`).
- M10: filter/map results are always eagerly materialized (upstream's `isLazilyGeneratedResultEnabled` result-stream path is out of scope); filter must return boolean and map non-null with upstream messages (<- `FilterLikeBI`, `mapBI`). [Superseded: `?filter`/`?map` are lazy since the seventh fidelity round -- see Deviations.]
- M10: `?sort` string keys compare by code point (upstream uses the locale Collator -- no locale APIs in the browser port); sort is stable via index tie-break.
- M11: built-in "(args)" mechanism follows upstream uniformly: plain built-ins return first and the "(...)" is a MethodCall on the built-in's method result (the BIMethod pattern, <- BuiltInsForStringsBasic/index_ofBI etc.); only lazy-parameter built-ins (?then, ?switch, ?default <- BuiltInWithParseTimeParameters / BuiltInsWithLazyConditionals) and lambda built-ins consume "(args)" at parse time. Arity errors are run-time TemplateExceptions via upstream-ish newArgCntError wording, not parse errors (deviation).
- M11: ?also / ?when don't exist in 2.3.36 (added in later versions); PLAN text mentioned ?also -- implemented ?then (exactly 2 args) and ?switch instead.
- M11: unknown built-ins are detected at run time ("There is no such built-in: x"); upstream fails at parse time (registry fills by milestone).
- M11: null/missing target: type-bound built-ins throw InvalidReferenceException; existence built-ins and ?is_* accept missing -- the port's Identifier throws eagerly, so acceptsMissing built-ins catch InvalidReferenceException (<- evalMaybeNonexistentTarget's FIRE behaviour).
- M11: ?size rejects strings (2.3.36: sequence/extended-hash only); ?first/?last of empty sequences evaluate to null; ?seq_index_of of a miss is null (needs ! / ?if_exists to output).
- M11: string case mapping uses JS toUpperCase/toLowerCase (upstream is locale-sensitive); ?trim is Java-style (chars <= U+0020, not JS Unicode trim); capitalize mirrors StringUtil.capitalize word logic.
- M11: ?round follows upstream Math.round(doubleValue) (halves toward +infinity: 2.5 -> 3, -2.5 -> -2); JVM-pinned.
- M11: date-kind built-ins (?is_date_only / ?is_time / ?is_datetime) are deferred to M16 (date kinds not modeled); ?is_date matches every date value; ?is_node / ?is_transform always false (no XML/transform models in this port).
- M11: deferred the regex/flag argument variants (<- BuiltInsForStringsRegexp / flag strings). NOTE: ?keep_*/?remove_*/?ensure_* are not FTL keywords in 2.3.36 either (JVM parse-errors them; port matches). ?word_list, ?substring, ?truncate*, ?matches, ?interpret are ported (?interpret: string LHS only; sequence LHS and the interpret(callbackName) nesting wiring are deviations; 2.3.36 rejects #nested inside interpreted bodies on both sides); ?matches inline (?i)/(?s)/(?m) flags translate to JS, other inline flags (?x...) throw (documented).
- M12: interpolation default is LEGACY (Configuration.java:573), so `#{...}` interpolates out of the box; DOLLAR/SQUARE demote the other openers (startInterpolation).
- M12: `#ftl` is parsed at template start only (at most one, after optional leading whitespace); parameter expressions restricted to literals (upstream evaluates any data-less expression at parse-time).
- M12: `#ftl` ns_prefixes / attributes params and strict_syntax behavior deferred to later milestones (auto-esc/output_format land M15, strip_* land M13); recorded on template.ftlHeader.settings meanwhile.
- M12: tag-syntax modes match handleTagSyntaxAndSwitch: a tag whose opening bracket mismatches the established syntax demotes to static text; closer bracket mismatch is "The tag shouldn't end with".
- M12: naming-convention tokens verified: #forEach/#foreach (idx 3), #elseIf/#elseif (idx 4), #outputFormat (idx 6), #autoEsc (idx 4), #noAutoEsc (idx 2), #noParse/#noparse (idx 2, switches noparseTag).
- M13: `#ftl` header is NOT an AST child (FTL.jj HeaderElement() is void; Root() discards it). It eats the single preceding STATIC_TEXT_WS token and eatNewline after its closer consumes exactly up to the first line break (backup otherwise). This is why "  \n \n  <#ftl> \n \n  x" -> " \n  x": the text after the header is the first top-level text, so it skips the opening auto-strip.
- M13: port rejects `#ftl` preceded by non-whitespace outright; upstream reaches a different parse error for that (header branch of Root() LOOKAHEAD simply doesn't fire) - same outcome (error), message differs.
- M13: postParseCleanup ported (TextBlock deliberateLeftTrim/RightTrim + openingCharsToStrip/trailingCharsToStrip, heeds*, isIgnorable, nonOutputtingType list incl. PropertySetting/LibraryLoad pending M14); getFirstLeaf/getLastLeaf treat Macro and block-assignments as leaves (TemplateElement.java comment).
- M13: trimming whitespace test uses the port's ASCII whitespace set (isWhitespace), a subset of Java Character.isWhitespace.
- M13: #compress implemented at string level (render children to a buffer, then standardCompress port of StandardCompressWriter states) instead of the upstream Writer stack; same output semantics.
- M13: strip_text applies only at mixedContentNesting == 1 (top level), matching Text() in FTL.jj.
- M13: whitespace-trim jython template suite (templatesuite/whitespace-trim.ftl/.txt) reproduces expected output exactly; WhitespaceStrippingTest.java expectations ported incl. the quirky 2.3.0-compat comment cases.
- M13: LooseDirectiveEnd (">/" grammar) verified: break/nested accept "/>"; #sep/#else (CLOSE_TAG1-only) reject it as malformed tags.
- M14: template references resolve through a synchronous resolver ((name) => source string) set via Configuration.setIncludeResolver or the process-level includeResolver option - the browser stand-in for TemplateLoader chains; the parse cache is per-Configuration keyed by name only (no locale/encoding variants). Relative names are resolved against the including template's directory and normalized (`/./x`, `a/../b` -> `x`) before hitting the resolver (added with the include/import fidelity work; supersedes the original raw-string note).
- M14: #include/#import error text is the short "Could not find the included template \"x\"." form without the upstream multi-line TemplateNotFoundLoaderDetailsBlock.
- M14: #include parse=false writes the file source verbatim (upstream wraps it as MarkupModel, i.e. unescaped raw text - port writes it straight to the output, same effect). The encoding parameter parses (canonical keeps it) but has no effect (no encodings in the browser).
- M14: #include ignore_missing suppresses both missing-source and parse failures, matching 2.3.x (documented upstream quirk).
- M14: #stop throws StopException whose message mirrors StopException.printStackTrace ("Encountered stop instruction" + "Cause given: ...").
- M14: #import namespaces are per-Environment (loadedLibs) keyed by resolved name, registered before initialization (cycle-tolerant like upstream); #import "x" as auto is not part of 2.3.36 directive syntax (API-only), so only `as ID` is supported.
- M15: auto-escaping and output formats bind at parse time per interpolation, like DollarVariable; the runtime env.outputFormat stack exists only so ?no_esc/legacy-bypass see the enclosing #outputformat block.
- M15: RTF/CSS/JSON output formats and CombinedMarkupOutputFormat ("{outer{inner}}" and "{outer}name") are unsupported (UnsupportedFeatureException on the {...} form).
- M15: Configuration.setOutputFormat takes a format name string (resolved via the standard registry); custom OutputFormat registration is not supported. autoEscapingPolicy uses string constants; all four policies (incl. force) are settable and their parse-time errors are ported (eighth fidelity round).
- M15: #outputformat's parameter must be a string literal (upstream accepts any parse-time literal, incl. non-string constants coerced to string).
- M15: ?url is fixed to UTF-8 (no charset argument/setting in the browser). ?js_string/?json_string follow the 2.3.32+ jsStringEnc rules exactly (no legacy pre-2.3.32 variant).
- M15: MarkupModel concatenation inside expressions is not ported (markup values behave as their escaped string form in string contexts); the DollarVariable.accept format-mixing rules for markup values are ported verbatim.
- M16: "${expr; fmt}" does not exist in 2.3.36 (it is 3.x syntax); the 2.3 format surface is the legacy #{exp; m2M4} numeric interpolation, ?string(fmt)/?string(hash), and number_format/date_format/... settings. Implemented accordingly.
- M16: number formatting is fixed to the en_US symbols (grouping ",", decimal "."; number = "#,##0.###", currency = "$#,##0.00", percent) - locale-dependent DecimalFormatSymbols from the JDK are not ported. Patterns support a subset: 0/# digit counts, one grouping comma, ".", prefix/suffix text, "%" x100; scientific notation, exponent, grouping sizes, and currency-code patterns are unsupported.
- M16: arithmetic uses a BigDecimalEngine port (exact decimal add/sub/mul with scale cap 100, division at minScale 12 HALF_UP, truncated-integer %; number literals keep their exact image; ?c and the default number format render from it BigDecimal.toString-style). Values arriving as plain JS numbers (model objects) go through shortest-decimal conversion, like BigDecimal.valueOf.
- M16: date/time formatting uses browser-local time by default; the time_zone setting is honored (IANA ids via Intl, DST-aware, plus offset forms; unresolvable values silently keep the default, like upstream); sql_date_and_time_time_zone remains inert; locale setting inert too. Date patterns are a SimpleDateFormat subset (y M d H h m s S E a, quoted literals); unsupported letters throw. "Q", "z", "Z", "G", "D", "w", "W", "F", "u" etc unsupported.
- M16: ISO date formats support "iso" plus the _h/_m/_s/_ms/_nz/_fz modifiers; the accuracy/zone-override extras of ISOLikeTemplateDateFormat (iso_utc variants, default accuracy showing .000 millis) are not ported; seconds are the default accuracy, zone offset shown only for date_type=datetime (Z when offset 0).
- M16: string -> date parsing (the "?date on string" and date-parsing factories) is not ported; ?date/?time/?datetime only re-type existing Date values (NonDateException otherwise). ?string on non-scalar also cannot use the "format string names string" form for dates.
- M16: #setting keys are validated against the 2.3 SETTING_NAMES at parse time; camelCase aliases (numberFormat) are always accepted regardless of the naming convention (deviation from incompatible_improvements 2.3.22). Values are applied at runtime to the Environment (no restore at end of template, like 2.3); number/date/c format values are validated lazily when first used (upstream PropertySetting also only checks the name).
- M16: boolean_format supports the "true,false" pair form and "c"; TemplateBooleanFormat's other syntaxes are not ported. Invalid values fail at set time with the Configurable.parseBooleanFormat message. The legacy "true,false" (default or explicit) rejects automatic boolean printing (JVM-pinned); ?string / ?c / ?then still work.
- M16: #{exp; fmt} rejects non-numeric literals at parse time (numberLiteralOnly, messages ported); the min/max fraction settings override locale defaults like upstream; fracOpts apply only in #{} (the port's ?string(fmt) has its own pattern path).
- M16: ?iso_date/?iso_time/?iso_datetime force the date type before formatting; the upstream "?iso" (no suffix) and "iso_milliseconds"-style parameterized forms follow the same modifier subset above.
- M17: audit-only milestone. Position audit: every parser method spans its node (_span) and errors carry line/column; Environment decorates the first runtime TemplateException with the template stack. Canonical-form audit: #{exp;mN M2M4} now dumps in the #{} form (upstream NumericalOutput keeps its form; ${} dumping of legacy output was the port's M5 placeholder).
- M17: ISO date-format modifiers _h/_m/_s/_ms/_nz/_fz implemented (subset); utc and fractional-second accuracy remain unsupported.
- M17: full JSDoc coverage pass on src/ (all production declarations); no behavior change.
- M18: async-capable core (upstream has no analogue - the Java engine is fully synchronous). The entire render/eval path is a generator tree ("green threads", src/async.js): frames up to any user callback boundary yield { op, promise } tokens; runAsync() awaits and re-sends them, runSync() converts them to AsyncOperationNotAllowedException (catchable by #attempt). Chosen over threading Promise-returning types everywhere so the sync core stays exception-driven and #recover/finally-style unwinding keeps working across await points.
- M18: the model protocols are generators by contract: HashModel.get, SequenceModel.getByIndex, MethodModel.exec, MacroModel/lambda invoke, and builtin impl target/arg evaluation. Deviation from the Java TemplateHashModelEX/TemplateSequenceModel signatures (plain return values); JS consumers must use yield*/callOp.
- M18: Template.processToString/processAsync are the async-capable drivers (Promise-valued, upstream-incompatible by necessity: the port's data usually comes from fetch/Promises); Template.process/processToStringSync are the strict sync drivers matching upstream semantics and throwing AsyncOperationNotAllowedException at async attempts.
- M18: includeResolver may return a Promise (awaited in async mode); parse-once TemplateCache semantics unchanged (parsing itself stays sync).

## Fidelity rounds (JVM differential testing against the upstream clone)

Three differential rounds ran a shared template corpus through the built upstream
2.3.36-SNAPSHOT (JVM) and the port, comparing status + payload (`/tmp/opencode`
corpus + Drv/cmp drivers, semantics pinned with Drv probes). Accepted policy:
error-message wording may differ as long as both sides explain the problem with
template line/column; status-class (PARSE vs runtime) and behavior differences
must match or be recorded here as deviations.

- Unknown built-ins are now detected at PARSE time against the full upstream
  2.3.36 name list (187 names, `src/builtins/upstreamBIRegistry.js`), with the
  upstream "Unknown built-in: \"x\"..." message plus the alphabetical list.
  Names that exist upstream but are unported still parse and fail at runtime
  (this overrides the M11 run-time detection note).
- `?then` arity is checked at parse time ("?then(...) requires exactly 2
  parameters") like upstream (overrides the uniform run-time arity note in M11
  for this built-in; others keep run-time arity errors).
- Loop-variable built-ins (`?index`, `?counter`, `?has_next`, `?is_first`,
  `?is_last`, `?is_odd_item`, `?is_even_item`, `?item_parity`,
  `?item_parity_cap`, `?item_cycle`) are parse-checked like upstream
  (FTL.jj checkLoopVariableBuiltInLHO): the left-hand operand must be a
  simple loop-variable identifier of an enclosing iterator; the user-defined
  directive loop-variable nuance is not modeled (deviation).
- iso built-in family now matches the 2.3.36 registry exactly: `?iso`/`?iso_nz`/
  `?iso_ms(_nz)`/`?iso_m(_nz)`/`?iso_h(_nz)` are METHODS taking one time-zone
  argument; `?iso_utc*`/`?iso_local*` (with `_h/_m/_ms/_nz/_fz` variants) are
  plain strings - calling them yields NonMethodException (this replaces the
  partial M16/M17 notes). Offset-style zone ids only (`GMT+2`, `UTC`, `GMT`,
  `UTC-05:00`) and IANA zone ids resolved DST-aware through Intl
  (`Europe/Berlin`); `Z` is rejected like upstream. DATE-typed values never show
  an offset (upstream AbstractISOBI); `_fz` forces the offset for datetime/time.
- `?c`/`?cn`: C/Java literal rendering (`src/format/cFormat.js`): strings are
  quoted/escaped like StringUtil.javaStringEnc, numbers use the
  CTemplateNumberFormat double branch (`1.0` -> `1`, `1E20`, `1E-8`). Only
  division results follow the ported BigDecimalEngine (minScale 12) -
  pre-existing documented deviation, now with an exact corpus probe:
  `${(1/3)?c}` upstream `0.333333333333`).
- DynamicKeyName (`t[k]`): Range keys yield sequence slices / string substrings
  (a scalar range key is a SUBSTRING, not a char sequence); numeric keys on
  string/number scalars index into the plain-text form, with upstream's
  "String index out of range: ..." / "Negative index not allowed: N" errors;
  date targets return null/missing.
- `?seq_index_of`/`?seq_last_index_of` return -1 on misses (not null), and
  seq_contains/index_of use safe comparison (no errors on mismatched types) <-
  upstream; `?sort` string comparison uses `Intl.Collator` (upstream
  java.text.Collator; locale defaults to the environment's - closer than the
  previous code-point order, but not byte-identical).
- `?min`/`?max` are sequence-only built-ins (numbers/strings give the upstream
  "Expected a sequence or collection" style errors).
- `?take_while`/`?drop_while` ported (sequence-only, same lambda/method/boolean-seq
  argument handling as `?filter`; eager materialization like `?filter`).
- `?with_args`/`?with_args_last` ported in the 2.3.36 form: the built-in returns a
  BIMethod; the following call binds exactly one sequence-or-hash argument
  ("expects 1 argument but has received N/none"; "expects an extended hash or
  sequence as argument #1"), the call after that invokes the target with bound
  arguments appended/prepended. Hash arguments are only accepted for `#macro`
  targets ("When applied on a method|function, ?with_args can't have a hash
  argument. Use a sequence argument."). Left-operand errors use
  NonMethodException with the upstream wording (upstream class
  UnexpectedTypeException; documented naming deviation).
- String built-in semantics pinned to probes: `?truncate` default marker
  `[...]` (keep = maxLength - 5; `_w` keeps whole words and keeps the trailing
  separator space when it still fits; `_m` uses the markup terminator span);
  `?wrap` breaks only at spaces and always ends with a newline; `?indent(
  lineIndentString, onlyForBlankLines)`; `?keep_after` miss -> "";
  `?substring` strict index checks; `?cn` = quoted C literal; unlike `?c` a
  null/missing `?cn` target renders as the literal `null` (cnBI).
- `?indent(prefix, rightTrim=true)` indents every line and right-trims each;
  `?dedent` (bare) removes the longest common leading-whitespace prefix, and
  `?dedent(prefix, rightTrim=true)` removes that exact prefix; bare `?dedent`
  is a dual string+method model (`?dedent` as a value works, `?dedent(...)`
  calls it). `?wrap(width, firstLinePrefix="", restPrefix=firstLinePrefix)`
  reflows whitespace-separated words, prefixes count toward the width, an
  over-long word is emitted whole, and the result always ends with a newline
  (`_CoreStringUtils` semantics, JVM-pinned).
- `?lower_abc`/`?upper_abc` are NUMBER built-ins (spreadsheet column letters,
  1-based); `?boolean` converts via boolean_format + true/false (numbers are
  stringified first, upstream-style error on non-boolean strings).
- `is_indexable` (sequences), `is_enumerable` (sequences/collections),
  `is_collection(_ex)`: the port has no TemplateCollectionModel, so
  is_collection/is_collection_ex are always false (deviation).
- Canonical-form dumps now match upstream: `<#elseif`, self-closing `<#break/>`
  / `<#continue/>` / `<#return expr/>`, backslash-escaped identifiers in
  #assign/#local/#global targets.
- Data-model JS `Date` objects wrap as DATE_TIME and print via the configured
  date/time/datetime format; upstream wraps `java.util.Date` as an UNKNOWN date
  type whose output throws (deviation, probed: `${d}` for a plain util.Date
  errors upstream but renders in the port).

Fifth fidelity round (JVM-pinned, same differential corpus, now 144 cases):
- `?indent`/`?dedent`/`?wrap` reimplemented against `_CoreStringUtils`
  (arg-count/type errors with "argument #N" wording, `dedent` dual model,
  wrap prefix args); MethodCall now duck-types any `exec`-able value.
- `ParseException` messages now carry the upstream-style location prefix
  (`Syntax error in template "name" in line L, column C:`) so every parse
  failure is human-readable with line/column without consulting properties.
- Upstream test-class assertions ported into
  `tests/builtins/upstreamFidelity.test.js`: CAndCnBuiltInTest,
  IndentAndWrapBuiltInTest, TruncateBuiltInTest /
  DefaultTruncateBuiltinAlgorithmTest, LinesBuiltInTest, MinMaxBITest
  (wording adjusted to the port; behavior JVM-pinned).
- Not ported (documented surface gaps): none among the dot special variables
  (`.data_model`, `.template_name`, `.vars`, `.args`, `.output_format` are all
  ported, JVM-pinned);
  FTL has no scientific-notation number literals upstream either (`1e20` is a
  parse error on both sides).

Sixth fidelity round (JVM-pinned, corpus now 160 cases):
- items-form `#list` (no "as") now matches IteratorBlock/Items: the body is
  visited once and only when the listed value is non-empty; `#items` performs
  the item loop and absorbs a `#break` thrown inside it; a `#break`/`#continue`
  elsewhere in the body escapes to the enclosing loop; a second `#items` for
  the same listing fails with the upstream message.
- `#switch` whitespace parity: `#on`/`#case`/`#default` elements carry their
  source location and switch children stay in source order, so the
  TextBlock.postParseCleanup heeds* chain behaves like upstream (`#on` is not
  a whitespace-stripping tag; trailing whitespace inside an `#on` body
  survives).
- Loop-variable built-ins are parse-checked (see above), which also fixed the
  bi-cycle PARSE-vs-runtime corpus deviation.
- More upstream test classes ported: BreakAndContinuePlacementTest,
  SwitchTest (#case/#on basics, oddly-placed #default, whitespace + `#t`,
  mixing errors), UnclosedCommentTest (modern i21 behavior).
- `#setting date_format|time_format|datetime_format` keyword set differs:
  the port also accepts `default` (its own internal default) as a preset
  value, while upstream only resolves `short`/`medium`/`long`/`full`/`iso*`
  and rejects `default`/`none`/`simple` as malformed pattern strings
  ("malformed date/time/datetime format string ... Illegal pattern
  character"). Matching that exactly would require porting the
  SimpleDateFormat pattern validator; documented deviation.

Seventh fidelity round (JVM-pinned; ported upstream test classes now drive the
work -- LamdaAndEscapeTest, CapturingAssignmentTest, CoercionToTextualTest,
WhitespaceStrippingTest, ListWithStreamLikeBuiltinsTest, IncludeAndImportTest,
GetOptionalTemplateTest, TemplateTransformModelTest, IncudeFromNamelessTest;
suite 646 green, corpus unchanged):
- `#escape` reworked to the upstream model: the escape target wraps each
  interpolation lexically inside the block at PARSE time (nested escapes chain
  inner-to-outer; `#noescape` opts out; macro/function definitions and bodies are
  never wrapped), and the target expression binds the interpolated VALUE when it
  runs. Lambda parameter lists may not shadow an active escape placeholder
  (upstream parse error). Interpolated-string-literal parts are not wrapped
  (expression level) -- JVM-pinned.
- Markup-aware `+`: when either operand is markup, the string side is
  auto-escaped through the markup format (MarkupModel result; mixing different
  markup formats throws). Markup values survive `#global` assignment; `?esc`
  and `?markup_string` are ported.
- `#assign x in ns` works for imported namespaces (pair form `<#assign a=1 in
  ns>` and block form `<#assign x in ns>...`; the JVM rejects the value form
  `<#assign x in ns = 1>` at parse on both sides).
- `?filter`/`?map` produce lazy sequences (element-wise lambda calls while
  iterating; `?map`'s `size()` short-circuits to the source size, like
  `LazyMappedList`), materialized on `#assign` and other eager-context use.
- Auto-include/auto-import (`addAutoInclude`/`addAutoImport`), `setLazyImports`
  and the `setLazyAutoImports` tri-state ported: auto-imports run before
  auto-includes before the main template; lazy namespaces initialize on first
  access and failed initialization surfaces as a wrapped TemplateException;
  template names are normalized so equivalent paths share one namespace; an
  import in the MAIN template also exposes its namespace variable as a global,
  while a library-internal import keeps it library-local (JVM-pinned).
- `.getOptionalTemplate`/`.get_optional_template` ported: `exists`/`include`/
  `import` members, option-hash validation (`parse`, `encoding` accepted but
  inert), `!`-defaulting works over missing templates; `include`/`import`
  re-resolve the raw name at call time against the current template.
- `#transform` and `<@transformModel>` calls ported: nested content flows into
  the sink returned by `getWriter(env.out, args)`; the sink is closed after a
  normal body end and when `#break`/`#continue`/`#return` pass through, but NOT
  when an error aborts the body (JVM rule, pinned). A null sink with nested
  content fails with "does not allow nested content"; `<@nonTransform>` and
  `<#transform 1>` fail with "Expected a transform" (class and status match).
- Accepted residual wording differences: the lazy-namespace-init error text,
  `.getOptionalTemplate` argument-error texts and transform callee-error texts
  differ from upstream's wording; every case above has its behavior class,
  position and payload pinned by JVM probes and the ported suites.
