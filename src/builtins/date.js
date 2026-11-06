// Date/type formatting built-ins ← BuiltInsForDates + BuiltInsForOutputFormatRelated
// ?string (2.3.36). Only the local-time ISO subset and java-style patterns are
// supported (no UTC/local/zone variants; see UPSTREAM.md).

import { registerBuiltIn, getBuiltIn } from './registry.js';
import { argCntError } from './common.js';
import { StringModel, DateModel } from '../model/models.js';
import { UnsupportedFeatureException, NonDateException } from '../errors.js';
import { formatIsoDate, DATE_TYPES } from '../format/dateFormat.js';

// ?string, ?string(fmt) with a format string, or ?string(fmtHash).
registerBuiltIn('string', {
  minArgs: 0, maxArgs: 1,
  impl(target, argExprs, env) {
    if (argExprs !== null && argExprs.length > 1) {
      throw argCntError('string', argExprs.length, 0, 1);
    }
    let fmt = null;
    if (argExprs !== null && argExprs.length > 0) {
      const arg = argExprs[0].evaluate(env);
      if (arg instanceof StringModel) {
        fmt = arg.value;
      } else if (arg && typeof arg.get === 'function') {
        return formatWithHash(target, arg, env);
      } else {
        throw new UnsupportedFeatureException(
          'The ?string(...) argument must be a format string or a hash of format strings.');
      }
    }
    if (target instanceof DateModel) {
      return new StringModel(env._formatDate(target.getAsDate(), target.dateType, fmt));
    }
    if (fmt !== null && fmt !== '') {
      if (target instanceof StringModel) {
        const bi = getBuiltIn(fmt);
        if (bi === null) throw new UnsupportedFeatureException(`Unknown string format built-in: "${fmt}".`);
        return bi.impl(target, null, env);
      }
      if (target && typeof target.getAsNumber === 'function') {
        return new StringModel(applyNumberFormatString(target.getAsNumber(), fmt, env));
      }
      if (target && typeof target.getAsBoolean === 'function') {
        return new StringModel(env._formatBoolean(target.getAsBoolean(), fmt));
      }
    }
    return new StringModel(env.coerceToString(target, ' with ?string'));
  },
});

/**
 * @param {number} v
 * @param {string} fmt - format string overriding the env default
 * @param {import('../environment.js').Environment} env
 * @returns {string}
 */
function applyNumberFormatString(v, fmt, env) {
  const saved = env._settings.numberFormat;
  try {
    env._settings.numberFormat = fmt;
    return env._formatNumber(v);
  } finally {
    env._settings.numberFormat = saved;
  }
}

/**
 * ?string({ number_format: "currency", date_format: "iso", boolean_format: "yes,no",
 * string_format: "upper_case" })
 * @param {Object} target
 * @param {import('../model/models.js').HashModel} hash
 * @param {import('../environment.js').Environment} env
 * @returns {Object}
 */
function formatWithHash(target, hash, env) {
  const pick = (k) => {
    const v = hash.get(k);
    return v instanceof StringModel ? v.value : null;
  };
  if (target instanceof DateModel) {
    const fmt = target.dateType === DATE_TYPES.DATE ? pick('date_format')
      : target.dateType === DATE_TYPES.TIME ? pick('time_format')
        : pick('datetime_format');
    if (fmt !== null) return new StringModel(env._formatDate(target.getAsDate(), target.dateType, fmt));
    return new StringModel(env.coerceToString(target, ' with ?string'));
  }
  if (target && typeof target.getAsNumber === 'function') {
    const fmt = pick('number_format');
    if (fmt !== null) return new StringModel(applyNumberFormatString(target.getAsNumber(), fmt, env));
    return new StringModel(env.coerceToString(target, ' with ?string'));
  }
  if (target && typeof target.getAsBoolean === 'function') {
    const fmt = pick('boolean_format');
    if (fmt !== null) return new StringModel(env._formatBoolean(target.getAsBoolean(), fmt));
    return new StringModel(env.coerceToString(target, ' with ?string'));
  }
  if (target instanceof StringModel) {
    const fmt = pick('string_format');
    if (fmt !== null) {
      const bi = getBuiltIn(fmt);
      if (bi === null) throw new UnsupportedFeatureException(`Unknown string format built-in: "${fmt}".`);
      return bi.impl(target, null, env);
    }
    return target;
  }
  return new StringModel(env.coerceToString(target, ' with ?string'));
}

// ← dateBI / timeBI / dateTimeBI: change the date-type used by formatting
// (parsing strings into dates is not ported; see UPSTREAM.md).
/**
 * @param {string} name - built-in name
 * @param {number} dateType - DATE_TYPES member
 * @returns {void}
 */
function asType(name, dateType) {
  registerBuiltIn(name, {
    impl(target, args, env) {
      if (!(target instanceof DateModel)) {
        throw new NonDateException(
          `Can't apply the ?${name} built-in to a value of type ${env.typeLabel(target)}`);
      }
      return new DateModel(target.getAsDate(), dateType);
    },
  });
}

asType('date', DATE_TYPES.DATE);
asType('time', DATE_TYPES.TIME);
asType('datetime', DATE_TYPES.DATE_TIME);

// ← isoDateBI / isoTimeBI / isoDateTimeBI: ISO strings with the type fixed.
/**
 * @param {string} name - built-in name
 * @param {number} dateType - DATE_TYPES member
 * @returns {void}
 */
function isoAsType(name, dateType) {
  registerBuiltIn(name, {
    impl(target, args, env) {
      if (!(target instanceof DateModel)) {
        throw new NonDateException(
          `Can't apply the ?${name} built-in to a value of type ${env.typeLabel(target)}`);
      }
      return new StringModel(formatIsoDate(target.getAsDate(), 'iso', dateType));
    },
  });
}

isoAsType('iso_date', DATE_TYPES.DATE);
isoAsType('iso_time', DATE_TYPES.TIME);
isoAsType('iso_datetime', DATE_TYPES.DATE_TIME);
