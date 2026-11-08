// Date/type formatting built-ins <- BuiltInsForDates + BuiltInsForOutputFormatRelated
// ?string (2.3.36). Only the local-time ISO subset and java-style patterns are
// supported (no UTC/local/zone variants; see UPSTREAM.md).

import { registerBuiltIn, getBuiltIn } from './registry.js';
import { argCntError, BuiltinArgMethod } from './common.js';
import { StringModel, DateModel, BooleanModel } from '../model/models.js';
import {
  isScalarModel, isDateModel, isHashModel, isBooleanModel,
} from '../model/capabilities.js';
import {
  UnsupportedFeatureException, NonDateException, NonStringException,
  NonNumericalException, TemplateException, InvalidFormatStringException,
} from '../errors.js';
import { formatIsoDate, DATE_TYPES } from '../format/dateFormat.js';
import { callOp } from '../async.js';

// ?string, ?string(fmt) with a format string, or ?string(fmtHash).
registerBuiltIn('string', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  * impl(target, argExprs, env) {
    const isBool = isBooleanModel(target) && !isDateModel(target);
    const maxArgs = isBool ? 2 : 1;
    if (argExprs !== null && argExprs.length > maxArgs) {
      throw argCntError('string', argExprs.length, 0, maxArgs);
    }
    if (isBool && argExprs !== null && argExprs.length === 2) {
      const yes = yield* env.coerceToString(yield* argExprs[0].evaluate(env), ' as ?string first argument');
      const no = yield* env.coerceToString(yield* argExprs[1].evaluate(env), ' as ?string second argument');
      const b = yield* callOp('getAsBoolean', target, 'getAsBoolean');
      return new StringModel(b ? yes : no);
    }
    let fmt = null;
    if (argExprs !== null && argExprs.length > 0) {
      const arg = yield* argExprs[0].evaluate(env);
      if (isScalarModel(arg)) {
        fmt = yield* callOp('getAsString', arg, 'getAsString');
      } else if (isHashModel(arg)) {
        return yield* formatWithHash(target, arg, env);
      } else {
        throw new UnsupportedFeatureException(
          'The ?string(...) argument must be a format string or a hash of format strings.');
      }
    }
    if (isDateModel(target)) {
      return new StringModel(env._formatDate(
        yield* callOp('getAsDate', target, 'getAsDate'),
        target.dateType === undefined ? DateModel.DATE_TIME : target.dateType, fmt));
    }
    if (fmt !== null && fmt !== '') {
      if (isScalarModel(target)) {
        const bi = getBuiltIn(fmt);
        if (bi === null) throw new UnsupportedFeatureException(`Unknown string format built-in: "${fmt}".`);
        return yield* bi.impl(target, null, env);
      }
      if (target && typeof target.getAsNumber === 'function') {
        return new StringModel(env._formatNumber(
          yield* callOp('getAsNumber', target, 'getAsNumber'), undefined, fmt));
      }
      if (target && typeof target.getAsBoolean === 'function') {
        return new StringModel(env._formatBoolean(yield* callOp('getAsBoolean', target, 'getAsBoolean'), fmt));
      }
    }
    // <- JVM: bare ?string on a boolean uses the boolean_format pair even when it
    // is the legacy "true,false" default (no auto-conversion error on ?string).
    if (isBool) {
      return new StringModel(env._formatBoolean(yield* callOp('getAsBoolean', target, 'getAsBoolean')));
    }
    return new StringModel(yield* env.coerceToString(target, ' with ?string'));
  },
});

/**
 * @param {number} v
 * @param {string} fmt - format string overriding the env default
 * @param {import('../environment.js').Environment} env
 * @returns {string}
 */
/**
 * ?string({ number_format: "currency", date_format: "iso", boolean_format: "yes,no",
 * string_format: "upper_case" })
 * @param {Object} target
 * @param {import('../model/models.js').HashModel} hash
 * @param {import('../environment.js').Environment} env
 * @returns {Object}
 */
function* formatWithHash(target, hash, env) {
  function* pick(k) {
    const v = yield* callOp(`get "${k}"`, hash, 'get', k);
    return v === null || v === undefined ? null : (isScalarModel(v)
      ? (v instanceof StringModel ? v.value : yield* callOp('getAsString', v, 'getAsString'))
      : null);
  }
  if (isDateModel(target)) {
    const dt = target.dateType === undefined ? DATE_TYPES.NONE : target.dateType;
    const fmt = dt === DATE_TYPES.DATE ? yield* pick('date_format')
      : dt === DATE_TYPES.TIME ? yield* pick('time_format')
        : yield* pick('datetime_format');
    if (fmt !== null) return new StringModel(env._formatDate(
      yield* callOp('getAsDate', target, 'getAsDate'),
      target.dateType === undefined ? DateModel.DATE_TIME : target.dateType, fmt));
    return new StringModel(yield* env.coerceToString(target, ' with ?string'));
  }
  if (target && typeof target.getAsNumber === 'function') {
    const fmt = yield* pick('number_format');
    if (fmt !== null) {
      return new StringModel(env._formatNumber(
        yield* callOp('getAsNumber', target, 'getAsNumber'), undefined, fmt));
    }
    return new StringModel(yield* env.coerceToString(target, ' with ?string'));
  }
  if (target && typeof target.getAsBoolean === 'function') {
    const fmt = yield* pick('boolean_format');
    if (fmt !== null) {
      return new StringModel(env._formatBoolean(yield* callOp('getAsBoolean', target, 'getAsBoolean'), fmt));
    }
    return new StringModel(yield* env.coerceToString(target, ' with ?string'));
  }
  if (isScalarModel(target)) {
    const fmt = yield* pick('string_format');
    if (fmt !== null) {
      const bi = getBuiltIn(fmt);
      if (bi === null) throw new UnsupportedFeatureException(`Unknown string format built-in: "${fmt}".`);
      return yield* bi.impl(target, null, env);
    }
    return target;
  }
  return new StringModel(yield* env.coerceToString(target, ' with ?string'));
}

// <- dateBI / timeBI / dateTimeBI: change the date-type used by formatting
// (parsing strings into dates is not ported; see UPSTREAM.md).
/**
 * @param {string} name - built-in name
 * @param {number} dateType - DATE_TYPES member
 * @returns {void}
 */
function asType(name, dateType) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
  * impl(target, args, env) {
      if (!isDateModel(target)) {
        throw new NonDateException(
          `Can't apply the ?${name} built-in to a value of type ${env.typeLabel(target)}`);
      }
      return new DateModel(yield* callOp('getAsDate', target, 'getAsDate'), dateType);
    },
  });
}

asType('date', DATE_TYPES.DATE);
asType('time', DATE_TYPES.TIME);
asType('datetime', DATE_TYPES.DATE_TIME);

// <- isoBI family (2.3.36). Two shapes:
//  - iso / iso_nz / iso_ms / iso_ms_nz / iso_m / iso_m_nz / iso_h / iso_h_nz:
//    a METHOD taking exactly one time-zone argument (bare ?iso is the method).
//  - iso_utc* / iso_local* (with _h/_m/_ms/_nz/_fz variants): plain strings.
// IANA named zones are resolved DST-aware via Intl (see parseZoneOffsetMinutes).
const ISO_METHOD_NAMES = ['iso', 'iso_nz', 'iso_ms', 'iso_ms_nz', 'iso_m', 'iso_m_nz', 'iso_h', 'iso_h_nz'];
const ISO_STRING_NAMES = [
  'iso_utc', 'iso_utc_fz', 'iso_utc_nz', 'iso_utc_ms', 'iso_utc_ms_nz',
  'iso_utc_m', 'iso_utc_m_nz', 'iso_utc_h', 'iso_utc_h_nz',
  'iso_local', 'iso_local_nz', 'iso_local_ms', 'iso_local_ms_nz',
  'iso_local_m', 'iso_local_m_nz', 'iso_local_h', 'iso_local_h_nz',
];

/**
 * @param {import('../model/templateModel.js').TemplateModel} target
 * @param {import('../environment.js').Environment} env
 * @param {string} name
 * @returns {number} the effective date-type
 */
function isoKind(target, env, name) {
  if (!isDateModel(target)) {
    throw new NonDateException(
      `Can't apply the ?${name} built-in to a value of type ${env.typeLabel(target)}`);
  }
  const dt = target.dateType === undefined ? DATE_TYPES.NONE : target.dateType;
  return dt === DATE_TYPES.NONE ? DATE_TYPES.DATE_TIME : dt;
}

/**
 * @param {string} name - built-in name (also the ISO format string)
 * @returns {void}
 */
function registerIsoMethod(name) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
    * impl(target, args, env) {
      const kind = isoKind(target, env, name);
      return new BuiltinArgMethod(name, 1, 1, function* (e, a) {
        const tzMin = parseZoneOffsetMinutes(a[0], target.getAsDate(), name);
        return new StringModel(
          formatIsoDate(target.getAsDate(), name, kind, tzMin, env._settings.timeZone));
      });
    },
  });
}

/**
 * @param {string} name - built-in name (also the ISO format string)
 * @returns {void}
 */
function registerIsoString(name) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
    * impl(target, args, env) {
      const kind = isoKind(target, env, name);
      return new StringModel(
        formatIsoDate(target.getAsDate(), name, kind, null, env._settings.timeZone));
    },
  });
}

/**
 * Resolve a ?iso(...) time-zone argument to fixed minutes east of UTC.
 * Offset-style values ("UTC", "GMT", "GMT+2", "UTC-05:00") are parsed directly;
 * IANA names ("Europe/Berlin") are resolved DST-aware for the given instant
 * via Intl (upstream uses java.util.TimeZone; "Z" is rejected like upstream).
 * @param {string} s @param {Date} date @param {string} name
 * @returns {number} minutes east of UTC
 */
function parseZoneOffsetMinutes(s, date, name) {
  if (typeof s !== 'string') {
    throw new NonStringException(
      `?${name}(...) argument #1: Expected a string time zone name, `
      + `but this has evaluated to ${typeof s}.`);
  }
  const m = /^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(s.trim())
    || (s.trim() === 'UTC' || s.trim() === 'GMT' ? ['x', '+', '0', '0'] : null)
    || (s.trim() === '' ? ['x', '+', '0', '0'] : null);
  if (m === null) {
    const asNamed = ianaZoneOffsetMinutes(s, date);
    if (asNamed !== null) return asNamed;
    // <- upstream class: _TemplateModelException (generic)
    throw new TemplateException(
      `The time zone string specified for ?${name}(...) `
      + `is not recognized as a valid time zone name: "${s}"`);
  }
  const sign = m[1] === '-' ? -1 : 1;
  const hh = parseInt(m[2], 10);
  const mm = m[3] !== undefined ? parseInt(m[3], 10) : 0;
  if (hh > 14 || mm > 59) {
    throw new InvalidFormatStringException(`Invalid time zone offset "${s}".`);
  }
  return sign * (hh * 60 + mm);
}

/**
 * DST-aware offset of an IANA zone id at the given instant, or null if the
 * string isn't a zone id Intl recognizes. "Z" is rejected upstream-style.
 * @param {string} s @param {Date} date @returns {number|null}
 */
function ianaZoneOffsetMinutes(s, date) {
  const id = s.trim();
  if (id === 'Z' || id === '') return null; // upstream rejects "Z" as a zone name
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: id, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'longOffset',
    });
  } catch (_e) {
    return null;
  }
  const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName');
  const v = part ? part.value : 'GMT'; // "GMT+02:00" / "GMT-05:00" / "GMT"
  const m = /^GMT(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

for (const n of ISO_METHOD_NAMES) registerIsoMethod(n);
for (const n of ISO_STRING_NAMES) registerIsoString(n);

// <- BuiltInsForDates type-testing built-ins.
const DATE_TYPE_TEST = {
  is_date_like: (t) => isDateModel(t),
  is_date_only: (t) => isDateModel(t) && t.dateType === DATE_TYPES.DATE,
  is_time: (t) => isDateModel(t) && t.dateType === DATE_TYPES.TIME,
  is_datetime: (t) => isDateModel(t) && t.dateType === DATE_TYPES.DATE_TIME,
  is_unknown_date_like: (t) => isDateModel(t)
    && (t.dateType === undefined || t.dateType === DATE_TYPES.NONE),
};
for (const [name, pred] of Object.entries(DATE_TYPE_TEST)) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
    * impl(target) {
      return new BooleanModel(pred(target));
    },
  });
}

// *_if_unknown: fix UNKNOWN date kind; the port's dates always have a known
// kind, so these are no-ops.
for (const name of ['date_if_unknown', 'time_if_unknown', 'datetime_if_unknown']) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} args - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {import('../model/templateModel.js').TemplateModel}
   */
    * impl(target, args, env) {
      if (!isDateModel(target)) {
        throw new NonDateException(
          `Can't apply the ?${name} built-in to a value of type ${env.typeLabel(target)}`);
      }
      return target;
    },
  });
}