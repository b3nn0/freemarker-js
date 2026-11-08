# Examples

Getting-started examples, each standalone under Node (no install, no build):

    node examples/basics.mjs      # data model, interpolation, defaults, lists, built-ins
    node examples/autoescape.mjs  # output formats, auto-escaping, ?no_esc, markup composition
    node examples/directives.mjs  # macros, #function, #nested, lambdas, #switch, #attempt
    node examples/includes.mjs    # #include / #import, namespaces, auto-include/import
    node examples/async.mjs       # Promise-valued model data, methods and resolvers
    node examples/beans.mjs       # custom model objects via capability contracts
    node examples/demo.mjs        # all of it in one template
    python3 -m http.server 8000   # then open http://localhost:8000/examples/browser.html

`browser.html` is the same engine in the browser as one `<script type="module">`; browsers
fetch module scripts under CORS rules, so `file://` won't load them - serve the repo root
with any static server (this also serves `tests/index.html`, the same suite in a page).

Sync rendering uses `processToStringSync` / `process` (upstream-style, throws at any
async step); async rendering uses `await processToString(...)`.
