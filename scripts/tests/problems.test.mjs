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

test('figures in common text appear once in their source position between or after parts', t => {
  const f = fixture(t), p = f.paper.problems[0];
  const figures = ['experiment', 'part-context', 'final-circuit'].map(id => ({ id, url: `https://example.org/${id}.png`, alt: id }));
  p.figures = [figures[0], figures[2]];
  p.parts = [
    { label: 'a)', statement: 'First question', figures: [figures[1]], statementAfter: `Experiment B\n\n![experiment](${figures[0].url})\n\n![part-context](${figures[1].url})` },
    { label: 'b)', statement: 'Second question' },
  ];
  p.statementAfterParts = `Shared final circuit\n\n![final-circuit](${figures[2].url})`;
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const mdx = f.read(f.output);
  for (const figure of figures) assert.equal(mdx.split(figure.url).length - 1, 1);
  assert.ok(mdx.indexOf('First question') < mdx.indexOf('Experiment B'));
  assert.ok(mdx.indexOf('Experiment B') < mdx.indexOf(figures[0].url));
  assert.ok(mdx.indexOf(figures[1].url) < mdx.indexOf('Second question'));
  assert.ok(mdx.indexOf('Second question') < mdx.indexOf(figures[2].url));
  assert.equal(f.run('--check').status, 0);
});

test('unbracketed italic source awards do not gain a second generated award', t => {
  const f = fixture(t), p = f.paper.problems[0];
  p.parts = [
    { label: 'а)', statement: 'Намерете височината...*3 т.*', points: 3 },
    { label: 'б)', statement: 'Намерете далечината. *2 точки*', points: 2 },
    { label: 'в)', statement: 'Друг въпрос. **1,5 точки.**', points: 1.5 },
    { label: 'г)', statement: 'Идеални волтметри...*2 точки;*', points: 2 },
    { label: 'д)', statement: 'Тяло с маса 3 т.', points: 3 },
  ];
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const mdx = f.read(f.output);
  for (const part of p.parts.slice(0, 4)) assert.ok(mdx.includes(`**${part.label}** ${part.statement}\n`));
  assert.equal((mdx.match(/\[3 т\.\]/g) || []).length, 1);
  assert.doesNotMatch(mdx, /\[(?:2|1,5) т\.\]/);
  assert.ok(mdx.includes('Тяло с маса 3 т. **[3 т.]**'));
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

test('missing or unassessed difficulty exports as N/A while explicit ratings are preserved', t => {
  const f = fixture(t);
  const cases = [
    { expected: 'N/A' },
    { expected: 'N/A', unassessed: true },
    { expected: 'Normal', difficulty: 'Normal' },
    { expected: 'Hard', difficulty: 'Hard' },
  ];
  f.paper.problems = cases.map((c, index) => {
    const problem = { id: `${f.paper.paper.id}-p${index + 1}`, number: index + 1, statement: 'Original statement' };
    if (c.difficulty) problem.difficulty = c.difficulty;
    if (c.unassessed) {
      problem.classification = classificationFixture(problem.id);
      problem.classification.difficulty = { level: null, status: 'unrated', rationale: 'Not assessed.', confidence: null };
    }
    return problem;
  });
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(f.read('content/extraProblems.json')).EXTRA_PROBLEMS;
  for (const [index, c] of cases.entries()) {
    const row = rows.find(p => p.uniqueId === f.paper.problems[index].id);
    assert.equal(row.difficulty, c.expected);
    if (c.unassessed) assert.equal(row.assessmentLabel, 'Трудност: неоценена');
  }
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

test('a line that starts with a one-line $$…$$ becomes a display block; inline, table and fenced math stay as written', async t => {
  const { displayMathLines } = await import('../problems-to-site.mjs');
  const mdx = [
    '---', 'title: \'$$x$$\'', '---', '',
    'Общият ток се разделя:', '$$I = I_1 + I_2$$', 'Тогава',
    '$$T_0 \\approx 0.007\\ \\mathrm{s}$$ **[2.0]**',
    '  $$a = b$$',
    'Chain rule $$f(g(x))$$',
    '$$m = 0.52$$.',
    '$$x$$ - 1 точка',
    '| $$a$$ | b |',
    '$$', 'E = mgx.\\ $$ still in the block', '$$',
    '$$E = mgx\\sin\\alpha.\\ $$',
    'Тогава $$a +', 'b$$ и', '$$c$$',
  ].join('\n');
  assert.equal(displayMathLines(mdx), [
    '---', 'title: \'$$x$$\'', '---', '',
    'Общият ток се разделя:', '$$', 'I = I_1 + I_2', '$$', 'Тогава',
    '$$', 'T_0 \\approx 0.007\\ \\mathrm{s}', '$$', '**[2.0]**',
    '  $$', '  a = b', '  $$',
    'Chain rule $$f(g(x))$$',
    '$$m = 0.52$$.',
    '$$x$$ - 1 точка',
    '| $$a$$ | b |',
    '$$', 'E = mgx.\\ $$ still in the block', '$$',
    '$$', 'E = mgx\\sin\\alpha.', '$$',
    'Тогава $$a +', 'b$$ и', '$$', 'c', '$$',
  ].join('\n'));
  const f = fixture(t), p = f.paper.problems[0];
  p.statement = 'Съпротивленията са свързани успоредно:\n$$I_1 R_1 = I_2 R_2$$\nОбщият ток е $I$.';
  p.solution = { statement: '$$t_1 = \\frac{P_1 t}{I^2 R_1}$$ **[1 т.]**\n$$t_2 = \\frac{P_2 t}{I^2 R_2}$$ **[1 т.]**' };
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const page = f.read(f.output);
  assert.ok(page.includes('успоредно:\n$$\nI_1 R_1 = I_2 R_2\n$$\nОбщият ток е $I$.'));
  assert.ok(page.includes('$$\nt_1 = \\frac{P_1 t}{I^2 R_1}\n$$\n**[1 т.]**\n$$\nt_2 = \\frac{P_2 t}{I^2 R_2}\n$$\n**[1 т.]**'));
  assert.equal(f.run('--check').status, 0);
  const compiled = spawnSync(process.execPath, [path.join(repo, 'scripts/check-mdx.mjs'), '--warn', path.join(f.root, f.output)], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  assert.doesNotMatch(compiled.stdout + compiled.stderr, /KaTeX parse error/);
});

test('printed lines keep their breaks, the masthead is one line, pipeline notes are not shown, marked-up points are not doubled', async t => {
  const { lineBreaks } = await import('../problems-to-site.mjs');
  assert.equal(lineBreaks(['---', 'id: x', '---', '', 'A) 5 km', 'B) 7 km', 'Тялото е', 'в покой.', '| a | b |', '|---|---|', '$$', 'x', '$$', 'Край'].join('\n')),
    ['---', 'id: x', '---', '', 'A) 5 km  ', 'B) 7 km  ', 'Тялото е', 'в покой.', '| a | b |', '|---|---|', '$$', 'x', '$$', 'Край'].join('\n'));
  const f = fixture(t), p = f.paper.problems[0];
  f.paper.paper.title = 'НАЦИОНАЛНА ОЛИМПИАДА\n\nIII кръг\n10. 01. 2022';
  f.paper.paper.caveat = 'Solutions incomplete in this window: handled by another window.';
  p.parts = [{ label: 'a)', statement: 'Find the speed. **(2 points)**', points: 2 }, { label: 'b)', statement: 'Тяло с маса 3 т.', points: 3 }];
  p.solution = { statement: 'Solution text.', incomplete: true, incompleteReason: 'The official solution covers part (a) only.' };
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const mdx = f.read(f.output);
  assert.ok(mdx.includes('*НАЦИОНАЛНА ОЛИМПИАДА · III кръг · 10. 01. 2022*'), mdx);
  assert.doesNotMatch(mdx, /window/);
  assert.ok(mdx.includes('The official solution covers part (a) only.'));
  assert.ok(mdx.includes('**a)** Find the speed. **(2 points)**\n'));
  assert.ok(mdx.includes('**b)** Тяло с маса 3 т. **[3 т.]**'));
  const compiled = spawnSync(process.execPath, [path.join(repo, 'scripts/check-mdx.mjs'), path.join(f.root, f.output)], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
});

test('figure-id placeholders show their figure in place; one without a figure keeps only its description', t => {
  const f = fixture(t), p = f.paper.problems[0];
  const url = id => `https://example.org/${id}.png`;
  p.figures = [{ id: 'p1-fig1', url: url('p1-fig1'), alt: 'Схема' }];
  p.statement = 'Условие.\n\n![](p1-fig1)\n\nКрай.';
  p.solution = { statement: 'Решение.\n\n![Графика](#p1-sol-fig1)\n\n[[figure p1-sol-fig2]]\n\n![Липсваща](p9-sol-fig9)', figures: [{ id: 'p1-sol-fig1', url: url('p1-sol-fig1'), alt: 'a' }, { id: 'p1-sol-fig2', url: url('p1-sol-fig2'), alt: 'Втора' }] };
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const mdx = f.read(f.output);
  assert.ok(mdx.includes(`![Схема](${url('p1-fig1')})`));
  assert.ok(mdx.includes(`![Графика](${url('p1-sol-fig1')})`));
  assert.ok(mdx.includes(`![Втора](${url('p1-sol-fig2')})`));
  assert.ok(mdx.includes('*[Липсваща]*'));
  for (const id of ['p1-fig1', 'p1-sol-fig1', 'p1-sol-fig2']) assert.equal(mdx.split(url(id)).length - 1, 1, id);
  assert.doesNotMatch(mdx, /\]\((?!https?:)[^)]*\)|\[\[figure/);
});
