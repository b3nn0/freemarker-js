# Examples

Getting-started examples, each standalone under Node (no install, no build):

    node examples/basics.mjs      # data model, interpolation, defaults, lists, built-ins
    node examples/autoescape.mjs  # output formats, auto-escaping, ?no_esc, markup composition
    node examples/directives.mjs  # macros, #function, #nested, lambdas, #switch, #attempt
    node examples/includes.mjs    # #include / #import, namespaces, auto-include/import
    node examples/async.mjs       # Promise-valued model data, methods and resolvers
    node examples/demo.mjs        # all of it in one template
    open  examples/browser.html   # the same engine in the browser (script module)

Sync rendering uses `processToStringSync` / `process` (upstream-style, throws at any
async step); async rendering uses `await processToString(...)`.
