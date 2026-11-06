// ← freemarker.core.Include (#include).

import { TemplateElement } from '../templateElement.js';
import { UnsupportedFeatureException, NonBooleanException } from '../../../errors.js';
import { StringModel, BooleanModel } from '../../../model/models.js';

/**
 * `#include name [parse=..] [encoding=..] [ignore_missing=..]` — at render time
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
  _bool(env, exp, dflt, paramName) {
    if (exp === null) return dflt;
    const m = exp.evaluate(env);
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
  execute(env) {
    const rawName = env.coerceToString(this.nameExp.evaluate(env),
      ' used as the #include template name');
    const parse = this._bool(env, this.parseExp, true, 'parse');
    if (!parse) {
      throw new UnsupportedFeatureException(
        'The "#include" parameter parse=false (parsing the included file as XML) '
        + 'is not supported by this port.');
    }
    const ignoreMissing = this._bool(env, this.ignoreMissingExp, false, 'ignore_missing');
    let included;
    try {
      included = env.loadIncludedTemplate(rawName);
    } catch (e) {
      if (ignoreMissing) return null;
      throw e;
    }
    // ← Environment.include(): same data model and namespace; children visit inline.
    env.visit(included.rootElement); // ← Environment.include(): visit as single element
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
