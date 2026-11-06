// Existence-handling, lazy conditional, multi-type, type-check, hash and number
// built-ins ← BuiltInsForExistenceHandling, BuiltInsWithLazyConditionals,
// BuiltInsForMultipleTypes, BuiltInsForHashes, BuiltInsForNumbers (2.3.36).

import { registerBuiltIn } from './registry.js';
import {
  BuiltinArgMethod, argCntError, sequenceItems, nonSequenceError,
} from './common.js';
import {
  StringModel, NumberModel, BooleanModel, DateModel, HashModel, SequenceModel,
} from '../model/models.js';
import {
  TemplateSequenceModel, TemplateHashModelEx, TemplateMethodModel,
} from '../model/templateModel.js';
import {
  InvalidReferenceException, NonExtendedHashException, NonNumericalException, TemplateException,
} from '../errors.js';

const BoolTrue = BooleanModel.TRUE;
const BoolFalse = BooleanModel.FALSE;

// ---- existence handling (BuiltInsForExistenceHandling) ----

// ← Expression.isEmpty
/**
 * ← Expression.isEmpty.
 * @param {Object|null} model
 * @param {import('../environment.js').Environment} env
 * @returns {boolean}
 */
function isEmpty(model, env) {
  if (model === null || model === undefined) return true;
  if (model instanceof TemplateSequenceModel) return model.size() === 0;
  if (typeof model.getAsString === 'function') return model.getAsString() === '';
  if (model instanceof TemplateHashModelEx) return model.size() === 0;
  if (model instanceof NumberModel || model instanceof DateModel || model instanceof BooleanModel) {
    return false;
  }
  if (typeof model.size === 'function') return model.size() === 0;
  return true;
}

registerBuiltIn('if_exists', {
  acceptsMissing: true,
  impl(target) {
    // ← TemplateModel.NOTHING: an empty string for output purposes
    return target === null || target === undefined ? new StringModel('') : target;
  },
});

registerBuiltIn('has_content', {
  acceptsMissing: true,
  impl(target, args, env) {
    return isEmpty(target, env) ? BoolFalse : BoolTrue;
  },
});

// ← defaultBI: a method returning the target (ConstantMethod), or the first
// non-null argument when the target was missing (FIRST_NON_NULL_METHOD).
registerBuiltIn('default', {
  minArgs: 1,
  acceptsMissing: true,
  impl(target, argExprs, env) {
    const firstNonNull = (vals) => {
      for (const v of vals) {
        if (v !== null && v !== undefined) return v;
      }
      return null;
    };
    // Unevaluated argument expressions (missing ones must not throw).
    const evalMaybeMissing = (expr) => {
      try {
        return expr.evaluate(env);
      } catch (e) {
        if (e instanceof InvalidReferenceException) return null;
        throw e;
      }
    };
    if (argExprs.length === 0) {
      return new BuiltinArgMethod('default', 0, Infinity, (e, args) => {
        if (target !== null && target !== undefined) return target;
        if (args.length === 0) throw argCntError('default', 0, 1, Infinity);
        return firstNonNull(args.map((a) => e.wrap(a)));
      });
    }
    if (target !== null && target !== undefined) return target;
    return firstNonNull(argExprs.map(evalMaybeMissing));
  },
});

/**
 * @param {Object|null} target
 * @param {import('../environment.js').Environment} env
 * @param {string} key
 * @param {(s: string) => boolean} blankTest
 * @returns {Object|null} null when blank, else the target model
 */
function toNull(target, env, key, blankTest) {
  if (target === null || target === undefined) return null;
  const s = env.coerceToString(target, ` for the "?${key}" built-in`);
  return blankTest(s) ? null : target;
}

registerBuiltIn('blank_to_null', {
  acceptsMissing: true,
  impl(target, args, env) {
    // ← isBlank: whitespace (or NBSP) only; the empty string is blank too
    return toNull(target, env, 'blank_to_null',
      (s) => s.length === 0 || [...s].every((c) => c.charCodeAt(0) <= 0x20 || c === '\u00a0'));
  },
});

registerBuiltIn('empty_to_null', {
  acceptsMissing: true,
  impl(target, args, env) {
    return toNull(target, env, 'empty_to_null', (s) => s.length === 0);
  },
});

registerBuiltIn('trim_to_null', {
  acceptsMissing: true,
  impl(target, args, env) {
    if (target === null || target === undefined) return null;
    const s = env.coerceToString(target, ' for the "?trim_to_null" built-in').trim();
    return s.length === 0 ? null : new StringModel(s);
  },
});

// ---- lazy conditionals (BuiltInsWithLazyConditionals) ----

registerBuiltIn('then', {
  minArgs: 2,
  maxArgs: 2,
  impl(target, argExprs, env) {
    if (argExprs.length !== 2) {
      throw argCntError('then', argExprs.length, 2, 2);
    }
    const lho = env.toBoolean(target, ' on the left side of "?then"');
    const branch = argExprs[lho ? 0 : 1];
    const v = branch.evaluate(env); // ← only the chosen branch is evaluated
    if (v === null || v === undefined) {
      throw new InvalidReferenceException(
        `The following has evaluated to null or missing: ${branch.getCanonicalForm()} `
        + '(the branch chosen by the "?then" built-in).');
    }
    return v;
  },
});

registerBuiltIn('switch', {
  minArgs: 2,
  maxArgs: Infinity,
  impl(target, argExprs, env) {
    if (argExprs.length < 2) {
      throw argCntError('switch', argExprs.length, 2, Infinity);
    }
    const n = argExprs.length;
    for (let i = 0; i + 1 < n; i += 2) {
      const caseValue = argExprs[i].evaluate(env);
      if (caseValue === null || caseValue === undefined) {
        throw new InvalidReferenceException(
          `The following has evaluated to null or missing: ${argExprs[i].getCanonicalForm()} `
          + '(a ?switch case parameter).');
      }
      if (env.equals(target, caseValue)) {
        const value = argExprs[i + 1].evaluate(env);
        if (value === null || value === undefined) {
          throw new InvalidReferenceException(
            `The following has evaluated to null or missing: ${argExprs[i + 1].getCanonicalForm()} `
            + '(the ?switch value for a matching case).');
        }
        return value;
      }
    }
    if (n % 2 === 1) {
      // last parameter = default value
      const def = argExprs[n - 1].evaluate(env);
      if (def === null || def === undefined) {
        throw new InvalidReferenceException(
          `The following has evaluated to null or missing: ${argExprs[n - 1].getCanonicalForm()} `
          + '(the ?switch default parameter).');
      }
      return def;
    }
    throw new TemplateException(
      'The value before ?switch(case1, value1, case2, value2, ...) didn\'t match any of the '
      + 'case parameters, and there was no default value parameter (an additional last parameter).');
  },
});

// ---- multi-type built-ins (BuiltInsForMultipleTypes) ----

registerBuiltIn('size', {
  acceptsMissing: true, // own error below covers null/missing targets
  impl(target, args, env) {
    if (target instanceof TemplateSequenceModel) return new NumberModel(target.size());
    if (target instanceof TemplateHashModelEx) return new NumberModel(target.size());
    throw new TemplateException(
      'Expected an extended-hash or sequence value, but the target of the "?size" built-in '
      + `is a ${env.typeLabel(target)} instead.`);
  },
});

registerBuiltIn('first', {
  acceptsMissing: true,
  impl(target, args, env) {
    const items = sequenceItems(target);
    if (items === null) throw nonSequenceError('first', target, env);
    return items.length === 0 ? null : items[0];
  },
});

registerBuiltIn('last', {
  acceptsMissing: true,
  impl(target, args, env) {
    const items = sequenceItems(target);
    if (items === null) throw nonSequenceError('last', target, env);
    return items.length === 0 ? null : items[items.length - 1];
  },
});

// ---- hash built-ins (BuiltInsForHashes) ----

/**
 * @param {string} key
 * @param {Object} target
 * @param {import('../environment.js').Environment} env
 * @returns {NonExtendedHashException}
 */
function keysValuesError(key, target, env) {
  return new NonExtendedHashException(
    `For "?${key}": Expected an extended-hash value, but the target evaluated to a `
    + `${env.typeLabel(target)} instead.`);
}

registerBuiltIn('keys', {
  acceptsMissing: true,
  impl(target, args, env) {
    if (!(target instanceof TemplateHashModelEx)) throw keysValuesError('keys', target, env);
    return new SequenceModel(target.keys().map((k) => new StringModel(k)));
  },
});

registerBuiltIn('values', {
  acceptsMissing: true,
  impl(target, args, env) {
    if (!(target instanceof TemplateHashModelEx)) throw keysValuesError('values', target, env);
    return new SequenceModel(target.values().map((v) => env.wrap(v)));
  },
});

// ---- number built-ins (BuiltInsForNumbers) ----

/**
 * @param {Object} target
 * @param {import('../environment.js').Environment} env
 * @param {string} key
 * @returns {number}
 */
function numberTarget(target, env, key) {
  if (target instanceof NumberModel) return target.getAsNumber();
  throw new NonNumericalException(
    `Expected a number, but the target of the "?${key}" built-in is a `
    + `${env.typeLabel(target)}.`);
}

registerBuiltIn('abs', {
  impl(target, args, env) {
    const v = numberTarget(target, env, 'abs');
    return new NumberModel(Math.abs(v));
  },
});

registerBuiltIn('ceiling', {
  impl(target, args, env) {
    return new NumberModel(Math.ceil(numberTarget(target, env, 'ceiling')));
  },
});

registerBuiltIn('floor', {
  impl(target, args, env) {
    return new NumberModel(Math.floor(numberTarget(target, env, 'floor')));
  },
});

// Java rounds halves away from zero; Math.round(-2.5) is -2 → explicit.
registerBuiltIn('round', {
  impl(target, args, env) {
    const v = numberTarget(target, env, 'round');
    return new NumberModel(v < 0 ? -Math.round(-v) : Math.round(v));
  },
});

// ---- type checks (BuiltInsForMultipleTypes is_*BI; null targets → false) ----

registerBuiltIn('is_string', {
  acceptsMissing: true,
  impl(target) { return target instanceof StringModel ? BoolTrue : BoolFalse; },
});
registerBuiltIn('is_number', {
  acceptsMissing: true,
  impl(target) { return target instanceof NumberModel ? BoolTrue : BoolFalse; },
});
registerBuiltIn('is_boolean', {
  acceptsMissing: true,
  impl(target) { return target instanceof BooleanModel ? BoolTrue : BoolFalse; },
});
// Date kind (date-only/time/datetime) is not modeled until M16; ?is_date covers
// every date-like value (deviation noted in UPSTREAM.md).
registerBuiltIn('is_date', {
  acceptsMissing: true,
  impl(target) { return target instanceof DateModel ? BoolTrue : BoolFalse; },
});
registerBuiltIn('is_hash', {
  acceptsMissing: true,
  impl(target) { return target instanceof HashModel ? BoolTrue : BoolFalse; },
});
registerBuiltIn('is_hash_ex', {
  acceptsMissing: true,
  impl(target) { return target instanceof TemplateHashModelEx ? BoolTrue : BoolFalse; },
});
registerBuiltIn('is_sequence', {
  acceptsMissing: true,
  impl(target) { return target instanceof TemplateSequenceModel ? BoolTrue : BoolFalse; },
});
registerBuiltIn('is_method', {
  acceptsMissing: true,
  impl(target) {
    if (target === null || target === undefined) return BoolFalse;
    return (target instanceof TemplateMethodModel || target.isFunctionModel === true)
      ? BoolTrue : BoolFalse;
  },
});
registerBuiltIn('is_directive', {
  acceptsMissing: true,
  impl(target) { return target && target.isMacroLike === true ? BoolTrue : BoolFalse; },
});
registerBuiltIn('is_macro', {
  acceptsMissing: true,
  impl(target) { return target && target.isMacroLike === true ? BoolTrue : BoolFalse; },
});
// The port has no node models and no TemplateTransformModel yet (M15): always false.
registerBuiltIn('is_node', {
  acceptsMissing: true,
  impl() { return BoolFalse; },
});
registerBuiltIn('is_transform', {
  acceptsMissing: true,
  impl() { return BoolFalse; },
});
