// Sequence built-ins: ?sort, ?sort_by, ?filter, ?map.
// ← freemarker.core.BuiltInsForSequences (sortBI 601, sort_byBI 548, filterBI 1051, mapBI 1207)

import { registerBuiltIn } from './registry.js';
import {
  SequenceModel, RangeModel, StringModel, NumberModel, BooleanModel, DateModel,
  HashModel,
} from '../model/models.js';
import { TemplateMethodModel } from '../model/templateModel.js';
import { LocalLambdaExpression } from '../parser/ast/expressions/lambda.js';
import { InvalidReferenceException, TemplateException } from '../errors.js';
import { unwrap } from '../model/unwrap.js';

/**
 * Materializes the elements through getByIndex so raw data-model values become models.
 * @param {Object} target
 * @returns {Object[]|null} the element models, or null when not a sequence
 */
function sequenceItems(target) {
  if (target instanceof SequenceModel) {
    const n = target.size();
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = target.getByIndex(i);
    return out;
  }
  if (target instanceof RangeModel) {
    const n = target.size();
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = target.getByIndex(i);
    return out;
  }
  return null;
}

/**
 * @param {string} key - built-in name for the message
 * @param {Object} target
 * @param {import('../environment.js').Environment} env
 * @returns {import('../errors.js').TemplateException}
 */
function nonSequenceError(key, target, env) {
  return new TemplateException(
    `The "?${key}" built-in can only be used on sequences (lists), `
    + `but the target is a ${env.typeLabel(target)}.`);
}

/**
 * @param {Object|null} key - a model used as a sort key
 * @returns {[string, string]|null} [singular label, plural label], null if not sortable
 */
function keyTypeName(key) {
  if (key instanceof StringModel) return ['string', 'strings'];
  if (key instanceof NumberModel) return ['number', 'numbers'];
  if (key instanceof DateModel) return ['date/time', 'date/times'];
  if (key instanceof BooleanModel) return ['boolean', 'booleans'];
  return null;
}

/**
 * ← BuiltInsForSequences.sortBI.sort: type detection from the 1st key, stable sort.
 * Deviation: string keys compare by code point (upstream uses the locale Collator).
 * @param {Object[]} items
 * @param {(item: Object, index: number, startError: Function) => Object|null} keyOf
 * @param {import('../environment.js').Environment} env
 * @param {string} biLabel - e.g. "?sort" / "?sort_by(...)"
 * @param {string} valueWord - singular noun for messages ("value" / "key value")
 * @param {string} valueWordPlural
 * @returns {import('../model/models.js').SequenceModel}
 */
function sortItems(items, keyOf, env, biLabel, valueWord, valueWordPlural) {
  const n = items.length;
  if (n === 0) return new SequenceModel([...items]);
  const startError = (i) => (i === 0
    ? `${biLabel} failed: `
    : `${biLabel} failed at sequence index ${i} (0-based): `);
  const pairs = [];
  let keyType = null;
  for (let i = 0; i < n; i++) {
    const key = keyOf(items[i], i, startError);
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
    pairs.push([key, items[i], i]);
  }
  const cmp = (a, b) => {
    if (keyType[0] === 'number') return a.getAsNumber() - b.getAsNumber();
    if (keyType[0] === 'date/time') return a.getAsDate().getTime() - b.getAsDate().getTime();
    if (keyType[0] === 'boolean') return (a.getAsBoolean() ? 1 : 0) - (b.getAsBoolean() ? 1 : 0);
    const as = a.getAsString();
    const bs = b.getAsString();
    return as < bs ? -1 : as > bs ? 1 : 0;
  };
  pairs.sort((p, q) => cmp(p[0], q[0]) || p[2] - q[2]);
  return new SequenceModel(pairs.map((p) => p[1]));
}

registerBuiltIn('sort', {
  impl(target, argExprs, env) {
    const items = sequenceItems(target);
    if (items === null) throw nonSequenceError('sort', target, env);
    return sortItems(items, (it) => it, env, '?sort', 'value', 'values');
  },
});

// ← sort_byBI.BIMethod: ?sort_by evaluates to a method called with a string key or
// a string sequence key path.
/** The method model that `?sort_by` evaluates to ← sort_byBI.BIMethod. */
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
  exec(env, args) {
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
    const keyOf = (item, i, startError) => {
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
        cur = cur.get(subvars[ki]);
        if (cur === null || cur === undefined) {
          throw new TemplateException(
            startError(i) + `The "${subvars[ki]}" subvariable was null or missing.`);
        }
      }
      return cur;
    };
    return sortItems(this.items, keyOf, env, '?sort_by(...)', 'key value', 'key values');
  }
}

registerBuiltIn('sort_by', {
  impl(target, argExprs, env) {
    const items = sequenceItems(target);
    if (items === null) throw nonSequenceError('sort_by', target, env);
    return new SortByMethodModel(items);
  },
});

/**
 * Turns a ?filter/?map argument into an element -> result function
 * ← IntermediateStreamOperationLikeBuiltIn.evalElementTransformerExp.
 * @param {Object} argExp - the (unevaluated) argument expression
 * @param {import('../environment.js').Environment} env
 * @param {string} key - built-in name for messages
 * @returns {(element: Object) => Object}
 */
function makeTransformer(argExp, env, key) {
  if (argExp instanceof LocalLambdaExpression) {
    return (element) => argExp.invoke(env, [element]);
  }
  const model = argExp.evaluate(env);
  if (model === null || model === undefined) {
    throw new InvalidReferenceException(
      `The following has evaluated to null or missing: ${argExp.getCanonicalForm()} `
      + `(the argument of the ?${key} built-in).`);
  }
  if (model.isFunctionModel === true) {
    return (element) => model.invoke(env, { positionalArgs: [element], namedArgs: new Map() });
  }
  if (model instanceof TemplateMethodModel) {
    return (element) => model.exec(env, [unwrap(element)]);
  }
  throw new TemplateException(
    `The argument of the ?${key} built-in must be a lambda expression or a function/method, `
    + `but it evaluated to a ${env.typeLabel(model)}.`);
}

// ?filter: ← filterBI + FilterLikeBI.elementMatches
registerBuiltIn('filter', {
  impl(target, argExprs, env) {
    const items = sequenceItems(target);
    if (items === null) throw nonSequenceError('filter', target, env);
    const transform = makeTransformer(argExprs[0], env, 'filter');
    const out = [];
    for (const el of items) {
      const ok = transform(el);
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

// ?map: ← mapBI.fetchAndMapNextElement
registerBuiltIn('map', {
  impl(target, argExprs, env) {
    const items = sequenceItems(target);
    if (items === null) throw nonSequenceError('map', target, env);
    const transform = makeTransformer(argExprs[0], env, 'map');
    const out = [];
    for (const el of items) {
      const v = transform(el);
      if (v === null || v === undefined) {
        throw new TemplateException(
          'The element mapper function has returned no return value (has returned null).');
      }
      out.push(v);
    }
    return new SequenceModel(out);
  },
});
