// <- UnifiedCall (<@...>), NestedInstruction (#nested), FallbackInstruction (#fallback).
// <- freemarker.core.UnifiedCall / BodyInstruction / FallbackInstruction

import { TemplateElement } from '../templateElement.js';
import { InvalidReferenceException, UnsupportedFeatureException } from '../../../errors.js';
import { callOp } from '../../../async.js';

/** <@call ...> <- UnifiedCall. */
export class UnifiedCall extends TemplateElement {
  // target: Expression; namedArgs: Map<string, Expression> | null; positionalArgs: Expression[] | null;
  // bodyParamNames: string[] | null (the "; p1, p2" list); bodyChildren: TemplateElement[]
  /**
   * @param {Expression} target
   * @param {Expression[]} positionalArgs
   * @param {Array<{ name: string, value: Expression }>} namedArgs
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
    if (!model.isMacroLike) {
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
  /** @param {Expression[]|null} bodyParameters */
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
      for (const e of this.bodyParameters) values.push(yield* e.evaluate(env));
    }
    // <- BodyInstruction.accept: the body runs in the CALLER's context, so swap the
    // macro-scoped frames for the caller's chain saved at invoke time.
    const macroView = env._scopes.slice();
    env._scopes.length = 0;
    env._scopes.push(...ctx.callerScopes);
    if (ctx.bodyParamNames !== null && ctx.bodyParamNames.length > 0) {
      const ps = new Map();
      ctx.bodyParamNames.forEach((n, i) => ps.set(n, values[i] === undefined ? null : values[i]));
      env._scopes.push(ps);
    }
    try {
      for (const c of ctx.bodyChildren) yield* env.visit(c);
    } finally {
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
