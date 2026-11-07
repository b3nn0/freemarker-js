// <- freemarker.core.LibraryLoad (#import "x" as ns).

import { TemplateElement } from '../templateElement.js';
import { HashModel } from '../../../model/models.js';
import { StringWriter } from '../../../io/writer.js';

/**
 * `#import nameExp as nsVar` -- loads the template (per-Environment loadedLibs cache
 * + per-Configuration parse cache), runs its top level with output suppressed and a
 * fresh namespace, and exposes that namespace as a hash variable.
 */
export class ImportDirective extends TemplateElement {
  /**
   * @param {Object} nameExp - template-name expression
   * @param {string} nsVarName - the ID after "as"
   */
  constructor(nameExp, nsVarName) {
    super();
    this.nameExp = nameExp;
    this.nsVarName = nsVarName;
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    const rawName = yield* env.coerceToString(yield* this.nameExp.evaluate(env),
      ' used as the #import template name');
    const template = yield* env.loadIncludedTemplate(rawName);
    const key = template.name ?? rawName; // <- namespace key is the resolved name

    // <- Environment.importLib(): register before initializing (cycle-tolerant).
    let ns = env.loadedLibs.get(key);
    if (ns !== undefined) {
      env.assignVariable(this.nsVarName, ns, 'namespace');
      return null;
    }
    ns = new HashModel(new Map());
    env.loadedLibs.set(key, ns);
    env.assignVariable(this.nsVarName, ns, 'namespace');

    // <- initializeImportLibNamespace(): currentNamespace = new ns, out = NullWriter.
    for (const m of template.macros) {
      m.macroModel.defTemplate = template;
      ns.source.set(m.name, m.macroModel);
    }
    const prevOut = env.output;
    const prevNs = env._nsScope;
    env.output = new StringWriter();
    env._nsScope = ns.source;
    try {
      yield* env.visit(template.rootElement);
    } finally {
      env.output = prevOut;
      env._nsScope = prevNs;
    }
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `<#import ${this.nameExp.getCanonicalForm()} as ${this.nsVarName}/>`;
  }
}
