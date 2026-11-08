# Examples

Getting-started examples, each standalone under Node (no install, no build):

    node examples/basics.mjs      # data model, interpolation, defaults, lists, built-ins
    node examples/autoescape.mjs  # output formats, auto-escaping, ?no_esc, markup composition
    node examples/directives.mjs  # macros, #function, #nested, lambdas, #switch, #attempt
    node examples/includes.mjs    # #include / #import, namespaces, auto-include/import
    node examples/async.mjs       # Promise-valued model data, methods and resolvers
    node examples/beans.mjs       # custom model objects via capability contracts
    node examples/bean-readers.mjs # JavaBean-style getters: getFoo()/isFoo() as ${foo}
    node examples/demo.mjs        # all of it in one template

Two pages need a browser instead. Module scripts are fetched under CORS rules, so `file://`
won't load them -- serve the repo root:

    npx serve .    # then open http://localhost:3000/examples/sandbox.html

- `sandbox.html` - the interactive one: edit the data model (JSON, or JavaScript whose last
  statement returns the model - model beans included), the template, and the common
  `Configuration` settings; it re-renders on every change and echoes the equivalent
  JavaScript. The prefilled samples sit in `<script type="text/plain">` blocks at the bottom
  of the file, so their FTL `${...}` needs no escaping. The model field is evaluated with
  `new Function` on purpose: keep it a local tool, never a shipped page.
- `browser.html` - the smallest embedding: one module script, one `Configuration`, one
  template, one render.

The same server also carries the test suite as a page: `http://localhost:3000/tests/`.

Sync rendering uses `processToStringSync` / `process` (upstream-style, throws at any
async step); async rendering uses `await processToString(...)`.
