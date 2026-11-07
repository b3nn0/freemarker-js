// <- freemarker.core.LibraryLoad (#import "x" as ns).

import { TemplateElement } from '../templateElement.js';
import { HashModel } from '../../../model/models.js';
import { StringWriter } from '../../../io/writer.js';
import { TemplateException } from '../../../errors.js';

/**
 * <- Template.getTemplateByName path normalization, used for namespace identity
 * (so '/./lib.ftl', './x/../lib.ftl' and 'lib.ftl' name one namespace).
 * @param {string} name @returns {string}
 */
export function normalizePath(name) {
  const segs = [];
  for (const seg of name.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (segs.length > 0) segs.pop();
      continue;
    }
    segs.push(seg);
  }
  return segs.join('/');
}

/**
 * <- Environment.LazilyInitializedNamespace: placeholder namespace model that
 * loads and initializes the library on first access (lazyImports).
 */
class LazyNamespaceModel extends HashModel {
  /** @param {ImportDirective} dir @param {import('../../../environment.js').Environment} env @param {string} rawName */
  constructor(dir, env, rawName) {
    super(new Map());
    this._dir = dir;
    this._env = env;
    this._rawName = rawName;
    this._real = null;
  }
  /** @param {import('../../../environment.js').Environment} env @returns {HashModel} */
  * _ensure(env) {
    if (this._real !== null) return this._real;
    try {
      this._real = yield* this._dir._initNamespace(env, this._rawName);
    } catch (e) {
      if (e instanceof TemplateException) {
        throw new TemplateException(
          `Lazy initialization of the namespace imported from "${this._rawName}" failed. `
          + `Cause: ${e.message}`);
      }
      throw e;
    }
    return this._real;
  }
  /** @param {string} k @returns {import('../../../model/templateModel.js').TemplateModel|null} */
  * get(k) {
    const r = yield* this._ensure(this._env);
    return yield* r.get(k);
  }
  /** @returns {string[]|Generator} keys <- awaitOp drives the generator form */
  keys() {
    if (this._real !== null) return this._real.keys();
    const self = this;
    return (function* () {
      const r = yield* self._ensure(self._env);
      return r.keys();
    })();
  }
  /** @returns {number|Generator} */
  size() {
    if (this._real !== null) return this._real.size();
    const self = this;
    return (function* () {
      const r = yield* self._ensure(self._env);
      return r.size();
    })();
  }
}

/**
 * `#import nameExp as nsVar` -- loads the template (per-Environment loadedLibs cache
 * + per-Configuration parse cache), runs its top level with output suppressed and a
 * fresh namespace, and exposes that namespace as a hash variable.
 */
export class ImportDirective extends TemplateElement {
  /**
   * @param {Object} nameExp - template-name expression
   * @param {string} nsVarName - the ID after "as"
   * @param {boolean} [isAuto] - auto-import (lazyAutoImports applies)
   */
  constructor(nameExp, nsVarName, isAuto = false) {
    super();
    this.nameExp = nameExp;
    this.nsVarName = nsVarName;
    this.isAuto = isAuto;
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    const rawName = yield* env.coerceToString(yield* this.nameExp.evaluate(env),
      ' used as the #import template name');
    if (this._isLazy(env)) {
      const holder = new LazyNamespaceModel(this, env, rawName);
      env.assignVariable(this.nsVarName, holder, 'namespace');
      this._assignGlobal(env, holder);
      return null;
    }
    const ns = yield* this._initNamespace(env, rawName);
    env.assignVariable(this.nsVarName, ns, 'namespace');
    this._assignGlobal(env, ns);
    return null;
  }

  /**
   * <- 2.3.24+: an import executed in the MAIN template's namespace also makes
   * the namespace variable a global; inside a library it stays in that library.
   * @param {import('../../../environment.js').Environment} env
   * @param {HashModel} ns
   */
  _assignGlobal(env, ns) {
    if (env._nsScope === env._mainNsScope) env.assignVariable(this.nsVarName, ns, 'global');
  }

  /** @param {import('../../../environment.js').Environment} env @returns {boolean} */
  _isLazy(env) {
    const cfg = env.configuration;
    return this.isAuto ? (cfg._lazyAutoImports ?? cfg._lazyImports) : cfg._lazyImports;
  }

  /**
   * Loads the library template and initializes its namespace (idempotent via
   * the per-Environment loadedLibs cache).
   * @param {import('../../../environment.js').Environment} env
   * @param {string} rawName @returns {HashModel} the namespace hash
   */
  * _initNamespace(env, rawName) {
    const template = yield* env.loadIncludedTemplate(rawName);
    const key = normalizePath(template.name ?? rawName); // <- namespace key is the resolved name

    // <- Environment.importLib(): register before initializing (cycle-tolerant).
    let ns = env.loadedLibs.get(key);
    if (ns !== undefined) return ns;
    ns = new HashModel(new Map());
    env.loadedLibs.set(key, ns);

    // <- initializeImportLibNamespace(): currentNamespace = new ns, out = NullWriter.
    for (const m of template.macros) {
      m.macroModel.defTemplate = template;
      m.macroModel.defNsTemplate = template;
      ns.source.set(m.name, m.macroModel);
    }
    const prevOut = env.output;
    const prevNs = env._nsScope;
    const prevLegacy = env._legacyTemplate;
    const prevNsTemplate = env._nsTemplate;
    env.output = new StringWriter();
    env._nsScope = ns.source;
    env._legacyTemplate = template.name ?? null;
    env._nsTemplate = template;
    try {
      yield* env.visit(template.rootElement);
    } finally {
      env.output = prevOut;
      env._nsScope = prevNs;
      env._legacyTemplate = prevLegacy;
      env._nsTemplate = prevNsTemplate;
    }
    return ns;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `<#import ${this.nameExp.getCanonicalForm()} as ${this.nsVarName}/>`;
  }
}
