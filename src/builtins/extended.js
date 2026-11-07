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

// ?substring(from[, to]); negative indices count from the end (both clamped).
stringBI('substring', (s, a) => {
  const len = s.length;
  let from = intArg(a[0], 'from');
  let to = a.length > 1 ? intArg(a[1], 'to') : len;
  if (from < 0) from += len;
  if (to < 0) to += len;
  from = Math.min(Math.max(from, 0), len);
  to = Math.min(Math.max(to, 0), len);
  if (from > to) {
    throw new TemplateException('The "begin" argument can\'t be greater than the "end" argument.');
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
  return i < 0 ? s : s.slice(i + sep.length);
});
stringBI('keep_after_last', (s, a) => {
  const sep = String(a[0]);
  const i = s.lastIndexOf(sep);
  return i < 0 ? s : s.slice(i + sep.length);
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

// ?cn <- BuiltInsForStringsMisc cnBI ("capitalize new"), a cap_first alias.
registerBuiltIn('cn', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {Array<Object>|null} argExprs - unevaluated argument expressions
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, argExprs, env) {
    return yield* getBuiltIn('cap_first').impl(target, argExprs, env);
  },
});

// ASCII-only case mapping (Locale.ENGLISH patterns).
stringBI('lower_abc', (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)));
stringBI('upper_abc', (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32)));

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

// ?indent(addIndent = " ", lineLength = 80, firstLine = addIndent)
stringBI('indent', (s, a) => {
  const add = a.length > 0 ? String(a[0]) : ' ';
  const lineLength = a.length > 1 ? intArg(a[1], 'lineLength') : 80;
  const first = a.length > 2 ? String(a[2]) : add;
  const lines = s.split('\n');
  return lines.map((ln, i) => {
    if (i === 0) return ln.length + first.length > lineLength ? first + ln : ln;
    return ln.length === 0 ? ln : add + ln;
  }).join('\n');
});

// ?wrap(lineWidth = 80, addIdent = "", removeIdent = "")
stringBI('wrap', (s, a) => {
  const lineWidth = a.length > 0 ? intArg(a[0], 'lineWidth') : 80;
  const addIdent = a.length > 1 ? String(a[1]) : '';
  const removeIdent = a.length > 2 ? String(a[2]) : '';
  const out = [];
  for (const line of s.split('\n')) {
    let src = line.startsWith(removeIdent) ? line.slice(removeIdent.length) : line;
    let first = true;
    while (src.length > lineWidth) {
      let cut = src.lastIndexOf(' ', lineWidth);
      if (cut < 0) cut = src.indexOf(' ', lineWidth);
      if (cut < 0) cut = lineWidth - addIdent.length;
      out.push((first ? '' : addIdent) + src.slice(0, cut).replace(/\s+$/, ''));
      src = src.slice(cut).replace(/^\s+/, '');
      first = false;
    }
    out.push((first ? '' : addIdent) + src);
  }
  return out.join('\n');
});

// ?truncate variants (subset of DefaultTruncateBuiltinAlgorithm; see UPSTREAM.md).
registerBuiltIn('truncate', truncateBI('truncate', 'm'));
registerBuiltIn('truncate_c', truncateBI('truncate_c', 'c'));
registerBuiltIn('truncate_m', truncateBI('truncate_m', 'm'));
registerBuiltIn('truncate_w', truncateBI('truncate_w', 'w'));

/**
 * @param {string} name
 * @param {'c' | 'm' | 'w'} algo - char | smart | word
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
      return new BuiltinArgMethod(name, 1, 2, function* (e, a) {
        const max = intArg(a[0], 'maxLength');
        const wholeWords = a.length > 1 ? Boolean(a[1]) : algo === 'w';
        const marker = '\u2026'; // upstream default truncation marker
        if (s.length <= max) return new StringModel(s);
        let cut = Math.max(0, max - 1);
        if (wholeWords || algo === 'm' || algo === 'w') {
          const back = s.lastIndexOf(' ', cut);
          if (back > 0) cut = back;
        }
        return new StringModel(s.slice(0, cut).replace(/\s+$/, '') + marker);
      });
    },
  };
}

// ------------------------------------------------------------ sequences ----

// ?seq_last_index_of(v): last lenient-equal index, else null.
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
        const eq = yield* e.compare(items[i], needle, 'eq', null, {
          typeMismatchMeansNotEqual: true,
          leftNullReturnsFalse: true,
          rightNullReturnsFalse: true,
        });
        if (eq === 0) return new NumberModel(i);
      }
      return null;
    });
  },
});

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
    if (argExprs === null || argExprs.length !== 1) throw argCntError('chunk', argExprs === null ? 0 : argExprs.length, 1, 1);
    const m = yield* argExprs[0].evaluate(env);
    if (m === null || typeof m.getAsNumber !== 'function') {
      throw new TemplateException('The ?chunk size argument must be a number.');
    }
    const n = Math.floor(yield* callOp('getAsNumber', m, 'getAsNumber'));
    if (!(n >= 1)) {
      throw new TemplateException('The ?chunk size argument must be 1 or greater.');
    }
    const out = [];
    for (let i = 0; i < items.length; i += n) {
      out.push(new SequenceModel(items.slice(i, i + n)));
    }
    return new SequenceModel(out);
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

// is_indexable / is_enumerable / is_collection / is_collection_ex: capability
// checks over the port's model kinds (sequences and ranges are both indexable).
const capBI = {
  is_indexable: (t) => typeof t.getByIndex === 'function',
  is_enumerable: (t) => typeof t.getByIndex === 'function' || typeof t.getKeys === 'function',
  is_collection: (t) => typeof t.getByIndex === 'function',
  is_collection_ex: (t) => typeof t.getByIndex === 'function' && typeof t.size === 'function',
  is_hash_ex: (t) => typeof t.getKeys === 'function' || typeof t.getKeysAndValues === 'function',
};
for (const [name, pred] of Object.entries(capBI)) {
  if (name === 'is_hash_ex') continue; // already registered in misc.js
  registerBuiltIn(name, {
    acceptsMissing: true,
    /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @returns {Object}
   */
    * impl(target) {
      return target !== null && pred(target) ? BooleanModel.TRUE : BooleanModel.FALSE;
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
    if (ctx !== null && ctx.index !== undefined && ctx.size !== null) {
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

registerBuiltIn('boolean', {
  /**
   * @param {import('../model/templateModel.js').TemplateModel} target
   * @param {import('../environment.js').Environment} env
   * @returns {Object}
   */
  * impl(target, env) {
    if (typeof target.getAsBoolean === 'function') {
      return (yield* callOp('getAsBoolean', target, 'getAsBoolean'))
        ? BooleanModel.TRUE : BooleanModel.FALSE;
    }
    if (typeof target.getAsNumber === 'function') {
      return (yield* callOp('getAsNumber', target, 'getAsNumber')) !== 0
        ? BooleanModel.TRUE : BooleanModel.FALSE;
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
