import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256, jsonText, publicationState } from '../lib/problem-data.mjs';
import { classificationFixture } from './classification-fixture.mjs';
import { normaliseCandidate } from '../tx/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
fs.mkdirSync(path.join(repo, 'tmp'), { recursive: true });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(repo, 'tmp/generator-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : jsonText(value));
  };
  const paper = { paper: { id: 'nof-2026-ii-7', subject: 'physics', competition: 'NOF', year: 2026, roundType: 'theory', lang: 'bg', source: { archiveKey: 'Физика/exam.pdf' }, status: 'draft' }, problems: [{ id: 'nof-2026-ii-7-p1', number: 1, statement: 'Original statement', answer: { kind: 'numeric', value: 42, unit: 'm' } }] };
  const file = 'content/problems/physics/NOF/2026/nof-2026-ii-7.json';
  write(file, paper);
  write('content/extraProblems.json', { EXTRA_PROBLEMS: [{ uniqueId: 'authored-p1', name: 'Authored', source: 'Book', url: 'https://example.org/book', solutionMetadata: { kind: 'internal' } }] });
  write('solutions/book/authored-p1.mdx', 'Hand-authored solution');
  const approve = () => write('content/problem-publication.json', { version: 1, papers: { [paper.paper.id]: { kind: 'legacy', contentHash: sha256(fs.readFileSync(path.join(root, file))), sourceCommit: 'a'.repeat(40), recordedAt: new Date().toISOString() } } });
  const run = (...args) => spawnSync(process.execPath, [path.join(repo, 'scripts/problems-to-site.mjs'), '--root', root, ...args], { encoding: 'utf8' });
  const output = `solutions/physics/${paper.paper.id}/${paper.problems[0].id}.mdx`;
  return { root, write, paper, file, approve, run, output, read: file => fs.readFileSync(path.join(root, file), 'utf8') };
}

test('unapproved draft never creates a page; explicit legacy migration preserves an exact revision', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(fs.existsSync(path.join(f.root, f.output)), false);
  f.approve();
  assert.equal(f.run().status, 0);
  assert.match(f.read(f.output), /42 m/);
  assert.match(f.read(f.output), /verification: 'legacy'/);
  assert.equal(f.run('--check').status, 0);
  f.paper.problems[0].statement = 'Changed unreviewed statement';
  f.write(f.file, f.paper);
  assert.equal(f.run('--check').status, 1);
  assert.equal(f.run().status, 0);
  assert.equal(fs.existsSync(path.join(f.root, f.output)), false);
});

test('two printed awards under one part survive normalization and publication without an inferred total', t => {
  const f = fixture(t);
  const statement = 'Намерете израза. **[1 т.]** За какъв интервал е приложим? **[0.5 т.]**';
  f.paper.problems[0].parts = [{ label: 'е)', statement, points: null }];
  normaliseCandidate(f.paper);
  normaliseCandidate(f.paper);
  assert.equal(f.paper.problems[0].parts[0].points, null);
  assert.equal(f.paper.problems[0].parts[0].statement, statement);
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const mdx = f.read(f.output);
  assert.ok(mdx.includes(`**е)** ${statement}`));
  assert.equal((mdx.match(/\[1 т\.\]/g) || []).length, 1);
  assert.equal((mdx.match(/\[0\.5 т\.\]/g) || []).length, 1);
  assert.doesNotMatch(mdx, /\[(?:1[,.]5|0,5) т\.\]/);
});

test('source removal retracts only owned artifacts and index entries', t => {
  const f = fixture(t); f.approve(); assert.equal(f.run().status, 0);
  fs.unlinkSync(path.join(f.root, f.file));
  assert.equal(f.run('--check').status, 1);
  assert.equal(f.run().status, 0);
  assert.equal(fs.existsSync(path.join(f.root, f.output)), false);
  assert.equal(f.read('solutions/book/authored-p1.mdx'), 'Hand-authored solution');
  assert.deepEqual(JSON.parse(f.read('content/extraProblems.json')).EXTRA_PROBLEMS.map(p => p.uniqueId), ['authored-p1']);
});

test('check detects index drift without writing; ownership refuses to delete manual changes', t => {
  const f = fixture(t); f.approve(); f.run();
  f.write('content/extraProblems.json', { EXTRA_PROBLEMS: [] });
  const before = f.read('content/extraProblems.json');
  assert.equal(f.run('--check').status, 1);
  assert.equal(f.read('content/extraProblems.json'), before);
  f.write(f.output, 'Manual correction that must be preserved');
  fs.unlinkSync(path.join(f.root, f.file));
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read(f.output), 'Manual correction that must be preserved');
});

test('top-level and part answers include zero and choice identifiers; missing solutions are explicit', t => {
  const f = fixture(t);
  f.paper.problems[0].answer = { kind: 'choice', correct: 'Б' };
  f.paper.problems[0].parts = [{ label: 'а)', statement: 'Part', answer: { kind: 'numeric', value: 0, unit: 's' } }];
  f.paper.problems[0].solution = { incomplete: true, incompleteReason: 'Source has no solution.' };
  f.write(f.file, f.paper); f.approve(); assert.equal(f.run().status, 0);
  assert.match(f.read(f.output), /- Б/);
  assert.match(f.read(f.output), /0 s/);
  assert.match(f.read(f.output), /Source has no solution/);
});

test('routes survive title edits; curated records do not duplicate extraProblems', t => {
  const f = fixture(t);
  f.write('content/test.problems.json', { MODULE_ID: 'st-kin-tricks', practice: [] });
  f.write('content/problem-curation.json', { modules: { 'st-kin-tricks': [{ problemId: f.paper.problems[0].id }] } });
  f.approve(); assert.equal(f.run().status, 0);
  const routes = f.read('content/problem-routes.json');
  assert.equal(JSON.parse(f.read('content/test.problems.json')).archivePractice.length, 1);
  assert.equal(JSON.parse(f.read('content/extraProblems.json')).EXTRA_PROBLEMS.length, 1);
  f.paper.problems[0].title = 'Corrected title'; f.write(f.file, f.paper); f.approve();
  assert.equal(f.run().status, 0);
  assert.equal(f.read('content/problem-routes.json'), routes);
});

test('a model label alone cannot authorize publication; withdrawal always wins', () => {
  const record = { contentHash: 'a'.repeat(64), data: { paper: { id: 'x', status: 'review' } } };
  assert.equal(publicationState(record, { papers: { x: { kind: 'reviewed', contentHash: record.contentHash, verifiedBy: 'opus' } } }).eligible, false);
  record.data.paper.status = 'withdrawn';
  assert.equal(publicationState(record, { papers: { x: { kind: 'legacy', contentHash: record.contentHash, sourceCommit: 'a'.repeat(40), recordedAt: 'today' } } }).eligible, false);
});

test('new classification is searchable and source notes and common paragraphs retain their positions', t => {
  const f = fixture(t), p = f.paper.problems[0];
  p.classification = classificationFixture(p.id);
  p.difficulty = 'Easy';
  p.parts = [{ label: 'a)', statement: 'First part', points: 2, statementAfter: 'Common paragraph between parts' }, { label: 'b)', statement: 'Second part' }];
  p.statementAfterParts = 'Final common paragraph';
  p.solution = { statement: 'Underlined solution variant\n\nFull solution.' };
  p.sourceLayout = { underlines: ['Underlined solution variant'] };
  f.paper.paper.documentNotes = [
    { title: 'Instructions for the whole paper', statement: 'Choose three tasks.', document: 'problems', page: 1, position: 'before-problem' },
    { title: 'Grading for the whole paper', statement: 'Shared grading rules.', document: 'solutions', page: 1, position: 'after-problem' },
  ];
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const mdx = f.read(f.output);
  const ordered = ['Instructions for the whole paper', '## Условие', 'Original statement', 'First part', 'Common paragraph between parts', 'Second part', 'Final common paragraph', '## Решение', 'Full solution.', 'Grading for the whole paper'];
  for (let i = 1; i < ordered.length; i++) assert.ok(mdx.indexOf(ordered[i]) > mdx.indexOf(ordered[i - 1]), `${ordered[i - 1]} before ${ordered[i]}`);
  assert.match(mdx, /<u>Underlined solution variant<\/u>/);
  assert.match(mdx, /Оценена трудност: 3\/5/);
  const row = JSON.parse(f.read('content/extraProblems.json')).EXTRA_PROBLEMS.find(x => x.uniqueId === p.id);
  assert.equal(row.difficulty, 'Easy');
  assert.equal(row.assessmentLabel, 'Оценена трудност: 3/5');
  assert.deepEqual(row.fields, ['Флуиди']);
  assert.ok(row.tags.includes('Флуиди'));
  assert.ok(row.classificationTerms.includes('physics/fluids/hydrostatics'));
  const compiled = spawnSync(process.execPath, [path.join(repo, 'scripts/check-mdx.mjs'), path.join(f.root, f.output)], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
});
