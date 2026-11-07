// #escape / #noescape <- FTL.jj EscapeDirective() / NoEscapeBlock() and the
// EscapeDirectiveElement AST nodes (2.3.36). Escaping is applied at parse time
// by wrapping matching simple-identifier interpolations with EscapeChain.
// Escaping is applied at parse time to every interpolation lexically inside
// the body (not #noescape subtrees, nor macro/function bodies), binding the
// interpolated value to the placeholder; matching the 2.3.36 runtime model.

import { Expression } from '../expressions/expression.js';
import { TemplateElement } from '../templateElement.js';
import { backslashEscapeIdentifier } from '../../../utility/stringUtil.js';
import { InvalidReferenceException } from '../../../errors.js';
import { MarkupModel, StringModel } from '../../../model/models.js';

/**
 * The escape-variable placeholder inside the "as" expression.
 * <- EscapeDirectiveElement's identity match on the target name.
 */
export class EscapeVar extends Expression {
  /** @param {string} name */
  constructor(name) {
    super();
    this.name = name;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return backslashEscapeIdentifier(this.name);
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  * evaluate(env) {
    if (!env._escapeValueStack.length) {
      throw new InvalidReferenceException(
        `The #escape variable ${JSON.stringify(this.name)} has no value here.`);
    }
    return env._escapeValueStack[env._escapeValueStack.length - 1];
  }
}

/**
 * <- DollarVariable escape chains: the interpolated value (coerced to
 * string/markup, as the output would coerce it) is bound to the escape
 * placeholder and passed through the "as" expression. Nested escapes chain
 * inner-first.
 */
export class EscapeChain extends Expression {
  /**
   * @param {string} name - placeholder name
   * @param {Expression} expr - the "as" expression (contains EscapeVar)
   * @param {Expression} inner - the wrapped interpolation expression
   */
  constructor(name, expr, inner) {
    super();
    this.name = name;
    this.expr = expr;
    this.inner = inner;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.inner.getCanonicalForm();
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  * evaluate(env) {
    let v = yield* this.inner.evaluate(env);
    if (v !== null && v !== undefined && !(v instanceof MarkupModel)) {
      v = new StringModel(yield* env.coerceToString(v, ' auto-escaped'));
    }
    env._escapeValueStack.push(v === null ? null : v === undefined ? null : v);
    try {
      return yield* this.expr.evaluate(env);
    } finally {
      env._escapeValueStack.pop();
    }
  }
}

/** <#escape x as expr> ... </#escape> <- EscapeDirectiveElement. */
export class EscapeDirective extends TemplateElement {
  /** @param {string} name @param {Expression} expr @param {TemplateElement[]} children */
  constructor(name, expr, children) {
    super();
    this.name = name;
    this.expr = expr;
    if (children) for (const c of children) this.addChild(c);
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    for (const c of this.children) yield* env.visit(c);
    return null;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `<#escape ${backslashEscapeIdentifier(this.name)} as ${this.expr.getCanonicalForm()}>`
      + this.children.map((c) => c.getCanonicalForm()).join('')
      + '</#escape>';
  }
}

/** <#noescape> ... </#noescape> <- NoEscapeBlock. */
export class NoEscapeBlock extends TemplateElement {
  /** @param {TemplateElement[]} children */
  constructor(children) {
    super();
    if (children) for (const c of children) this.addChild(c);
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    for (const c of this.children) yield* env.visit(c);
    return null;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `<#noescape>${this.children.map((c) => c.getCanonicalForm()).join('')}</#noescape>`;
  }
}
