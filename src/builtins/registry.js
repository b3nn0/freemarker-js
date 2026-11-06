// Built-in registry: name -> implementation. Filled by milestones M11-M16.

const BUILTINS = new Map();

/**
 * @typedef {Object} BuiltInSpec
 * @property {number} [minArgs] - reserved for M11+ argument validation
 * @property {number} [maxArgs] - reserved for M11+ argument validation
 * @property {(target: import('../model/templateModel.js').TemplateModel,
 *   argExprs: Object[]|null, env: import('../environment.js').Environment) =>
 *   import('../model/templateModel.js').TemplateModel} impl
 *   receives the raw target and unevaluated argument expressions (lambdas need that)
 */

/**
 * @param {string} name - the built-in name without the leading "?"
 * @param {BuiltInSpec} spec
 * @returns {void}
 */
export function registerBuiltIn(name, spec) {
  BUILTINS.set(name, spec);
}

/**
 * @param {string} name
 * @returns {BuiltInSpec|null} null when the built-in is unknown or not yet implemented
 */
export function getBuiltIn(name) {
  return BUILTINS.has(name) ? BUILTINS.get(name) : null;
}
