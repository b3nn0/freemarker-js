// Error hierarchy mirroring upstream names; position fields are mandatory carriers.

/** Base of all port exceptions ← FreeMarkerException. */
export class FreeMarkerException extends Error {
  /** @param {string} [message] */
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Template parse error ← ParseException. */
export class ParseException extends FreeMarkerException {
  /**
   * @param {string} message
   * @param {{ templateName?: string|null, beginLine?: number, beginColumn?: number, endLine?: number, endColumn?: number }} [loc]
   */
  constructor(message, { templateName = null, beginLine = -1, beginColumn = -1, endLine = -1, endColumn = -1 } = {}) {
    super(message);
    this.templateName = templateName;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
  }
}

/** Runtime template error ← TemplateException. */
export class TemplateException extends FreeMarkerException {
  /**
   * @param {string} message
   * @param {{ templateName?: string|null, beginLine?: number, beginColumn?: number, errorStackTrace?: string|null }} [loc]
   */
  constructor(message, { templateName = null, beginLine = -1, beginColumn = -1, errorStackTrace = null } = {}) {
    super(message);
    this.templateName = templateName;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.errorStackTrace = errorStackTrace;
  }

  /**
   * Attaches template location + FTL stack trace; chainable, built at throw sites.
   * @param {string|null} templateName
   * @param {number} beginLine
   * @param {number} beginColumn
   * @param {string|null} errorStackTrace
   * @returns {this}
   */
  withLocation(templateName, beginLine, beginColumn, errorStackTrace) {
    this.templateName = templateName;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.errorStackTrace = errorStackTrace;
    return this;
  }
}

/** Value is null/missing ← InvalidReferenceException. */
export class InvalidReferenceException extends TemplateException {}
/** Identifier has no value ← UnassignedVariableException. */
export class UnassignedVariableException extends InvalidReferenceException {}
/** Unknown hash property ← InvalidPropertyException. */
export class InvalidPropertyException extends InvalidReferenceException {}

/** Expected string ← NonStringException. */
export class NonStringException extends TemplateException {}
/** Expected hash ← NonHashException. */
export class NonHashException extends TemplateException {}
/** Expected extended hash ← NonExtendedHashException. */
export class NonExtendedHashException extends NonHashException {}
/** Expected sequence/collection ← NonSequenceOrCollectionException. */
export class NonSequenceOrCollectionException extends TemplateException {}
/** Expected sequence ← NonSequenceException. */
export class NonSequenceException extends NonSequenceOrCollectionException {}
/** Expected boolean ← NonBooleanException. */
export class NonBooleanException extends TemplateException {}
/** Expected number ← NonNumericalException. */
export class NonNumericalException extends TemplateException {}
/** Expected method ← NonMethodException. */
export class NonMethodException extends TemplateException {}
/** Expected date ← NonDateException. */
export class NonDateException extends TemplateException {}

/** Bad format string ← InvalidFormatStringException. */
export class InvalidFormatStringException extends TemplateException {}

/** #stop encountered ← StopException. */
export class StopException extends TemplateException {}

// Internal control-flow markers (← BreakException/ContinueException); not exported publicly.
/** Flow: #break ← BreakInstruction. */
export class BreakInstructionException extends TemplateException {}
/** Flow: #continue ← ContinueInstruction. */
export class ContinueInstructionException extends TemplateException {}
/** Flow: #return ← ReturnInstruction. */
export class ReturnInstructionException extends TemplateException {
  // ← ReturnInstructionException: internal #return marker, carries the returned value.
  /**
   * @param {Object|null} [value] - the model returned by #return (null when valueless)
   */
  constructor(value) {
    super('return-marker');
    this.value = value ?? null;
  }
}
/** Not supported by this port ← UnsupportedFeatureException. */
export class UnsupportedFeatureException extends FreeMarkerException {}
// ← freemarker.template.UnregisteredOutputFormatException
/** Unknown output format name ← UnregisteredOutputFormatException. */
export class UnregisteredOutputFormatException extends FreeMarkerException {}
// ← freemarker.template.InvalidSettingException
/** Unknown/invalid #setting ← InvalidSettingException. */
export class InvalidSettingException extends TemplateException {}
/** Internal port bug ← BugException. */
export class BugException extends FreeMarkerException {}

// ← javacc TokenMgrError: lexer-level failure, wrapped into ParseException at parse time.
/** Lexer-level failure ← javacc TokenMgrError. */
export class TokenMgrError extends Error {
  /**
   * @param {string} message
   * @param {number} [beginLine]
   * @param {number} [beginColumn]
   * @param {number} [endLine]
   * @param {number} [endColumn]
   */
  constructor(message, beginLine = -1, beginColumn = -1, endLine = -1, endColumn = -1) {
    super(message);
    this.name = this.constructor.name;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
  }
}
