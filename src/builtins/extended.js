// The remaining portable built-ins <- BuiltInsForStringsBasic/Misc/Advanced,
// BuiltInsForSequences, BuiltInsForLoopVariables, BuiltInsForExistenceHandling,
// BuiltInsForMarkupVisibility, BuiltInsForNumericals and BuiltInsForUsers (2.3.36).
// XML/node/transform/output-format built-ins (new, node_*, rtf, esc, ...) stay
// out of scope (see UPSTREAM.md).

import { registerBuiltIn, getBuiltIn } from './registry.js';
import { BuiltinArgMethod, sequenceItems, nonSequenceError, argCntError } from './common.js';
import { StringModel, NumberModel, BooleanModel, SequenceModel } from '../model/models.js';
import {
  TemplateException, InvalidReferenceException, NonStringException, NonNumericalException,
} from '../errors.js';
import { callOp } from '../async.js';
import { cNumberFormat, cStringLiteral } from '../format/cFormat.js';

// -------------------------------------------------------------- strings ----

/**
 * @param {import('../model/templateModel.js').TemplateModel} target
 * @param {import('../environment.js').Environment} env
 * @param {string} name - built-in name for the message
 * @returns {Generator<unknown, string, unknown>}
 */
function* str(target, env, name) {
  if (typeof target.getAsString !== 'function') {
    throw new NonStringException(`Can't apply the ?${name} built-in to a non-string value.`);
  }
  return yield* callOp('getAsString', target, 'getAsString');
}

/**
 * @param {string} name - built-in name
 * @param {(s: string, args: unknown[], env: import('../environment.js').Environment) => unknown} fn
 *   result may be a string (wrapped) or a model
 * @returns {void}
 */
function stringBI(name, fn) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
    * impl(target, argExprs, env) {
      const s = yield* str(target, env, name);
      const wrap = (r) => (typeof r === 'string' ? new StringModel(r)
        : typeof r === 'number' ? new NumberModel(r)
          : r instanceof SequenceModel || r === null || r instanceof Object ? r
            : new StringModel(String(r)));
      if (fn.length >= 2) {
        return new BuiltinArgMethod(name, 1, Infinity, function* (e, a) {
          return wrap(yield* call1(fn, s, a, e));
        });
      }
      return wrap(yield* call1(fn, s, [], env));
    },
  });
}

/**
 * @param {Function} fn
 * @param {string} s
 * @param {unknown[]} a
 * @param {import('../environment.js').Environment} e
 * @returns {Generator<unknown, unknown, unknown>}
 */
function* call1(fn, s, a, e) {
  return fn(s, a, e);
}

// ?substring(from[, to]) <- _CoreStringUtils.SubstringBI: strict 0..len index checks.
stringBI('substring', (s, a) => {
  const len = s.length;
  const check = (v, n) => {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new TemplateException(`?substring(...) argument #${n} had invalid value: it must be an integer.`);
    }
    if (v < 0) {
      throw new TemplateException(
        `?substring(...) argument #${n} had invalid value: The index must be at least 0, but was ${v}.`);
    }
    if (v > len) {
      throw new TemplateException(
        `?substring(...) argument #${n} had invalid value: The index mustn't be greater `
        + `than the length of the string, ${len}, but it was ${v}.`);
    }
    return v;
  };
  const from = check(a[0], 1);
  const to = a.length > 1 ? check(a[1], 2) : len;
  if (from > to) {
    throw new TemplateException(
      '?substring(...) argument #1 had invalid value: '
      + "The first index mustn't be greater than the second index.");
  }
  return s.slice(from, to);
});

function intArg(v, name) {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new TemplateException(`The "${name}" argument of the built-in must be an integer.`);
  }
  return v;
}

// ?keep_after(sep) / ?keep_after_last(sep): everything after (first|last) sep;
// the whole string when sep is absent.
stringBI('keep_after', (s, a) => {
  const sep = String(a[0]);
  const i = s.indexOf(sep);
  return i < 0 ? '' : s.slice(i + sep.length);
});
stringBI('keep_after_last', (s, a) => {
  const sep = String(a[0]);
  const i = s.lastIndexOf(sep);
  return i < 0 ? '' : s.slice(i + sep.length);
});
stringBI('keep_before', (s, a) => {
  const sep = String(a[0]);
  const i = s.indexOf(sep);
  return i < 0 ? s : s.slice(0, i);
});
stringBI('keep_before_last', (s, a) => {
  const sep = String(a[0]);
  const i = s.lastIndexOf(sep);
  return i < 0 ? s : s.slice(0, i);
});

// ?remove_beginning(s) / ?remove_ending(s): strip only when present.
stringBI('remove_beginning', (s, a) => (s.startsWith(String(a[0])) ? s.slice(String(a[0]).length) : s));
stringBI('remove_ending', (s, a) => (s.endsWith(String(a[0])) ? s.slice(0, s.length - String(a[0]).length) : s));

// ?ensure_starts_with(s) / ?ensure_ends_with(s): add only when missing.
stringBI('ensure_starts_with', (s, a) => (s.startsWith(String(a[0])) ? s : String(a[0]) + s));
stringBI('ensure_ends_with', (s, a) => (s.endsWith(String(a[0])) ? s : s + String(a[0])));

stringBI('uncap_first', (s) => {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) <= 0x20) i++;
  if (i >= s.length) return s;
  return s.slice(0, i) + s[i].toLowerCase() + s.slice(i + 1);
});

// ?cn <- BuiltInsForMultipleTypes.cnBI (C/Java literal quoting of scalars).
registerBuiltIn('cn', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, argExprs, env) {
    return cLike(target, env, 'cn');
  },
});

/**
 * @param {import('../model/templateModel.js').TemplateModel|null} target
 * @param {import('../environment.js').Environment} env
 * @param {string} name - built-in name for messages
 * @returns {Generator<unknown, Object|null, unknown>}
 */
function* cLike(target, env, name) {
  if (target === null || target === undefined) return null;
  if (typeof target.getAsNumber === 'function') {
    return new StringModel(cNumberFormat(yield* callOp('getAsNumber', target, 'getAsNumber')));
  }
  if (typeof target.getAsBoolean === 'function') {
    return new StringModel(
      (yield* callOp('getAsBoolean', target, 'getAsBoolean')) ? 'true' : 'false');
  }
  if (typeof target.getAsString === 'function') {
    return new StringModel(cStringLiteral(yield* callOp('getAsString', target, 'getAsString')));
  }
  throw new NonStringException(
    `For "?${name}" left-hand operand: Expected a number, boolean, or string, `
    + `but this has evaluated to ${env.typeLabel(target)}`);
}

// ?lower_abc / ?upper_abc <- BuiltInsForNumbers.abcBI: number to spreadsheet-style
// column letters (1 -> a, 26 -> z, 27 -> aa).
for (const [name, upper] of [['lower_abc', false], ['upper_abc', true]]) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
    * impl(target, argExprs, env) {
      if (typeof target.getAsNumber !== 'function') {
        throw new NonNumericalException(
          `For "?${name}" left-hand operand: Expected a number, `
          + `but this has evaluated to ${env.typeLabel(target)}`);
      }
      const v = yield* callOp('getAsNumber', target, 'getAsNumber');
      if (!Number.isInteger(v)) {
        throw new NonNumericalException(
          `The left side operand value isn't compatible with ?${name}: `
          + `Can't convert ${cNumberFormat(v)} to type Integer without loss.`);
      }
      if (v <= 0) {
        throw new NonNumericalException(
          `The left side operand of to ?${name} must be at least 1, but was ${v}.`);
      }
      const base = upper ? 65 : 97;
      let out = '';
      let n = v;
      while (n > 0) {
        const r = (n - 1) % 26;
        out = String.fromCharCode(base + r) + out;
        n = Math.floor((n - 1) / 26);
      }
      return new StringModel(out);
    },
  });
}

// Word/line splitting <- StringUtil.splitLines / splitWords.
stringBI('word_list', (s) => {
  const out = [];
  const m = s.split(/[ \t\r\n\f]+/);
  for (const p of m) if (p.length) out.push(new StringModel(p));
  return new SequenceModel(out);
});
stringBI('lines', (s) => {
  let src = s;
  if (src.endsWith('\r\n')) src = src.slice(0, -2);
  else if (src.endsWith('\n') || src.endsWith('\r')) src = src.slice(0, -1);
  const out = src.split(/\r\n|\r|\n/).map((p) => new StringModel(p));
  return new SequenceModel(out);
});

// ?dedent: removes the common leading whitespace of all non-blank lines.
stringBI('dedent', (s) => {
  const lines = s.split(/\r\n|\r|\n/);
  let common = null;
  for (const ln of lines) {
    if (/^\s*$/.test(ln)) continue;
    const ws = /^\s*/.exec(ln)[0].length;
    if (common === null || ws < common) common = ws;
  }
  if (common === null || common === 0) return s;
  return lines.map((ln) => ln.slice(Math.min(common, ln.length))).join('\n');
});

// ?indent(lineIndentString = " ", onlyForBlankLines = false)
stringBI('indent', (s, a) => {
  let add = ' ';
  if (a.length > 0) {
    if (typeof a[0] !== 'string') {
      throw new TemplateException(
        `?indent(...) expects a string as argument #1, but received ${typeName(a[0])}.`);
    }
    add = a[0];
  }
  let onlyBlank = false;
  if (a.length > 1) {
    if (typeof a[1] !== 'boolean') {
      throw new TemplateException(
        `?indent(...) expects a boolean as argument #2, but received ${typeName(a[1])}.`);
    }
    onlyBlank = a[1];
  }
  const lines = s.split(/\r\n|\r|\n/);
  if (onlyBlank) return lines.map((ln) => (ln.trim() === '' ? add + ln : ln)).join('\n');
  return lines.map((ln) => add + ln).join('\n');
});

// ?wrap(lineLength = 65): wraps only at spaces (long words are never split),
// and always terminates the result with a newline.
stringBI('wrap', (s, a) => {
  const width = a.length > 0 ? intArg(a[0], 'lineLength') : 65;
  const out = [];
  for (const line of s.split(/\r\n|\r|\n/)) {
    if (line.length === 0) {
      out.push('');
      continue;
    }
    let cur = null;
    for (const w of line.split(/ +/)) {
      if (cur === null) cur = w;
      else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
      else {
        out.push(cur);
        cur = w;
      }
    }
    out.push(cur);
  }
  return `${out.join('\n')}\n`;
});

function typeName(v) {
  if (typeof v === 'number') return 'a number';
  if (typeof v === 'boolean') return 'a boolean';
  if (typeof v === 'string') return 'a string';
  return 'a value';
}

// ?truncate variants <- DefaultTruncateBuiltinAlgorithm: the default marker is
// "[...]"; keep = maxLength - marker.length, whole-word variant keeps complete
// words only. (?truncate_m renders the markup terminator span.)
registerBuiltIn('truncate', truncateBI('truncate', 'c'));
registerBuiltIn('truncate_c', truncateBI('truncate_c', 'c'));
registerBuiltIn('truncate_m', truncateBI('truncate_m', 'm'));
registerBuiltIn('truncate_w', truncateBI('truncate_w', 'w'));

/**
 * @param {string} name
 * @param {'c' | 'm' | 'w'} algo - code-point | markup | whole-word
 * @returns {Object} BuiltInSpec
 */
function truncateBI(name, algo) {
  return {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
    * impl(target, argExprs, env) {
      const s = yield* str(target, env, name);
      return new BuiltinArgMethod(name, 1, 1, function* (e, a) {
        const max = intArg(a[0], 'maxLength');
        const markup = algo === 'm';
        const marker = markup ? '<span class=\'truncateTerminator\'>[&#8230;]</span>' : '[...]';
        const chars = Array.from(s);
        if (chars.length <= max) return new StringModel(s);
        const keep = Math.max(0, max - (markup ? 3 : 5));
        if (algo === 'w') {
          const words = s.match(/\S+/g) || [];
          const kept = [];
          let curLen = 0;
          for (const w of words) {
            const add = kept.length === 0 ? w.length : 1 + w.length;
            if (curLen + add <= keep) {
              kept.push(w);
              curLen += add;
            } else break;
          }
          return new StringModel(kept.join(' ') + marker);
        }
        return new StringModel(chars.slice(0, keep).join('') + marker);
      });
    },
  };
}

// ------------------------------------------------------------ sequences ----

// ?seq_last_index_of(v): last equal index, -1 when absent (safe equals:
// different types are simply unequal, <- EvalUtil.compare eq semantics).
registerBuiltIn('seq_last_index_of', {
  acceptsMissing: true,
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, argExprs, env) {
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('seq_last_index_of', target, env);
    return new BuiltinArgMethod('seq_last_index_of', 1, 1, function* (e, a) {
      const needle = e.wrap(a[0]);
      for (let i = items.length - 1; i >= 0; i--) {
        if (yield* safeEquals(e, items[i], needle)) return new NumberModel(i);
      }
      return new NumberModel(-1);
    });
  },
});

/**
 * @param {import('../environment.js').Environment} e
 * @param {Object} a @param {Object} b
 * @returns {Generator<unknown, boolean, unknown>}
 */
function* safeEquals(e, a, b) {
  try {
    return (yield* e.compare(a, b, 'eq', null, {
      typeMismatchMeansNotEqual: true,
      leftNullReturnsFalse: true,
      rightNullReturnsFalse: true,
    })) === 0;
  } catch (err) {
    return false;
  }
}

// ?chunk(size): groups of `size` items (last group may be smaller).
registerBuiltIn('chunk', {
  acceptsMissing: true,
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, argExprs, env) {
    const items = yield* sequenceItems(target);
    if (items === null) throw nonSequenceError('chunk', target, env);
    return new BuiltinArgMethod('chunk', 1, 1, function* (e, a) {
      if (typeof a[0] !== 'number' || !Number.isFinite(a[0]) || a[0] < 1) {
        throw new NonNumericalException(
          '?chunk(...) argument #1 had invalid value: it must be a number of 1 or greater.');
      }
      const n = Math.floor(a[0]);
      const out = [];
      for (let i = 0; i < items.length; i += n) {
        out.push(new SequenceModel(items.slice(i, i + n)));
      }
      return new SequenceModel(out);
    });
  },
});

// ?min / ?max <- BuiltInsForSequences minmaxBI: strict relational compare.
for (const name of ['min', 'max']) {
  registerBuiltIn(name, {
    acceptsMissing: true,
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
    * impl(target, argExprs, env) {
      const items = yield* sequenceItems(target);
      if (items === null) throw nonSequenceError(name, target, env);
      let best = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i] === null || items[i] === undefined) continue;
        if (best === null) {
          best = items[i];
          continue;
        }
        const cmp = yield* env.compare(best, items[i], name === 'min' ? 'lt' : 'gt',
          name === 'min' ? '<' : '>');
        if (name === 'min' ? cmp > 0 : cmp < 0) best = items[i];
      }
      return best;
    },
  });
}

// ---------------------------------------------------- loop variables -------

/**
 * @param {import('../environment.js').Environment} env
 * @param {string} name
 * @returns {{ index: number, size: number }}
 */
function loopInfo(env, name) {
  const ctx = env._iterStack.length ? env._iterStack[env._iterStack.length - 1] : null;
  if (ctx === null || ctx.index === undefined) {
    throw new InvalidReferenceException(
      `Can't get the loop index for the ?${name} built-in: `
      + 'this value wasn\'t produced by an #list iteration.');
  }
  return ctx;
}

const loopBI = {
  counter: (c) => new NumberModel(c.index + 1),
  index: (c) => new NumberModel(c.index),
  is_first: (c) => (c.index === 0 ? BooleanModel.TRUE : BooleanModel.FALSE),
  is_last: (c) => (c.index === c.size - 1 ? BooleanModel.TRUE : BooleanModel.FALSE),
  is_even_item: (c) => ((c.index + 1) % 2 === 0 ? BooleanModel.TRUE : BooleanModel.FALSE),
  is_odd_item: (c) => ((c.index + 1) % 2 === 1 ? BooleanModel.TRUE : BooleanModel.FALSE),
  item_parity: (c) => new StringModel((c.index + 1) % 2 === 1 ? 'odd' : 'even'),
  item_parity_cap: (c) => new StringModel((c.index + 1) % 2 === 1 ? 'Odd' : 'Even'),
};
for (const [name, fn] of Object.entries(loopBI)) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
    * impl(target, argExprs, env) {
      return fn(loopInfo(env, name));
    },
  });
}

// ?item_cycle(cycleItems...) : picks from the cycle by the loop index.
registerBuiltIn('item_cycle', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, argExprs, env) {
    if (argExprs === null) throw new TemplateException('The ?item_cycle built-in requires an argument.');
    const c = loopInfo(env, 'item_cycle');
    const arg = yield* argExprs[0].evaluate(env);
    let items = null;
    if (arg instanceof StringModel) {
      items = (yield* callOp('getAsString', arg, 'getAsString')).split('')
        .map((ch) => new StringModel(ch));
    } else {
      items = yield* sequenceItems(arg);
    }
    if (items === null || items.length === 0) {
      throw new TemplateException('The ?item_cycle argument must be a non-empty sequence (or string).');
    }
    return items[c.index % items.length];
  },
});

// ----------------------------------------------------- existence/type ------

// is_indexable / is_enumerable / is_collection / is_collection_ex <- the
// upstream instanceof checks; the port has no TemplateCollectionModel concept,
// so the collection checks are always false (documented deviation).
registerBuiltIn('is_indexable', {
  acceptsMissing: true,
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @returns {Object}
   */
  * impl(target) {
    return target instanceof SequenceModel ? BooleanModel.TRUE : BooleanModel.FALSE;
  },
});
registerBuiltIn('is_enumerable', {
  acceptsMissing: true,
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @returns {Object}
   */
  * impl(target) {
    return target instanceof SequenceModel ? BooleanModel.TRUE : BooleanModel.FALSE;
  },
});
for (const name of ['is_collection', 'is_collection_ex']) {
  registerBuiltIn(name, {
    acceptsMissing: true,
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @returns {Object}
   */
    * impl(target) {
      return BooleanModel.FALSE;
    },
  });
}

// ?exists: legacy alias of ?if_exists; ?has_next: iterator end check (for the
// port's materialized sequences this is an index bound check).
registerBuiltIn('exists', {
  acceptsMissing: true,
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @returns {Object}
   */
  * impl(target) {
    return target !== null && target !== undefined ? BooleanModel.TRUE : BooleanModel.FALSE;
  },
});
registerBuiltIn('has_next', {
  acceptsMissing: true,
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, argExprs, env) {
    const ctx = env._iterStack.length ? env._iterStack[env._iterStack.length - 1] : null;
    if (ctx !== null && ctx.index !== undefined && ctx.size != null) {
      return ctx.index + 1 < ctx.size ? BooleanModel.TRUE : BooleanModel.FALSE;
    }
    return BooleanModel.FALSE;
  },
});

// ?is_markup_output: the port has no output-format model, so markup is never
// known (documented deviation).
registerBuiltIn('is_markup_output', {
  acceptsMissing: true,
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @returns {Object}
   */
  * impl(target) {
    return BooleanModel.FALSE;
  },
});

// ------------------------------------------------------ numbers / casts ----

registerBuiltIn('number', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, env) {
    if (target instanceof NumberModel) return target;
    if (typeof target.getAsString === 'function') {
      const s = (yield* callOp('getAsString', target, 'getAsString')).trim();
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
        throw new NonNumericalException(`Can't parse this as a number: ${JSON.stringify(s)}.`);
      }
      return new NumberModel(parseFloat(s));
    }
    throw new NonNumericalException('This value can\'t be converted to a number.');
  },
});

// ?boolean <- BuiltInsForMultipleTypes: booleans pass through, other scalars
// are stringified and matched against the boolean_format pair (plus true/false).
registerBuiltIn('boolean', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, env) {
    if (target instanceof BooleanModel) return target;
    if (typeof target.getAsString === 'function') {
      const s = yield* callOp('getAsString', target, 'getAsString');
      if (s === 'true') return BooleanModel.TRUE;
      if (s === 'false') return BooleanModel.FALSE;
      const [yes, no] = env.getBooleanFormat();
      if (s === yes) return BooleanModel.TRUE;
      if (s === no) return BooleanModel.FALSE;
      throw new TemplateException(`Can't convert this string to boolean: ${JSON.stringify(s)}`);
    }
    throw new TemplateException(
      `Can't apply the ?boolean built-in to a value of type ${env.typeLabel(target)}`);
  },
});

for (const name of ['int', 'long', 'short', 'byte']) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
    * impl(target, env) {
      if (typeof target.getAsNumber !== 'function') {
        throw new NonNumericalException(`Can't apply the ?${name} built-in to a non-number value.`);
      }
      const v = Math.trunc(yield* callOp('getAsNumber', target, 'getAsNumber'));
      return new NumberModel(v);
    },
  });
}
for (const name of ['float', 'double']) {
  registerBuiltIn(name, {
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
    * impl(target, env) {
      if (typeof target.getAsNumber !== 'function') {
        throw new NonNumericalException(`Can't apply the ?${name} built-in to a non-number value.`);
      }
      return new NumberModel(yield* callOp('getAsNumber', target, 'getAsNumber'));
    },
  });
}

registerBuiltIn('is_nan', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @returns {Object}
   */
  * impl(target) {
    if (typeof target.getAsNumber !== 'function') return BooleanModel.FALSE;
    return Number.isNaN(target.getAsNumber()) ? BooleanModel.TRUE : BooleanModel.FALSE;
  },
});
registerBuiltIn('is_infinite', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @returns {Object}
   */
  * impl(target) {
    if (typeof target.getAsNumber !== 'function') return BooleanModel.FALSE;
    return !Number.isFinite(target.getAsNumber()) && !Number.isNaN(target.getAsNumber())
      ? BooleanModel.TRUE : BooleanModel.FALSE;
  },
});

// j_string: legacy alias (upstream deprecated it in 2.3.21; it kept the old
// JS quoting -- the port uses the js_string implementation, see UPSTREAM.md).
registerBuiltIn('j_string', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, argExprs, env) {
    return yield* getBuiltIn('js_string').impl(target, argExprs, env);
  },
});

// ?eval_json: parse a JSON string into the object model.
registerBuiltIn('eval_json', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, env) {
    const s = yield* str(target, env, 'eval_json');
    let v;
    try {
      v = JSON.parse(s);
    } catch (err) {
      throw new TemplateException(`Failed to parse the JSON string: ${err.message}`);
    }
    return env.wrap(v);
  },
});

function getBuiltInLazy(name) {
  // resolved at call time, after all registration modules have loaded
  return getBuiltIn(name);
}
