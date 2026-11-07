// ${...} (and [=...], canonicalized to ${...}). <- freemarker.core.DollarVariable (Interpolation).

import { TemplateElement } from './templateElement.js';
import { MarkupModel, NumberModel } from '../../model/models.js';
import {
  InvalidReferenceException, TemplateException, NonStringOrTemplateOutputException,
} from '../../errors.js';
import { TemplateMethodModel, TemplateSequenceModel, TemplateHashModel, TemplateHashModelEx } from '../../model/templateModel.js';
import { blameText, GENERAL_MISSING_TIP } from './expressions/variables.js';

/** ${...} <- DollarVariable; with fracOpts set it is the legacy #{...} (NumericalOutput). */
export class Interpolation extends TemplateElement {
  /**
   * @param {import('./expressions/expression.js').Expression} expression
   * @param {import('../../outputFormat.js').OutputFormat|null} [outputFormat] -
   *   the format bound at parse time <- DollarVariable.outputFormat
   * @param {boolean} [autoEscape] - <- DollarVariable.autoEscape
   * @param {{ minFrac?: number, maxFrac?: number }|null} [fracOpts] - <- NumericalOutput #{exp;mN}
   */
  constructor(expression, outputFormat = null, autoEscape = false, fracOpts = null) {
    super();
    this.expression = expression;
    this.outputFormat = outputFormat;
    this.autoEscape = autoEscape;
    this.fracOpts = fracOpts;
  }

  /**
   * <- DollarVariable.accept: markup values follow the format-mixing rules,
   * plain values are escaped iff this interpolation was parse-bound to autoEscape.
   * @param {import('../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    const value = yield* this.expression.evaluate(env);
    if (value === null || value === undefined) {
      const e = new InvalidReferenceException(
        blameText(this.expression, this.expression.getCanonicalForm(), [GENERAL_MISSING_TIP]));
      e.templateName = this.templateName ?? this.expression.templateName;
      e.beginLine = this.expression.beginLine;
      e.beginColumn = this.expression.beginColumn;
      throw e;
    }
    if (value instanceof TemplateMethodModel || value instanceof TemplateSequenceModel
      || value instanceof TemplateHashModel) {
      // <- CoercionUtil message (wrapper text omitted; deviation)
      const what = value instanceof TemplateMethodModel ? 'a method'
        : value instanceof TemplateSequenceModel ? 'a sequence'
          : (value instanceof TemplateHashModelEx) ? 'an extended_hash' : 'a hash';
      const e = new NonStringOrTemplateOutputException(
        'For "${...}" content: Expected a string or something automatically convertible to '
        + `string (number, date or boolean), or "template output" , but this has evaluated to ${what}:`);
      e.templateName = this.templateName ?? this.expression.templateName;
      e.beginLine = this.expression.beginLine;
      e.beginColumn = this.expression.beginColumn;
      e.message += `\n==> ${this.expression.getCanonicalForm()}`
        + `  [in template "${e.templateName ?? 'Template'}" at line ${e.beginLine}, `
        + `column ${e.beginColumn}]`;
      throw e;
    }
    if (this.fracOpts !== null && value instanceof NumberModel) {
      const s = env._formatNumber(
        value.getAsNumber(), this.fracOpts, null,
        typeof value.getAsDecimal === 'function' ? value.getAsDecimal() : null);
      env.output.write(
        this.autoEscape && this.outputFormat !== null && this.outputFormat.isMarkup
          ? this.outputFormat.escapePlainText(s) : s);
      return null;
    }
    if (value instanceof MarkupModel) {
      const cur = this.outputFormat ?? env.outputFormat ?? env.configuration.getOutputFormat();
      const moOF = value.outputFormat;
      if (moOF === cur) {
        env.output.write(value.markup ?? cur.escapePlainText(value.plainText));
      } else if (!cur.isOutputFormatMixingAllowed) {
        const src = value.plainText;
        if (src === null) {
          throw new TemplateException(
            `The value to print is in ${moOF.name} format, which differs from the current `
            + `output format, ${cur.name}. Format conversion wasn't possible.`);
        }
        env.output.write(cur.isMarkup ? cur.escapePlainText(src) : src);
      } else {
        env.output.write(value.markup ?? moOF.escapePlainText(value.plainText));
      }
      return null;
    }
    const s = yield* env.coerceToString(value, ' (output of an interpolation)');
    env.output.write(
      this.autoEscape && this.outputFormat !== null && this.outputFormat.isMarkup
        ? this.outputFormat.escapePlainText(s)
        : s);
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    if (this.fracOpts !== null) {
      // <- NumericalOutput keeps the #{} form; m/M spell back the parsed bounds
      return `#{${this.expression.getCanonicalForm()} ; m${this.fracOpts.minFrac}`
        + `M${this.fracOpts.maxFrac}}`;
    }
    return `\${${this.expression.getCanonicalForm()}}`;
  }

  /** <- DollarVariable: interpolations heed whitespace around them */
  heedsOpeningWhitespace() {
    return true;
  }

  /** <- DollarVariable: interpolations heed whitespace around them */
  heedsTrailingWhitespace() {
    return true;
  }
}
