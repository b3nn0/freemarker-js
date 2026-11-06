// <#setting name=value> ← PropertySetting (2.3.36). The value is evaluated and
// applied to the environment at render time (2.3 behavior; parse-time key
// validation only).

import { TemplateElement } from '../templateElement.js';

// ← PropertySetting.SETTING_NAMES (legacy-naming view; camelCase variants are
// accepted too when the parser's naming convention is camel).
export const SETTING_NAMES = [
  'boolean_format', 'c_format', 'classic_compatible', 'date_format', 'datetime_format',
  'locale', 'number_format', 'output_encoding', 'sql_date_and_time_time_zone',
  'time_format', 'time_zone', 'url_escaping_charset',
];

// ← the *_KEY_CAMEL_CASE twins (accepted regardless of the naming convention;
// see UPSTREAM.md).
export const CAMEL_SETTING_NAMES = [
  'booleanFormat', 'cFormat', 'classicCompatible', 'dateFormat', 'datetimeFormat',
  'locale', 'numberFormat', 'outputEncoding', 'sqlDateAndTimeTimeZone',
  'timeFormat', 'timeZone', 'urlEscapingCharset',
];

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
  execute(env) {
    const mval = this.value.evaluate(env);
    let strval;
    if (mval === null || mval === undefined) {
      strval = env.coerceToString(mval, ' for the #setting value'); // throws
    } else if (typeof mval.getAsString === 'function') {
      strval = mval.getAsString();
    } else if (typeof mval.getAsBoolean === 'function') {
      strval = mval.getAsBoolean() ? 'true' : 'false';
    } else if (typeof mval.getAsNumber === 'function') {
      strval = String(mval.getAsNumber());
    } else {
      strval = env.coerceToString(mval, ' for the #setting value');
    }
    env.setSetting(this.key, strval);
    return null;
  }

  /** @returns {string} */
  getCanonicalForm() {
    return `<#setting ${this.key}=${this.value.getCanonicalForm()}/>`;
  }
}
