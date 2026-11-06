// ← IfBlock / ConditionalBlock.

import { TemplateElement } from '../templateElement.js';

export class ConditionalBlock extends TemplateElement {
  // type: if | else-if | else (condition null ← else)
  constructor(condition, children, type) {
    super();
    this.condition = condition;
    this.type = type;
    if (children) for (const c of children) this.addChild(c);
  }
  getCanonicalForm() {
    const head = this.condition
      ? `<#${this.type} ${this.condition.getCanonicalForm()}>`
      : '<#else>';
    return head + this.children.map((c) => c.getCanonicalForm()).join('');
  }
}

export class IfBlock extends TemplateElement {
  constructor(blocks) {
    super();
    this.blocks = blocks;
    for (const b of blocks) this.addChild(b);
  }

  execute(env) {
    for (const b of this.blocks) {
      if (b.condition === null || env.toBoolean(b.condition.evaluate(env), ' of #if/#elseif')) {
        for (const c of b.children) env.visit(c);
        return null;
      }
    }
    return null;
  }

  getCanonicalForm() {
    return this.blocks.map((b) => b.getCanonicalForm()).join('') + '</#if>';
  }
}
