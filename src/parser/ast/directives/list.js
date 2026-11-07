// <- IteratorBlock (#list / #forEach), ListElseContainer merged into IteratorBlock, Items, Sep.

import { TemplateElement } from '../templateElement.js';
import {
  InvalidReferenceException, NonSequenceOrCollectionException, TemplateException,
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
    const label = env.typeLabel(src);
    const aOrAn = 'aeiou'.includes(label.charAt(0)) ? 'an' : 'a';
    if (src instanceof TemplateSequenceModel && !this.hashListing) {
      length = yield* awaitOp('size', src.size());
    } else if (this.hashListing && src instanceof TemplateHashModelEx) {
      keys = yield* awaitOp('keys', src.keys());
      length = keys.length;
    } else if (this.hashListing) {
      // <- IteratorBlock: two loop variables only for hashes
      throw new NonSequenceOrCollectionException(
        `The value you try to list is ${aOrAn} ${label}, thus you must specify only one loop `
        + 'variable after the "as" (there\'s no separate key and value).');
    } else if (src instanceof TemplateHashModelEx) {
      // <- IteratorBlock: a hash needs two loop variables
      throw new NonSequenceOrCollectionException(
        `The value you try to list is ${aOrAn} ${label}, thus you must specify two loop `
        + 'variables after the "as"; one for the key, and another for the value, like '
        + '<#... as k, v>).');
    } else {
      throw new NonSequenceOrCollectionException(
        `Can't iterate with ${tag}: ${this.sourceExp.getCanonicalForm()} is a `
        + `${label}${this.hashListing ? '' : ' (only sequences are iterable)'}.`);
    }

    if (length === 0) {
      if (this.elseChildren) for (const c of this.elseChildren) yield* env.visit(c);
      // Upstream visits the body only when the listed value is non-empty; in
      // items-form (no "as") the body runs ONCE for the whole listing and
      // #items does the looping. Break/continue from that body are NOT caught
      // here; they propagate to the enclosing loop.
      return null;
    }

    if (this.loopVar === null) {
      env.pushScope();
      const ctx = {
        first: null, second: null, index: 0, size: length,
        src, keys, itemsMode: true, alreadyEntered: false,
      };
      env._iterStack.push(ctx);
      try {
        for (const c of this.children) yield* env.visit(c);
      } finally {
        env._iterStack.pop();
        env.popScope();
      }
      return null;
    }

    for (let i = 0; i < length; i++) {
      // first = loopVar value (hash listing: the key), second = loopVar2 value (hash: the value)
      const item = keys !== null
        ? { first: env.wrap(keys[i]), second: yield* callOp(`get "${keys[i]}"`, src, 'get', keys[i]) }
        : { first: yield* callOp('sequence index', src, 'getByIndex', i), second: null };
      env.pushScope();
      // _iterStack drives both #items and the loop-variable built-ins (?counter,
      // ?index, ...); entries carry position info for those.
      item.index = i;
      item.size = length;
      env._iterStack.push(item);
      if (this.loopVar !== null) {
        const fb = env.configuration.getFallbackOnNullLoopVariable();
        if (!(fb && item.first === null)) env.setVariable(this.loopVar, item.first);
        if (this.loopVar2 !== null && !(fb && item.second === null)) {
          env.setVariable(this.loopVar2, item.second);
        }
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
        env._iterStack.pop();
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
    if (ctx === null || ctx.index === undefined) {
      throw new InvalidReferenceException('Unmatched #items (no enclosing #list iteration).');
    }
    if (ctx.alreadyEntered) {
      throw new TemplateException(
        'The #items directive was already entered earlier for this listing.');
    }
    ctx.alreadyEntered = true;
    const n = ctx.size;
    for (let i = 0; i < n; i++) {
      ctx.index = i;
      const first = ctx.keys !== null
        ? env.wrap(ctx.keys[i])
        : yield* callOp('sequence index', ctx.src, 'getByIndex', i);
      const second = ctx.keys !== null
        ? yield* callOp(`get "${ctx.keys[i]}"`, ctx.src, 'get', ctx.keys[i])
        : null;
      ctx.first = first;
      ctx.second = second;
      env.pushScope();
      const fb = env.configuration.getFallbackOnNullLoopVariable();
      if (!(fb && first === null)) env.setVariable(this.loopVar, first);
      if (this.loopVar2 !== null && !(fb && second === null)) env.setVariable(this.loopVar2, second);
      try {
        for (const c of this.children) {
          // <- #sep in an #items body shows only between items, like in #list.
          if (c instanceof Sep) {
            if (i < n - 1) for (const sc of c.children) yield* env.visit(sc);
          } else {
            yield* env.visit(c);
          }
        }
      } catch (e) {
        if (e instanceof BreakInstructionException) break;
        else if (!(e instanceof ContinueInstructionException)) throw e;
      } finally {
        env.popScope();
      }
    }
    ctx.index = n;
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
