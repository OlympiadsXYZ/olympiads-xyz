// Synthetic source navigation/rendering fixtures. No original reading or publisher execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  solutionOriginalFor,
  problemMdx,
  problemInfo,
} from '../problems-to-site.mjs';
const source = { archiveKey: 'Химия/IChO/Volume1.pdf', pages: [81] };
const paper = () => ({
  id: 'fixture-experiment',
  subject: 'chemistry',
  competition: 'IChO',
  year: 1974,
  round: 'experiment',
  lang: 'en',
  source: structuredClone(source),
  solutionSource: structuredClone(source),
});
const problem = () => ({
  id: 'fixture-experiment-p1',
  number: 1,
  title: 'Fixture',
  statement: 'Synthetic prompt.',
  sourceSpans: [{ document: 'problems', page: 81 }],
  solution: {
    attribution: 'archive',
    incomplete: true,
    incompleteReason:
      'This compilation prints no key for this practical problem.',
  },
});
const render = (p, q) =>
  problemMdx(
    p,
    q,
    { quality: 'reviewed', singlePass: true },
    'synthetic-fixture.json'
  );
test('absent archive key never uses the shared question source/page in footer or compare data', () => {
  const p = paper(),
    q = problem(),
    mdx = render(p, q),
    info = problemInfo(p, q);
  assert.equal(solutionOriginalFor(p, q), null);
  assert(mdx.includes('<Warning title="Непълно решение">'));
  assert(mdx.includes(q.solution.incompleteReason));
  assert(mdx.includes('Оригинал в Архива:'));
  assert(!mdx.includes('· решение от архива:'));
  assert(!Object.hasOwn(info, 'solutionUrl'));
  assert(info.url.endsWith('#page=81'));
});
test('absent solution document stays absent even with a key note', () => {
  const p = paper(),
    q = problem();
  delete p.solutionSource;
  assert.equal(solutionOriginalFor(p, q), null);
  assert(!Object.hasOwn(problemInfo(p, q), 'solutionUrl'));
});
test('explicit archive solution span preserves the link in a shared volume', () => {
  const p = paper(),
    q = problem();
  p.solutionSource.pages = [83];
  q.sourceSpans.push({ document: 'solutions', page: 83 });
  assert.deepEqual(solutionOriginalFor(p, q), p.solutionSource);
  assert(render(p, q).includes('· решение от архива:'));
  assert(problemInfo(p, q).solutionUrl.endsWith('#page=83'));
});
test('substantive archive solution text is preserved without an explicit source span', () => {
  const p = paper(),
    q = problem();
  q.solution.statement = 'Synthetic supplied explanation.';
  assert.deepEqual(solutionOriginalFor(p, q), p.solutionSource);
  assert(render(p, q).includes('Synthetic supplied explanation.'));
});
test('genuine separate official original remains available while transcription is incomplete', () => {
  const p = paper(),
    q = problem();
  p.solutionSource = { archiveKey: 'Химия/IChO/Official-key.pdf', pages: [2] };
  q.solution.attribution = 'official';
  assert.deepEqual(solutionOriginalFor(p, q), p.solutionSource);
  assert(render(p, q).includes('официални решения'));
  assert(problemInfo(p, q).solutionUrl.endsWith('Official-key.pdf#page=2'));
});
test('explicit shared key span is problem-specific: missing neighbor gets no inherited key link', () => {
  const p = paper(),
    missing = problem(),
    supplied = problem();
  supplied.id = 'fixture-experiment-p2';
  supplied.sourceSpans.push({ document: 'solutions', page: 85 });
  assert.equal(solutionOriginalFor(p, missing), null);
  assert.deepEqual(solutionOriginalFor(p, supplied), p.solutionSource);
});
test('explicit manual key pin retains its bound source, not the problem source', () => {
  const p = paper(),
    q = problem();
  const overlay = { [q.id]: { solutions: { via: 'manual', page: 83 } } };
  assert.deepEqual(solutionOriginalFor(p, q, overlay), p.solutionSource);
});
test('manual supplementary key pin validates original ownership and physical scope', () => {
  const p = paper(),
    q = problem();
  p.supplementarySources = {
    alternate: { archiveKey: 'Химия/IChO/Alternate.pdf', pages: [3] },
  };
  const overlay = {
    [q.id]: { solutions: { via: 'manual', document: 'alternate', page: 3 } },
  };
  assert.deepEqual(
    solutionOriginalFor(p, q, overlay),
    p.supplementarySources.alternate
  );
  overlay[q.id].solutions.page = 4;
  assert.throws(
    () => solutionOriginalFor(p, q, overlay),
    /outside the registered/
  );
});
test('invalid key spans do not manufacture evidence', () => {
  const p = paper(),
    q = problem();
  q.sourceSpans.push({ document: 'solutions', page: 0 });
  assert.equal(solutionOriginalFor(p, q), null);
});
test('nested key content is substantive and remains rendered', () => {
  const p = paper(),
    q = problem();
  q.solution.sections = [{ title: 'Key', statement: 'Nested supplied key.' }];
  assert.deepEqual(solutionOriginalFor(p, q), p.solutionSource);
  assert(render(p, q).includes('Nested supplied key.'));
});
