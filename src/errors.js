// Error hierarchy mirroring upstream names; position fields are mandatory carriers.

export class FreeMarkerException extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ParseException extends FreeMarkerException {
  constructor(message, { templateName = null, beginLine = -1, beginColumn = -1, endLine = -1, endColumn = -1 } = {}) {
    super(message);
    this.templateName = templateName;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
  }
}

export class TemplateException extends FreeMarkerException {
  constructor(message, { templateName = null, beginLine = -1, beginColumn = -1, errorStackTrace = null } = {}) {
    super(message);
    this.templateName = templateName;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.errorStackTrace = errorStackTrace;
  }

  // FTL stack frames ("freemarker-js://name#L>line>C"), built at throw sites.
  withLocation(templateName, beginLine, beginColumn, errorStackTrace) {
    this.templateName = templateName;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.errorStackTrace = errorStackTrace;
    return this;
  }
}

export class InvalidReferenceException extends TemplateException {}
export class UnassignedVariableException extends InvalidReferenceException {}
export class InvalidPropertyException extends InvalidReferenceException {}

export class NonStringException extends TemplateException {}
export class NonHashException extends TemplateException {}
export class NonExtendedHashException extends NonHashException {}
export class NonSequenceOrCollectionException extends TemplateException {}
export class NonSequenceException extends NonSequenceOrCollectionException {}
export class NonBooleanException extends TemplateException {}
export class NonNumericalException extends TemplateException {}
export class NonMethodException extends TemplateException {}
export class NonDateException extends TemplateException {}

export class InvalidFormatStringException extends TemplateException {}

export class StopException extends TemplateException {}

// Internal control-flow markers (← BreakException/ContinueException); not exported publicly.
export class BreakInstructionException extends TemplateException {}
export class ContinueInstructionException extends TemplateException {}
// ← ReturnInstructionException: internal #return marker, carries the returned value.
export class ReturnInstructionException extends TemplateException {
  constructor(value) {
    super('return-marker');
    this.value = value ?? null;
  }
}
export class UnsupportedFeatureException extends FreeMarkerException {}
export class BugException extends FreeMarkerException {}

// ← javacc TokenMgrError: lexer-level failure, wrapped into ParseException at parse time.
export class TokenMgrError extends Error {
  constructor(message, beginLine = -1, beginColumn = -1, endLine = -1, endColumn = -1) {
    super(message);
    this.name = this.constructor.name;
    this.beginLine = beginLine;
    this.beginColumn = beginColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
  }
}
