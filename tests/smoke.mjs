// Smoke checks for solve.js: the headline csv-reader 1.0.0 semantics.
// Run with: node tests/smoke.mjs   (exits non-zero on the first failure)
import { run } from '../solve.js';

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}\n  actual:   ${a}\n  expected: ${e}`);
    process.exit(1);
  }
  console.log(`ok ${label}`);
}

eq(run({ text: 'a,b\n1,2\n', header: true }),
  { columns: ['a', 'b'], rows: [['1', '2']], errors: [] }, 'plain header + row');

eq(run({ text: 'a,b\n1\n2,3,4\n', header: true }),
  {
    columns: ['a', 'b'],
    rows: [['1', ''], ['2', '3']],
    errors: [
      { code: 'short_row', line: 2, row: 0, fields: 1 },
      { code: 'long_row', line: 3, row: 1, extra: ['4'] },
    ],
  }, 'short row padded, long row cut');

eq(run({ text: '"x\ny",z\r\n', header: false }),
  { columns: null, rows: [['x\ny', 'z']], errors: [] }, 'quoted LF and CRLF record end');

eq(run({ text: 'a\rb\n', header: false }),
  { columns: null, rows: [['ab']], errors: [{ code: 'stray_cr', line: 1, row: 0 }] }, 'stray CR dropped');

eq(run({ text: '"abc\n', header: false }),
  { columns: null, rows: [['"abc']], errors: [{ code: 'unterminated_quote', line: 1, row: 0 }] },
  'unterminated quote re-read as unquoted');

eq(run({ text: '\uFEFFa\n\n1\n', header: true }),
  { columns: ['a'], rows: [['1']], errors: [] }, 'BOM dropped, blank line is no record');

console.log('all smoke checks passed');
