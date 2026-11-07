// Sequence built-ins: ?sort, ?sort_by, ?filter, ?map.
// <- freemarker.core.BuiltInsForSequences (sortBI 601, sort_byBI 548, filterBI 1051, mapBI 1207)

import { registerBuiltIn } from './registry.js';
import { BuiltinArgMethod, sequenceItems, nonSequenceError } from './common.js';
import {
  SequenceModel, StringModel, NumberModel, BooleanModel, DateModel, HashModel,
} from '../model/models.js';
import { TemplateMethodModel } from '../model/templateModel.js';
import { LocalLambdaExpression } from '../parser/ast/expressions/lambda.js';
import { InvalidReferenceException, TemplateException } from '../errors.js';
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
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('seq_index_of', target, env);
    return new BuiltinArgMethod('seq_index_of', 1, 1, function* (e, a) {
      const needle = e.wrap(a[0]);
      for (let i = 0; i < items.length; i++) {
        if (yield* lenientEquals(e, items[i], needle, i)) return new NumberModel(i);
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
