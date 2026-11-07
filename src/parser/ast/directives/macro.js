// <- Macro / MacroModel (#macro, #function). <- freemarker.core.Macro

import { TemplateElement } from '../templateElement.js';
import { HashModel, SequenceModel } from '../../../model/models.js';
import { TemplateModel } from '../../../model/templateModel.js';
import { InvalidReferenceException, ReturnInstructionException } from '../../../errors.js';

/** #macro / #function <- Macro. */
export class Macro extends TemplateElement {
  // params: [{ name, defaultExp|null }]; catchAllName: string|null
  /**
   * @param {string} name
   * @param {Array<{ name: string, defaultExp: import('../expressions/expression.js').Expression|null }>} params
   * @param {string|null} catchAllName
   * @param {boolean} isFunction
   * @param {TemplateElement[]} bodyChildren
   */
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
  * execute(env) {
    // Registration happens at parse time (<- Parser.Macro(): template.addMacro); at
    // render start the Environment seeds them into the namespace.
    return null;
  }

  // <- Macro.dump: macros list space-separated params without parens;
  // functions use parens and commas.
  /** @returns {string} */
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

/** A #macro as a callable value <- MacroModel. */
export class MacroModel extends TemplateModel {
  /** @param {Macro} macroDef */
  constructor(macroDef) {
    super();
    this.macroDef = macroDef;
    this.isMacroLike = !macroDef.isFunction;
    this.isFunctionModel = macroDef.isFunction;
    this.defTemplate = null; // set when the model is seeded into a namespace
    this.defNsTemplate = null; // template owning the namespace the model was seeded into
  }

  // <- Environment.invokeMacroOrFunctionCommonPart + Macro.accept
  * invoke(env, { positionalArgs = [], namedArgs = new Map(), bodyChildren = null,
    bodyParamNames = null }) {
    const def = this.macroDef;
    const scope = new Map();
    scope.isMacroScope = true;

    const declared = new Map(def.params.map((p) => [p.name, p]));
    const used = new Set();
    const extras = [];
    const kind = def.isFunction ? 'Function' : 'Macro';
    // <- parameter-count check runs before the unknown-name check (JVM-pinned
    // order; Drv75/76). The catch-all relaxes both.
    if (def.catchAllName === null) {
      const given = positionalArgs.length + namedArgs.size;
      if (given > def.params.length) {
        throw new InvalidReferenceException(
          `${kind} "${def.name}" only accepts ${def.params.length} parameters, but got ${given}.`);
      }
      for (const [k, v] of namedArgs) {
        if (v !== null && !declared.has(k)) {
          throw new InvalidReferenceException(
            `${kind} "${def.name}" has no parameter with name "${k}". `
            + `Valid parameter names are: ${def.params.map((p) => p.name).join(', ')}`);
        }
      }
    } else if (!def.isFunction && def.argsNeeded
      && positionalArgs.length > def.params.length) {
      throw new InvalidReferenceException(
        'The macro can only by called with named arguments, because it uses both '
        + '.args and a non-empty catch-all parameter.');
    }
    // <- a null call argument counts as "not given" (the default fills in).
    for (let i = 0; i < positionalArgs.length; i++) {
      if (positionalArgs[i] === null) continue;
      const p = def.params[i];
      if (p === undefined) {
        // overflow; the count/name checks above already rejected the illegal
        // shapes - what remains goes to the catch-all ".args" (functions) or is
        // silently ignored (macros without ".args").
        if (def.isFunction) extras.push([null, positionalArgs[i]]);
        continue;
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
      if (v === null) continue;
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
      }
    }

    // <- Environment.pushMacroContext: a macro body sees only its own scope (plus
    // the namespace / data model), never the caller's loop/macro scopes.
    const callerScopes = env._scopes.slice();
    env._scopes.length = 0;
    // <- the defining template's namespace stays visible to the macro body
    // (macros defined in an imported lib see their own lib's namespace).
    if (this.defTemplate !== null && this.defTemplate !== undefined) {
      const libNs = env.loadedLibs.get(this.defTemplate.name ?? '');
      if (libNs !== undefined && libNs.isMap && libNs.source !== env._nsScope) {
        env._scopes.push(libNs.source);
      }
    }
    env._scopes.push(scope);
    env._macroCallStack.push({ callerScopes, bodyChildren, bodyParamNames });
    // <- Environment.pushMacroContext: call-site template = the template of the
    // executing code (its def template when inside another macro body).
    const prevMacroCtx = env._macroCtx;
    env._macroCtx = {
      callTemplate: env._macroCtx !== null ? env._macroCtx.codeTemplate : (env.template ?? null),
      codeTemplate: this.defTemplate ?? null,
      // <- Environment.pushMacroContext: currentNamespace = the macro's namespace;
      // its template drives the legacy parent for #nested content.
      nsTemplate: this.defNsTemplate ?? this.defTemplate ?? null,
      // <- Macro.Context.nestedContentNamespace = currentNamespace at call time
      callSiteNsTemplate: env._macroCtx !== null ? env._macroCtx.nsTemplate
        : (env._nsTemplate ?? null),
      prev: prevMacroCtx,
    };
    try {
      // <- Macro.java MultiPassDefaultsInvoker: defaults may reference each
      // other; they are re-tried in repeated passes until no progress is made
      // (a stall throws the first failure, e.g. for cyclic defaults).
      let firstFail = null;
      let progress = true;
      while (progress) {
        progress = false;
        for (const p of def.params) {
          if (used.has(p.name) || p.defaultExp === null) continue;
          try {
            scope.set(p.name, yield* p.defaultExp.evaluate(env));
            used.add(p.name);
            progress = true;
          } catch (e) {
            scope.delete(p.name);
            if (firstFail === null) firstFail = e;
          }
        }
      }
      for (const p of def.params) {
        if (!used.has(p.name)) {
          if (p.defaultExp === null) {
            throw new InvalidReferenceException(
              `The macro/function "${def.name}" is missing the required argument "${p.name}".`);
          }
          throw firstFail ?? new InvalidReferenceException(
            `The macro/function "${def.name}" is missing the required argument "${p.name}".`);
        }
      }
      if (def.argsNeeded) {
        if (def.isFunction) {
          // <- .args in a function is a plain sequence of the values, in the
          // declared-parameter order, with the overflow/extras appended.
          const vals = [];
          for (const p of def.params) {
            const v = scope.get(p.name);
            if (v !== undefined) vals.push(v);
          }
          for (const [, v] of extras) vals.push(v);
          scope.set('__args__', new SequenceModel(vals));
        } else {
          const m = new Map();
          for (const p of def.params) {
            const v = scope.get(p.name);
            if (v !== undefined) m.set(p.name, v);
          }
          for (const [k, v] of extras) if (k !== null) m.set(k, v);
          scope.set('__args__', new HashModel(m));
        }
      }
      for (const c of def.children) yield* env.visit(c);
    } catch (e) {
      if (e instanceof ReturnInstructionException) {
        return def.isFunction ? e.value : null;
      }
      throw e;
    } finally {
      env._macroCallStack.pop();
      env._macroCtx = prevMacroCtx;
      env._scopes.length = 0;
      env._scopes.push(...callerScopes);
    }
    return null;
  }
}

// <- getFirstLeaf/getLastLeaf stop at Macro (treated as leaf for whitespace scans)
Macro.prototype._whitespaceScanLeaf = true;
