import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedProblemNumbers } from './source-numbering.mjs';
const manifest = (titles, problems = titles.length) => ({meta:{listed:{titles,problems}}});
test('preserves the printed label of an individually archived question', () => {
  assert.deepEqual(expectedProblemNumbers(manifest(['2 · Motion of an Electric Dipole in a Magnetic Field']), 1), [2]);
  assert.deepEqual(expectedProblemNumbers(manifest(['4', '5']), 2), [4, 5]);
});
test('ambiguous or incomplete catalogue headings cannot override normal numbering', () => {
  for (const m of [undefined, manifest(['2 · Title'], 2), manifest(['2. A title']), manifest(['2023 contest']), manifest(['2','2']), manifest(['9007199254740993'])]) {
    const n = m?.meta.listed.titles.length ?? 2;
    assert.deepEqual(expectedProblemNumbers(m, n), Array.from({length:n},(_,i)=>i+1));
  }
  assert.deepEqual(expectedProblemNumbers(manifest(['3']), 2), [1,2]);
});
