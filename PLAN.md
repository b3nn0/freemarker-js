# PLAN.md — milestones (one commit each, suite green at commit)

- [x] M0 scaffold: package.json, dirs, harness (harness.js/cli.mjs/index.html), README, UPSTREAM.md, PLAN.md, .gitignore, git init
- [ ] M1 Writer/StringWriter, Template parse-text-only, TextBlock, processToString
- [ ] M2 Token/TokenType/TokenManager: DEFAULT state, text, ${...}, comments, positions, lexical-state skeleton
- [ ] M3 Expression parser: precedence chain, literals, ranges, escaped ids, .x vars, !/?exists, canonical form
- [ ] M4 Model layer v1 + ObjectWrapper primitives/arrays, ${...} output, coercion, NonXxxException
- [ ] M5 Dot/DynamicKeyName/MethodCall, introspection cache, bean readers, deep unwrap
- [ ] M6 ZeroArgumentNonVoidMethodPolicy (3 values, BeforeMethodCall nodes, bean-reader carve-out)
- [ ] M7 #if/#elseif/#else, #attempt/#recover, #switch/#case/#default/#on/#break, #list/#items/#sep/#else, #foreach, #continue, loop vars
- [ ] M8 #assign (block, compound), #global, #local, scope stack, #import/#namespace
- [ ] M9 #macro (defaults, catch-all), #nested (+ body params), #return, #fallback, <@...> calls, .args
- [ ] M10 lambdas + ?filter ?map ?sort ?sort_by
- [ ] M11 built-ins: existence, string, hash, number, ?then/?also, type checks
- [ ] M12 tag syntax modes + interpolation modes + naming convention (auto/camel/legacy)
- [ ] M13 whitespace stripping (+ stripText, #t/#lt/#rt/#nt, #compress), #noparse, loose directive ends
- [ ] M14 #include/#import via includeResolver, #stop, #flush no-op, UnsupportedFeatureException set
- [ ] M15 #outputformat/#autoesc/#noautoesc, ?html ?xml ?no_esc, HTML escaper, ?url, ?json_string/?js_string/?c, ?eval
- [ ] M16 number/date formatting subset (${expr; fmt}, number_format/date_format, pattern subset)
- [ ] M17 polish: position audit, README matrix, examples/, regex/eval audit, perf sanity
