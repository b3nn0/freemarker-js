// <- IteratorBlock (#list / #forEach), ListElseContainer merged into IteratorBlock, Items, Sep.

import { TemplateElement } from '../templateElement.js';
import {
  InvalidReferenceException, NonSequenceOrCollectionException,
  BreakInstructionException, ContinueInstructionException,
} from '../../../errors.js';
import { TemplateSequenceModel, TemplateHashModelEx } from '../../../model/templateModel.js';
import { awaitOp, callOp } from '../../../async.js';

/** #list / #forEach <- IteratorBlock. */
export class IteratorBlock extends TemplateElement {
  // sourceExp, loopVar, loopVar2, hashListing, forEach; children before #else; elseChildren|null
  /**
   * @param {import('../expressions/expression.js').Expression} sourceExp
   * @param {string|null} loopVar
   * @param {string|null} loopVar2
   * @param {TemplateElement[]} children
   * @param {boolean} hashListing
   * @param {boolean} forEach
   * @param {TemplateElement[]|null} elseChildren
   */
  constructor(sourceExp, loopVar, loopVar2, children, hashListing, forEach, elseChildren) {
    super();
    this.sourceExp = sourceExp;
    this.loopVar = loopVar;
    this.loopVar2 = loopVar2;
    this.hashListing = hashListing;
    this.forEach = forEach;
    this.elseChildren = elseChildren ?? null;
    if (children) for (const c of children) this.addChild(c);
  }

  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    const src = yield* this.sourceExp.evaluate(env);
    if (src === null || src === undefined) {
      throw new InvalidReferenceException(
        `The expression ${this.sourceExp.getCanonicalForm()} evaluated to null or missing `
        + '(can\'t be iterated).');
    }
    const tag = this.forEach ? '#forEach' : '#list';
    let length;
    let keys = null;
    if (src instanceof TemplateSequenceModel) {
      length = yield* awaitOp('size', src.size());
    } else if (this.hashListing && src instanceof TemplateHashModelEx) {
      keys = yield* awaitOp('keys', src.keys());
      length = keys.length;
    } else {
      throw new NonSequenceOrCollectionException(
        `Can't iterate with ${tag}: ${this.sourceExp.getCanonicalForm()} is a `
        + `${env.typeLabel(src)}${this.hashListing ? '' : ' (only sequences are iterable)'}.`);
    }

    if (length === 0 && this.elseChildren) {
      for (const c of this.elseChildren) yield* env.visit(c);
      return null;
    }

    for (let i = 0; i < length; i++) {
      // first = loopVar value (hash listing: the key), second = loopVar2 value (hash: the value)
      const item = keys !== null
        ? { first: env.wrap(keys[i]), second: yield* callOp(`get "${keys[i]}"`, src, 'get', keys[i]) }
        : { first: yield* callOp('sequence index', src, 'getByIndex', i), second: null };
      env.pushScope();
      if (this.loopVar !== null) {
        env.setVariable(this.loopVar, item.first);
        if (this.loopVar2 !== null) env.setVariable(this.loopVar2, item.second);
      } else {
        env._iterStack.push(item); // for a nested #items
      }
      let broke = false;
      try {
        for (const c of this.children) {
          if (c instanceof Sep) {
            if (i < length - 1) for (const sc of c.children) yield* env.visit(sc);
          } else {
            yield* env.visit(c);
          }
        }
      } catch (e) {
        if (e instanceof BreakInstructionException) broke = true;
        else if (!(e instanceof ContinueInstructionException)) throw e;
      } finally {
        if (this.loopVar === null) env._iterStack.pop();
        env.popScope();
      }
      if (broke) break;
    }
    return null;
  }

  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const head = this.forEach
      ? `<#forEach ${this.loopVar} in ${this.sourceExp.getCanonicalForm()}>`
      : `<#list ${this.sourceExp.getCanonicalForm()}`
        + `${this.loopVar !== null
          ? ` as ${this.loopVar}${this.loopVar2 !== null ? `, ${this.loopVar2}` : ''}` : ''}>`;
    const body = this.children.map((c) => c.getCanonicalForm()).join('');
    const elsePart = this.elseChildren
      ? `<#else>${this.elseChildren.map((c) => c.getCanonicalForm()).join('')}`
      : '';
    const end = this.forEach ? '</#forEach>' : '</#list>';
    return `${head}${body}${elsePart}${end}`;
  }
}

/** #items <- Items. */
export class Items extends TemplateElement {
  /** @param {string|null} loopVar @param {string|null} loopVar2 @param {TemplateElement[]} children */
  constructor(loopVar, loopVar2, children) {
    super();
    this.loopVar = loopVar;
    this.loopVar2 = loopVar2;
    if (children) for (const c of children) this.addChild(c);
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {null}
   */
  * execute(env) {
    const ctx = env._iterStack.length ? env._iterStack[env._iterStack.length - 1] : null;
    if (ctx === null) {
      throw new InvalidReferenceException('Unmatched #items (no enclosing #list iteration).');
    }
    env.pushScope();
    env.setVariable(this.loopVar, ctx.first);
    if (this.loopVar2 !== null) env.setVariable(this.loopVar2, ctx.second);
    try {
      for (const c of this.children) yield* env.visit(c);
    } finally {
      env.popScope();
    }
    return null;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    const head = `<#items as ${this.loopVar}${this.loopVar2 !== null ? `, ${this.loopVar2}` : ''}>`;
    return head + this.children.map((c) => c.getCanonicalForm()).join('') + '</#items>';
  }
}

/** #sep <- Sep. */
export class Sep extends TemplateElement {
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
    return `<#sep>${this.children.map((c) => c.getCanonicalForm()).join('')}</#sep>`;
  }
}
