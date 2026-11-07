// Basic string built-ins <- freemarker.core.BuiltInsForStringsBasic (2.3.36).
// Arg-taking ones evaluate to a method model (the BIMethod pattern); the parser
// leaves the "(args)" to MethodCall, matching upstream.

import { registerBuiltIn } from './registry.js';
import { BuiltinArgMethod, stringMethodArg } from './common.js';
import { StringModel, NumberModel, SequenceModel, BooleanModel } from '../model/models.js';
import { NonNumericalException, TemplateException } from '../errors.js';
import { awaitOp } from '../async.js';

/** @type {import('../model/models.js').BooleanModel} */
const BoolTrue = BooleanModel.TRUE;
/** @type {import('../model/models.js').BooleanModel} */
const BoolFalse = BooleanModel.FALSE;

// Java String.trim equivalent: strips chars <= U+0020 at both ends (JS trim also
// strips NBSP etc. -- deviation noted in UPSTREAM.md).
/**
 * @param {string} s
 * @returns {string} it without leading/trailing U+0020-and-below characters
 */
function javaTrim(s) {
  let b = 0;
  let e = s.length;
  while (b < e && s.charCodeAt(b) <= 0x20) b++;
  while (e > b && s.charCodeAt(e - 1) <= 0x20) e--;
  return s.slice(b, e);
}

// StringUtil.capitalize: first char of each blank-delimited word uppercased,
// rest lowercased; the delimiters are " \t\r\n".
/**
 * @param {string} s
 * @returns {string} every blank-delimited word capitalized (rest lowercased)
 */
function capitalize(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === ' ' || s[i] === '\t' || s[i] === '\r' || s[i] === '\n') {
      out += s[i++];
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== ' ' && s[j] !== '\t' && s[j] !== '\r' && s[j] !== '\n') j++;
    out += s[i].toUpperCase() + s.slice(i + 1, j).toLowerCase();
    i = j;
  }
  return out;
}

// Target must be a string <- BuiltInForString.getTargetString.
/**
 * @param {import('../model/templateModel.js').TemplateModel} target
 * @param {import('../environment.js').Environment} env
 * @param {string} key
 * @returns {string} the target coerced to a string
 */
function* targetString(target, env, key) {
  return yield* env.coerceToString(target, ` for the "?${key}" built-in`);
}

// A method-model built-in whose first job is string coercion of the target.
/**
 * @param {import('../model/templateModel.js').TemplateModel} target
 * @param {import('../environment.js').Environment} env
 * @param {string} key
 * @param {number} minArgs
 * @param {number} maxArgs
 * @param {(env: Object, s: string, args: unknown[]) => Object} fn
 * @returns {import('./common.js').BuiltinArgMethod}
 */
function* methodOnString(target, env, key, minArgs, maxArgs, fn) {
  const s = yield* targetString(target, env, key);
  return new BuiltinArgMethod(key, minArgs, maxArgs, (e, a) => fn(e, s, a));
}

// <- getNumberMethodArg: the argument must be a number.
/**
 * @param {unknown} v - unwrapped method argument
 * @param {import('../environment.js').Environment} env
 * @param {number} idx - 0-based argument index (for the message)
 * @returns {number}
 */
function numberMethodArg(v, env, idx) {
  const m = env.wrap(v);
  if (m instanceof NumberModel) return m.getAsNumber();
  throw new NonNumericalException(
    `The argument at position ${idx + 1} of the built-in method must be a number, `
    + `but it is a ${env.typeLabel(m)}.`);
}

registerBuiltIn('length', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return new NumberModel((yield* targetString(target, env, 'length')).length);
  },
});

registerBuiltIn('upper_case', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return new StringModel((yield* targetString(target, env, 'upper_case')).toUpperCase());
  },
});

registerBuiltIn('lower_case', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return new StringModel((yield* targetString(target, env, 'lower_case')).toLowerCase());
  },
});

registerBuiltIn('trim', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return new StringModel(javaTrim(yield* targetString(target, env, 'trim')));
  },
});

registerBuiltIn('cap_first', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    const s = yield* targetString(target, env, 'cap_first');
    let i = 0;
    while (i < s.length && s.charCodeAt(i) <= 0x20) i++;
    if (i >= s.length) return new StringModel(s);
    return new StringModel(s.slice(0, i) + s[i].toUpperCase() + s.slice(i + 1));
  },
});

registerBuiltIn('capitalize', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return new StringModel(capitalize(yield* targetString(target, env, 'capitalize')));
  },
});

registerBuiltIn('chop_linebreak', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    // <- StringUtil.chomp
    const s = yield* targetString(target, env, 'chop_linebreak');
    if (s.endsWith('\r\n')) return new StringModel(s.slice(0, -2));
    if (s.endsWith('\r') || s.endsWith('\n')) return new StringModel(s.slice(0, -1));
    return new StringModel(s);
  },
});

registerBuiltIn('contains', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return yield* methodOnString(target, env, 'contains', 1, 1,
      (e, s, a) => (s.includes(stringMethodArg(a[0], e)) ? BoolTrue : BoolFalse));
  },
});

registerBuiltIn('starts_with', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return yield* methodOnString(target, env, 'starts_with', 1, 1,
      (e, s, a) => (s.startsWith(stringMethodArg(a[0], e)) ? BoolTrue : BoolFalse));
  },
});

registerBuiltIn('ends_with', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return yield* methodOnString(target, env, 'ends_with', 1, 1,
      (e, s, a) => (s.endsWith(stringMethodArg(a[0], e)) ? BoolTrue : BoolFalse));
  },
});

registerBuiltIn('index_of', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return yield* methodOnString(target, env, 'index_of', 1, 2, (e, s, a) => {
      const from = a.length > 1 ? Math.trunc(numberMethodArg(a[1], e, 1)) : 0;
      return new NumberModel(s.indexOf(stringMethodArg(a[0], e), from));
    });
  },
});

registerBuiltIn('last_index_of', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return yield* methodOnString(target, env, 'last_index_of', 1, 2, (e, s, a) => {
      const from = a.length > 1 ? Math.trunc(numberMethodArg(a[1], e, 1)) : s.length;
      return new NumberModel(s.lastIndexOf(stringMethodArg(a[0], e), from));
    });
  },
});

registerBuiltIn('split', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return yield* methodOnString(target, env, 'split', 1, 1, (e, s, a) => {
      const sep = stringMethodArg(a[0], e);
      const pieces = sep === '' ? Array.from(s) : s.split(sep);
      return new SequenceModel(pieces.map((p) => new StringModel(p)));
    });
  },
});

// ?word_list <- stringWordList: whitespace split (java split("\\s") minus
// the empty leading token); empty string -> zero words.
registerBuiltIn('word_list', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    const s = yield* targetString(target, env, 'word_list');
    const trimmed = s.trim();
    const pieces = trimmed === '' ? [] : (s === trimmed ? [s] : trimmed.split(/\s+/));
    return new SequenceModel(pieces.map((p) => new StringModel(p)));
  },
});

// 2.3.36 literal (non-regex) replace of every occurrence <- replaceBI.
registerBuiltIn('replace', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return yield* methodOnString(target, env, 'replace', 2, 2, (e, s, a) => {
      const from = stringMethodArg(a[0], e);
      const to = stringMethodArg(a[1], e);
      let out = '';
      let i = 0;
      for (;;) {
        const j = s.indexOf(from, i);
        if (j === -1) {
          out += s.slice(i);
          break;
        }
        out += s.slice(i, j) + to;
        i = j + from.length;
      }
      return new StringModel(out);
    });
  },
});

// <- padBI.BIMethod: filling may be multi-char; repeated and truncated to width.
/**
 * @param {string} s
 * @param {number} width - desired total width
 * @param {string} fill - repeating filler
 * @returns {string} the padding to add (empty when no padding is needed)
 */
function pad(s, width, fill) {
  if (width <= s.length) return '';
  if (fill === '') {
    throw new TemplateException(
      'The second argument of the padding built-in can\'t be an empty string, as the string needs padding.');
  }
  const need = width - s.length;
  let padStr = '';
  while (padStr.length < need) padStr += fill;
  return padStr.slice(0, need);
}

registerBuiltIn('left_pad', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return yield* methodOnString(target, env, 'left_pad', 1, 2, (e, s, a) => {
      const fill = a.length > 1 ? stringMethodArg(a[1], e) : ' ';
      return new StringModel(pad(s, Math.trunc(numberMethodArg(a[0], e, 0)), fill) + s);
    });
  },
});

registerBuiltIn('right_pad', {
  /**
     * @param {import('../model/templateModel.js').TemplateModel} target
     * @param {Array<Object>|null} args - unevaluated argument expressions
     * @param {import('../environment.js').Environment} env
     * @returns {import('../model/templateModel.js').TemplateModel}
     */
  * impl(target, args, env) {
    return yield* methodOnString(target, env, 'right_pad', 1, 2, (e, s, a) => {
      const fill = a.length > 1 ? stringMethodArg(a[1], e) : ' ';
      return new StringModel(s + pad(s, Math.trunc(numberMethodArg(a[0], e, 0)), fill));
    });
  },
});
