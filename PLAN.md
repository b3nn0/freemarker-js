# PLAN.md -- milestones (one commit each, suite green at commit)

- [x] M0 scaffold: package.json, dirs, harness (harness.js/cli.mjs/index.html), README, UPSTREAM.md, PLAN.md, .gitignore, git init
- [x] M1 Writer/StringWriter, Template parse-text-only, TextBlock, processToString
- [x] M2 Token/TokenType/TokenManager: DEFAULT state, text, ${...}, comments, positions, lexical-state skeleton
- [x] M3 Expression parser: precedence chain, literals, ranges, escaped ids, .x vars, !/?exists, canonical form
- [x] M4 Model layer v1 + ObjectWrapper primitives/arrays, ${...} output, coercion, NonXxxException
- [x] M5 Dot/DynamicKeyName/MethodCall, introspection cache, bean readers, deep unwrap
- [x] M6 ZeroArgumentNonVoidMethodPolicy (3 values, BeforeMethodCall nodes, bean-reader carve-out)
- [x] M7 #if/#elseif/#else, #attempt/#recover, #switch/#case/#default/#on/#break, #list/#items/#sep/#else, #forEach, #continue, loop vars
- [x] M8 #assign (block, compound), #global, #local, scope stack (namespace-target `in ns` + #import deferred to M14)
- [x] M9 #macro (defaults, catch-all), #nested (+ body params), #return, #fallback, <@...> calls, .args
- [x] M10 lambdas + ?filter ?map ?sort ?sort_by
- [x] M11 built-ins: existence, string, hash, number, ?then/?also, type checks
- [x] M12 tag syntax modes + interpolation modes + naming convention (auto/camel/legacy)
- [x] M13 whitespace stripping (+ stripText, #t/#lt/#rt/#nt, #compress), #noparse, loose directive ends
- [x] M14 #include/#import via includeResolver, #stop, #flush no-op, UnsupportedFeatureException set
- [x] M15 #outputformat/#autoesc/#noautoesc, ?html ?xml ?no_esc, HTML escaper, ?url, ?json_string/?js_string/?c, ?eval
- [x] M16 #setting, number/date formatting subset (#{exp;m2M4}, ?string(fmt), number_format/date_format, pattern subset)
- [x] M17 polish: position audit, README matrix, examples/, regex/eval audit, perf sanity
- [x] M18 async-capable core: generator green-threads (src/async.js runSync/runAsync), async model protocol (get/getByIndex/exec/impl), async resolvers/callbacks, processToStringSync/processAsync, asyncModel tests

Post-M18: seven JVM-differential fidelity rounds plus an upstream-test-porting program
(ported upstream test classes into tests/builtins/upstreamFidelity.test.js; suite 646,
corpus same=256/diff=62 wording-only). Decision history and the canonical deviation
list live in `UPSTREAM.md`; open review items in `IMPROVEMENTS.md`.
