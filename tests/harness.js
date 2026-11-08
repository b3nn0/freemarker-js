// Minimal zero-dependency test harness: describe/it + assertions + reporter.

const root = { name: '', children: [] };
let current = root;

export function describe(name, fn) {
  const suite = { name, children: [] };
  current.children.push(suite);
  const parent = current;
  current = suite;
  fn();
  current = parent;
}

export function it(name, fn) {
  current.children.push({ name, fn });
}

export function ok(cond, msg = 'expected truthy') {
  if (!cond) throw new Error(msg);
}

export function eq(actual, expected, msg = '') {
  if (!deepEqual(actual, expected)) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${show(expected)}, got ${show(actual)}`);
  }
}

export function snapshot(actual, expected, msg = '') {
  if (typeof actual !== 'string' || actual !== expected) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Runs fn, requires it to throw; optional error class and message substrings.
export function throwsMatch(fn, ErrorClass = null, substrings = []) {
  try {
    fn();
  } catch (e) {
    return checkError(e, ErrorClass, substrings);
  }
  throw new Error(`expected ${ErrorClass ? ErrorClass.name : 'an error'} to be thrown, but nothing was`);
}

// Same as throwsMatch but for rejected promises.
export async function rejectsMatch(promise, ErrorClass = null, substrings = []) {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (e) {
    return checkError(e, ErrorClass, substrings);
  }
  throw new Error(`expected ${ErrorClass ? ErrorClass.name : 'a rejection'} to be thrown, but resolved`);
}

function checkError(e, ErrorClass, substrings) {
  if (ErrorClass && !(e instanceof ErrorClass)) {
    throw new Error(
      `expected error instanceof ${ErrorClass.name}, got ${e && e.constructor && e.constructor.name}: ${e && e.message}`);
  }
  for (const s of substrings) {
    if (!String(e && e.message).includes(s)) {
      throw new Error(`error message ${show(e && e.message)} lacks substring ${JSON.stringify(s)}`);
    }
  }
  return e;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

function show(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

export async function run() {
  let pass = 0, fail = 0;
  const t0 = Date.now();
  const walk = async (suite, prefix) => {
    for (const c of suite.children) {
      const full = prefix ? `${prefix} > ${c.name}` : c.name;
      if (c.fn) {
        try {
          await c.fn();
          pass++;
          console.log(`ok - ${full}`);
        } catch (e) {
          fail++;
          console.log(`not ok - ${full}`);
          console.log(String(e && e.stack || e).split('\n').map(l => '  ' + l).join('\n'));
        }
      } else {
        console.log(`# ${full}`);
        await walk(c, full);
      }
    }
  };
  await walk(root, '');
  console.log(`# tests ${pass + fail}, pass ${pass}, fail ${fail}, ${Date.now() - t0}ms`);
  return { pass, fail };
}
