// Sequence built-ins: ?sort, ?sort_by, ?filter, ?map.
// <- freemarker.core.BuiltInsForSequences (sortBI 601, sort_byBI 548, filterBI 1051, mapBI 1207)

import { registerBuiltIn } from './registry.js';
import { BuiltinArgMethod, sequenceItems, nonSequenceError } from './common.js';
import {
  SequenceModel, StringModel, NumberModel, BooleanModel, DateModel, HashModel,
} from '../model/models.js';
import { TemplateMethodModel, TemplateHashModel, TemplateSequenceModel } from '../model/templateModel.js';
import { LocalLambdaExpression } from '../parser/ast/expressions/lambda.js';
import { InvalidReferenceException, TemplateException, NonMethodException } from '../errors.js';
import { unwrap } from '../model/unwrap.js';
import { awaitOp, callOp } from '../async.js';

/** @param {Object} key - a key model @returns {string[]|null} [singular, plural] labels; null = unsortable type */
function keyTypeName(key) {
  if (key instanceof StringModel) return ['string', 'strings'];
  if (key instanceof NumberModel) return ['number', 'numbers'];
  if (key instanceof DateModel) return ['date/time', 'date/times'];
  if (key instanceof BooleanModel) return ['boolean', 'booleans'];
  return null;
}

/**
 * <- BuiltInsForSequences.sortBI.sort: type detection from the 1st key, stable sort.
 * Deviation: string keys compare by code point (upstream uses the locale Collator).
 * @param {Object[]} items
 * @param {(item: Object, index: number, startError: Function) => Object|null} keyOf
 * @param {import('../environment.js').Environment} env
 * @param {string} biLabel - e.g. "?sort" / "?sort_by(...)"
 * @param {string} valueWord - singular noun for messages ("value" / "key value")
 * @param {string} valueWordPlural
 * @returns {import('../model/models.js').SequenceModel}
 */
function* sortItems(items, keyOf, env, biLabel, valueWord, valueWordPlural) {
  const n = items.length;
  if (n === 0) return new SequenceModel([...items]);
  const startError = (i) => (i === 0
    ? `${biLabel} failed: `
    : `${biLabel} failed at sequence index ${i} (0-based): `);
  // Key collection may await (async keys); the comparison itself then works on
  // precomputed primitives so no yielding happens inside Array.prototype.sort.
  const pairs = [];
  let keyType = null;
  for (let i = 0; i < n; i++) {
    const key = yield* keyOf(items[i], i, startError);
    const t = key === null || key === undefined
      ? null : keyTypeName(key);
    if (keyType === null) {
      if (t === null) {
        throw new TemplateException(
          startError(i) + 'Values used for sorting must be numbers, strings, date/times or booleans.');
      }
      keyType = t;
    } else if (t === null || t[0] !== keyType[0]) {
      throw new TemplateException(
        startError(i) + `All ${valueWordPlural} in the sequence must be ${keyType[1]}, `
        + `because the first ${valueWord} was that. However, the ${valueWord} of the current item `
        + `isn't a ${keyType[0]} but a ${env.typeLabel(key)}.`);
    }
    let cmpKey;
    if (keyType[0] === 'number') cmpKey = yield* callOp('getAsNumber', key, 'getAsNumber');
    else if (keyType[0] === 'date/time') cmpKey = (yield* callOp('getAsDate', key, 'getAsDate')).getTime();
    else if (keyType[0] === 'boolean') cmpKey = (yield* callOp('getAsBoolean', key, 'getAsBoolean')) ? 1 : 0;
    else cmpKey = yield* callOp('getAsString', key, 'getAsString');
    pairs.push([cmpKey, items[i], i]);
  }
  // <- upstream sorting orders strings with java.text.Collator (locale-aware);
  // Intl.Collator is the port's equivalent (default locale; see UPSTREAM.md).
  const coll = keyType[0] === 'string' ? sortCollator() : null;
  const cmp = (a, b) => (coll !== null ? coll(a, b) : (a < b ? -1 : a > b ? 1 : 0));
  pairs.sort((p, q) => cmp(p[0], q[0]) || p[2] - q[2]);
  return new SequenceModel(pairs.map((p) => p[1]));
}

/** @returns {Function} a cached default-locale string comparator */
let sortCollatorCache = null;
function sortCollator() {
  if (sortCollatorCache === null) sortCollatorCache = new Intl.Collator().compare;
  return sortCollatorCache;
}

registerBuiltIn('sort', {
  acceptsMissing: true, // own "not a sequence" error covers null targets
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} argExprs - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, argExprs, env) {
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('sort', target, env);
    function* keyOf(it) { return it; }
    return yield* sortItems(items, keyOf, env, '?sort', 'value', 'values');
  },
});

// <- sort_byBI.BIMethod: ?sort_by evaluates to a method called with a string key or
// a string sequence key path.
/** The method model that `?sort_by` evaluates to <- sort_byBI.BIMethod. */
class SortByMethodModel extends TemplateMethodModel {
  /** @param {Object[]} items - the sequence elements to sort */
  constructor(items) {
    super();
    this.items = items;
  }

  /**
   * @param {import('../environment.js').Environment} env
   * @param {unknown[]} args - a string key name, or a sequence of strings (key path)
   * @returns {import('../model/models.js').SequenceModel}
   */
  * exec(env, args) {
    if (args.length < 1) {
      throw new TemplateException(`Expected 1 argument for "?sort_by(...)", but it had ${args.length}.`);
    }
    let subvars;
    const a0 = args[0];
    if (typeof a0 === 'string') {
      subvars = [a0];
    } else if (Array.isArray(a0)) {
      subvars = a0.map((v, i) => {
        if (typeof v !== 'string') {
          throw new TemplateException(
            'The argument to ?sort_by(key), when it\'s a sequence, must be a sequence of strings, '
            + `but the item at index ${i} is not a string.`);
        }
        return v;
      });
    } else {
      throw new TemplateException(
        'The argument to ?sort_by(key) must be a string (the name of the subvariable), '
        + 'or a sequence of strings (the "path" to the subvariable).');
    }
    function* keyOf(item, i, startError) {
      let cur = item;
      for (let ki = 0; ki < subvars.length; ki++) {
        if (!(cur instanceof HashModel)) {
          if (ki === 0) {
            throw new TemplateException(
              startError(i) + 'Sequence items must be hashes when using ?sort_by.');
          }
          throw new TemplateException(
            startError(i) + `The "${subvars[ki - 1]}" subvariable is not a hash, so ?sort_by `
            + `can't proceed with getting the "${subvars[ki]}" subvariable.`);
        }
        cur = yield* callOp(`get "${subvars[ki]}"`, cur, 'get', subvars[ki]);
        if (cur === null || cur === undefined) {
          throw new TemplateException(
            startError(i) + `The "${subvars[ki]}" subvariable was null or missing.`);
        }
      }
      return cur;
    }
    return yield* sortItems(this.items, keyOf, env, '?sort_by(...)', 'key value', 'key values');
  }
}

registerBuiltIn('sort_by', {
  acceptsMissing: true,
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} argExprs - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, argExprs, env) {
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('sort_by', target, env);
    return new SortByMethodModel(items);
  },
});

/**
 * Turns a ?filter/?map argument into an element -> result function
 * <- IntermediateStreamOperationLikeBuiltIn.evalElementTransformerExp.
 * @param {Object} argExp - the (unevaluated) argument expression
 * @param {import('../environment.js').Environment} env
 * @param {string} key - built-in name for messages
 * @returns {(element: Object) => Object}
 */
function* makeTransformer(argExp, env, key) {
  if (argExp instanceof LocalLambdaExpression) {
    return function* (element) { return yield* argExp.invoke(env, [element]); };
  }
  const model = yield* argExp.evaluate(env);
  if (model === null || model === undefined) {
    throw new InvalidReferenceException(
      `The following has evaluated to null or missing: ${argExp.getCanonicalForm()} `
      + `(the argument of the ?${key} built-in).`);
  }
  if (model.isFunctionModel === true) {
    return function* (element) {
      return yield* callOp('function call', model, 'invoke', env,
        { positionalArgs: [element], namedArgs: new Map() });
    };
  }
  if (model instanceof TemplateMethodModel) {
    return function* (element) {
      return yield* callOp('method call', model, 'exec', env, [unwrap(element)]);
    };
  }
  throw new TemplateException(
    `The argument of the ?${key} built-in must be a lambda expression or a function/method, `
    + `but it evaluated to a ${env.typeLabel(model)}.`);
}

// ?filter: <- filterBI + FilterLikeBI.elementMatches
registerBuiltIn('filter', {
  acceptsMissing: true,
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} argExprs - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, argExprs, env) {
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('filter', target, env);
    const transform = yield* makeTransformer(argExprs[0], env, 'filter');
    const out = [];
    for (const el of items) {
      const ok = yield* transform(el);
      if (ok === null || ok === undefined) {
        throw new TemplateException(
          'The filter expression has returned no value (has returned null), rather than a boolean.');
      }
      if (!(ok instanceof BooleanModel)) {
        throw new TemplateException(
          'The filter expression had to return a boolean value, but it returned a '
          + `${env.typeLabel(ok)} instead.`);
      }
      if (ok.value) out.push(el);
    }
    return new SequenceModel(out);
  },
});

// ?take_while / ?drop_while <- BuiltInsForSequences take_whileBI / drop_whileBI
// (same FilterLikeBI argument handling as ?filter; stop at first false/true).
for (const name of ['take_while', 'drop_while']) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/models.js').SequenceModel}
   */
    * impl(target, argExprs, env) {
      if (!(target instanceof TemplateSequenceModel)) throw nonSequenceError(name, target, env);
      const transform = yield* makeTransformer(argExprs[0], env, name);
      const out = [];
      let dropping = false;
      // <- upstream iterates by index; take_while stops early, so unbounded
      // ranges work there (up to Integer.MAX_VALUE from ?size). For take_while
      // the scan below already produced the result.
      const size = yield* awaitOp('size', target.size());
      const items = [];
      for (let i = 0; i < size; i++) {
        const el = yield* awaitOp('getByIndex', target.getByIndex(i));
        if (el === null || el === undefined) break;
        if (name === 'take_while') {
          const ok0 = yield* transform(el);
          if (ok0 === null || ok0 === undefined) {
            throw new TemplateException(
              `The ${name} expression has returned no value (has returned null), `
              + 'rather than a boolean.');
          }
          if (!(ok0 instanceof BooleanModel)) {
            throw new TemplateException(
              `The ${name} expression had to return a boolean value, but it returned a `
              + `${env.typeLabel(ok0)} instead.`);
          }
          if (ok0 !== BooleanModel.TRUE) break;
          out.push(el);
        } else {
          items.push(el);
        }
      }
      if (name === 'take_while') return new SequenceModel(out);
      for (const el of items) {
        const ok = yield* transform(el);
        if (ok === null || ok === undefined) {
          throw new TemplateException(
            `The ${name} expression has returned no value (has returned null), `
            + 'rather than a boolean.');
        }
        if (!(ok instanceof BooleanModel)) {
          throw new TemplateException(
            `The ${name} expression had to return a boolean value, but it returned a `
            + `${env.typeLabel(ok)} instead.`);
        }
        const match = ok === BooleanModel.TRUE;
        if (name === 'take_while') {
          if (!match) break;
          out.push(el);
        } else {
          if (!dropping) {
            if (match) continue;
            dropping = true;
          }
          out.push(el);
        }
      }
      return new SequenceModel(out);
    },
  });
}

// ?map: <- mapBI.fetchAndMapNextElement
registerBuiltIn('map', {
  acceptsMissing: true,
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} argExprs - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, argExprs, env) {
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('map', target, env);
    const transform = yield* makeTransformer(argExprs[0], env, 'map');
    const out = [];
    for (const el of items) {
      const v = yield* transform(el);
      if (v === null || v === undefined) {
        throw new TemplateException(
          'The element mapper function has returned no return value (has returned null).');
      }
      out.push(v);
    }
    return new SequenceModel(out);
  },
});

// <- BuiltInsForSequences: ?join / ?seq_contains / ?seq_index_of / ?reverse
// (DirectCallOptimization in upstream: the built-in evaluates to a method, and
// the "(args)" arrives through MethodCall, like the BIMethod built-ins).
registerBuiltIn('join', {
  acceptsMissing: true,
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} argExprs - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, argExprs, env) {
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('join', target, env);
    return new BuiltinArgMethod('join', 1, 1, function* (e, a) {
      const sep = typeof a[0] === 'string'
        ? a[0]
        : yield* e.coerceToString(e.wrap(a[0]), ' as the separator');
      const parts = [];
      for (const it of items) parts.push(yield* e.coerceToString(it, ' as a ?join element'));
      return new StringModel(parts.join(sep));
    });
  },
});

registerBuiltIn('seq_contains', {
  acceptsMissing: true,
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} argExprs - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, argExprs, env) {
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('seq_contains', target, env);
    return new BuiltinArgMethod('seq_contains', 1, 1, function* (e, a) {
      const needle = e.wrap(a[0]);
      for (let i = 0; i < items.length; i++) {
        if (yield* lenientEquals(e, items[i], needle, i)) return BooleanModel.TRUE;
      }
      return BooleanModel.FALSE;
    });
  },
});

registerBuiltIn('seq_index_of', {
  acceptsMissing: true,
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} argExprs - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, argExprs, env) {
    if (!(target instanceof TemplateSequenceModel)) throw nonSequenceError('seq_index_of', target, env);
    return new BuiltinArgMethod('seq_index_of', 1, 1, function* (e, a) {
      const needle = e.wrap(a[0]);
      // <- upstream iterates by index (lazily), which keeps unbounded ranges
      // working: it stops at Integer.MAX_VALUE or when the item is found.
      const size = yield* awaitOp('size', target.size());
      for (let i = 0; i < size; i++) {
        const item = yield* awaitOp('getByIndex', target.getByIndex(i));
        if (item === null || item === undefined) break;
        if (yield* lenientEquals(e, item, needle, i)) return new NumberModel(i);
      }
      return new NumberModel(-1); // <- upstream: -1 when absent (2.3.36)
    });
  },
});

/**
 * <- BuiltInsForSequences.seqContainsBI/seqIndexOfBI: EvalUtil.compare with
 * typeMismatchMeansNotEqual and null-flags set; a comparison error simply means
 * "not equal" (upstream's eq-comparison never errors on type mismatch anyway).
 * @param {import('../environment.js').Environment} e
 * @param {Object} item
 * @param {Object} needle
 * @param {number} index
 * @returns {Generator<unknown, boolean, unknown>}
 */
function* lenientEquals(e, item, needle, index) {
  try {
    return (yield* e.compare(item, needle, 'eq', null, {
      typeMismatchMeansNotEqual: true,
      leftNullReturnsFalse: true,
      rightNullReturnsFalse: true,
    })) === 0;
  } catch (err) {
    return false;
  }
}

registerBuiltIn('reverse', {
  acceptsMissing: true,
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} argExprs - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, argExprs, env) {
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('reverse', target, env);
    return new SequenceModel([...items].reverse());
  },
});


// ?with_args / ?with_args_last <- BuiltInsForCallables.with_argsBI /
// with_args_lastBI (2.3.36 form): the built-in returns a BIMethod; the first
// "(...)" call binds exactly one argument (a sequence or extended hash), the
// following call invokes the wrapped target with the bound arguments appended
// to (with_args) or prepended before (with_args_last) the call arguments.
class WithArgsMethod extends TemplateMethodModel {
  /**
   * @param {TemplateMethodModel|Object} target - method model or invoke-capable
   * @param {string} name - with_args | with_args_last
   */
  constructor(target, name) {
    super();
    this.target = target;
    this.name = name;
    this.isFunctionModel = target.isFunctionModel === true ? true : undefined;
    this.isMacroLike = target.isMacroLike === true ? true : undefined;
    this.boundPos = null;
    this.boundNamed = null;
    this.bound = false;
  }
  _countError(cnt) {
    return new TemplateException(
      `?${this.name}(...) expects 1 argument but has received ${cnt}.`);
  }
  _typeError(value) {
    return new TemplateException(
      `?${this.name}(...) expects an extended hash or sequence as argument #1, `
      + `but received a ${typeof value === 'number' ? 'number' : typeof value}.`);
  }
  _combine(bound, call) {
    return this.name === 'with_args' ? [...bound, ...call] : [...call, ...bound];
  }
  /**
   * @param {import('../environment.js').Environment} env
   * @param {unknown[]} raw - unwrapped call arguments (<- MethodCall)
   * @returns {Generator<unknown, Object, unknown>}
   */
  * exec(env, raw = []) {
    if (!this.bound) {
      if (raw.length !== 1) throw this._countError(raw.length === 0 ? 'none' : raw.length);
      const a = raw[0];
      if (Array.isArray(a)) {
        this.boundPos = a;
      } else if (a instanceof Map || (a !== null && typeof a === 'object')) {
        if (this.target.isMacroLike !== true) {
          throw new TemplateException(`When applied on a ${this.target.isFunctionModel === true
            ? 'function' : 'method'}, ?${this.name} can't have a hash argument. `
            + 'Use a sequence argument.');
        }
        this.boundNamed = new Map(a instanceof Map ? a : Object.entries(a));
        for (const [k, v] of this.boundNamed) this.boundNamed.set(k, env.wrap(v));
      } else {
        throw this._typeError(a);
      }
      this.bound = true;
      return this;
    }
    if (this.boundPos !== null) {
      return yield* callOp(`${this.name} call`, this.target, 'exec', env,
        this._combine(this.boundPos, raw));
    }
    const named = new Map(this.boundNamed);
    return yield* callOp(`${this.name} call`, this.target, 'invoke', env,
      { positionalArgs: raw.map((v) => env.wrap(v)), namedArgs: named });
  }
  /**
   * Model-level call path (isFunctionModel targets).
   * @param {import('../environment.js').Environment} env
   * @param {Object} call - { positionalArgs, namedArgs }
   * @returns {Generator<unknown, Object, unknown>}
   */
  * invoke(env, call) {
    const pos = call.positionalArgs || [];
    if (!this.bound) {
      if (pos.length !== 1) throw this._countError(pos.length === 0 ? 'none' : pos.length);
      const a = pos[0];
      if (a instanceof TemplateSequenceModel) {
        const bound = [];
        const size = yield* callOp('size', a, 'size');
        for (let i = 0; i < size; i++) bound.push(yield* callOp('index', a, 'getByIndex', i));
        this.boundPos = bound;
      } else if (a instanceof TemplateHashModel) {
        if (this.target.isMacroLike !== true) {
          throw new TemplateException(`When applied on a ${this.target.isFunctionModel === true
            ? 'function' : 'method'}, ?${this.name} can't have a hash argument. `
            + 'Use a sequence argument.');
        }
        const named = new Map();
        for (const ks of a.keys()) {
          named.set(String(ks), yield* callOp('hash get', a, 'get', String(ks)));
        }
        this.boundNamed = named;
      } else {
        return this._typeErrorModel(env, a);
      }
      this.bound = true;
      return this;
    }
    const named = new Map(this.boundNamed === null ? [] : this.boundNamed);
    if (call.namedArgs) for (const [k, v] of call.namedArgs) named.set(k, v);
    return yield* callOp(`${this.name} call`, this.target, 'invoke', env,
      { ...call, positionalArgs: this._combine(this.boundPos || [], pos), namedArgs: named });
  }
  _typeErrorModel(env, a) {
    throw new TemplateException(
      `?${this.name}(...) expects an extended hash or sequence as argument #1, `
      + `but received a ${env.typeLabel(a)}.`);
  }
}

for (const name of ['with_args', 'with_args_last']) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {WithArgsMethod} the BIMethod stand-in
   */
    * impl(target, argExprs, env) {
      if (!(target instanceof TemplateMethodModel) && typeof target.invoke !== 'function') {
        throw new NonMethodException(
          `For "?${name}" left-hand operand: Expected a macro, function, directive, or `
          + `method, but this has evaluated to ${env.typeLabel(target)}`);
      }
      return new WithArgsMethod(target, name);
    },
  });
}// <- BuiltInsForSequences.sequenceBI: a sequence stays as-is (identity, so
// unbounded ranges keep working); collections have no port-side model.
registerBuiltIn('sequence', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    if (target instanceof TemplateSequenceModel) return target;
    const tl = env.typeLabel(target);
    throw new InvalidReferenceException(
      'For "?sequence" left-hand operand: Expected a sequence or collection, '
      + `but this has evaluated to ${/^[aeiou]/.test(tl) ? 'an' : 'a'} ${tl}.`);
  },
});


