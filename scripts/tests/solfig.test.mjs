// Solution figures stored in a statement or part are rendered inside the solution spoiler, never under «Условие»
// (problems-to-site.mjs misplacedSolutionFigures); validate.mjs warns about them in new candidates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256, jsonText } from '../lib/problem-data.mjs';
import { misplacedSolutionFigures, figuresBelowSolutionHeading, textLayerLines, SOLUTION_FIGURES } from '../problems-to-site.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
fs.mkdirSync(path.join(repo, 'tmp'), { recursive: true });
const R2 = 'https://pub-43290baaaff14857b5dd59610ea438c7.r2.dev/problems';
const fig = (paperId, id, source, extra = {}) => ({ id, url: `${R2}/${paperId}/${id}.png`, alt: `alt ${id}`, width: 100, height: 100, ...(source ? { source: { dpi: 300, ...source } } : {}), ...extra });

function fixture(t, paper) {
  const root = fs.mkdtempSync(path.join(repo, 'tmp/solfig-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : jsonText(value));
  };
  const file = `content/problems/${paper.paper.subject}/${paper.paper.competition}/${paper.paper.year}/${paper.paper.id}.json`;
  write(file, paper);
  write('content/extraProblems.json', { EXTRA_PROBLEMS: [] });
  write('content/problem-publication.json', { version: 1, papers: { [paper.paper.id]: { kind: 'legacy', contentHash: sha256(fs.readFileSync(path.join(root, file))), sourceCommit: 'a'.repeat(40), recordedAt: '2026-09-22T00:00:00Z' } } });
  const run = (...args) => spawnSync(process.execPath, [path.join(repo, 'scripts/problems-to-site.mjs'), '--root', root, ...args], { encoding: 'utf8' });
  const page = id => fs.readFileSync(path.join(root, `solutions/${paper.paper.subject}/${paper.paper.id}/${id}.mdx`), 'utf8');
  return { root, run, page };
}

const basePaper = (id, extra = {}) => ({ id, subject: 'astronomy', competition: 'NAO', year: 2000, roundType: 'theory', lang: 'bg', status: 'review', source: { archiveKey: 'Астрономия/p.pdf', pages: [1, 2] }, ...extra });
// where the figure sits on the page: inside «Условие» (before the answers/solution headings) or inside a spoiler
function placement(mdx, url) {
  const at = mdx.indexOf(url);
  if (at < 0) return 'absent';
  if (mdx.indexOf(url, at + 1) >= 0) return 'twice';
  const solution = mdx.indexOf('## Решение');
  if (solution < 0 || at < solution) return 'statement';
  const open = mdx.lastIndexOf('<Spoiler', at), close = mdx.indexOf('</Spoiler>', at);
  return open > solution && close > at && mdx.lastIndexOf('</Spoiler>', at) < open ? 'solution-spoiler' : 'solution-open';
}

test('a "-sol-" figure in the statement or a part moves into the solution spoiler after the solution text', t => {
  const id = 'nao-2000-ii-7-9';
  const statementFig = fig(id, 'p3-fig1', { page: 1, pdfRect: [10, 10, 100, 100] });
  const leaked = fig(id, 'p3-sol-fig1', { page: 2, pdfRect: [67, 336, 264, 537], document: 'solutions' });
  const leakedInPart = fig(id, 'p3-sol-fig2', { page: 3, pdfRect: [67, 100, 264, 200] }); // no document: the id decides
  const own = fig(id, 'p3-sol-fig3', { page: 3, pdfRect: [67, 300, 264, 400], document: 'solutions' });
  const f = fixture(t, { paper: basePaper(id, { solutionSource: { archiveKey: 'Астрономия/s.pdf', pages: [1, 2, 3] } }), problems: [{
    id: `${id}-p3`, number: 3, statement: 'Условие на задачата.', figures: [statementFig, leaked],
    parts: [{ label: 'а)', statement: 'Първа подточка.', figures: [leakedInPart] }],
    solution: { statement: 'Официалното решение.', figures: [own] },
  }] });
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  const mdx = f.page(`${id}-p3`);
  assert.equal(placement(mdx, statementFig.url), 'statement');
  for (const x of [leaked, leakedInPart, own]) assert.equal(placement(mdx, x.url), 'solution-spoiler', x.id);
  assert.ok(mdx.indexOf('Официалното решение.') < mdx.indexOf(leaked.url));
  assert.ok(mdx.indexOf(own.url) < mdx.indexOf(leaked.url), 'moved figures follow the solution\'s own figures');
  assert.ok(mdx.indexOf('Първа подточка.') < mdx.indexOf('## Решение'));
  assert.equal(f.run('--check').status, 0);
});

test('a figure cropped from the solutions document moves even without a "-sol-" id; a same-crop duplicate is shown once', t => {
  const id = 'ipho-2023-experiment-q5';
  const statementFig = fig(id, 'p1-fig1', { page: 1, pdfRect: [222, 376, 373, 495] });
  const answerPlot = fig(id, 'p1-fig-b2', { page: 7, pdfRect: [100, 207, 532, 578], document: 'solutions' });
  const dupInStatement = fig(id, 'p6-sol-fig1', { page: 6, pdfRect: [135, 465, 450, 613], document: 'solutions' });
  const own = fig(id, 'p6-sol-fig2', { page: 6, pdfRect: [135, 465, 450, 613], document: 'solutions' });
  const f = fixture(t, { paper: basePaper(id, { subject: 'physics', competition: 'IPhO', year: 2023, solutionSource: { archiveKey: 'Физика/s.pdf' } }), problems: [{
    id: `${id}-p1`, number: 1, statement: 'Statement.', figures: [statementFig, answerPlot, dupInStatement],
    solution: { statement: 'Solution.', figures: [own] },
  }] });
  assert.deepEqual(misplacedSolutionFigures({ solutionSource: { archiveKey: 'x' } }, { figures: [statementFig, answerPlot, dupInStatement], solution: { figures: [own] } }).map(m => [m.fig.id, m.reason]),
    [['p1-fig-b2', 'document'], ['p6-sol-fig1', 'id']]);
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  const mdx = f.page(`${id}-p1`);
  assert.equal(placement(mdx, statementFig.url), 'statement');
  assert.equal(placement(mdx, answerPlot.url), 'solution-spoiler');
  assert.equal(placement(mdx, own.url), 'solution-spoiler');
  assert.equal(placement(mdx, dupInStatement.url), 'absent', 'the solution already shows this exact crop box');
});

test('combined problems+solutions PDF (SPbA): figures at or after the solution\'s first figure move, earlier ones stay', t => {
  const id = 'spba-2023-ii-11-pract';
  const sheet = fig(id, 'p1-fig1', { page: 2, pdfRect: [94, 37, 419, 794] });
  const ris1 = fig(id, 'p1-fig2-v2', { page: 3, pdfRect: [97, 25, 410, 768] }, { caption: 'Рис. 1: Определение угла наклона.' });
  const ris2 = fig(id, 'p1-fig3', { page: 4, pdfRect: [86, 136, 527, 393] }, { caption: 'Рис. 2: Кривая вращения.' });
  const laterSamePage = fig(id, 'p1-fig4', { page: 4, pdfRect: [86, 500, 527, 700] });
  const sol1 = fig(id, 'p1-sol-fig1-v2', { page: 3, pdfRect: [97, 25, 410, 768] }, { caption: 'Рис. 1: Определение угла наклона.' });
  const sol2 = fig(id, 'p1-sol-fig2', { page: 4, pdfRect: [86, 136, 527, 393] }, { caption: 'Рис. 2: Кривая вращения.' });
  const f = fixture(t, { paper: basePaper(id, { competition: 'SPbA', year: 2023, lang: 'ru', source: { archiveKey: 'Астрономия/pract.pdf', pages: [1, 2, 3, 4, 5] } }), problems: [{
    id: `${id}-p1`, number: 1, statement: 'Вам на отдельном листе дано изображение.', figures: [sheet, ris1, ris2, laterSamePage],
    sourceSpans: [1, 2, 3, 4, 5].map(page => ({ document: 'problems', page })),
    solution: { statement: 'Впишем эллипс (см. рис. 1). Итоговая кривая на рис. 2.', figures: [sol1, sol2] },
  }] });
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  const mdx = f.page(`${id}-p1`);
  assert.equal(placement(mdx, sheet.url), 'statement');
  assert.equal(placement(mdx, ris1.url), 'absent'); // the solution's own crop of the same box is shown instead
  assert.equal(placement(mdx, ris2.url), 'absent');
  assert.equal(placement(mdx, laterSamePage.url), 'solution-spoiler');
  for (const s of [sol1, sol2]) assert.equal(placement(mdx, s.url), 'solution-spoiler');
  assert.equal((mdx.match(/Рис\. 1:/g) || []).length, 1);
});

test('statement figures the solution merely repeats stay in the statement (separate PDFs, reused url)', t => {
  const id = 'esf-2014-esenno-9';
  const statementFig = fig(id, 'p1-fig1', { page: 1, pdfRect: [119, 387, 508, 517] }, { caption: 'Фиг. 1' });
  const later = fig(id, 'p1-fig2', { page: 2, pdfRect: [119, 100, 508, 200] });
  const f = fixture(t, { paper: basePaper(id, { subject: 'physics', competition: 'ESF', year: 2014, solutionSource: { archiveKey: 'Физика/s.pdf' } }), problems: [{
    id: `${id}-p1`, number: 1, statement: 'Топче, както е показано на фиг. 1.', figures: [statementFig, later],
    solution: { statement: 'Решение.', figures: [{ ...statementFig }, fig(id, 'p1-sol-fig9', { page: 1, pdfRect: [1, 1, 50, 50] })] },
  }] });
  assert.deepEqual(misplacedSolutionFigures({}, { figures: [statementFig, later], solution: { figures: [{ ...statementFig }] } }), [], 'a reused statement url never marks where a solution starts');
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  const mdx = f.page(`${id}-p1`);
  const at = mdx.indexOf(statementFig.url), solution = mdx.indexOf('## Решение');
  assert.ok(at >= 0 && at < solution, 'statement copy stays');
  assert.ok(mdx.indexOf(statementFig.url, at + 1) > solution, 'the solution keeps its own reference');
  assert.equal(placement(mdx, later.url), 'statement');
});

test('solution figures without solution text are still hidden behind a spoiler', t => {
  const id = 'nao-2001-ii-7-8';
  const leaked = fig(id, 'p1-sol-fig1', { page: 2, pdfRect: [1, 1, 50, 50], document: 'solutions' });
  const incompleteOwn = fig(id, 'p2-sol-fig1', { page: 3, pdfRect: [1, 1, 50, 50], document: 'solutions' });
  const f = fixture(t, { paper: basePaper(id), problems: [
    { id: `${id}-p1`, number: 1, statement: 'Без решение.', figures: [leaked] },
    { id: `${id}-p2`, number: 2, statement: 'Непълно решение.', solution: { incomplete: true, incompleteReason: 'Липсва.', figures: [incompleteOwn] } },
  ] });
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  const one = f.page(`${id}-p1`), two = f.page(`${id}-p2`);
  assert.equal(placement(one, leaked.url), 'solution-spoiler');
  assert.match(one, /<Spoiler title="Покажи фигурите от официалното решение">/);
  assert.equal(placement(two, incompleteOwn.url), 'solution-spoiler');
  assert.ok(two.indexOf('Непълно решение"') < two.indexOf('<Spoiler'), 'the incomplete warning stays in front');
});

test('a problem without misplaced figures renders exactly as before', t => {
  const id = 'nao-2002-ii-7-8';
  const statementFig = fig(id, 'p1-fig1', { page: 1, pdfRect: [1, 1, 50, 50] });
  const own = fig(id, 'p1-sol-fig1', { page: 1, pdfRect: [1, 1, 50, 50], document: 'solutions' });
  const f = fixture(t, { paper: basePaper(id), problems: [{ id: `${id}-p1`, number: 1, statement: 'Условие.', figures: [statementFig], solution: { statement: 'Решение.', figures: [own] } }] });
  assert.equal(f.run().status, 0);
  const mdx = f.page(`${id}-p1`);
  const block = x => `<figure className="problem-figure problem-figure--sized" style={{'--fig-w': '10.2%', '--fig-max': '32px'}}>\n<img src="${x.url}" alt="${x.alt}" width="100" height="100" loading="lazy" decoding="async" />\n</figure>`;
  assert.ok(mdx.includes(`## Условие\n\nУсловие.\n\n${block(statementFig)}\n\n## Решение\n\n<Spoiler title="Покажи официалното решение">\n\nРешение.\n\n${block(own)}\n\n\n</Spoiler>\n`));
});

test('validate.mjs warns (not errors) about a solution figure in a candidate statement', t => {
  const dir = fs.mkdtempSync(path.join(repo, 'tmp/solfig-validate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = 'spba-2025-ii-9-theo';
  const box = (document, page, bbox) => ({ tx: { document, page, bbox } });
  const candidate = { paper: { ...basePaper(id, { competition: 'SPbA', year: 2025, lang: 'ru' }), status: 'draft' }, problems: [{
    id: `${id}-p5`, number: 1, statement: 'Условие.',
    figures: [{ id: 'p5-fig1', alt: 'a', ...box('problems', 3, [100, 100, 400, 400]) }, { id: 'p5-fig2', alt: 'b', ...box('problems', 4, [100, 700, 400, 900]) }],
    parts: [{ label: '1)', statement: 'Часть.', figures: [{ id: 'p5-sol-fig9', alt: 'c', ...box('problems', 5, [100, 100, 400, 400]) }] }],
    solution: { statement: 'Решение.', figures: [{ id: 'p5-sol-fig1', alt: 'd', ...box('problems', 4, [100, 50, 400, 300]) }] },
  }] };
  const file = path.join(dir, 'candidate.json');
  fs.writeFileSync(file, jsonText(candidate));
  const r = spawnSync(process.execPath, [path.join(repo, 'scripts/tx/validate.mjs'), file, '--mode', 'candidate'], { encoding: 'utf8' });
  const report = JSON.parse(r.stdout);
  const flagged = report.warnings.filter(w => /belongs to the official solution/.test(w.message));
  assert.deepEqual(flagged.map(w => w.path).sort(), ['/problems/0/figures/1', '/problems/0/parts/0/figures/0']);
  assert.match(flagged.find(w => w.path === '/problems/0/figures/1').message, /combined problems\+solutions PDF/);
  assert.ok(!report.errors.some(e => /official solution/.test(e.message)));
});

test('listed combined-PDF solution drawings (no solution figure to anchor on) move into the solution spoiler', t => {
  const id = 'spba-2025-ii-7-8-theo';
  const drawing = fig(id, 'p4-fig1', { page: 3, pdfRect: [241, 17, 367, 207] });
  const other = fig(id, 'p3-fig1', { page: 2, pdfRect: [100, 300, 400, 500] });
  const f = fixture(t, { paper: basePaper(id, { competition: 'SPbA', year: 2025, lang: 'ru', source: { archiveKey: 'Астрономия/theo.pdf', pages: [1, 2, 3, 4] } }), problems: [
    { id: `${id}-p3`, number: 3, statement: 'Другая задача.', figures: [other], solution: { statement: 'Решение 3.' } },
    { id: `${id}-p4`, number: 4, statement: 'В день равноденствия путешественник…', figures: [drawing], sourceSpans: [{ document: 'problems', page: 2 }, { document: 'problems', page: 3 }],
      solution: { statement: 'Нарисуем схему перемещения путешественника за 12 часов.' } },
  ] });
  assert.deepEqual(misplacedSolutionFigures({}, { id: `${id}-p4`, figures: [drawing], solution: { statement: 'x' } }).map(m => m.reason), ['listed']);
  assert.deepEqual(misplacedSolutionFigures({}, { id: `${id}-p3`, figures: [{ ...drawing }] }), [], 'the override is per problem id');
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(placement(f.page(`${id}-p4`), drawing.url), 'solution-spoiler');
  assert.ok(f.page(`${id}-p4`).indexOf('Нарисуем схему') < f.page(`${id}-p4`).indexOf(drawing.url));
  assert.equal(placement(f.page(`${id}-p3`), other.url), 'statement');
});

test('every SOLUTION_FIGURES entry names a published statement figure, and its page shows it only in the solution spoiler', () => {
  const entries = Object.entries(SOLUTION_FIGURES);
  assert.ok(entries.length >= 6);
  for (const [problemId, figIds] of entries) {
    const paperId = problemId.replace(/-p\d+$/, '');
    const hits = [];
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === `${paperId}.json` && hits.push(path.join(dir, e.name)));
    walk(path.join(repo, 'content/problems'));
    assert.equal(hits.length, 1, `${paperId}: one content file`);
    const data = JSON.parse(fs.readFileSync(hits[0], 'utf8'));
    const problem = data.problems.find(p => p.id === problemId);
    assert.ok(problem, problemId);
    assert.ok(problem.solution?.statement, `${problemId}: has solution text`);
    const mdx = fs.readFileSync(path.join(repo, `solutions/${data.paper.subject}/${paperId}/${problemId}.mdx`), 'utf8');
    for (const figId of figIds) {
      const f = [...(problem.figures || []), ...(problem.parts || []).flatMap(p => p.figures || [])].find(x => x.id === figId);
      assert.ok(f, `${problemId}/${figId} is a statement figure`);
      assert.ok(misplacedSolutionFigures(data.paper, problem).some(m => m.fig === f), `${problemId}/${figId} is moved`);
      assert.equal(placement(mdx, f.url), 'solution-spoiler', `${problemId}/${figId} on the published page`);
    }
  }
});

// a pdftotext -tsv excerpt: page rows (level 1), line rows (level 4), word rows (level 5)
const tsv = (pages) => ['level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  ...pages.flatMap(([page, lines]) => [`1\t${page}\t0\t0\t0\t0\t0\t0\t595\t842\t-1\t###PAGE###`,
    ...lines.flatMap(([top, text]) => [`4\t${page}\t0\t0\t0\t0\t60\t${top}\t400\t14\t-1\t###LINE###`,
      ...text.split(' ').map((w, k) => `5\t${page}\t0\t0\t0\t${k}\t${60 + k * 30}\t${top}\t28\t14\t100\t${w}`)])])].join('\n');

test('textLayerLines reads pdftotext -tsv into page-ordered lines with page heights', () => {
  const layer = textLayerLines(tsv([[2, [[300, 'second line'], [100, 'first & line']]], [3, [[50, 'next page']]]]));
  assert.deepEqual(layer.lines, [{ page: 2, top: 100, text: 'first & line' }, { page: 2, top: 300, text: 'second line' }, { page: 3, top: 50, text: 'next page' }]);
  assert.deepEqual(layer.heights, { 2: 842, 3: 842 });
  assert.deepEqual(textLayerLines(''), { lines: [], heights: {} });
});

test('figuresBelowSolutionHeading flags a statement figure below its own problem\'s printed solution heading', () => {
  const layer = textLayerLines(tsv([
    [1, [[100, '3. Предыдущая задача про Луну.'], [200, 'Решение: предыдущее.']]],
    [2, [[100, '4. В день равноденствия путешественник на восходе'], [140, 'Солнца выехал… в начало своего'], [160, 'решения. Влиянием атмосферы'], [400, 'Решение:'], [420, 'Скорость путешественника невелика']]],
    [3, [[300, 'Путешественник двигался по гипотенузе']]],
  ]));
  const problem = { id: 'x-p4', statement: '**4.** В день равноденствия путешественник на восходе Солнца выехал', figures: [
    fig('x', 'p4-fig1', { page: 2, pdfRect: [100, 180, 300, 380] }), // beside/below the statement, above the heading
    fig('x', 'p4-fig2', { page: 2, pdfRect: [100, 430, 300, 600] }), // below the heading
    fig('x', 'p4-fig3', { page: 3, pdfRect: [100, 17, 300, 207] }), // top of the next page
  ], parts: [{ label: 'а)', statement: 'Часть', figures: [{ id: 'p4-fig4', alt: 'c', tx: { document: 'problems', page: 2, bbox: [100, 600, 400, 800] } }] }] };
  const hits = figuresBelowSolutionHeading({}, problem, layer);
  assert.deepEqual(hits.map(h => h.fig.id), ['p4-fig2', 'p4-fig3', 'p4-fig4'], 'lowercase «решения.» wrapped from the statement is no heading');
  assert.deepEqual(hits[0].heading, { page: 2, text: 'Решение:' });
  assert.equal(hits[2].path, 'parts/0/figures/0');
  assert.deepEqual(figuresBelowSolutionHeading({ solutionSource: { archiveKey: 's.pdf' }, source: { archiveKey: 'p.pdf' } }, problem, layer), [], 'separate solutions document');
  assert.deepEqual(figuresBelowSolutionHeading({}, { ...problem, statement: 'Нет такой задачи в тексте вообще' }, layer), [], 'problem start not found');
  assert.deepEqual(figuresBelowSolutionHeading({}, problem, { lines: [], heights: {} }), [], 'scanned PDF: no text layer');
  // a figure the other rules already move is not reported twice
  assert.deepEqual(figuresBelowSolutionHeading({}, { ...problem, id: 'spba-2025-ii-7-8-theo-p4', figures: [fig('x', 'p4-fig1', { page: 3, pdfRect: [1, 1, 5, 5] })], parts: [] }, layer), []);
  // numbered heading (vserusiyska «11.3. Возможное решение.»)
  const v = textLayerLines(tsv([[5, [[69, '11.3. Плоский конденсатор. Две круглые'], [180, '11.3. Возможное решение. Напряжённость']]]]));
  assert.deepEqual(figuresBelowSolutionHeading({}, { statement: '**11.3. Плоский конденсатор.** Две круглые', figures: [fig('v', 'a', { page: 5, pdfRect: [1, 90, 5, 170] }), fig('v', 'b', { page: 5, pdfRect: [1, 200, 5, 300] })] }, v).map(h => h.fig.id), ['b']);
});

const havePdf = spawnSync('python3', ['-c', 'import fitz'], { encoding: 'utf8' }).status === 0 && spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).status === 0;
test('validate.mjs --manifest warns about a statement figure below the solution heading of a combined PDF', { skip: !havePdf && 'python3 + PyMuPDF or pdftotext missing' }, t => {
  const dir = fs.mkdtempSync(path.join(repo, 'tmp/solfig-layer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src'));
  const pdf = path.join(dir, 'src/problems.pdf');
  const py = spawnSync('python3', ['-c', `
import fitz, sys
doc = fitz.open(); page = doc.new_page(width=595, height=842)
for y, t in [(80, '1. A traveller leaves the equator at sunrise'), (120, 'and walks north-west. Where is he at sunset?'), (420, 'Solution: draw the path of the traveller.')]:
    page.insert_text((60, y), t, fontsize=11)
doc.save(sys.argv[1])`, pdf], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const id = 'spba-2099-ii-7-8-theo';
  const manifest = { paperId: id, renderDpi: 160, documents: { problems: { key: 'Астрономия/theo.pdf', file: 'src/problems.pdf', pages: 1, pageSizes: [{ page: 1, widthPt: 595, heightPt: 842 }] } } };
  fs.writeFileSync(path.join(dir, 'manifest.json'), jsonText(manifest));
  const box = (page, bbox) => ({ tx: { document: 'problems', page, bbox } });
  const candidate = { paper: { ...basePaper(id, { competition: 'SPbA', year: 2099, lang: 'en', source: { archiveKey: 'Астрономия/theo.pdf', pages: [1] } }), status: 'draft' }, problems: [{
    id: `${id}-p1`, number: 1, statement: 'A traveller leaves the equator at sunrise and walks north-west. Where is he at sunset?',
    figures: [{ id: 'p1-fig1', alt: 'given map', ...box(1, [100, 170, 500, 450]) }, { id: 'p1-fig2', alt: 'path', ...box(1, [100, 560, 500, 800]) }],
    solution: { statement: 'Draw the path of the traveller.' },
  }] };
  const file = path.join(dir, 'candidate.json');
  fs.writeFileSync(file, jsonText(candidate));
  const r = spawnSync(process.execPath, [path.join(repo, 'scripts/tx/validate.mjs'), file, '--mode', 'candidate', '--manifest', path.join(dir, 'manifest.json')], { encoding: 'utf8' });
  const report = JSON.parse(r.stdout);
  const flagged = report.warnings.filter(w => /printed solution heading/.test(w.message));
  assert.deepEqual(flagged.map(w => w.path), ['/problems/0/figures/1']);
  assert.match(flagged[0].message, /\("Solution:[^"]*", page 1\)/);
  assert.ok(!report.errors.some(e => /solution heading/.test(e.message)));
});
