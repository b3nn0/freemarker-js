// Render-time state; no module-global mutable state (all of it lives here).

export class Environment {
  constructor(rootElement, template, options = {}) {
    this.rootElement = rootElement;
    this.template = template;
    this.configuration = template.configuration;
    this.output = options.out;
    this.dataModel = options.dataModel ?? null;
    this.includeResolver = options.includeResolver ?? null;
    this.elementStack = [];
  }

  process() {
    this.visit(this.rootElement);
  }

  // Mirrors Environment.visit: elementStack feeds FTL error stack traces.
  visit(element) {
    this.elementStack.push(element);
    try {
      const more = element.execute(this);
      if (more) {
        for (const el of more) {
          if (el) this.visit(el);
        }
      }
    } finally {
      this.elementStack.pop();
    }
  }
}
