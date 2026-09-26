// Problem pages and the /problems list (site audit 2026-09, batch B): previous/next problem and the archive year
// link (src/problems/page-links.ts), the original's format (ComparePanel/originalFormat.ts), the list's order,
// difficulty scale and URL state (ProblemsPage/problemSearch.ts) and the sidebar's scroll position
// (ProblemsTree/sidebarScroll.ts). The modules are the TypeScript the site runs, loaded with the repository's
// typescript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTreeModule, loadTsModule } from '../lib/load-tree.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = relative => loadTsModule(path.join(repo, relative), repo);
const tree = loadTreeModule(repo);
const links = load('src/problems/page-links.ts');
const format = load('src/components/ComparePanel/originalFormat.ts');
const search = load('src/components/ProblemsPage/problemSearch.ts');
const sidebar = load('src/components/ProblemsTree/sidebarScroll.ts');

function paper(id, fields, n) {
  return {
    paper: { id, subject: 'astronomy', competition: 'NAO', year: 2024, lang: 'bg', title: '', ...fields },
    problems: Array.from({ length: n }, (_, i) => ({ id: `${id}-p${i + 1}`, number: i + 1, title: `Т${i + 1}` })),
  };
}

test('previous and next problem run through the papers of a year in sidebar order, and stop at the year', () => {
  const files = [
    paper('nao-2024-ii-7-8', { round: 'II', grade: '7-8' }, 2),
    paper('nao-2024-ii-5-6', { round: 'II', grade: '5-6' }, 2),
    paper('nao-2023-ii-5-6', { year: 2023, round: 'II', grade: '5-6' }, 1),
  ];
  const urls = new Map(files.flatMap(f => f.problems.map(p => [p.id, `/problems/${p.id}/solution`])));
  const data = tree.assembleProblemsTree(files, urls, undefined, {});
  const n = links.problemNeighbours(data);

  const first = n.get('nao-2024-ii-5-6-p1');
  assert.equal(first.prev, null);
  assert.deepEqual(first.next, { url: '/problems/nao-2024-ii-5-6-p2/solution', label: 'Задача 2. Т2', paper: null });

  // the last problem of the 5-6 paper leads to the first of the 7-8 paper, which names its paper
  const crossing = n.get('nao-2024-ii-5-6-p2').next;
  assert.equal(crossing.url, '/problems/nao-2024-ii-7-8-p1/solution');
  assert.ok(crossing.paper && crossing.paper.includes('7'), crossing.paper);
  assert.equal(n.get('nao-2024-ii-7-8-p1').prev.url, '/problems/nao-2024-ii-5-6-p2/solution');

  assert.equal(n.get('nao-2024-ii-7-8-p2').next, null);
  // another year is another sequence
  assert.deepEqual(n.get('nao-2023-ii-5-6-p1'), { prev: null, next: null });
});

test('a problem page links the archive year page that lists its paper, else its competition and year, else none', () => {
  const pages = links.archiveYearPages([
    { subject: 'physics', kind: 'competition', competition: 'IPhO', year: 2019, file: 'Физика/Състезания/IPhO/2019/Theory/T1.pdf' },
    { subject: 'physics', kind: 'competition', competition: 'NOF', year: 2019, file: 'Физика/Състезания/NOF/2019/NOF3.pdf' },
    { subject: 'physics', kind: 'book', competition: 'NOF', year: 2018, file: 'Физика/Книги/nof.pdf' },
    { subject: 'physics', kind: 'competition', competition: 'NOF', year: null, file: 'Физика/Състезания/NOF/regulations.pdf' },
  ]);
  const ipho = links.archiveYearLink(
    { subject: 'physics', competition: 'IPhO', year: 2019, archiveKey: 'Физика/Състезания/IPhO/2019/Theory/T1.pdf' },
    pages
  );
  assert.match(ipho.path, /^\/archive\/physics\/[a-z0-9-]+\/2019\/$/);
  assert.match(ipho.label, / 2019$/);
  // a paper whose file the catalog does not have still finds its year page
  const nof = links.archiveYearLink({ subject: 'physics', competition: 'NOF', year: 2019, archiveKey: 'elsewhere.pdf' }, pages);
  assert.match(nof.path, /\/2019\/$/);
  assert.equal(nof.label, 'НОФ 2019');
  // a 2020 paper filed in the 2019 folder names the folder, not a second year
  const shelved = links.archiveYearLink({ subject: 'physics', competition: 'NOF', year: 2020, archiveKey: 'Физика/Състезания/NOF/2019/NOF3.pdf' }, pages);
  assert.match(shelved.path, /\/2019\/$/);
  assert.equal(shelved.label, 'НОФ, папка 2019');
  // books are on the shelf, not on a year page; undated entries have no year page
  assert.equal(links.archiveYearLink({ subject: 'physics', competition: 'NOF', year: 2018 }, pages), null);
  assert.equal(links.archiveYearLink({ subject: 'astronomy', competition: 'NOF', year: 2019 }, pages), null);
});

test('the sidebar row and previous/next drop a points note the page heading drops', () => {
  const file = paper('izho-2022-theory', { competition: 'IZhO', year: 2022 }, 2);
  file.problems[0].title = 'Problem 1';
  file.problems[1].title = 'Problem 2. Greenhouse effect (10.0 points)';
  file.problems[0].points = 10;
  file.problems[1].points = 10;
  assert.equal(tree.problemDisplayName(file.problems[1]), 'Задача 2. Problem 2. Greenhouse effect');
  assert.equal(tree.problemDisplayName({ ...file.problems[1], points: 8 }), 'Задача 2. Problem 2. Greenhouse effect (10.0 points)');
  const urls = new Map(file.problems.map(p => [p.id, `/problems/${p.id}/solution`]));
  const data = tree.assembleProblemsTree([file], urls, undefined, {});
  assert.equal(links.problemNeighbours(data).get('izho-2022-theory-p1').next.label, 'Задача 2. Problem 2. Greenhouse effect');
});

test('only a real non-Bulgarian language code becomes a lang attribute', () => {
  assert.equal(links.foreignLang('en'), 'en');
  assert.equal(links.foreignLang('RU'), 'ru');
  assert.equal(links.foreignLang('bg'), null);
  assert.equal(links.foreignLang('other'), null);
  assert.equal(links.foreignLang(null), null);
});

test('the original\'s format comes from its file name, and only a browser-viewable one is embedded', () => {
  assert.equal(format.originalFormat('https://a.test/x/NOF3_2019.pdf#page=2'), 'pdf');
  assert.equal(format.originalFormat('https://a.test/%D0%A4/st_sen2.DOC#page=1'), 'word');
  assert.equal(format.originalFormat('https://a.test/x/p15.docx?download=1'), 'word');
  assert.equal(format.originalFormat('https://a.test/x/iypt1998.txt'), 'text');
  assert.equal(format.originalFormat('https://a.test/x/folder/'), 'other');
  assert.equal(format.originalFormat(undefined), 'other');
  assert.equal(format.isEmbeddable('pdf'), true);
  assert.equal(format.isEmbeddable('text'), true);
  assert.equal(format.isEmbeddable('word'), false);
  // a page fragment means something to a PDF viewer only
  assert.equal(format.embedUrl('https://a.test/a.txt#page=3', 'text'), 'https://a.test/a.txt');
  assert.equal(format.embedUrl('https://a.test/a.pdf#page=3', 'pdf'), 'https://a.test/a.pdf#page=3');
});

test('one difficulty scale: an estimated level wins, an unestimated label never hides the recorded difficulty', () => {
  assert.equal(search.problemDifficulty({ difficulty: 'N/A', assessmentLabel: 'Оценена трудност: 3/5' }), 'Normal');
  assert.equal(search.problemDifficulty({ difficulty: 'Easy', assessmentLabel: 'Калибрирана трудност: 5/5' }), 'Very Hard');
  assert.equal(search.problemDifficulty({ difficulty: 'Hard', assessmentLabel: 'Трудност: неоценена' }), 'Hard');
  assert.equal(search.problemDifficulty({ difficulty: '', assessmentLabel: null }), 'N/A');
});

test('the list opens newest year first, a paper\'s problems in their order, problems without a year last', () => {
  const p = (uniqueId, year, competition) => ({ uniqueId, year, competition });
  const list = [
    p('nof-2019-p10', 2019, 'NOF'),
    p('ipho-2024-p1', 2024, 'IPhO'),
    p('nof-2019-p2', 2019, 'NOF'),
    p('usaco-x', null, null),
    p('nao-2024-p1', 2024, 'NAO'),
  ];
  const rank = code => ['NAO', 'NOF', 'IPhO'].indexOf(code ?? '') + 1 || 9;
  const ids = sort => search.sortProblems(list, sort, rank).map(x => x.uniqueId);
  assert.deepEqual(ids('newest'), ['nao-2024-p1', 'ipho-2024-p1', 'nof-2019-p2', 'nof-2019-p10', 'usaco-x']);
  assert.deepEqual(ids('oldest'), ['nof-2019-p2', 'nof-2019-p10', 'nao-2024-p1', 'ipho-2024-p1', 'usaco-x']);
  assert.deepEqual(ids('competition'), ['nao-2024-p1', 'nof-2019-p2', 'nof-2019-p10', 'ipho-2024-p1', 'usaco-x']);
  assert.equal(list[0].uniqueId, 'nof-2019-p10', 'the input is not reordered in place');
  // one round in two files (1–2 in -x, 26–27 in -2) reads in problem order; two language versions stay whole
  const h = (uniqueId, source) => ({ uniqueId, year: 2018, competition: 'HOOS', source });
  const round = [h('hoos-2018-selection-2-p26', 'ХООС 2018, Подборен кръг'), h('hoos-2018-selection-2-p27', 'ХООС 2018, Подборен кръг'),
    h('hoos-2018-selection-x-p2', 'ХООС 2018, Подборен кръг'), h('hoos-2018-selection-x-p1', 'ХООС 2018, Подборен кръг'),
    h('hoos-2018-iii-p1', 'ХООС 2018, III кръг'), h('hoos-2018-cgp-fr-p1', 'Тема'), h('hoos-2018-cgp-en-p2', 'Тема'), h('hoos-2018-cgp-en-p1', 'Тема')];
  assert.deepEqual(search.sortProblems(round, 'newest', rank).map(x => x.uniqueId), ['hoos-2018-cgp-en-p1', 'hoos-2018-cgp-en-p2', 'hoos-2018-cgp-fr-p1',
    'hoos-2018-iii-p1', 'hoos-2018-selection-x-p1', 'hoos-2018-selection-x-p2', 'hoos-2018-selection-2-p26', 'hoos-2018-selection-2-p27']);
});

test('the filters, order and page survive a round trip through the URL', () => {
  const state = {
    q: 'махало',
    filters: { subject: ['chemistry'], year: ['2019', '2020'], tags: ['Optics', 'Оптика'] },
    page: 2,
    sort: 'oldest',
    perPage: 48,
  };
  const url = search.problemsUrlSearch(state);
  assert.match(url, /^\?q=/);
  assert.match(url, /page=3/);
  assert.deepEqual(search.parseProblemsUrl(url), state);
  // defaults stay out of the URL; unknown or broken values fall back to them
  assert.equal(search.problemsUrlSearch({ q: '', filters: {}, page: 0, sort: 'newest', perPage: null }), '');
  const parsed = search.parseProblemsUrl('?subject=chemistry&page=0&sort=bogus&n=x&source=NOF%202019');
  assert.deepEqual(parsed, { q: '', filters: { subject: ['chemistry'] }, page: 0, sort: 'newest', perPage: null });
  assert.equal(search.parseProblemsUrl('?subject=chemistry&page=3').page, 2);
});

test('counts read as Bulgarian', () => {
  assert.equal(search.problemsCountLabel(1), '1 задача');
  // the count is of problems with a page here, the sidebar's number; source-only module problems come after it
  const own = { solution: { kind: 'internal' } }, linked = { solution: { kind: 'link' } };
  const all = [own, own, own, linked];
  assert.equal(search.resultsCountLabel(all, all), '3 задачи · още 1 с връзка към източника');
  assert.equal(search.resultsCountLabel([own], all), '1 задача от 3');
  assert.equal(search.resultsCountLabel([own, own, own], [own, own, own]), '3 задачи');
  assert.equal(search.problemsCountLabel(8674), '8 674 задачи');
  assert.equal(sidebar.problemCount(50), '50 задачи');
  assert.equal(sidebar.problemCount(1, true), '1 problem');
});

test('the sidebar keeps the competition row and year picker in view when the current problem fits below them', () => {
  // fits: the competition row goes to the top
  assert.equal(sidebar.sidebarScrollTop({ anchorTop: 400, itemTop: 900, itemHeight: 36, viewHeight: 700 }), 400);
  // does not fit: the problem row is centred (the year picker is sticky)
  assert.equal(sidebar.sidebarScrollTop({ anchorTop: 400, itemTop: 1400, itemHeight: 36, viewHeight: 700 }), 1068);
  assert.equal(sidebar.sidebarScrollTop({ anchorTop: null, itemTop: 100, itemHeight: 36, viewHeight: 700 }), 0);
});
