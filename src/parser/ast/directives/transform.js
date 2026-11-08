// <- freemarker.core.Transform (#transform directive) and the UnifiedCall
// fallback to a transform model (<@someTransform> body semantics: the nested
// content goes to the Writer returned by getWriter).

import { TemplateElement } from '../templateElement.js';
import { TemplateException } from '../../../errors.js';
import {
  BreakInstructionException, ContinueInstructionException, ReturnInstructionException,
} from '../../../errors.js';

/**
 * Runs the nested content through a transform's output sink. The sink is closed
 * after the body finishes normally or when a loop-control signal passes through,
 * but NOT when an error aborts it (JVM rule: don't corrupt the output on
 * failure). A null sink with no nested content just skips the body.
 * @param {import('../../../environment.js').Environment} env
 * @param {import('../../../model/templateModel.js').TemplateModel|null} model
 * @param {string} calleeText - canonical form for error blaming
 * @param {Map<string, unknown>} args - evaluated named parameters
 * @param {TemplateElement[]} children
 * @returns {Generator<unknown, null, unknown>}
 */
export function* runTransform(env, model, calleeText, args, children) {
  if (model === null || model === undefined || typeof model.getWriter !== 'function') {
    throw new TemplateException(
      `For the transform call "${calleeText}": Expected a transform, but this has `
      + `evaluated to ${env.typeLabel(model)}.`);
  }
  let w;
  try {
    w = model.getWriter(env.output, args);
  } catch (e) {
    if (e instanceof TemplateException) throw e;
    throw new TemplateException(
      `The transform "${calleeText}" failed in getWriter(): ${e.message}`);
  }
  if (w === null || w === undefined) {
    if (children.length > 0) {
      throw new TemplateException(
        `This transform ("${calleeText}") does not allow nested content.`);
    }
    return null;
  }
  const outer = env.output;
  env.output = w;
  try {
    for (const c of children) yield* c.execute(env);
    if (typeof w.close === 'function') w.close();
  } catch (e) {
    if (e instanceof BreakInstructionException || e instanceof ContinueInstructionException
      || e instanceof ReturnInstructionException) {
      if (typeof w.close === 'function') w.close();
    }
    throw e;
  } finally {
    env.output = outer;
  }
  return null;
}

/** #transform targetExp params>...body...</#transform> <- Transform. */
export class TransformElement extends TemplateElement {
  /**
   * @param {import('../expressions/expression.js').Expression} targetExp
   * @param {Map<string, import('../expressions/expression.js').Expression>|null} namedArgs
   * @param {TemplateElement[]} children
   */
  constructor(targetExp, namedArgs, children) {
    super();
    this.targetExp = targetExp;
    this.namedArgs = namedArgs;
    this.children = children;
  }
  /**
   * @param {import('../../../environment.js').Environment} env
   * @returns {null}
   */
  * execute(env) {
    const model = yield* this.targetExp.evaluate(env);
    const args = new Map();
    if (this.namedArgs !== null) {
      for (const [k, exp] of this.namedArgs) args.set(k, yield* exp.evaluate(env));
    }
    yield* runTransform(env, model, this.targetExp.getCanonicalForm(), args, this.children);
    return null;
  }
  /** @returns {string} the upstream-style canonical template source of this node */
  getCanonicalForm() {
    const args = this.namedArgs === null || this.namedArgs.size === 0 ? ''
      : ' ' + [...this.namedArgs.keys()].sort()
        .map((k) => `${k}=${this.namedArgs.get(k).getCanonicalForm()}`).join(' ');
    if (this.children.length === 0) {
      return `<#transform ${this.targetExp.getCanonicalForm()}${args}/>`;
    }
    return `<#transform ${this.targetExp.getCanonicalForm()}${args}>`
      + this.children.map((c) => c.getCanonicalForm()).join('')
      + '</#transform>';
  }
}
