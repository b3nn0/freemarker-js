// Variable reference nodes <- Identifier, Dot, DynamicKeyName (<- freemarker.core.VariableExpression).

import { Expression } from './expression.js';
import { backslashEscapeIdentifier } from '../../../utility/stringUtil.js';
import {
  UnassignedVariableException, InvalidPropertyException, NonHashException, InvalidReferenceException,
} from '../../../errors.js';
import { TemplateHashModel, TemplateSequenceModel } from '../../../model/templateModel.js';
import { HashModel } from '../../../model/models.js';
import { unwrap } from '../../../model/unwrap.js';
import { zeroArgFunctionIsProperty } from '../../../model/policy.js';

// ZeroArgumentPolicy application for a hash-value read (Dot / DynamicKeyName shared).
// argExprs=null -> bare read (0-arg pre-call); array -> parenthesized call gets the args.
/**
 * @param {import('../../../environment.js').Environment} env
 * @param {Object} t - the hash model holding the value
 * @param {string} label - key for error/trace wording
 * @param {Object|null} v - the read model value
 * @param {Expression[]|null} argExprs - call args, or null for a bare read
 * @returns {Generator<unknown, [Object|null, boolean], unknown>} [model, autoInvoked]
 */
function* applyZeroArgPolicy(env, t, label, v, argExprs) {
  if (v !== null && v !== undefined && t instanceof HashModel
      && zeroArgFunctionIsProperty(env.configuration, v.fn)) {
    if (argExprs === null) {
      return [env.wrap(yield* awaitOp(`read-only call "${label}"`, v.fn())), true];
    }
    const raw = [];
    for (const a of argExprs) raw.push(unwrap(yield* a.evaluate(env)));
    return [env.wrap(yield* awaitOp(`method call "${label}"`, v.fn(...raw))), true];
  }
  return [v, false];
}
import { awaitOp, callOp } from '../../../async.js';

/** Bare name <- Identifier. */
export class Identifier extends Expression {
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
    const v = yield* env.getVariable(this.name);
    if (v === null || v === undefined) {
      const e = new UnassignedVariableException(
        `The variable ${JSON.stringify(this.name)} is not in the data model.`);
      // <- upstream carries the blamed expression's position on the exception
      e.templateName = this.templateName;
      e.beginLine = this.beginLine;
      e.beginColumn = this.beginColumn;
      throw e;
    }
    return v;
  }
}

/** x.y <- Dot. */
export class Dot extends Expression {
  /** @param {Expression} target @param {Expression|null} key */
  constructor(target, key) {
    super();
    this.target = target;
    this.key = key;
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `${this.target.getCanonicalForm()}.${backslashEscapeIdentifier(this.key)}`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  * evaluate(env) {
    const t = yield* this.target.evaluate(env);
    if (t === null || t === undefined) {
      throw new InvalidPropertyException(
        `Can't read the ${JSON.stringify(this.key)} key: the parent expression `
        + `${this.target.getCanonicalForm()} evaluated to null or missing.`);
    }
    if (!(t instanceof TemplateHashModel)) {
      throw new NonHashException(
        `Can't read the ${JSON.stringify(this.key)} key: ${this.target.getCanonicalForm()} `
        + `is not a hash (it is a ${env.typeLabel(t)}).`);
    }
    const v = yield* callOp(`get "${this.key}"`, t, 'get', this.key);
    if (v === null || v === undefined) {
      throw new InvalidPropertyException(
        `The ${JSON.stringify(this.key)} key of ${this.target.getCanonicalForm()} `
        + 'has not been found (it is missing).');
    }
    // ZeroArgumentPolicy: property-like read of a 0-arg function <- get()/getBeforeMethodCall.
    const [m] = yield* applyZeroArgPolicy(env, t, this.key, v, null);
    return m;
  }

  // <- the parse-time BeforeMethodCall trick: a directly enclosing MethodCall routes through here.
  // Returns [model, preCalled]; preCalled=true when the policy already produced the value.
  /** @param {import('../../../environment.js').Environment} env @param {Expression[]|null} argExprs @returns {import('../../../model/templateModel.js').TemplateModel} */
  * _evaluateForMethodCall(env, argExprs) {
    const t = yield* this.target.evaluate(env);
    if (t === null || t === undefined) {
      throw new InvalidPropertyException(
        `Can't read the ${JSON.stringify(this.key)} key: the parent expression `
        + `${this.target.getCanonicalForm()} evaluated to null or missing.`);
    }
    if (!(t instanceof TemplateHashModel)) {
      throw new NonHashException(
        `Can't read the ${JSON.stringify(this.key)} key: ${this.target.getCanonicalForm()} `
        + `is not a hash (it is a ${env.typeLabel(t)}).`);
    }
    const v = yield* callOp(`get "${this.key}"`, t, 'get', this.key);
    if (v === null || v === undefined) {
      throw new InvalidPropertyException(
        `The ${JSON.stringify(this.key)} key of ${this.target.getCanonicalForm()} `
        + 'has not been found (it is missing).');
    }
    return yield* applyZeroArgPolicy(env, t, this.key, v, argExprs);
  }
}

// <- freemarker.core.DynamicKeyName: target[key] or target[...]
/** x[h] <- DynamicKeyName. */
export class DynamicKeyName extends Expression {
  /** @param {Expression} target @param {Expression|null} key */
  constructor(target, key) {
    super();
    this.target = target;
    this.key = key; // null <- empty [] (only legal before !/??)
  }
  /**
   * @returns {string} the upstream-style canonical template source of this node
   */
  getCanonicalForm() {
    return `${this.target.getCanonicalForm()}[${this.key === null ? '' : this.key.getCanonicalForm()}]`;
  }
  /**
   * @param {import('../../../environment.js').Environment} env - rendering environment
   * @returns {import('../../../model/templateModel.js').TemplateModel|null}
   */
  * evaluate(env) {
    const t = yield* this.target.evaluate(env);
    const empty = () => new InvalidPropertyException(
      `The dynamic key expression of ${this.getCanonicalForm()} evaluated to null or missing `
      + '(use the ! or ?? operator to define a default).');
    if (t === null || t === undefined) throw empty();
    if (this.key === null) throw empty();
    let k;
    try {
      k = yield* this.key.evaluate(env);
    } catch (e) {
      if (e instanceof InvalidReferenceException) throw empty();
      throw e;
    }
    if (k === null || k === undefined) throw empty();
    if (t instanceof TemplateSequenceModel) {
      const n = yield* env.toNumber(k, ' used as an index into a sequence');
      return yield* callOp('sequence index', t, 'getByIndex', Math.trunc(n));
    }
    if (t instanceof TemplateHashModel) {
      const s = yield* env.coerceToString(k, ' used as a hash key');
      const v = yield* callOp(`get "${s}"`, t, 'get', s);
      const [m] = yield* applyZeroArgPolicy(env, t, s, v, null);
      return m;
    }
    throw new NonHashException(
      `Can't read: ${this.target.getCanonicalForm()} is a ${env.typeLabel(t)}, `
      + 'not a hash or sequence.');
  }

  /** @param {import('../../../environment.js').Environment} env @param {Expression[]|null} argExprs @returns {import('../../../model/templateModel.js').TemplateModel} */
  * _evaluateForMethodCall(env, argExprs) {
    const t = yield* this.target.evaluate(env);
    if (t === null || t === undefined) throw new InvalidPropertyException(
      `The dynamic key expression of ${this.getCanonicalForm()} evaluated to null or missing `
      + '(use the ! or ?? operator to define a default).');
    if (this.key === null) throw new InvalidPropertyException(
      `The dynamic key expression of ${this.getCanonicalForm()} evaluated to null or missing `
      + '(use the ! or ?? operator to define a default).');
    const k = yield* this.key.evaluate(env);
    if (t instanceof TemplateHashModel && k !== null && k !== undefined) {
      const s = yield* env.coerceToString(k, ' used as a hash key');
      const v = yield* callOp(`get "${s}"`, t, 'get', s);
      if (v !== null && v !== undefined) {
        const [m, auto] = yield* applyZeroArgPolicy(env, t, s, v, argExprs);
        return [m, auto];
      }
    }
    // non-hash target / missing value: full read path (throws the DKNN wording)
    return [yield* this.evaluate(env), false];
  }
}
