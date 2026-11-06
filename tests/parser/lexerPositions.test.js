// Position bookkeeping: SimpleCharStream-equivalent 1-based line/column with tab expansion,
// CRLF and lone-CR line breaks.

import { describe, it, eq, throwsMatch } from '../harness.js';
import { TokenManager } from '../../src/parser/tokenManager.js';
import { TokenMgrError } from '../../src/errors.js';
import { Configuration } from '../../src/configuration.js';

function firstPositionOf(source, typeName, cfg = new Configuration()) {
  const tm = new TokenManager(source, cfg);
  for (;;) {
    const t = tm.nextToken();
    if (t.type.name === typeName) {
      return { begin: [t.beginLine, t.beginColumn], end: [t.endLine, t.endColumn] };
    }
    if (t.type.name === 'EOF') throw new Error(`token ${typeName} not found`);
  }
}

describe('lexer: positions', () => {
  it('columns are 1-based', () => {
    eq(firstPositionOf('abc${x}', 'DOLLAR_INTERPOLATION_OPENING'),
      { begin: [1, 4], end: [1, 5] });
  });

  it('tab expands to next multiple of tabSize', () => {
    const tm = new TokenManager('\t\tb', tabCfg(4));
    const ws = tm.nextToken();
    eq([ws.image, ws.beginColumn, ws.endColumn], ['\t\t', 1, 9]);
    const b = tm.nextToken();
    eq([b.image, b.beginColumn, b.endColumn], ['b', 9, 9]);
  });

  it('column after tabs is correct for following token', () => {
    const tm = new TokenManager('a\tb ${x}', tabCfg(8));
    tm.nextToken(); // a
    tm.nextToken(); // tab ws -> col 9
    const b = tm.nextToken();
    eq([b.beginLine, b.beginColumn, b.image], [1, 9, 'b']);
    tm.nextToken(); // space
    const open = tm.nextToken();
    eq([open.beginLine, open.beginColumn], [1, 11]);
  });

  it('CRLF counts as one line break', () => {
    eq(firstPositionOf('a\r\n${x}', 'DOLLAR_INTERPOLATION_OPENING'),
      { begin: [2, 1], end: [2, 2] });
  });

  it('lone CR counts as one line break', () => {
    eq(firstPositionOf('a\r${x}', 'DOLLAR_INTERPOLATION_OPENING'),
      { begin: [2, 1], end: [2, 2] });
  });

  it('lone LF counts as one line break', () => {
    eq(firstPositionOf('a\n${x}', 'DOLLAR_INTERPOLATION_OPENING'),
      { begin: [2, 1], end: [2, 2] });
  });

  it('positions survive tag rewind', () => {
    const tm = new TokenManager('a<#list x>y', new Configuration());
    tm.nextToken(); // a
    const list = tm.nextToken();
    eq([list.beginLine, list.beginColumn, list.endLine, list.endColumn], [1, 2, 1, 8]);
    const id = tm.nextToken();
    eq([id.beginColumn, id.endColumn], [9, 9]);
  });

  it('positions survive unknown-directive rewind', () => {
    const e = throwsMatch(() => {
      const tm = new TokenManager('x<#foo bar>y', new Configuration());
      tm.nextToken();
      tm.nextToken();
    }, TokenMgrError, ['Unknown directive: #foo']);
    eq([e.beginLine, e.beginColumn, e.endLine, e.endColumn], [1, 2, 1, 6]);
  });
});

function tabCfg(size) {
  const cfg = new Configuration();
  cfg.setTabSize(size);
  return cfg;
}
