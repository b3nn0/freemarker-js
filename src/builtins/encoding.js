// Escaping/encoding/string-formatting built-ins <- BuiltInsForStringsEncoding
// + BuiltInsForStringsBasic ?c + ?eval (2.3.36).

import { registerBuiltIn } from './registry.js';
import { StringModel, MarkupModel } from '../model/models.js';
import {
  xhtmlEnc, xmlEnc, urlEnc, jsStringEnc,
} from '../utility/stringUtil.js';
import { TemplateException, InvalidReferenceException, NonStringException } from '../errors.js';
import { Parser } from '../parser/parser.js';
import { TT } from '../parser/tokenType.js';
import * as LEX from '../parser/lexicalStates.js';
import { callOp } from '../async.js';
import { cNumberFormat, cStringLiteral } from '../format/cFormat.js';

/**
 * @param {import('../model/templateModel.js').TemplateModel} target
 * @param {import('../environment.js').Environment} env
 * @param {string} key
 * @returns {string}
 */
function* targetString(target, env, key) {
  return yield* env.coerceToString(target, ` for the "?${key}" built-in`);
}

// <- BuiltInForLegacyEscaping: if the target is markup of a format that bypasses
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
  * impl(target, args, env) {
    if (bypassed(target, 'html')) return target;
    return new StringModel(xhtmlEnc(yield* targetString(target, env, 'html')));
  },
});

registerBuiltIn('xhtml', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  * impl(target, args, env) {
    if (bypassed(target, 'xhtml')) return target;
    return new StringModel(xhtmlEnc(yield* targetString(target, env, 'xhtml')));
  },
});

registerBuiltIn('xml', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  * impl(target, args, env) {
    if (bypassed(target, 'xml')) return target;
    return new StringModel(xmlEnc(yield* targetString(target, env, 'xml')));
  },
});

// ?no_esc: wrap in the current output format's markup model so the
// interpolation writes it out as-is (<- NoEsc BI + OutputFormat.output path).
registerBuiltIn('no_esc', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  * impl(target, args, env) {
    const fmt = env.outputFormat ?? env.configuration.getOutputFormat();
    return MarkupModel.fromMarkup(yield* targetString(target, env, 'no_esc'), fmt);
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
  * impl(target, args, env) {
    return new StringModel(urlEnc(yield* targetString(target, env, 'url'), false));
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
  * impl(target, args, env) {
    return new StringModel(jsStringEnc(yield* targetString(target, env, 'json_string'), true));
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
  * impl(target, args, env) {
    return new StringModel(jsStringEnc(yield* targetString(target, env, 'js_string'), false));
  },
});

// ?c <- BuiltInsForMultipleTypes.cBI: C/Java literal form of a scalar (strings
// get quoted and escaped; numbers use the CTemplateNumberFormat).
registerBuiltIn('c', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  * impl(target, args, env) {
    if (target === null || target === undefined) {
      throw new InvalidReferenceException('Can\'t apply the ?c built-in to null.');
    }
    if (typeof target.getAsNumber === 'function') {
      const dec = typeof target.getAsDecimal === 'function' ? target.getAsDecimal() : null;
      if (dec !== null && dec !== undefined) return new StringModel(dec.toJavaString());
      return new StringModel(cNumberFormat(yield* callOp('getAsNumber', target, 'getAsNumber')));
    }
    if (typeof target.getAsBoolean === 'function') {
      return new StringModel((yield* callOp('getAsBoolean', target, 'getAsBoolean')) ? 'true' : 'false');
    }
    if (typeof target.getAsString === 'function') {
      return new StringModel(cStringLiteral(yield* callOp('getAsString', target, 'getAsString')));
    }
    throw new NonStringException(
      'For "?c" left-hand operand: Expected a number, boolean, or string, '
      + `but this has evaluated to ${env.typeLabel(target)}`);
  },
});

// ?eval: evaluates the string as an FTL expression. The static import of the
// parser creates a load-time cycle (builtIn -> index -> encoding -> parser ->
// builtIn); it stays safe because the Parser class is only touched at runtime.
registerBuiltIn('eval', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  * impl(target, args, env) {
    const src = yield* targetString(target, env, 'eval');
    let exp;
    try {
      exp = parseExpression(src, env.configuration, env.template ? env.template.name : null);
    } catch (e) {
      if (e instanceof TemplateException) throw e;
      // <- keep the sub-parse position (tab-expanded column) in the cause text:
      const where = e.beginColumn > 0
        ? ` at line ${e.beginLine}, column ${e.beginColumn}` : '';
      throw new TemplateException(
        `Could not parse the expression: ${src}\nUnderlying cause: ${e.message}${where}`);
    }
    return yield* exp.evaluate(env);
  },
});

/**
 * Parses a single FTL expression from a string (?eval support).
 * @param {string} source
 * @param {import('../configuration.js').Configuration} cfg
 * @param {string|null} [templateName] - the template being evaluated in (JVM:
 *   eval-parsed elements belong to the containing template)
 * @returns {Object} the expression AST node
 * @throws {import('../errors.js').ParseException}
 */
export function parseExpression(source, cfg, templateName = null) {
  const p = new Parser(source, cfg, templateName ?? null);
  p.tm.switchTo(LEX.FM_EXPRESSION); // <- like inside "${"
  const exp = p._parseExpression();
  const t = p._peek();
  if (t.type !== TT.EOF) {
    throw p._error(`Expected end of expression, but got ${p._desc(t)}.`, t);
  }
  return exp;
}
