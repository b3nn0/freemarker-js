// Model interfaces ← freemarker.template.TemplateXxxModel (v1; M5 adds method/collection nodes).

export class TemplateModel {}

export class TemplateScalarModel extends TemplateModel {
  getAsString() {
    throw new Error('getAsString() not implemented');
  }
}

export class TemplateNumberModel extends TemplateModel {
  getAsNumber() {
    throw new Error('getAsNumber() not implemented');
  }
}

export class TemplateBooleanModel extends TemplateModel {
  getAsBoolean() {
    throw new Error('getAsBoolean() not implemented');
  }
}

export class TemplateDateModel extends TemplateModel {
  getAsDate() {
    throw new Error('getAsDate() not implemented');
  }
}

export class TemplateSequenceModel extends TemplateModel {
  getByIndex(i) {
    throw new Error('getByIndex() not implemented');
  }
  size() {
    throw new Error('size() not implemented');
  }
}

export class TemplateHashModel extends TemplateModel {
  get(key) {
    throw new Error('get() not implemented');
  }
}

export class TemplateHashModelEx extends TemplateHashModel {
  keys() {
    throw new Error('keys() not implemented');
  }
  values() {
    throw new Error('values() not implemented');
  }
  size() {
    throw new Error('size() not implemented');
  }
}

export class TemplateMethodModel extends TemplateModel {
  exec(env, args) {
    throw new Error('exec() not implemented');
  }
}
