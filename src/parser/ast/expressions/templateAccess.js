// <- freemarker.core.BuiltInVariable .get_optional_template: a hash with the
// "exists" / "include" / "import" members describing a referenced template.
// Deviation: the port has no byte-array template loaders, so the "encoding"
// option is accepted (and validated) but the source is always a string.

import { HashModel, BooleanModel } from '../../../model/models.js';
import { TemplateModel } from '../../../model/templateModel.js';
import {
  isScalarModel, isBooleanModel, isHashModelEx,
} from '../../../model/capabilities.js';
import { callOp } from '../../../async.js';
import { TemplateException } from '../../../errors.js';
import { IncludeDirective } from '../directives/include.js';
import { ImportDirective } from '../directives/importDir.js';
import { StringLiteral, BooleanLiteral } from './literals.js';

/**
 * Evaluates ".getOptionalTemplate(name, options)" into the access hash.
 * @param {import('../../../environment.js').Environment} env
 * @param {import('./expression.js').Expression[]|null} args
 * @returns {Generator<unknown, HashModel, unknown>}
 */
export function* getOptionalTemplateValue(env, args) {
  if (args === null || args.length === 0) {
    throw new TemplateException(
      'Expected at least 1 argument for ".getOptionalTemplate", but got none '
      + '(0 arguments given).');
  }
  if (args.length > 2) {
    throw new TemplateException(
      `The ".getOptionalTemplate" special variable takes 2 arguments at most, but you `
      + `gave ${args.length} arguments.`);
  }
  const nameModel = yield* args[0].evaluate(env);
  if (!isScalarModel(nameModel)) {
    throw new TemplateException(
      `The argument #1 (the template name) of ".getOptionalTemplate" must be a string, `
      + `but it was a ${env.typeLabel(nameModel)}.`);
  }
  const name = yield* callOp('getAsString', nameModel, 'getAsString');

  let parseOpt = null;
  let encodingOpt = null;
  if (args.length >= 2) {
    const optModel = yield* args[1].evaluate(env);
    if (!isHashModelEx(optModel)) {
      throw new TemplateException(
        `The argument #2 (the options) of ".getOptionalTemplate" must be a hash, but it `
        + `was a ${env.typeLabel(optModel)}.`);
    }
    const keys = yield* callOp('keys', optModel, 'keys');
    for (const key of keys) {
      if (key !== 'parse' && key !== 'encoding') {
        throw new TemplateException(
          `Unrecognized option "${key}" in argument #2 of ".getOptionalTemplate"; the `
          + 'recognized options are "encoding" and "parse".');
      }
      const v = yield* callOp(`get "${key}"`, optModel, 'get', key);
      if (key === 'parse') {
        if (!isBooleanModel(v)) {
          throw new TemplateException(
            `The value of the "parse" option (argument #2) of ".getOptionalTemplate" must `
            + `be a boolean, but it was a ${env.typeLabel(v)}.`);
        }
        parseOpt = yield* callOp('getAsBoolean', v, 'getAsBoolean');
      } else {
        if (!isScalarModel(v)) {
          throw new TemplateException(
            `The value of the "encoding" option (argument #2) of ".getOptionalTemplate" `
            + `must be a string, but it was a ${env.typeLabel(v)}.`);
        }
        encodingOpt = yield* callOp('getAsString', v, 'getAsString');
      }
    }
  }

  // <- the access hash keeps the raw name; exists resolves against the CURRENT
  // template now, include/import resolve again at call time (JVM behavior).
  const resolvedName = env._resolveTemplateName(name);
  let exists;
  try {
    yield* env._resolveTemplateSource(resolvedName);
    exists = true;
  } catch (e) {
    if (!(e instanceof TemplateException)) throw e;
    exists = false;
  }

  const members = new Map([['exists', new BooleanModel(exists)]]);
  if (exists) {
    members.set('include', new TemplateAccessIncludeModel(name, parseOpt, encodingOpt));
    members.set('import', new TemplateAccessImportModel(name));
  }
  return new HashModel(members);
}

/** <@t.include /> <- TemplateAccessMethod(include): #include without parameters. */
class TemplateAccessIncludeModel extends TemplateModel {
  /** @param {string} name @param {boolean|null} parseOpt @param {string|null} encodingOpt */
  constructor(name, parseOpt, encodingOpt) {
    super();
    this.name = name;
    this.parseOpt = parseOpt;
    this.encodingOpt = encodingOpt; // accepted, not applied (string sources only)
    this.isMacroLike = true;
  }
  /**
   * @param {import('../../../environment.js').Environment} env
   * @param {{positionalArgs: unknown[]|null, namedArgs: Map<string, unknown>|null,
   *   bodyChildren: unknown[]|null, bodyParamNames: string[]|null}} opts
   * @returns {Generator<unknown, null, unknown>}
   */
  *invoke(env, opts) {
    if ((opts.positionalArgs !== null && opts.positionalArgs !== undefined
        && opts.positionalArgs.length > 0)
        || (opts.namedArgs !== null && opts.namedArgs !== undefined
        && opts.namedArgs.size > 0)) {
      throw new TemplateException(
        'The "include" member of the ".getOptionalTemplate" hash has no parameters.');
    }
    if (opts.bodyParamNames !== null && opts.bodyParamNames !== undefined
        && opts.bodyParamNames.length > 0) {
      throw new TemplateException(
        'The "include" member of the ".getOptionalTemplate" hash has no loop variables.');
    }
    if (opts.bodyChildren !== null && opts.bodyChildren !== undefined
        && opts.bodyChildren.length > 0) {
      throw new TemplateException(
        'The "include" member of the ".getOptionalTemplate" hash has no nested content.');
    }
    const d = new IncludeDirective(new StringLiteral(this.name),
      this.parseOpt === null ? null : new BooleanLiteral(this.parseOpt), null, null);
    yield* d.execute(env);
    return null;
  }
}

/** t.import() <- TemplateAccessMethod(import): returns the library namespace. */
class TemplateAccessImportModel extends TemplateModel {
  /** @param {string} name */
  constructor(name) {
    super();
    this.name = name;
  }
  /**
   * @param {import('../../../environment.js').Environment} env
   * @param {unknown[]} rawArgs - already unwrapped <- MethodCall
   * @returns {Generator<unknown, HashModel, unknown>}
   */
  *exec(env, rawArgs) {
    if (rawArgs.length > 0) {
      throw new TemplateException(
        'The "import" member of the ".getOptionalTemplate" hash has no parameters.');
    }
    const d = new ImportDirective(new StringLiteral(this.name), null, false);
    return yield* d._initNamespace(env, this.name);
  }
}
