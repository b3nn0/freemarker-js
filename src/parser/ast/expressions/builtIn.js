// <- freemarker.core.BuiltIn: target?key; positional (args) consumption landed with M10/M11.

import { Expression } from './expression.js';
import { getBuiltIn } from '../../../builtins/registry.js';
import '../../../builtins/index.js'; // registers the milestone's built-ins (side effect)
import { HashModel, StringModel, BooleanModel, DateModel } from '../../../model/models.js';
import { TemplateHashModelEx } from '../../../model/templateModel.js';
import { InvalidReferenceException, TemplateException } from '../../../errors.js';
import { getOptionalTemplateValue } from './templateAccess.js';

// <- .vars: live view of scopes + namespace + data model
class VarsModel extends TemplateHashModelEx {
  /** @param {import('../../../environment.js').Environment} env */
  constructor(env) {
    super();
    this.env = env;
  }

  * get(key) {
    return yield* this.env.getVariable(key);
  }

  keys() {
    const out = new Set();
    for (const s of this.env._scopes) for (const k of s.keys()) out.add(k);
    for (const k of this.env._nsScope.keys()) out.add(k);
    const dm = this.env.dataModel;
    if (dm && typeof dm.keys === 'function') for (const k of dm.keys()) out.add(k);
    return [...out];
  }

  size() {
    return this.keys().length;
  }
}

// <- BuiltinVariable: live view of the current template's namespace hash
class NamespaceModel extends TemplateHashModelEx {
  /** @param {import('../../../environment.js').Environment} env */
  constructor(env) {
    super();
    this.env = env;
  }

  * get(key) {
    const v = this.env._nsScope.get(key);
    return v === undefined ? null : v;
  }

  keys() {
    return [...this.env._nsScope.keys()];
  }

  size() {
    return this.keys().length;
  }
}

// <- freemarker.core.BuiltinVariable: the leading-dot special variables.
/** ?loop_var style builtin variable <- BuiltinVariable. */
export class BuiltinVariable extends Expression {
  /**
   * @param {string} name
   * @param {boolean|null} autoEscValue - parse-time auto-escaping state, bound
   *   for ".auto_esc" <- BuiltinVariable's parseTimeValue
   */
  constructor(name, autoEscValue = null, args = null) {
    super();
    this.name = name;
    this.autoEscValue = autoEscValue;
    this.args = args;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `.${this.name}${this.args === null || this.args === undefined ? ''
      : `(${this.args.map((a) => a.getCanonicalForm()).join(', ')})`}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  * evaluate(env) {
    if (this.name === 'data_model') return env.dataModel;
    if (this.name === 'output_format') {
      const of = env.outputFormat ?? env.configuration.getOutputFormat();
      return new StringModel(of ? of.name : 'Undefined');
    }
    if (this.name === 'args') {
      for (let i = env._scopes.length - 1; i >= 0; i--) {
        const s = env._scopes[i];
        if (s.isMacroScope) {
          const v = s.get('__args__');
          return v === undefined ? new HashModel(new Map()) : v;
        }
      }
      throw new InvalidReferenceException(
        'The "args" special variable is only available inside a macro or function.');
    }
    if (this.name === 'template_name') {
      // <- Environment.getTemplate230(): the legacy parent template, switched at
      // #include/#import/#nested but not at macro/function calls; the deprecated
      // variable prints "" for a nameless template.
      const fallback = env._mainTemplate ?? env.template;
      const n = env._legacyTemplate ?? ((fallback && fallback.name != null) ? fallback.name : '');
      return new StringModel(n === null ? '' : n);
    }
    if (this.name === 'current_template_name') {
      // <- Environment.getCurrentTemplate(): the template this element was parsed
      // from (macro bodies follow the definition site; nested bodies the call site).
      return this.templateName != null ? new StringModel(this.templateName) : null;
    }
    if (this.name === 'main_template_name') {
      const t = env._mainTemplate ?? env.template;
      return t && t.name != null ? new StringModel(t.name) : null;
    }
    if (this.name === 'vars' || this.name === 'globals') return new VarsModel(env);
    if (this.name === 'namespace' || this.name === 'main') return new NamespaceModel(env);
    if (this.name === 'locals') return null;
    if (this.name === 'auto_esc') {
      return new BooleanModel(this.autoEscValue !== null
        ? this.autoEscValue
        : !!(env.template && env.template.autoEscaping));
    }
    if (this.name === 'time_zone') {
      const tz = env._settings.timeZone
        ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null)
        ?? 'UTC';
      return new StringModel(tz);
    }
    if (this.name === 'output_encoding' || this.name === 'url_escaping_charset') {
      const key = this.name === 'output_encoding' ? 'outputEncoding' : 'urlEscapingCharset';
      const v = env._settings[key];
      return v == null ? null : new StringModel(String(v));
    }
    if (this.name === 'locale' || this.name === 'lang') {
      const loc = env._settings.locale
        ?? (env.configuration.getLocale() != null ? String(env.configuration.getLocale()) : 'en_US');
      return new StringModel(this.name === 'locale' ? loc : loc.split(/[_-]/)[0]);
    }
    if (this.name === 'version') return new StringModel('2.3.36');
    if (this.name === 'incompatible_improvements') return new StringModel('2.3.36');
    if (this.name === 'now') return new DateModel(new Date(), DateModel.DATE_TIME);
    if (this.name === 'error') {
      if (!env._recoverError) {
        throw new TemplateException('.error is not available outside of a #recover block.');
      }
      return new StringModel(env._recoverError.message);
    }
    if (this.name === 'caller_template_name') {
      // <- BuiltinVariable eval: the innermost macro/function CALL frame's call
      // place template (switched to the enclosing frame inside #nested bodies).
      const ctx = env._macroCtx;
      if (ctx === null) {
        throw new TemplateException(
          `Can't get .${this.name} here, as there's no macro or function `
          + "(that's implemented in the template) call in context.");
      }
      const t = ctx.callTemplate;
      return t && t.name !== null && t.name !== undefined
        ? new StringModel(t.name) : new StringModel('');
    }
    if (this.name === 'node' || this.name === 'current_node') {
      throw new TemplateException(
        `Special variable ".${this.name}" isn't supported in this port (XML support is excluded).`);
    }
    if (this.name === 'get_optional_template') {
      return yield* getOptionalTemplateValue(env, this.args);
    }
    if (this.name === 'pass' || this.name === 'locale_object') {
      throw new TemplateException(
        `Special variable ".${this.name}" isn't supported in this port.`);
    }
    throw new TemplateException(`Unsupported special variable .${this.name}`);
  }
}

/** x?name <- BuiltIn (target, key, args). */
export class BuiltIn extends Expression {
  // args: Expression[] | null -- raw argument expressions; builtins that accept
  // lambda arguments receive the unevaluated nodes (<- BuiltInWithParseTimeParameters).
  /** @param {Expression} target @param {string} key @param {Expression[]|null} [args] */
  constructor(target, key, args = null) {
    super();
    this.target = target;
    this.key = key;
    this.args = args;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const args = this.args === null
      ? '' : `(${this.args.map((a) => a.getCanonicalForm()).join(', ')})`;
    return `${this.target.getCanonicalForm()}?${this.key}${args}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  * evaluate(env) {
    const spec = getBuiltIn(this.key);
    if (!spec) {
      // <- upstream reports unknown built-ins at parse time; the registry fills by
      // milestone, so this port detects at run time (deviation in UPSTREAM.md).
      throw new TemplateException(`There is no such built-in: ${this.key}`);
    }
    let target;
    if (spec.acceptsMissing) {
      // <- ExistenceBuiltIn.evalMaybeNonexistentTarget: a missing target becomes null
      try {
        target = yield* this.target.evaluate(env);
      } catch (e) {
        if (e instanceof InvalidReferenceException) target = null;
        else throw e;
      }
    } else {
      target = yield* this.target.evaluate(env);
      if (target === null || target === undefined) {
        // <- the type-bound BuiltInForXxx classes reject null targets
        throw new InvalidReferenceException(
          `The "?${this.key}" built-in needs a value, but its target has evaluated to `
          + 'null or missing.');
      }
    }
    return yield* spec.impl(target, this.args === null ? [] : this.args, env);
  }
}
