// Built-in registry: name -> implementation. Filled by milestones M11-M16.

const BUILTINS = new Map();

// spec: { minArgs = 0, maxArgs = 0, impl(target, args, env) }
export function registerBuiltIn(name, spec) {
  BUILTINS.set(name, spec);
}

export function getBuiltIn(name) {
  return BUILTINS.has(name) ? BUILTINS.get(name) : null;
}
