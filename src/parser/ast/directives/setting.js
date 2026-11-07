// <#setting name=value> ← PropertySetting (2.3.36). The value is evaluated and
// applied to the environment at render time (2.3 behavior; parse-time key
// validation only).

import { TemplateElement } from '../templateElement.js';
import { callOp } from '../../../async.js';

// ← PropertySetting.SETTING_NAMES (legacy-naming view; camelCase variants are
// accepted too when the parser's naming convention is camel).
/** Allowed #setting keys (snake convention). @type {string[]} */
export const SETTING_NAMES = [
  'boolean_format', 'c_format', 'classic_compatible', 'date_format', 'datetime_format',
  'locale', 'number_format', 'output_encoding', 'sql_date_and_time_time_zone',
  'time_format', 'time_zone', 'url_escaping_charset',
];

// ← the *_KEY_CAMEL_CASE twins (accepted regardless of the naming convention;
// see UPSTREAM.md).
/** camelCase aliases accepted too. @type {string[]} */
export const CAMEL_SETTING_NAMES = [
  'booleanFormat', 'cFormat', 'classicCompatible', 'dateFormat', 'datetimeFormat',
  'locale', 'numberFormat', 'outputEncoding', 'sqlDateAndTimeTimeZone',
  'timeFormat', 'timeZone', 'urlEscapingCharset',
];

/** <#setting key=value> ← PropertySetting. */
export class PropertySetting extends TemplateElement {
  /**
   * @param {string} key - the setting name as written
   * @param {import('../expressions/expression.js').Expression} value - expression
   */
  constructor(key, value) {
    super();
    this.key = key;
    this.value = value;
  }

  /**
   * @param {import('../../../environment.js').Environment} env
   * @returns {null}
   */
  * execute(env) {
    const mval = yield* this.value.evaluate(env);
    let strval;
    if (mval === null || mval === undefined) {
      strval = yield* env.coerceToString(mval, ' for the #setting value'); // throws
    } else if (typeof mval.getAsString === 'function') {
      strval = yield* callOp('getAsString', mval, 'getAsString');
    } else if (typeof mval.getAsBoolean === 'function') {
      strval = (yield* callOp('getAsBoolean', mval, 'getAsBoolean')) ? 'true' : 'false';
    } else if (typeof mval.getAsNumber === 'function') {
      strval = String(yield* callOp('getAsNumber', mval, 'getAsNumber'));
    } else {
      strval = yield* env.coerceToString(mval, ' for the #setting value');
    }
    env.setSetting(this.key, strval);
    return null;
  }

  /** @returns {string} */
  getCanonicalForm() {
    return `<#setting ${this.key}=${this.value.getCanonicalForm()}/>`;
  }
}
