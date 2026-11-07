// ← IfBlock / ConditionalBlock.

import { TemplateElement } from '../templateElement.js';

/** One #if/#elseif/#else branch ← ConditionalBlock. */
export class ConditionalBlock extends TemplateElement {
  // type: if | else-if | else (condition null ← else)
  /** @param {Expression|null} condition @param {TemplateElement[]} children @param {string} type */
  constructor(condition, children, type) {
    super();
    this.condition = condition;
    this.type = type;
    if (children) for (const c of children) this.addChild(c);
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const head = this.condition
      ? `<#${this.type} ${this.condition.getCanonicalForm()}>`
      : '<#else>';
    return head + this.children.map((c) => c.getCanonicalForm()).join('');
  }
}

/** #if...#else... ← IfBlock. */
export class IfBlock extends TemplateElement {
  /** @param {ConditionalBlock[]} blocks */
  constructor(blocks) {
    super();
    this.blocks = blocks;
    for (const b of blocks) this.addChild(b);
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    for (const b of this.blocks) {
      if (b.condition === null
        || (yield* env.toBoolean(yield* b.condition.evaluate(env), ' of #if/#elseif'))) {
        for (const c of b.children) yield* env.visit(c);
        return null;
      }
    }
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return this.blocks.map((b) => b.getCanonicalForm()).join('') + '</#if>';
  }
}
