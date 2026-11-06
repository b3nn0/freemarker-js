// Single source of truth for test files; also enforced against the fs by cli.mjs.
export const TEST_FILES = [
  './harness.selftest.test.js',
  './io/writer.test.js',
  './syntax/textBlock.test.js',
  './syntax/interpolationSyntax.test.js',
  './parser/tokenManager.test.js',
  './parser/lexerPositions.test.js',
];
