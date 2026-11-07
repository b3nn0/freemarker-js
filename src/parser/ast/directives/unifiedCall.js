// <- UnifiedCall (<@...>), NestedInstruction (#nested), FallbackInstruction (#fallback).
// <- freemarker.core.UnifiedCall / BodyInstruction / FallbackInstruction

import { TemplateElement } from '../templateElement.js';
import { InvalidReferenceException, UnsupportedFeatureException } from '../../../errors.js';
import { Identifier } from '../expressions/variables.js';
import { CompressedBlock } from './compress.js';
import { callOp } from '../../../async.js';

/** <@call ...> <- UnifiedCall. */
export class UnifiedCall extends TemplateElement {
  // target: Expression; namedArgs: Map<string, Expression> | null; positionalArgs: Expression[] | null;
  // bodyParamNames: string[] | null (the "; p1, p2" list); bodyChildren: TemplateElement[]
  /**
   * @param {import('../expressions/expression.js').Expression} target
   * @param {import('../expressions/expression.js').Expression[]} positionalArgs
   * @param {Array<{ name: string, value: import('../expressions/expression.js').Expression }>} namedArgs
   * @param {string[]} bodyParamNames
   * @param {TemplateElement[]|null} bodyChildren
   */
  constructor(target, positionalArgs, namedArgs, bodyParamNames, bodyChildren) {
    super();
    this.target = target;
    this.positionalArgs = positionalArgs;
    this.namedArgs = namedArgs;
    this.bodyParamNames = bodyParamNames;
    this.bodyChildren = bodyChildren;
    for (const c of bodyChildren) this.addChild(c);
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    // <- UnifiedCall falls back to the core directive element for built-in user
    // directive names (e.g. <@compress> = #compress), data-model shadowing winning.
    if (this.target instanceof Identifier && this.target.name === 'compress'
      && (this.positionalArgs === null || this.positionalArgs.length === 0)
      && (this.namedArgs === null || this.namedArgs.size === 0)
      && (this.bodyParamNames === null || this.bodyParamNames.length === 0)) {
      const shadow = yield* env.getVariable('compress');
      if (shadow === null || shadow === undefined) {
        const block = new CompressedBlock(this.bodyChildren);
        block.setLocation(this.templateName, this.beginLine, this.beginColumn, this.endLine, this.endColumn);
        yield* block.execute(env);
        return null;
      }
    }
    const model = yield* this.target.evaluate(env);
    if (model === null || model === undefined) {
      throw new InvalidReferenceException(
        `The expression ${this.target.getCanonicalForm()} evaluated to null or missing `
        + '(can\'t be called as a macro with <@...>).');
    }
    if (model.isFunctionModel) {
      throw new InvalidReferenceException(
        `The expression ${this.target.getCanonicalForm()} is a #function; call it inside `
        + '${...} instead of with <@...>.');
    }
    if (!model.isMacroLike && !model.isTransform) {
      throw new InvalidReferenceException(
        `The expression ${this.target.getCanonicalForm()} evaluated to a `
        + `${env.typeLabel(model)}, and can't be called with <@...>.`);
    }
    const positional = [];
    if (this.positionalArgs !== null) {
      for (const a of this.positionalArgs) positional.push(yield* a.evaluate(env));
    }
    const named = new Map();
    if (this.namedArgs !== null) {
      for (const [k, exp] of this.namedArgs) named.set(k, yield* exp.evaluate(env));
    }
    yield* callOp(`macro call "<@${this.target.getCanonicalForm()}>"`, model, 'invoke', env, {
      positionalArgs: positional,
      namedArgs: named,
      bodyChildren: this.bodyChildren,
      bodyParamNames: this.bodyParamNames,
    });
    return null;
  }

  // <- UnifiedCall.dump: positional args are comma separated; named args use
  // "name=value" pairs separated by single spaces (sorted by name upstream).
  /** @returns {string} */
  _argsCanonical() {
    if (this.namedArgs !== null && this.namedArgs.size > 0) {
      const keys = [...this.namedArgs.keys()].sort();
      return keys.map((k) => `${k}=${this.namedArgs.get(k).getCanonicalForm()}`).join(' ');
    }
    if (this.positionalArgs !== null && this.positionalArgs.length > 0) {
      return this.positionalArgs.map((a) => a.getCanonicalForm()).join(', ');
    }
    return '';
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const args = this._argsCanonical();
    const bp = this.bodyParamNames === null || this.bodyParamNames.length === 0
      ? '' : `; ${this.bodyParamNames.join(', ')}`;
    const callee = this.target.getCanonicalForm();
    if (this.bodyChildren.length === 0 && this.bodyParamNames === null) {
      return `<@${callee}${args ? ` ${args}` : ''}/>`;
    }
    return `<@${callee}${args ? ` ${args}` : ''}${bp}>`
      + this.bodyChildren.map((c) => c.getCanonicalForm()).join('')
      + `</@${callee}>`;
  }
}

/** #nested <- Nested. */
export class NestedInstruction extends TemplateElement {
  /** @param {import('../expressions/expression.js').Expression[]|null} bodyParameters */
  constructor(bodyParameters) {
    super();
    this.bodyParameters = bodyParameters; // Expression[] | null
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    const ctx = env._macroCallStack[env._macroCallStack.length - 1];
    if (ctx === undefined || ctx.bodyChildren === null || ctx.bodyChildren.length === 0) {
      return null;
    }
    const values = [];
    if (this.bodyParameters !== null) {
      for (const e of this.bodyParameters) {
        try {
          values.push(yield* e.evaluate(env));
        } catch (err) {
          // <- BodyInstruction: a missing nested argument binds null (no error)
          if (!(err instanceof InvalidReferenceException)) throw err;
          values.push(null);
        }
      }
    }
    // <- BodyInstruction.accept: the body runs in the CALLER's context, so swap the
    // macro-scoped frames for the caller's chain saved at invoke time.
    const macroView = env._scopes.slice();
    env._scopes.length = 0;
    env._scopes.push(...ctx.callerScopes);
    // <- Environment.invokeNestedContent: during the body the macro context is
    // the one enclosing the macro CALL (so .caller_template_name blames the
    // body's template, and calls inside the body are attributed to it).
    const prevMacroCtx = env._macroCtx;
    env._macroCtx = prevMacroCtx === null ? null : prevMacroCtx.prev;
    // <- invokeNestedContent: legacyParent = the template owning the current
    // namespace, i.e. the namespace in effect when the running macro was called.
    const nsTemplate = prevMacroCtx !== null ? prevMacroCtx.callSiteNsTemplate : null;
    const prevLegacy = env._legacyTemplate;
    env._legacyTemplate = nsTemplate !== null && nsTemplate !== undefined
      ? (nsTemplate.name ?? null) : (this.templateName ?? null);
    if (ctx.bodyParamNames !== null && ctx.bodyParamNames.length > 0) {
      const ps = new Map();
      const fb = env.configuration.getFallbackOnNullLoopVariable();
      ctx.bodyParamNames.forEach((n, i) => {
        const v = values[i] === undefined ? null : values[i];
        // <- fallbackOnNullLoopVariable: a null body parameter keeps the outer
        // same-named variable visible instead of shadowing it.
        if (!(fb && v === null)) ps.set(n, v);
      });
      env._scopes.push(ps);
    }
    try {
      for (const c of ctx.bodyChildren) yield* env.visit(c);
    } finally {
      env._macroCtx = prevMacroCtx;
      env._legacyTemplate = prevLegacy;
      env._scopes.length = 0;
      env._scopes.push(...macroView);
    }
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    if (this.bodyParameters === null || this.bodyParameters.length === 0) return '<#nested>';
    return `<#nested ${this.bodyParameters.map((e) => e.getCanonicalForm()).join(' ')}>`;
  }
}

/** #fallback <- MacroFallback. */
export class FallbackInstruction extends TemplateElement {
  /** @returns {null} */
  * execute() {
    throw new UnsupportedFeatureException(
      'The #fallback directive requires XML node processing (#visit), which this port does not support.');
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return '<#fallback/>';
  }
}
