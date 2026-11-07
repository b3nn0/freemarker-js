// A string literal whose decoded content was re-parsed as static text + interpolations
// <- freemarker.core.StringLiteral.parseValue / StaticTextAndInterpolations. The parts
// are plain strings and {expression, fracOpts} records; eval concatenates the
// formatted values (the port has no markup-output model here, so markup promotion
// is a documented deviation).

import { Expression } from './expression.js';
import { StringModel, NumberModel } from '../../../model/models.js';
import { InvalidReferenceException } from '../../../errors.js';
import { blameText, GENERAL_MISSING_TIP } from './variables.js';

export class InterpolatedStringExpression extends Expression {
  /** @param {(string | {expression: Expression, fracOpts: Object|null})[]} parts */
  constructor(parts) {
    super();
    this.parts = parts;
  }

  /**
   * @param {import('../../../environment.js').Environment} env
   * @returns {Object}
   */
  * evaluate(env) {
    let s = '';
    for (const part of this.parts) {
      if (typeof part === 'string') {
        s += part;
        continue;
      }
      const value = yield* part.expression.evaluate(env);
      if (value === null || value === undefined) {
        const e = new InvalidReferenceException(
          blameText(part.expression, part.expression.getCanonicalForm(), [GENERAL_MISSING_TIP]));
        e.templateName = part.expression.templateName ?? this.templateName;
        e.beginLine = part.expression.beginLine;
        e.beginColumn = part.expression.beginColumn;
        throw e;
      }
      if (part.fracOpts !== null && value instanceof NumberModel) {
        s += env._formatNumber(
          value.getAsNumber(), part.fracOpts, null,
          typeof value.getAsDecimal === 'function' ? value.getAsDecimal() : null);
      } else {
        s += yield* env.coerceToString(value, ' (interpolation inside a string literal)');
      }
    }
    return new StringModel(s);
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    let out = '"';
    for (const part of this.parts) {
      if (typeof part === 'string') {
        out += part.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      } else {
        out += `${part.fracOpts !== null ? '#' : '$'}{${part.expression.getCanonicalForm()}}`;
      }
    }
    return out + '"';
  }
}
