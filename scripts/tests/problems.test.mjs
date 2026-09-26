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
  // the generator keeps a number and its points unit together with a no-break space; the assertions read plain text
  return { root, write, paper, file, approve, run, output, read: file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\u00A0/g, ' '), raw: file => fs.readFileSync(path.join(root, file), 'utf8') };
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
  // an English "no solution" note reads in Bulgarian
  assert.match(f.read(f.output), /Непълно решение">\nВ архива няма официално решение на тази задача\./);
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

test('a superseded edition keeps its source but becomes redirects without shadowing a published problem', t => {
  const f = fixture(t); f.approve();
  const old = structuredClone(f.paper);
  old.paper.id = 'old-edition'; old.problems[0].id = 'old-edition-p1';
  const oldFile = 'content/problems/physics/NOF/2026/old-edition.json';
  f.write(oldFile, old);
  const ledger = JSON.parse(f.read('content/problem-publication.json'));
  ledger.papers[old.paper.id] = { kind: 'legacy', contentHash: sha256(fs.readFileSync(path.join(f.root, oldFile))), sourceCommit: 'a'.repeat(40), recordedAt: 'today' };
  f.write('content/problem-publication.json', ledger);
  assert.equal(f.run().status, 0);
  f.paper.problems[0].aliases = [{ id: old.problems[0].id }];
  f.write(f.file, f.paper);
  ledger.papers[f.paper.paper.id].contentHash = sha256(fs.readFileSync(path.join(f.root, f.file)));
  f.write('content/problem-publication.json', ledger);
  assert.match(f.run().stderr, /Invalid alias/);
  ledger.papers[old.paper.id].supersededBy = f.paper.paper.id;
  f.write('content/problem-publication.json', ledger);
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(f.root, oldFile)), true);
  assert.equal(fs.existsSync(path.join(f.root, 'solutions/physics/old-edition/old-edition-p1.mdx')), false);
  const aliases = JSON.parse(f.read('content/problem-aliases.json'));
  assert.equal(aliases['/problems/old-edition-p1/solution'], `/problems/${f.paper.problems[0].id}/solution`);
  assert.equal(JSON.parse(f.read('content/extraProblems.json')).EXTRA_PROBLEMS.length, 2);
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

test('a one-line $$…$$ becomes a display block; table and fenced math stay as written', async t => {
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
    'Chain rule', '$$', 'f(g(x))', '$$',
    '$$', 'm = 0.52.', '$$',
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
  assert.ok(mdx.includes(`src="${url('p1-fig1')}" alt="Схема"`));
  assert.ok(mdx.includes(`src="${url('p1-sol-fig1')}" alt="a"`));
  assert.ok(mdx.includes(`src="${url('p1-sol-fig2')}" alt="Втора"`));
  assert.ok(mdx.includes('*[Липсваща]*'));
  for (const id of ['p1-fig1', 'p1-sol-fig1', 'p1-sol-fig2']) assert.equal(mdx.split(url(id)).length - 1, 1, id);
  assert.doesNotMatch(mdx, /\]\((?!https?:)[^)]*\)|\[\[figure/);
});

test('emphasis stuck between punctuation and a letter pairs; lone and escaped asterisks stay literal', async () => {
  const { emphasisFlanking } = await import('../problems-to-site.mjs');
  const f = t => emphasisFlanking(t).replace(/ /g, '⍽');
  assert.equal(f('(*фиг.*3)'), '(*фиг.*⍽3)');
  assert.equal(f('**2.** варовик; **11.**вода.'), '**2.** варовик; **11.**⍽вода.');
  assert.equal(f('| 0,5*(0,2;0)* |'), '| 0,5⍽*(0,2;0)* |');
  for (const t of ['M*, but *ok* here', 'δ*min = 1', '- ***** звезди', '\\*) бележка', '*a $x*y$ b*', 'plain *italic* and **bold**']) assert.equal(f(t), t);
});

test('a formula after text on its line becomes a block after the text, inside its list item; a closing mark goes into it', async () => {
  const { displayMathLines } = await import('../problems-to-site.mjs');
  assert.equal(displayMathLines('Chain rule $$f(g(x))$$'), 'Chain rule\n$$\nf(g(x))\n$$');
  assert.equal(displayMathLines('- величина $$f = 1$$ – 1 точка'), '- величина\n  $$\n  f = 1\n  $$\n  – 1 точка');
  assert.equal(displayMathLines('$$m = 0.52$$.'), '$$\nm = 0.52.\n$$');
  for (const t of ['| a $$x$$ | b |', 'Цена $5 и $$x$$', '# Heading $$x$$']) assert.equal(displayMathLines(t), t);
});

test('a formula in a quote stays in the quote; leader dots after a formula go', async () => {
  const { displayMathLines } = await import('../problems-to-site.mjs');
  assert.equal(displayMathLines('> $$E_1 = kq,$$'), '> $$\n> E_1 = kq,\n> $$');
  assert.equal(displayMathLines('> > text $$x$$ tail'), '> > text\n> > $$\n> > x\n> > $$\n> > tail');
  assert.equal(displayMathLines('$$h = 1{,}25$$ …..'), '$$\nh = 1{,}25\n$$');
  assert.equal(displayMathLines('$$t = 0{,}51$$ …'), '$$\nt = 0{,}51\n$$');
  for (const t of ['> $$\na\n> $$', '> plain $a$']) assert.equal(displayMathLines(t), t);
});

test('a number and its points unit are kept on one line', t => {
  const f = fixture(t), p = f.paper.problems[0];
  p.points = 5;
  p.parts = [{ label: 'а)', statement: 'Намерете скоростта (2 т.) и пътя [3 точки].', points: 4 }];
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const mdx = f.raw(f.output);
  for (const s of ['5\u00A0т.', '(2\u00A0т.)', '[3\u00A0точки]', '**[4\u00A0т.]**']) assert.ok(mdx.includes(s), s);
});

test('papers whose pages would share a heading get a language, a title or a file, only as much as needed', async () => {
  const { qualifyPapers } = await import('../problems-to-site.mjs');
  const paper = (id, extra) => ({ id, subject: 'astronomy', competition: 'IOAA', year: 2015, round: 'theory', grade: null, lang: 'en', source: { archiveKey: `IOAA/2015/${id}.pdf` }, ...extra });
  const problems = (...numbers) => numbers.map(number => ({ id: `p${number}`, number }));
  const q = qualifyPapers([
    { paper: paper('short-en', { title: 'SHORT PROBLEMS' }), problems: problems(1, 2) },
    { paper: paper('short-bg', { lang: 'bg', title: 'КЪСИ ЗАДАЧИ' }), problems: problems(1, 2) },
    { paper: paper('long-en', { title: 'LONG PROBLEMS' }), problems: problems(1) },
    { paper: paper('copy-a', { year: 2016 }), problems: problems(1) },
    { paper: paper('copy-b', { year: 2016 }), problems: problems(1) },
    { paper: paper('alone', { year: 2017 }), problems: problems(1) },
    { paper: paper('other-names', { year: 2017, lang: 'bg' }), problems: [{ id: 'x', number: 1, title: 'Звезди' }] },
  ]);
  assert.equal(q.get('short-bg'), 'български');
  assert.equal(q.get('short-en'), 'английски, Short problems');
  assert.equal(q.get('long-en'), 'английски, Long problems');
  assert.equal(q.get('copy-a'), 'файл copy-a.pdf');
  assert.equal(q.has('alone'), false);
  assert.equal(q.has('other-names'), false);
});

// ---- figures inside the text (content/figure-anchors.json, problems-to-site.mjs planFigureAnchors) ----
const IPHO_2016 = 'content/problems/physics/IPhO/2016/ipho-2016-theory-1.json';
// a published paper copied into a scratch root with an anchor overlay (the paper bytes stay as published)
function anchoredFixture(t, relPath, anchors) {
  const root = fs.mkdtempSync(path.join(repo, 'tmp/figure-anchor-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'string' || Buffer.isBuffer(value) ? value : jsonText(value));
  };
  const bytes = fs.readFileSync(path.join(repo, relPath));
  const data = JSON.parse(bytes.toString('utf8'));
  write(relPath, bytes);
  write('content/extraProblems.json', { EXTRA_PROBLEMS: [] });
  write('content/problem-publication.json', { version: 1, papers: { [data.paper.id]: { kind: 'legacy', contentHash: sha256(bytes), sourceCommit: 'a'.repeat(40), recordedAt: '2026-09-23T00:00:00Z' } } });
  if (anchors) write('content/figure-anchors.json', { version: 1, problems: anchors });
  const run = () => spawnSync(process.execPath, [path.join(repo, 'scripts/problems-to-site.mjs'), '--root', root], { encoding: 'utf8' });
  const pagePath = id => path.join(root, `solutions/${data.paper.subject}/${data.paper.id}/${id}.mdx`);
  return { root, data, run, pagePath, page: id => fs.readFileSync(pagePath(id), 'utf8') };
}
const figUrl = (data, id) => data.problems[0].figures.concat(data.problems[0].solution?.figures || []).find(f => f.id === id).url;
const inOrder = (mdx, marks) => { for (let i = 1; i < marks.length; i++) assert.ok(mdx.indexOf(marks[i - 1]) >= 0 && mdx.indexOf(marks[i - 1]) < mdx.indexOf(marks[i]), `${marks[i - 1]} before ${marks[i]}`); };

test('anchored figures go in at the paragraph where the paper prints them (ipho-2016-theory-1-p1)', t => {
  const f = anchoredFixture(t, IPHO_2016, { 'ipho-2016-theory-1-p1': {
    'p1-fig1': { field: 'statement', after: 'See Fig. 1 for a side view', method: 'test' },
    'p1-fig2': { field: 'statement', after: '(see Fig. 2)', method: 'test' },
    'p1-fig3': { field: 'parts/0/statementAfter', after: 'See figure 3 for the setup.', method: 'test' },
    'p1-fig4': { field: 'parts/4/statementAfter', after: 'curvature of the floor can be ignored.', method: 'test' },
    'p1-fig5': { field: 'parts/12/statement', after: '(see figure 5)', method: 'test' },
    'p1-sol-fig1': { field: 'solution/statement', after: 'According to the intersecting chord', method: 'test' },
    'p1-sol-fig2': { field: 'statement', after: 'See Fig. 1', method: 'test' }, // a solution figure never leaves the spoiler
  } });
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /figure anchors: 6\/7 placed in the text; 0 kept in place/);
  assert.match(r.stdout, /1 refused/);
  const mdx = f.page('ipho-2016-theory-1-p1'), url = id => figUrl(f.data, id);
  for (const id of ['p1-fig1', 'p1-fig2', 'p1-fig3', 'p1-fig4', 'p1-fig5', 'p1-sol-fig1', 'p1-sol-fig2']) assert.equal(mdx.split(url(id)).length - 1, 1, id);
  inOrder(mdx, ['See Fig. 1 for a side view', url('p1-fig1'), 'The goal of this task is to determine', '(see Fig. 2)', url('p1-fig2'), '**A.1**']);
  inOrder(mdx, ['**A.1**', 'See figure 3 for the setup', url('p1-fig3'), '**A.2**']);
  inOrder(mdx, ['**A.5**', 'curvature of the floor can be ignored.', url('p1-fig4'), '**B.1**']);
  inOrder(mdx, ['**B.8**', '(see figure 5)', url('p1-fig5'), '- Give an algebraic expression', '## Решение']);
  inOrder(mdx, ['## Решение', '<Spoiler title="Покажи официалното решение">', 'According to the intersecting chord', url('p1-sol-fig1')]);
  // the refused anchor leaves the solution figure at the end of the spoiler, after the solution text
  inOrder(mdx, [url('p1-sol-fig1'), url('p1-sol-fig2')]);
  assert.ok(mdx.indexOf(url('p1-sol-fig2')) < mdx.lastIndexOf('</Spoiler>'));
  assert.ok(mdx.indexOf(url('p1-sol-fig2')) > mdx.indexOf('Finding the third zero thus gives'), 'after the solution text');
  // a part split by a figure keeps its label on the first paragraph and its points at the end of the last one
  assert.match(mdx, /\*\*B\.8\*\* Alice pulls the mass/);
  // the printed width: Fig. 1 is 321.5 pt of a 480 pt column, its 1341 px crop 429 CSS px at 300 dpi
  assert.ok(mdx.includes(`<figure className="problem-figure problem-figure--sized" style={{'--fig-w': '67%', '--fig-max': '429px'}}>\n<img src="${url('p1-fig1')}"`));
  const compiled = spawnSync(process.execPath, [path.join(repo, 'scripts/check-mdx.mjs'), f.pagePath('ipho-2016-theory-1-p1')], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
});

test('an anchor whose text is not in the field keeps the figure in place; figures sharing a row sit side by side', t => {
  const f = anchoredFixture(t, IPHO_2016, { 'ipho-2016-theory-1-p1': {
    'p1-fig1': { field: 'statement', after: 'words the paper never prints', method: 'test' },
    'p1-fig2': { field: 'parts/1/statementAfter', after: null, row: 'r1', method: 'test' },
    'p1-fig3': { field: 'parts/1/statementAfter', after: null, row: 'r1', method: 'test' },
    'p1-fig4': { field: 'parts/99/statement', after: null, method: 'test' },
  } });
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /figure anchors: 2\/4 placed in the text; 2 kept in place/);
  const mdx = f.page('ipho-2016-theory-1-p1'), url = id => figUrl(f.data, id);
  // today's place for an unplaced statement figure: after the statement, before the first part
  inOrder(mdx, ['(see Fig. 2)', url('p1-fig1'), url('p1-fig4'), '**A.1**']);
  const row = /<div className="problem-figure-row">\n<figure[^\n]*>\n<img src="([^"]+)"[^\n]*\n[^\n]*\n<\/figure>\n<figure[^\n]*>\n<img src="([^"]+)"/.exec(mdx);
  assert.ok(row, 'one row holds both figures');
  assert.deepEqual([row[1], row[2]], [url('p1-fig2'), url('p1-fig3')]);
  inOrder(mdx, ['**A.2**', '<div className="problem-figure-row">', 'From the measurements in questions', '**A.3**']);
  const compiled = spawnSync(process.execPath, [path.join(repo, 'scripts/check-mdx.mjs'), f.pagePath('ipho-2016-theory-1-p1')], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
});

test('paragraph slots never split display math or a fenced block', async () => {
  const { paragraphSpans, anchorSlot } = await import('../problems-to-site.mjs');
  const text = 'One $a$.\n\n$$\nx = 1\n\ny = 2\n$$\n\n```\ncode\n\nmore\n```\n\n- item\n\n  continued\n\nLast.';
  assert.deepEqual(paragraphSpans(text).map(s => text.slice(s.start, s.end)), ['One $a$.', '$$\nx = 1\n\ny = 2\n$$', '```\ncode\n\nmore\n```', '- item\n\n  continued', 'Last.']);
  assert.equal(anchorSlot(text, null), 0);
  assert.equal(anchorSlot(text, 'x = 1'), 2);
  assert.equal(anchorSlot(text, 'code'), 3);
  assert.equal(anchorSlot(text, 'item'), 4);
  assert.equal(anchorSlot(text, 'Last.'), 5);
  assert.equal(anchorSlot(text, 'One  $a$.'), 1); // runs of whitespace compare as one
  assert.equal(anchorSlot(text, 'absent'), null);
  const steps = '1. Структурната формула е:\n\n2. Следващата реакция.';
  assert.equal(anchorSlot(steps, 'формула е:', true), 1); // PDF-reviewed drawing belongs to step 1
});

test('figure display width follows the printed width and never upscales the crop', async () => {
  const { figureSize } = await import('../problems-to-site.mjs');
  assert.deepEqual(figureSize({ width: 1341, source: { dpi: 300, pdfRect: [130.95, 457.15, 452.43, 585.95] } }), { widthPct: 67, maxPx: 429 });
  assert.deepEqual(figureSize({ width: 3000, source: { dpi: 300, pdfRect: [0, 0, 720, 100] } }), { widthPct: 100, maxPx: 960 });
  assert.deepEqual(figureSize({ width: 100, source: { dpi: 300, pdfRect: [0, 0, 24, 24] } }), { widthPct: 5, maxPx: 32 });
  assert.deepEqual(figureSize({ width: 144, source: { dpi: 72 } }), { widthPct: 30, maxPx: 192 });
  assert.equal(figureSize({ width: 933, height: 573 }), null); // nothing says how large it was printed
});

test('a part ending in an inline figure keeps its points outside the JSX block', t => {
  const f = fixture(t);
  f.paper.problems[0].parts = [{ label: 'А', statement: '![Схема](https://example.org/figure.png)', points: 5, figures: [{ id: 'p1-fig1', url: 'https://example.org/figure.png', alt: 'Схема', width: 200, height: 200 }] }];
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  assert.match(f.read(f.output), /<\/figure>\n\n\*\*\[5 т\.\]\*\*/);
  const compiled = spawnSync(process.execPath, [path.join(repo, 'scripts/check-mdx.mjs'), path.join(f.root, f.output)], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
});

test('NAO 2025 animal photos keep all six statement crops and omit the duplicate solution rows', async () => {
  const { problemMdx } = await import('../problems-to-site.mjs');
  const file = 'content/problems/astronomy/NAO/2025/nao-2025-i-5-6.json';
  const data = JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'));
  const problem = data.problems.find(p => p.id.endsWith('-p4'));
  const mdx = problemMdx(data.paper, problem, { quality: 'legacy' }, file);
  for (const fig of problem.figures) assert.ok(mdx.includes(fig.url), fig.id);
  for (const fig of problem.solution.figures) assert.ok(!mdx.includes(fig.url), fig.id);
});

// nao-2013-iii-9-10 p1: the text inlines the first crop p1-fig1.png, figures[] holds the re-crop p1-fig1-v2.png — one
// picture, shown once, inline, with the newest crop (a figure block next to it would repeat it)
test('a figure whose other crop version the text inlines is shown once, inline, with the newest crop', async () => {
  const { figureShownInline, newestInlineCrops } = await import('../problems-to-site.mjs');
  const base = 'https://r2.example/problems/nao-2013-iii-9-10';
  const text = `Графиките:\n\n![Площ на петната](${base}/p1-fig1.png)\n\n*Фиг. 1.*`;
  const fig = { id: 'p1-fig1', url: `${base}/p1-fig1-v2.png` };
  assert.equal(figureShownInline(fig, text), true);
  assert.equal(figureShownInline({ id: 'p1-fig2', url: `${base}/p1-fig2-v2.png` }, text), false);
  assert.equal(figureShownInline({ id: 'p1-fig10', url: `${base}/p1-fig10.png` }, text), false);
  assert.equal(newestInlineCrops(text, [fig]), text.replace('p1-fig1.png', 'p1-fig1-v2.png'));
  // an older version in figures[] never replaces the newer crop the text shows
  const newer = text.replace('p1-fig1.png', 'p1-fig1-v3.png');
  assert.equal(newestInlineCrops(newer, [fig]), newer);
  assert.equal(newestInlineCrops(null, [fig]), null);
});

// Every figure block appears on its page exactly as often as before anchoring, and on the same side of the
// «Решение» heading (a statement figure never enters the solution, a solution figure never leaves it) — over every
// paper in the repository, with the committed overlay (when there is one) and with an adversarial overlay that
// anchors every figure somewhere (valid fields, fields across the spoiler, missing text, rows).
test('every figure of every paper stays exactly once on its page, on its own side of the solution heading', async () => {
  const { problemMdx, readFigureAnchors, newFigureStats } = await import('../problems-to-site.mjs');
  const { readPapers } = await import('../lib/problem-data.mjs');
  const records = readPapers(repo);
  const committed = readFigureAnchors(repo);
  const state = { quality: 'legacy' };
  const regions = (mdx, url) => {
    const heading = mdx.indexOf('\n## Решение\n'), out = [];
    for (let at = mdx.indexOf(url); at >= 0; at = mdx.indexOf(url, at + 1)) out.push(heading >= 0 && at > heading ? 'solution' : 'statement');
    return out.join();
  };
  let pages = 0, figures = 0, placed = 0;
  for (const record of records) {
    const { paper, problems } = record.data;
    for (const problem of problems) {
      const urls = [...new Set([...(problem.figures || []), ...(problem.parts || []).flatMap(p => p.figures || []), ...(problem.solution?.figures || [])].map(f => f.url).filter(Boolean))];
      if (!urls.length) continue;
      const fieldNames = ['statement', 'statementAfterParts', 'solution/statement', ...(problem.parts || []).flatMap((_, k) => [`parts/${k}/statement`, `parts/${k}/statementAfter`])];
      const textOf = name => name === 'statement' ? problem.statement : name === 'statementAfterParts' ? problem.statementAfterParts : name === 'solution/statement' ? problem.solution?.statement
        : problem.parts[Number(name.split('/')[1])][name.split('/')[2]];
      const synthetic = {};
      [...(problem.figures || []), ...(problem.parts || []).flatMap(p => p.figures || []), ...(problem.solution?.figures || [])].forEach((fig, i) => {
        const field = fieldNames[i % fieldNames.length], text = String(textOf(field) ?? '');
        const after = i % 4 === 0 ? null : i % 4 === 3 ? 'text no paper prints' : text.slice(Math.floor(text.length / 2), Math.floor(text.length / 2) + 12) || null;
        synthetic[fig.id] = { field, after, row: i % 3 ? 'r' : undefined, method: 'test' };
      });
      const base = problemMdx(paper, problem, state, record.relativePath, {});
      const variants = [{ [problem.id]: synthetic }, ...(committed ? [committed] : [])];
      for (const anchors of variants) {
        const stats = newFigureStats();
        const mdx = problemMdx(paper, problem, state, record.relativePath, { anchors, stats });
        placed += stats.placed;
        for (const url of urls) assert.equal(regions(mdx, url), regions(base, url), `${problem.id} ${url}`);
      }
      pages++; figures += urls.length;
    }
  }
  assert.ok(pages > 1000 && figures > 5000 && placed > 1000, `${pages} pages, ${figures} figures, ${placed} placed`);
});

// ---- the original's link, notes, points, source line (site audit 2026-09, batch A) ----
test('the original opens on the problem\'s own page: spans, then the page overlay, then its figure, then a one-page document; never on a Word or text file', async () => {
  const { sourcePage, withPage, originalFormat } = await import('../problems-to-site.mjs');
  const paper = { source: { archiveKey: 'Физика/a.pdf', pages: [1, 2, 3] }, solutionSource: { archiveKey: 'Физика/s.pdf', pages: [1, 2] } };
  const problem = { id: 'x-p2', sourceSpans: [{ document: 'problems', page: 3 }, { document: 'problems', page: 2 }, { document: 'solutions', page: 2 }] };
  assert.equal(sourcePage(paper, problem, 'problems', {}), 2);
  assert.equal(sourcePage(paper, problem, 'solutions', {}), 2);
  // a page pinned by hand wins over the spans (an imposed booklet lists its pages out of order); a computed one does not
  assert.equal(sourcePage(paper, problem, 'problems', { 'x-p2': { problems: { page: 3, via: 'manual' } } }), 3);
  assert.equal(sourcePage(paper, problem, 'problems', { 'x-p2': { problems: { page: 1, via: 'text' } } }), 2);
  assert.equal(sourcePage(paper, problem, 'solutions', { 'x-p2': { problems: { page: 3, via: 'manual' } } }), 2, 'per document');
  const legacy = { id: 'x-p3', figures: [{ id: 'p3-fig1', source: { page: 3, pdfRect: [0, 0, 1, 1] } }], solution: { figures: [{ id: 'p3-sol-fig1', source: { page: 2, document: 'solutions' } }] } };
  assert.equal(sourcePage(paper, legacy, 'problems', { 'x-p3': { problems: { page: 2, via: 'text' } } }), 2, 'the overlay before a figure');
  assert.equal(sourcePage(paper, legacy, 'problems', {}), 3, 'the page of its own figure');
  assert.equal(sourcePage(paper, legacy, 'solutions', {}), 2);
  assert.equal(sourcePage(paper, { id: 'x-p4' }, 'problems', {}), null, 'nothing says: no page, never page 1 by default');
  assert.equal(sourcePage({ source: { archiveKey: 'a.pdf', pages: [4] } }, { id: 'y' }, 'problems', {}), 4);
  assert.equal(withPage('https://x/a.pdf', 3), 'https://x/a.pdf#page=3');
  assert.equal(withPage('https://x/%D0%B0.pdf', 3, 'Физика/а.PDF'), 'https://x/%D0%B0.pdf#page=3');
  for (const key of ['a.doc', 'a.docx', 'a.txt']) assert.equal(withPage(`https://x/${key}`, 3, key), `https://x/${key}`);
  assert.equal(withPage('https://x/a.pdf', null), 'https://x/a.pdf');
  assert.deepEqual(['a.pdf', 'b.DOC', 'c.docx', 'd.txt', 'e.zip'].map(originalFormat), ['pdf', 'word', 'word', 'text', 'other']);
});

test('generated page: the original link carries the overlay page, a Word original none; the card source has names, not codes', t => {
  const f = fixture(t);
  f.paper.paper.source.pages = [1, 2];
  f.paper.paper.grade = '9';
  f.paper.paper.round = 'III кръг (национален)';
  f.write(f.file, f.paper); f.approve();
  f.write('content/problem-source-pages.json', { version: 1, problems: { 'nof-2026-ii-7-p1': { problems: { page: 2, via: 'text' } } } });
  let result = f.run(); assert.equal(result.status, 0, result.stderr);
  const info = () => JSON.parse(fs.readFileSync(path.join(f.root, 'content/extraProblems.json'), 'utf8')).EXTRA_PROBLEMS.find(p => p.uniqueId === 'nof-2026-ii-7-p1');
  assert.match(info().url, /exam\.pdf#page=2$/);
  assert.match(f.read(f.output), /Оригинал в Архива: \[exam\.pdf\]\([^)]*exam\.pdf#page=2\)/);
  assert.match(info().source, /^NOF 2026, .*9\. клас/);
  f.paper.paper.source.archiveKey = 'Физика/exam.docx';
  f.write(f.file, f.paper); f.approve();
  result = f.run(); assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(info().url, /#page=/);
  assert.doesNotMatch(f.read(f.output), /#page=/);
});

test('run notes never reach the page: caveats, incomplete reasons and answer notes', async t => {
  const { visitorNoteText, NO_OFFICIAL_SOLUTION_LINE, pipelineNoteLeaks } = await import('../problems-to-site.mjs');
  for (const note of ['Official solution not transcribed in this window.', 'No closed-form numeric answer is printed in the visible window; official solution not transcribed here.',
    'Попълва се от страница 2 на решенията при верификация.', 'Решението … предстои да бъде транскрибирано при верификацията.']) assert.equal(visitorNoteText(note), null, note);
  assert.equal(visitorNoteText('Official solutions were not supplied with the prepared source.'), NO_OFFICIAL_SOLUTION_LINE);
  assert.equal(visitorNoteText('Архивният файл с решения не съдържа решението на Задача 1 — стойността се попълва при верификация по пълния оригинал.'), NO_OFFICIAL_SOLUTION_LINE);
  for (const note of ['The official solution covers part (a) only.', 'Answers are derived, not transcribed from an official solutions file.', 'Close all the windows.']) assert.equal(visitorNoteText(note), note);
  const f = fixture(t), p = f.paper.problems[0];
  f.paper.paper.solutionSource = { archiveKey: 'Физика/solutions.pdf' };
  delete p.answer;
  p.parts = [{ label: 'а)', statement: 'Първо.', answer: { kind: 'text', note: 'Official solution not transcribed in this window.' } },
    { label: 'б)', statement: 'Второ.', answer: { kind: 'text', note: 'Стойността се дочита от страница 2 на решенията — попълва се при верификация.' } },
    { label: 'в)', statement: 'Трето.', answer: { kind: 'numeric', value: 5, unit: 'm' } }];
  p.solution = { incomplete: true, incompleteReason: 'Решението е на страница 2 от PDF-а с решенията и предстои да бъде транскрибирано при верификацията.' };
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const mdx = f.read(f.output);
  assert.doesNotMatch(mdx, /window|верификаци/);
  assert.match(mdx, /## Отговори[\s\S]*- \*\*в\)\*\* 5 m/);
  assert.doesNotMatch(mdx, /- \*\*а\)\*\*/);
  assert.match(mdx, /Официалното решение не е транскрибирано — вижте файла с решенията в Архива/);
  assert.deepEqual(pipelineNoteLeaks(mdx), []);
  assert.deepEqual(pipelineNoteLeaks('<Warning title="x">\nSolutions not transcribed in this window.\n</Warning>'), ['Solutions not transcribed in this window.']);
});

test('an English or Russian "the archive has no solution" note reads in Bulgarian; a note on a partial solution stays', async t => {
  const { incompleteNoteText, caveatNoteText, archiveNoteLeaks, NO_ARCHIVE_SOLUTION_LINE, OPEN_RESEARCH_LINE } = await import('../problems-to-site.mjs');
  for (const note of ['The archive has no solutions file for this paper.', 'No official solutions are included in this problem PDF or in matching files in the archive.',
    'The archive text refers to exemplary solutions but contains no target URL or solution text, and no matching solutions file.',
    'В архиве отсутствует файл с решениями.', 'В архиве нет файла с решениями или ответами.', 'Официальные решения к этому тесту отсутствуют в архиве.',
    'Aucun document de solutions officielles n’a été fourni dans l’archive.', 'Мұрағатта шешімдер файлы жоқ.']) {
    assert.equal(incompleteNoteText(note, false), NO_ARCHIVE_SOLUTION_LINE, note);
    assert.equal(incompleteNoteText(note, true), note, `with solution text: ${note}`);
  }
  assert.equal(incompleteNoteText('IYPT problems are open research problems; no official solutions are published.', false), OPEN_RESEARCH_LINE);
  for (const note of ['На листе ответа размечены пять скоплений, но отсутствуют требуемые подписи пяти звёзд.', 'The official answer picture omits the ecliptic line.',
    'В архива няма официално решение на тази задача.']) assert.equal(incompleteNoteText(note, false), note, note);
  const caveat = 'The archive has no official answers or solutions for this blitz paper.';
  assert.equal(caveatNoteText(caveat, true), null);
  assert.equal(caveatNoteText(caveat, false), caveat, 'without the box the note is the only word on it');
  assert.equal(caveatNoteText('The archive has no official solutions for this fieldwork paper, and the Appendix II contour map is not included.', true), null);
  const more = 'The separate numbered exoplanet data table referenced by the problems and solutions are not in the archive.';
  assert.equal(caveatNoteText(more, true), more);
  // the lint
  const page = (box, cav, solved) => [cav ? `<Warning title="Бележка към темата">\n${cav}\n</Warning>` : '', box ? `<Warning title="Непълно решение">\n${box}\n</Warning>` : '',
    solved ? '<Spoiler title="Покажи официалното решение">' : ''].join('\n');
  assert.deepEqual(archiveNoteLeaks(page('The archive has no solutions file for this paper.')), ['The archive has no solutions file for this paper.']);
  assert.deepEqual(archiveNoteLeaks(page(NO_ARCHIVE_SOLUTION_LINE, caveat)), [caveat]);
  assert.deepEqual(archiveNoteLeaks(page('The official solutions contain no solution for part f.', null, true)), []);
  assert.deepEqual(archiveNoteLeaks(page(NO_ARCHIVE_SOLUTION_LINE)), []);
  const f = fixture(t), p = f.paper.problems[0];
  f.paper.paper.caveat = 'В архиве нет файла с решениями.';
  p.solution = { incomplete: true, incompleteReason: 'The archive has no official solutions file for this paper.' };
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const mdx = f.read(f.output);
  assert.match(mdx, /<Warning title="Непълно решение">\nВ архива няма официално решение на тази задача\.\n<\/Warning>/);
  assert.doesNotMatch(mdx, /Бележка към темата|archive has|архиве/);
});

test('points printed at the start of a part are not repeated; a title does not repeat the lead line\'s points; the lead line keeps "2019 г." together', async t => {
  const { titleWithoutPoints } = await import('../problems-to-site.mjs');
  assert.equal(titleWithoutPoints('Permanent magnets (10 points)', 10), 'Permanent magnets');
  assert.equal(titleWithoutPoints('E1 - Magnetic Pendulum (10 pts)', 10), 'E1 - Magnetic Pendulum');
  assert.equal(titleWithoutPoints('Hertzian Contact Stress [10 points]', 8), 'Hertzian Contact Stress [10 points]', 'other points stay');
  assert.equal(titleWithoutPoints('Магнити (10 т.)', null), 'Магнити (10 т.)');
  const f = fixture(t), p = f.paper.problems[0];
  f.paper.paper.title = 'Национална олимпиада по физика 2019 г.';
  f.paper.paper.held = { from: '2019-04-05' };
  p.title = 'Ping-Pong Resistor (10 points)';
  p.points = 10;
  p.parts = [{ label: '(a)', statement: '[1.2 points] Calculate the force.', points: 1.2 }, { label: '(b)', statement: '**(2 т.)** Намерете заряда.', points: 2 }, { label: '(c)', statement: 'Find it.', points: 3 }];
  f.write(f.file, f.paper); f.approve();
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const raw = f.raw(f.output), mdx = f.read(f.output);
  assert.match(mdx, /^title: '.*Ping-Pong Resistor'$/m);
  assert.doesNotMatch(mdx, /title: .*10 points/);
  assert.ok(mdx.includes('**(a)** [1.2 points] Calculate the force.\n'), mdx);
  assert.ok(mdx.includes('**(b)** **(2 т.)** Намерете заряда.\n'));
  assert.ok(mdx.includes('**(c)** Find it. **[3 т.]**'));
  assert.ok(raw.includes('2019 г. · 5 април 2019 г. · 10 т.'), raw.split('\n').find(l => l.startsWith('*')));
});

// the note lint: no published page shows a run note in its warnings or its answers (a ship gate)
test('no published page shows a transcription-run note in a warning or an answer', async () => {
  const { problemMdx, pipelineNoteLeaks, archiveNoteLeaks } = await import('../problems-to-site.mjs');
  const { readPapers, readJson } = await import('../lib/problem-data.mjs');
  const ledger = readJson(path.join(repo, 'content/problem-publication.json'), { papers: {} });
  const leaks = [];
  let pages = 0;
  for (const record of readPapers(repo)) {
    if (!publicationState(record, ledger).eligible) continue;
    for (const problem of record.data.problems) {
      pages++;
      const mdx = problemMdx(record.data.paper, problem, { quality: 'legacy' }, record.relativePath);
      for (const line of [...pipelineNoteLeaks(mdx), ...archiveNoteLeaks(mdx)]) leaks.push(`${problem.id}: ${line.slice(0, 120)}`);
    }
  }
  assert.ok(pages > 1000, `${pages} pages`);
  assert.deepEqual(leaks, []);
});
