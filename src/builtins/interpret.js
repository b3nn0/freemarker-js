// ?interpret <- freemarker.core.Interpret (2.3.36): parses the target string as
// FTL at render time and yields a "transform" model callable via <@d/>.
// A sequence left-hand operand is [source, templateName] <- InterpretBI

import { registerBuiltIn } from './registry.js';
import { StringModel } from '../model/models.js';
import {
  isScalarModel, isSequenceModel,
} from '../model/capabilities.js';
import { NonStringException, NonStringOrTemplateOutputException, ParseException, TemplateException } from '../errors.js';
import { awaitOp, callOp } from '../async.js';

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
    const savedTemplate = env.template;
    const savedLegacy = env._legacyTemplate;
    env.template = this.template;
    env._legacyTemplate = this.template.name ?? null;
    try {
      yield* env.visit(this.template.rootElement);
    } finally {
      env.template = savedTemplate;
      env._legacyTemplate = savedLegacy;
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
    let src;
    let explicitName = null;
    if (isScalarModel(target)) {
      src = yield* callOp('getAsString', target, 'getAsString');
    } else if (isSequenceModel(target)) {
      const n = yield* awaitOp('size', target.size());
      if (n < 1 || n > 2) {
        throw new NonStringOrTemplateOutputException(
          'For "?interpret" left-hand operand: Expected a sequence with 1 or 2 items '
          + `(source[, name]), but the sequence has ${n} items.`);
      }
      const first = yield* awaitOp('getByIndex', target.getByIndex(0));
      if (!isScalarModel(first)) {
        throw new NonStringOrTemplateOutputException(
          'For "?interpret" left-hand operand: Expected the first sequence item to be '
          + `a string, but it's a ${env.typeLabel(first)}.`);
      }
      src = yield* callOp('getAsString', first, 'getAsString');
      if (n === 2) {
        const second = yield* awaitOp('getByIndex', target.getByIndex(1));
        if (!isScalarModel(second)) {
          throw new NonStringOrTemplateOutputException(
            'For "?interpret" left-hand operand: Expected the second sequence item to '
            + `be a string, but it's a ${env.typeLabel(second)}.`);
        }
        explicitName = yield* callOp('getAsString', second, 'getAsString');
      }
    } else {
      throw new NonStringOrTemplateOutputException(
        'For "?interpret" left-hand operand: Expected a sequence or string, '
        + `but this has evaluated to a ${env.typeLabel(target)}.`);
    }
    let cbName = null;
    if (args !== null && args.length > 0) {
      const m = env.wrap(yield* args[0].evaluate(env));
      if (!isScalarModel(m)) {
        throw new NonStringException(
          `Expected a string argument, but the argument is a ${env.typeLabel(m)}.`);
      }
      cbName = yield* callOp('getAsString', m, 'getAsString');
    }
    return new InterpretModel(parseInterpretation(env, src, explicitName), cbName);
  },
});

/**
 * @param {import('../environment.js').Environment} env
 * @param {string} src
 * @returns {import('../template.js').Template}
 */
function parseInterpretation(env, src, explicitName) {
  // <- InterpretBI: the sub-template name chains onto the parent template name
  // ("parent->anonymous_interpreted"), so .current_template_name is traceable.
  const parentName = env.template && env.template.name != null ? env.template.name : 'nameless_template';
  const name = parentName + '->' + (explicitName !== null ? explicitName : 'anonymous_interpreted');
  try {
    return env.buildTemplate(name, src);
  } catch (e) {
    if (e instanceof ParseException) {
      throw new TemplateException(
        'Template parsing with "?interpret" has failed with this error:\n'
        + e.message);
    }
    throw e;
  }
}
