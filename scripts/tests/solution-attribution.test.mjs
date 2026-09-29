import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problemMdx, archiveNoteLeaks } from '../problems-to-site.mjs';

test('unsigned archive solutions have truthful labels without being called official', () => {
  const paper = { id: 'iao-2001-practical-alpha-ru', subject: 'astronomy', competition: 'IAO', year: 2001, lang: 'ru', source: { archiveKey: 'archive/question.jpg' }, solutionSource: { archiveKey: 'archive/handwritten.jpg' } };
  const problem = { id: paper.id + '-p7', number: '7', statement: 'Printed task.', solution: { attribution: 'archive', statement: 'Ръкописно решение от архива.', incomplete: true, incompleteReason: 'Подточка 7.9 липсва в ръкописа.' } };
  const mdx = problemMdx(paper, problem, { quality: 'reviewed', singlePass: true }, 'fixture.json');
  assert.match(mdx, /Покажи решението от архива/);
  assert.match(mdx, /· решение от архива:/);
  assert.doesNotMatch(mdx, /официалн/i);
  assert.deepEqual(archiveNoteLeaks(mdx), []);
});
