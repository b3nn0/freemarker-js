// ?interpret <- freemarker.core.Interpret (2.3.36): parses the target string as
// FTL at render time and yields a "transform" model callable via <@d/>.
// Deviation: sequence left-hand operands (element concatenation upstream) are
// not supported; only strings are accepted.

import { registerBuiltIn } from './registry.js';
import { StringModel } from '../model/models.js';
import { NonStringException, NonStringOrTemplateOutputException, ParseException, TemplateException } from '../errors.js';

/** A parsed ?interpret body <- Interpret.TemplateProcessorModel. */
export class InterpretModel {
  /** @param {import('../template.js').Template} template @param {string|null} callbackName */
  constructor(template, callbackName) {
    this.template = template;
    this.callbackName = callbackName;
    this.isTransform = true; // <- typeLabel("transform")
  }

  /**
   * Called through `<@d/>` (unifiedCall uses the same invoke protocol as macros).
   * @param {import('../environment.js').Environment} env
   * @param {Object} opts
   * @returns {null}
   */
  * invoke(env, opts) {
    // <- #nested inside the interpreted body fails at parse time (JVM-pinned
    // 2.3.36: "Cannot use a <#nested> instruction outside a macro."), so the
    // call body is unused.
    // <- the interpreted body sees its own macros (seeded for the visit only)
    const saved = new Map();
    for (const m of this.template.macros) {
      if (!saved.has(m.name)) {
        saved.set(m.name, env._nsScope.has(m.name) ? env._nsScope.get(m.name) : null);
      }
      env._nsScope.set(m.name, m.macroModel);
    }
    try {
      yield* env.visit(this.template.rootElement);
    } finally {
      for (const [k, v] of saved) {
        if (v === null) env._nsScope.delete(k);
        else env._nsScope.set(k, v);
      }
    }
    return null;
  }
}

registerBuiltIn('interpret', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  * impl(target, args, env) {
    if (!(target instanceof StringModel)) {
      throw new NonStringOrTemplateOutputException(
        'For "?interpret" left-hand operand: Expected a sequence or string, '
        + `but this has evaluated to a ${env.typeLabel(target)}.`);
    }
    let cbName = null;
    if (args !== null && args.length > 0) {
      const m = env.wrap(yield* args[0].evaluate(env));
      if (!(m instanceof StringModel)) {
        throw new NonStringException(
          `Expected a string argument, but the argument is a ${env.typeLabel(m)}.`);
      }
      cbName = m.getAsString();
    }
    return new InterpretModel(parseInterpretation(env, target.getAsString()), cbName);
  },
});

/**
 * @param {import('../environment.js').Environment} env
 * @param {string} src
 * @returns {import('../template.js').Template}
 */
function parseInterpretation(env, src) {
  try {
    return env.buildTemplate('anonymous_interpreted', src);
  } catch (e) {
    if (e instanceof ParseException) {
      throw new TemplateException(
        'Template parsing with "?interpret" has failed with this error:\n'
        + e.message);
    }
    throw e;
  }
}
