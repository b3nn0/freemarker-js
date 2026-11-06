// Model interfaces ← freemarker.template.TemplateXxxModel (v1; M5 adds method/collection nodes).

/**
 * Marker base class of every TemplateModel (← freemarker.template.TemplateModel).
 * @typedef {import('./models.js').StringModel|import('./models.js').NumberModel|import('./models.js').BooleanModel|import('./models.js').DateModel|import('./models.js').SequenceModel|import('./models.js').HashModel|import('./models.js').MethodModel|TemplateModel} AnyModel
 */
export class TemplateModel {}

/** Anything convertible to a string. */
export class TemplateScalarModel extends TemplateModel {
  /** @returns {string} */
  getAsString() {
    throw new Error('getAsString() not implemented');
  }
}

/** Anything convertible to a number. */
export class TemplateNumberModel extends TemplateModel {
  /** @returns {number} */
  getAsNumber() {
    throw new Error('getAsNumber() not implemented');
  }
}

/** Anything convertible to a boolean. */
export class TemplateBooleanModel extends TemplateModel {
  /** @returns {boolean} */
  getAsBoolean() {
    throw new Error('getAsBoolean() not implemented');
  }
}

/** Anything convertible to a date/time value. */
export class TemplateDateModel extends TemplateModel {
  /** @returns {Date} */
  getAsDate() {
    throw new Error('getAsDate() not implemented');
  }
}

/** Index-accessible sequence of models. */
export class TemplateSequenceModel extends TemplateModel {
  /**
   * @param {number} i
   * @returns {TemplateModel|null} null when out of bounds
   */
  getByIndex(i) {
    throw new Error('getByIndex() not implemented');
  }

  /** @returns {number} */
  size() {
    throw new Error('size() not implemented');
  }
}

/** Key lookup of models. */
export class TemplateHashModel extends TemplateModel {
  /**
   * @param {string} key
   * @returns {TemplateModel|null} null when the key is missing
   */
  get(key) {
    throw new Error('get() not implemented');
  }
}

/** Hash whose keys are enumerable (?keys/?values). */
export class TemplateHashModelEx extends TemplateHashModel {
  /** @returns {string[]} */
  keys() {
    throw new Error('keys() not implemented');
  }
  /** @returns {TemplateModel[]|unknown[]} raw or model elements per implementation */
  values() {
    throw new Error('values() not implemented');
  }

  /** @returns {number} */
  size() {
    throw new Error('size() not implemented');
  }
}

/** Callable model. */
export class TemplateMethodModel extends TemplateModel {
  /**
   * @param {import('../environment.js').Environment} env
   * @param {unknown[]} args - plain (unwrapped) JS arguments
   * @returns {TemplateModel|unknown}
   */
  exec(env, args) {
    throw new Error('exec() not implemented');
  }
}
