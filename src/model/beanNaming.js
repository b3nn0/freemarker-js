// JavaBeans reader naming: a getFoo/isFoo member standing for the property "foo"
// <- freemarker.ext.beans._MethodUtil.getBeanPropertyNameFromReaderMethodName plus the
// property entries of ClassIntrospector's introspection map. Upstream builds these names
// once per class (introspection cache); the port derives them per access (HashModel.get
// miss path), so a data model that grows members is never behind a stale cache.

/**
 * Java's Character.isUpperCase without the dependency: a character that is its own
 * upper-case form but is not already lower-case, so letters count and digits/symbols
 * and already-uppercase accents do not.
 * @param {string} ch - single character
 * @returns {boolean}
 */
function isUpperCaseChar(ch) {
  return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

/**
 * The JavaBeans property name a reader method name stands for, or null when the member
 * name is not a reader name. Same rule as upstream: the "get" prefix always, the "is"
 * prefix only for boolean-returning methods there -- JS has no declared return type to
 * consult, so "is" names are accepted as-is (deviation, see UPSTREAM.md). A suffix
 * beginning with two upper-case characters is kept whole (getURL -> URL), otherwise the
 * first suffix character is lower-cased (getFoo -> foo, getaBc -> aBc, get_x -> _x); a
 * bare "get"/"is" name is not a reader.
 * @param {string} name - member name, e.g. 'getURL'
 * @returns {string|null} the property name it reads, or null
 */
export function beanPropertyNameFromReaderName(name) {
  const start = name.startsWith('get') ? 3 : name.startsWith('is') ? 2 : -1;
  if (start < 0 || start === name.length) return null;
  const suffix = name.slice(start);
  return suffix.length > 1 && isUpperCaseChar(suffix[0]) && isUpperCaseChar(suffix[1])
    ? suffix
    : suffix[0].toLowerCase() + suffix.slice(1);
}

/**
 * Member names that can stand for a requested property name, in lookup order: "get"
 * forms before "is" forms, the conventional upper-first form before the name as-is
 * (getFoo, getfoo, isFoo, isfoo for "foo"). A candidate is kept only when it derives
 * back to the requested name, which is what makes getURL the reader of URL and not of
 * uRL, and getaBc the reader of aBc and not of ABc.
 * @param {string} key - the requested property name
 * @returns {string[]} candidate reader member names (empty for an empty key)
 */
export function readerNameCandidates(key) {
  if (typeof key !== 'string' || key === '') return [];
  const out = [];
  const forms = [key[0].toUpperCase() + key.slice(1), key];
  for (const prefix of ['get', 'is']) {
    for (const form of forms) {
      const name = prefix + form;
      if (beanPropertyNameFromReaderName(name) !== key) continue;
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}
