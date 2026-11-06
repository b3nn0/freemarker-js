// Control-flow directives ← freemarker.core BreakInstruction / ContinueInstruction.

import { TemplateElement } from '../templateElement.js';
import { BreakInstructionException, ContinueInstructionException } from '../../../errors.js';

export class BreakInstruction extends TemplateElement {
  execute() {
    throw new BreakInstructionException('#break');
  }
  getCanonicalForm() {
    return '<#break>';
  }
}

export class ContinueInstruction extends TemplateElement {
  execute() {
    throw new ContinueInstructionException('#continue');
  }
  getCanonicalForm() {
    return '<#continue>';
  }
}
