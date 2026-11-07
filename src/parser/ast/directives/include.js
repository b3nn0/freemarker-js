// <- freemarker.core.Include (#include).

import { TemplateElement } from '../templateElement.js';
import { NonBooleanException } from '../../../errors.js';
import { StringModel, BooleanModel } from '../../../model/models.js';

/**
 * `#include name [parse=..] [encoding=..] [ignore_missing=..]` -- at render time
 * resolves the source via the includeResolver, parses (cached per Configuration),
 * and visits the included template with the same data model/namespace.
 */
export class IncludeDirective extends TemplateElement {
  /**
   * @param {Object} nameExp - template-name expression
   * @param {Object|null} parseExp
   * @param {Object|null} encodingExp
   * @param {Object|null} ignoreMissingExp
   */
  constructor(nameExp, parseExp, encodingExp, ignoreMissingExp) {
    super();
    this.nameExp = nameExp;
    this.parseExp = parseExp;
    this.encodingExp = encodingExp;
    this.ignoreMissingExp = ignoreMissingExp;
  }

  /**
   * Boolean param value; legacy string values use the yes/no spelling rule.
   * @param {import('../../../environment.js').Environment} env
   * @param {Object|null} exp
   * @param {boolean} dflt
   * @param {string} paramName - for the error message
   * @returns {boolean}
   */
  * _bool(env, exp, dflt, paramName) {
    if (exp === null) return dflt;
    const m = yield* exp.evaluate(env);
    if (m instanceof BooleanModel) return m.getAsBoolean();
    if (m instanceof StringModel) {
      const s = m.getAsString().toLowerCase();
      if (s === 'true' || s === 'yes') return true;
      if (s === 'false' || s === 'no') return false;
      throw new NonBooleanException(
        `Expected a boolean as the value of the "${paramName}" attribute, `
        + `but the string "${m.getAsString()}" can't be converted to a boolean.`);
    }
    throw new NonBooleanException(
      `Expected a boolean as the value of the "${paramName}" attribute, `
      + `but it was a ${env.typeLabel(m)}.`);
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    const rawName = yield* env.coerceToString(yield* this.nameExp.evaluate(env),
      ' used as the #include template name');
    const parse = yield* this._bool(env, this.parseExp, true, 'parse');
    const ignoreMissing = yield* this._bool(env, this.ignoreMissingExp, false, 'ignore_missing');
    if (!parse) {
      // <- #include parse=false: write the file source verbatim, unparsed.
      let src;
      try {
        src = yield* env.loadIncludedSource(rawName);
      } catch (e) {
        if (ignoreMissing) return null;
        throw e;
      }
      env.output.write(src);
      return null;
    }
    let included;
    try {
      included = yield* env.loadIncludedTemplate(rawName);
    } catch (e) {
      if (ignoreMissing) return null;
      throw e;
    }
    // <- Environment.include(): same data model and namespace; children visit inline.
    // The included template becomes the "current" one (.current_template_name,
    // relative #include resolution) for the duration of the visit.
    // <- Environment.include: the included template's macros join the
    // namespace from this point on (visible in the including template).
    for (const m of included.macros) {
      m.macroModel.defTemplate = included;
      m.macroModel.defNsTemplate = env._nsTemplate ?? env._mainTemplate ?? included;
      if (!env._nsScope.has(m.name)) env._nsScope.set(m.name, m.macroModel);
    }
    const savedTemplate = env.template;
    const savedLegacy = env._legacyTemplate;
    env.template = included;
    env._legacyTemplate = included.name ?? null;
    try {
      yield* env.visit(included.rootElement); // <- visit as single element
    } finally {
      env.template = savedTemplate;
      env._legacyTemplate = savedLegacy;
    }
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    let s = `<#include ${this.nameExp.getCanonicalForm()}`;
    if (this.encodingExp !== null) s += ` encoding=${this.encodingExp.getCanonicalForm()}`;
    if (this.parseExp !== null) s += ` parse=${this.parseExp.getCanonicalForm()}`;
    if (this.ignoreMissingExp !== null) s += ` ignore_missing=${this.ignoreMissingExp.getCanonicalForm()}`;
    return s + '/>';
  }
}
