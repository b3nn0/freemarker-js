// Escaping/encoding/string-formatting built-ins ← BuiltInsForStringsEncoding
// + BuiltInsForStringsBasic ?c + ?eval (2.3.36).

import { registerBuiltIn } from './registry.js';
import { StringModel, MarkupModel } from '../model/models.js';
import {
  xhtmlEnc, xmlEnc, urlEnc, jsStringEnc,
} from '../utility/stringUtil.js';
import { TemplateException } from '../errors.js';
import { Parser } from '../parser/parser.js';
import { TT } from '../parser/tokenType.js';
import * as LEX from '../parser/lexicalStates.js';

/**
 * @param {import('../model/templateModel.js').TemplateModel} target
 * @param {import('../environment.js').Environment} env
 * @param {string} key
 * @returns {string}
 */
function targetString(target, env, key) {
  return env.coerceToString(target, ` for the "?${key}" built-in`);
}

// ← BuiltInForLegacyEscaping: if the target is markup of a format that bypasses
// this built-in (e.g. ?html on an HTML value), the built-in is silently skipped.
/**
 * @param {Object} target
 * @param {string} key
 * @returns {boolean}
 */
function bypassed(target, key) {
  return target instanceof MarkupModel
    && target.outputFormat.isMarkup
    && typeof target.outputFormat.isLegacyBuiltInBypassed === 'function'
    && target.outputFormat.isLegacyBuiltInBypassed(key);
}

registerBuiltIn('html', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  impl(target, args, env) {
    if (bypassed(target, 'html')) return target;
    return new StringModel(xhtmlEnc(targetString(target, env, 'html')));
  },
});

registerBuiltIn('xhtml', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  impl(target, args, env) {
    if (bypassed(target, 'xhtml')) return target;
    return new StringModel(xhtmlEnc(targetString(target, env, 'xhtml')));
  },
});

registerBuiltIn('xml', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  impl(target, args, env) {
    if (bypassed(target, 'xml')) return target;
    return new StringModel(xmlEnc(targetString(target, env, 'xml')));
  },
});

// ?no_esc: wrap in the current output format's markup model so the
// interpolation writes it out as-is (← NoEsc BI + OutputFormat.output path).
registerBuiltIn('no_esc', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  impl(target, args, env) {
    const fmt = env.outputFormat ?? env.configuration.getOutputFormat();
    return MarkupModel.fromMarkup(targetString(target, env, 'no_esc'), fmt);
  },
});

// ?url: application/x-www-form-urlencoded (UTF-8).
registerBuiltIn('url', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  impl(target, args, env) {
    return new StringModel(urlEnc(targetString(target, env, 'url'), false));
  },
});

// ?json_string: StringUtil.jsonStringEnc (2.3.32 rules).
registerBuiltIn('json_string', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  impl(target, args, env) {
    return new StringModel(jsStringEnc(targetString(target, env, 'json_string'), true));
  },
});

// ?js_string: StringUtil.javaScriptStringEnc (2.3.32 rules).
registerBuiltIn('js_string', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  impl(target, args, env) {
    return new StringModel(jsStringEnc(targetString(target, env, 'js_string'), false));
  },
});

// ?c: the computer-oriented ("C") form; strings return themselves unchanged.
registerBuiltIn('c', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  impl(target, args, env) {
    if (target instanceof StringModel) return target;
    if (target && typeof target.getAsNumber === 'function') {
      return new StringModel(String(target.getAsNumber()));
    }
    if (target && typeof target.getAsBoolean === 'function') {
      return new StringModel(target.getAsBoolean() ? 'true' : 'false');
    }
    return new StringModel(env.coerceToString(target, ' for the "?c" built-in'));
  },
});

// ?eval: evaluates the string as an FTL expression. The static import of the
// parser creates a load-time cycle (builtIn → index → encoding → parser →
// builtIn); it stays safe because the Parser class is only touched at runtime.
registerBuiltIn('eval', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  impl(target, args, env) {
    const src = targetString(target, env, 'eval');
    let exp;
    try {
      exp = parseExpression(src, env.configuration);
    } catch (e) {
      if (e instanceof TemplateException) throw e;
      throw new TemplateException(
        `Could not parse the expression: ${src}\nUnderlying cause: ${e.message}`);
    }
    return exp.evaluate(env);
  },
});

/**
 * Parses a single FTL expression from a string (?eval support).
 * @param {string} source
 * @param {import('../configuration.js').Configuration} cfg
 * @returns {Object} the expression AST node
 * @throws {import('../errors.js').ParseException}
 */
export function parseExpression(source, cfg) {
  const p = new Parser(source, cfg, null);
  p.tm.switchTo(LEX.FM_EXPRESSION); // ← like inside "${"
  const exp = p._parseExpression();
  const t = p._peek();
  if (t.type !== TT.EOF) {
    throw p._error(`Expected end of expression, but got ${p._desc(t)}.`, t);
  }
  return exp;
}
