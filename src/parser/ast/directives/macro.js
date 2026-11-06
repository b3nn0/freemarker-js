// ← Macro / MacroModel (#macro, #function). ← freemarker.core.Macro

import { TemplateElement } from '../templateElement.js';
import { HashModel } from '../../../model/models.js';
import { InvalidReferenceException, ReturnInstructionException } from '../../../errors.js';

export class Macro extends TemplateElement {
  // params: [{ name, defaultExp|null }]; catchAllName: string|null
  constructor(name, params, catchAllName, isFunction, bodyChildren) {
    super();
    this.name = name;
    this.params = params;
    this.catchAllName = catchAllName;
    this.isFunction = isFunction;
    this.argsNeeded = false; // set by the parser when `.args` appears in the body
    for (const c of bodyChildren) this.addChild(c);
    this.macroModel = new MacroModel(this);
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  execute(env) {
    // Registration happens at parse time (← Parser.Macro(): template.addMacro); at
    // render start the Environment seeds them into the namespace.
    return null;
  }

  // ← Macro.dump: macros list space-separated params without parens;
  // functions use parens and commas.
  _paramsCanonical() {
    const parts = this.params.map((p) =>
      p.defaultExp === null ? p.name : `${p.name}=${p.defaultExp.getCanonicalForm()}`);
    if (this.catchAllName !== null) parts.push(`${this.catchAllName}...`);
    if (this.isFunction) return `(${parts.join(', ')})`;
    return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const tag = this.isFunction ? 'function' : 'macro';
    return `<#${tag} ${this.name}${this._paramsCanonical()}>`
      + this.children.map((c) => c.getCanonicalForm()).join('')
      + `</#${tag}>`;
  }
}

export class MacroModel {
  constructor(macroDef) {
    this.macroDef = macroDef;
    this.isMacroLike = !macroDef.isFunction;
    this.isFunctionModel = macroDef.isFunction;
  }

  // ← Environment.invokeMacroOrFunctionCommonPart + Macro.accept
  invoke(env, { positionalArgs = [], namedArgs = new Map(), bodyChildren = null,
    bodyParamNames = null }) {
    const def = this.macroDef;
    const scope = new Map();
    scope.isMacroScope = true;

    const declared = new Map(def.params.map((p) => [p.name, p]));
    const used = new Set();
    const extras = [];
    for (let i = 0; i < positionalArgs.length; i++) {
      const p = def.params[i];
      if (p === undefined) {
        throw new InvalidReferenceException(
          `Macro/function "${def.name}" was called with ${positionalArgs.length} positional `
          + `arguments, but it only accepts ${def.params.length} positional arguments.`);
      }
      if (used.has(p.name)) {
        throw new InvalidReferenceException(
          `Argument "${p.name}" of macro/function "${def.name}" was given twice.`);
      }
      scope.set(p.name, positionalArgs[i]);
      used.add(p.name);
    }
    let catchAllMap = null;
    for (const [k, v] of namedArgs) {
      if (declared.has(k)) {
        if (used.has(k)) {
          throw new InvalidReferenceException(
            `Argument "${k}" of macro/function "${def.name}" was given twice.`);
        }
        scope.set(k, v);
        used.add(k);
      } else if (def.catchAllName !== null) {
        if (catchAllMap === null) {
          catchAllMap = new Map();
          scope.set(def.catchAllName, new HashModel(catchAllMap));
        }
        catchAllMap.set(k, v);
        if (def.argsNeeded) extras.push([k, v]);
      } else if (def.argsNeeded) {
        extras.push([k, v]); // unnamed-for-the-signature, but `.args` captures them
      } else {
        throw new InvalidReferenceException(
          `Macro/function "${def.name}" doesn't accept the argument "${k}".`);
      }
    }

    // ← Environment.pushMacroContext: a macro body sees only its own scope (plus
    // the namespace / data model), never the caller's loop/macro scopes.
    const callerScopes = env._scopes.slice();
    env._scopes.length = 0;
    env._scopes.push(scope);
    env._macroCallStack.push({ callerScopes, bodyChildren, bodyParamNames });
    try {
      // ← Macro.java:274-288: default values are evaluated once the earlier
      // parameters are already set in the macro scope.
      for (const p of def.params) {
        if (!used.has(p.name)) {
          if (p.defaultExp !== null) scope.set(p.name, p.defaultExp.evaluate(env));
          else {
            throw new InvalidReferenceException(
              `The macro/function "${def.name}" is missing the required argument "${p.name}".`);
          }
        }
      }
      if (def.argsNeeded) {
        const m = new Map();
        for (const p of def.params) {
          const v = scope.get(p.name);
          if (v !== undefined) m.set(p.name, v);
        }
        for (const [k, v] of extras) m.set(k, v);
        scope.set('__args__', new HashModel(m));
      }
      for (const c of def.children) env.visit(c);
    } catch (e) {
      if (e instanceof ReturnInstructionException) {
        return def.isFunction ? e.value : null;
      }
      throw e;
    } finally {
      env._macroCallStack.pop();
      env._scopes.length = 0;
      env._scopes.push(...callerScopes);
    }
    return null;
  }
}

// ← getFirstLeaf/getLastLeaf stop at Macro (treated as leaf for whitespace scans)
Macro.prototype._whitespaceScanLeaf = true;
