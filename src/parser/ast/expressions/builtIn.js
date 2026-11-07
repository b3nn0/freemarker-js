// <- freemarker.core.BuiltIn: target?key; positional (args) consumption landed with M10/M11.

import { Expression } from './expression.js';
import { getBuiltIn } from '../../../builtins/registry.js';
import '../../../builtins/index.js'; // registers the milestone's built-ins (side effect)
import { HashModel, StringModel } from '../../../model/models.js';
import { TemplateHashModelEx } from '../../../model/templateModel.js';
import { InvalidReferenceException, TemplateException } from '../../../errors.js';

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

// <- freemarker.core.BuiltinVariable: the leading-dot special variables. Only .args lands in M9.
/** ?loop_var style builtin variable <- BuiltinVariable. */
export class BuiltinVariable extends Expression {
  /** @param {string} name */
  constructor(name) {
    super();
    this.name = name;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `.${this.name}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  * evaluate(env) {
    if (this.name === 'data_model') return env.dataModel;
    if (this.name === 'template_name') {
      return env.template && env.template.name !== null
        ? new StringModel(env.template.name) : null;
    }
    if (this.name === 'vars') return new VarsModel(env);
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
