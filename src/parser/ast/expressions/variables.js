// Variable reference nodes <- Identifier, Dot, DynamicKeyName (<- freemarker.core.VariableExpression).

import { Expression } from './expression.js';
import { backslashEscapeIdentifier } from '../../../utility/stringUtil.js';
import {
  UnassignedVariableException, InvalidPropertyException, NonHashException, InvalidReferenceException,
  NonNumericalException, TemplateException,
} from '../../../errors.js';
import { TemplateHashModel, TemplateSequenceModel } from '../../../model/templateModel.js';
import { HashModel, RangeModel, SequenceModel, StringModel, NumberModel } from '../../../model/models.js';
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

// <- Blame.addBlameText / MessageUtil error wording (2.3.36).
export const GENERAL_MISSING_TIP = 'Tip: If the failing expression is known to legally refer to '
  + 'something that\'s sometimes null or missing, either specify a default value like '
  + 'myOptionalVar!myDefault, or use <#if myOptionalVar??>when-present<#else>when-missing</#if>. '
  + '(These only cover the last step of the expression; to cover the whole expression, '
  + 'use parenthesis: (myOptionalVar.foo)!myDefault, (myOptionalVar.foo)??';
const LAST_DOT_TIP = 'Tip: It\'s the step after the last dot that caused this error, '
  + 'not those before it.';
const FINAL_INDEX_TIP = 'Tip: It\'s the final [] step that caused this error, '
  + 'not those before it.';

/**
 * @param {Expression} node - blamed node (carries location)
 * @param {string} canonical - blamed expression canonical form
 * @param {string[]} tips
 * @returns {string}
 */
export function blameText(node, canonical, tips = []) {
  let m = `The following has evaluated to null or missing:\n==> ${canonical}`;
  if (node.beginLine >= 0) {
    m += `  [in template "${node.templateName ?? 'Template'}" `
      + `at line ${node.beginLine}, column ${node.beginColumn}]`;
  }
  for (const tip of tips) m += `\n\n----\n${tip}\n----`;
  return m;
}

/**
 * <- Blame for wrong-type operands: For "x" left-hand operand: Expected ...
 * @param {string} what - e.g. `"." left-hand operand`
 * @param {string} expected
 * @param {string} foundDesc - e.g. `a string`
 * @param {Expression} node
 * @param {string[]} tips
 * @returns {string}
 */
export function typeBlameText(what, expected, foundDesc, node, tips = []) {
  let m = `For ${what}: Expected ${expected}, but this has evaluated to ${foundDesc}:`;
  if (node && node.beginLine >= 0) {
    m += `\n==> ${node.getCanonicalForm()}  [in template "${node.templateName ?? 'Template'}" `
      + `at line ${node.beginLine}, column ${node.beginColumn}]`;
  }
  for (const tip of tips) m += `\n\n----\n${tip}\n----`;
  return m;
}

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
      const e = new UnassignedVariableException(blameText(this, this.getCanonicalForm(), [GENERAL_MISSING_TIP]));
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
      throw new InvalidPropertyException(blameText(this, this.getCanonicalForm(), [GENERAL_MISSING_TIP]));
    }
    if (!(t instanceof TemplateHashModel)) {
      throw new NonHashException(
        typeBlameText('"." left-hand operand', 'a hash', `a ${env.typeLabel(t)}`, this.target));
    }
    const v = yield* callOp(`get "${this.key}"`, t, 'get', this.key);
    if (v === null || v === undefined) {
      throw new InvalidPropertyException(
        blameText(this, this.getCanonicalForm(), [LAST_DOT_TIP, GENERAL_MISSING_TIP]));
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
      throw new InvalidPropertyException(blameText(this, this.getCanonicalForm(), [GENERAL_MISSING_TIP]));
    }
    if (!(t instanceof TemplateHashModel)) {
      throw new NonHashException(
        typeBlameText('"." left-hand operand', 'a hash', `a ${env.typeLabel(t)}`, this.target));
    }
    const v = yield* callOp(`get "${this.key}"`, t, 'get', this.key);
    if (v === null || v === undefined) {
      throw new InvalidPropertyException(
        blameText(this, this.getCanonicalForm(), [LAST_DOT_TIP, GENERAL_MISSING_TIP]));
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
    const keyMissingBlame = () => this.key === null
      ? new InvalidPropertyException(
        blameText(this, this.getCanonicalForm(), ['Tip: Use the ! or ?? operator to define a default.']))
      : new InvalidReferenceException(blameText(this.key, this.key.getCanonicalForm(), [GENERAL_MISSING_TIP]));
    if (t === null || t === undefined) {
      throw new InvalidPropertyException(blameText(this, this.getCanonicalForm(), [GENERAL_MISSING_TIP]));
    }
    if (this.key === null) throw keyMissingBlame();
    let k;
    try {
      k = yield* this.key.evaluate(env);
    } catch (e) {
      if (e instanceof InvalidReferenceException) throw keyMissingBlame();
      throw e;
    }
    if (k === null || k === undefined) throw keyMissingBlame();
    if (t instanceof TemplateSequenceModel) {
      if (k instanceof RangeModel) {
        // <- upstream: numeric Range key over a sequence = the sliced sublist
        if (k.sizeValue === null) {
          throw new TemplateException('An unbounded range can\'t be used as an index key.');
        }
        const out = [];
        for (let i = 0; i < k.sizeValue; i++) {
          out.push(yield* callOp('sequence index', t, 'getByIndex', k.from + i));
        }
        return new SequenceModel(out);
      }
      const n = yield* env.toNumber(k, ' used as an index into a sequence');
      const v = yield* callOp('sequence index', t, 'getByIndex', Math.trunc(n));
      if (v === null || v === undefined) {
        throw new InvalidPropertyException(
          blameText(this, this.getCanonicalForm(), [FINAL_INDEX_TIP, GENERAL_MISSING_TIP]));
      }
      return v;
    }
    if (t instanceof TemplateHashModel) {
      const s = yield* env.coerceToString(k, ' used as a hash key');
      const v = yield* callOp(`get "${s}"`, t, 'get', s);
      if (v === null || v === undefined) {
        throw new InvalidPropertyException(
          blameText(this, this.getCanonicalForm(), [GENERAL_MISSING_TIP]));
      }
      const [m] = yield* applyZeroArgPolicy(env, t, s, v, null);
      return m;
    }
    if (t instanceof StringModel || t instanceof NumberModel) {
      // <- upstream DynamicKeyName: string-coercible targets fall back to
      // per-character indexing (and substring lists for range keys)
      let s;
      if (t instanceof NumberModel) {
        s = String(t.getAsNumber()); // plain-text coercion of a number
      } else {
        s = yield* callOp('getAsString', t, 'getAsString');
      }
      if (k instanceof RangeModel) {
        if (k.sizeValue === null) {
          throw new TemplateException('An unbounded range can\'t be used as an index key.');
        }
        return new SequenceModel(s.slice(k.from, k.from + k.sizeValue).split('')
          .map((ch) => new StringModel(ch)));
      }
      const n = Math.trunc(yield* env.toNumber(k, ' used as an index into a string'));
      if (n < 0) {
        throw new NonNumericalException(`Negative index not allowed: ${n}`);
      }
      if (n >= s.length) {
        throw new NonNumericalException(
          `String index out of range: The index was ${n} (0-based), but the length of the `
          + `string is only ${s.length}.`);
      }
      return new StringModel(s[n]);
    }
    throw new NonHashException(
      typeBlameText('"...[...]" left-hand operand', 'a hash or sequence', `a ${env.typeLabel(t)}`, this.target));
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
