// The archive pages' labels and row logic (src/archive/labels.ts, display.ts,
// catalog-node.ts) against the real catalog: stage names, shelf search, row
// titles, folded page images, the library tree, links to problems on the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');

// Transpiles src/archive/*.ts on the fly; relative imports resolve to the .ts files.
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const req = spec => (spec.startsWith('.') ? load(path.resolve(path.dirname(file), `${spec}.ts`)) : require(spec));
  new Function('require', 'module', 'exports', 'process', compiled)(req, module, module.exports, { env: {} });
  return module.exports;
}
const labels = load(path.join(repo, 'src/archive/labels.ts'));
const display = load(path.join(repo, 'src/archive/display.ts'));
const catalog = load(path.join(repo, 'src/archive/catalog-node.ts'));

const entries = catalog.loadCatalog(repo);
const grouped = catalog.groupCatalog(entries);
// the rows of static/archive-data/<science>.json, as writeSearchIndexes builds them
const shelf = science => {
  const s = grouped[science];
  return [
    ...Object.entries(s.competitions).flatMap(([comp, list]) => list.map(e => ({ ...e, comp }))),
    ...s.library.map(e => ({ ...e, comp: null })),
    ...s.uncategorized.map(e => ({ ...e, comp: null })),
  ];
};
const search = (science, q) => shelf(science).filter(e => display.matchesQuery(e, q));

test('Bulgarian stage names only on Bulgarian olympiads', () => {
  assert.equal(labels.roundLabel('III', 'NOF'), 'III кръг (национален)');
  assert.equal(labels.roundLabel('II', 'NAO'), 'II кръг (областен)');
  assert.equal(labels.roundLabel('regional', 'Всерусийска'), 'Регионален етап');
  assert.equal(labels.roundLabel('II', 'Всерусийска'), 'Общински етап');
  assert.equal(labels.roundLabel('IV', 'Всерусийска'), 'Финален етап');
  assert.equal(labels.roundLabel('III', 'BelPhO'), 'III етап (областен)');
  assert.equal(labels.roundLabel('II', 'SPbA'), 'II кръг');
  assert.equal(labels.roundLabel('theory', 'IPhO'), 'Теоретичен тур');
  // without a competition (older callers) the map is unchanged
  assert.equal(labels.roundLabel('I'), 'I кръг (общински)');
  // no foreign competition in the catalog shows a Bulgarian stage
  const wrong = entries.filter(
    e => e.competition && !labels.BULGARIAN_STAGED.has(e.competition) &&
      /общински|областен|национален/.test(labels.roundLabel(e.round, e.competition) ?? '') &&
      !labels.COMPETITION_ROUND_LABELS[e.competition]?.[e.round]
  );
  assert.deepEqual(wrong.map(e => e.id), []);
});

test('ВсОШ по физика: regional stage is `regional`, municipal is II', () => {
  const vsosh = entries.filter(e => e.competition === 'Всерусийска');
  assert.deepEqual(vsosh.filter(e => e.round === 'III' || e.round === 'I').map(e => e.id), []);
  const y2015 = vsosh.filter(e => e.year === 2015).map(e => labels.roundLabel(e.round, e.competition));
  assert.ok(y2015.includes('Регионален етап'));
  assert.ok(!y2015.some(l => /национален/.test(l)));
});

test('the regional stage sorts before the zonal stage and the final', () => {
  const o = labels.ROUND_ORDER;
  assert.ok(o.indexOf('regional') < o.indexOf('zonal') && o.indexOf('zonal') < o.indexOf('IV'));
});

test('shelf search matches the short names, folders and years the site shows', () => {
  assert.ok(search('physics', 'ВсОШ 2015').length > 0);
  const nof2024 = search('physics', 'НОФ 2024');
  assert.ok(nof2024.length >= 40, `НОФ 2024: ${nof2024.length}`);
  assert.ok(nof2024.every(e => e.comp === 'NOF'));
  assert.equal(search('physics', 'Иродов').length, 3);
  assert.equal(search('physics', 'zzzqqq').length, 0);
  // case and Unicode form do not matter
  assert.equal(search('physics', 'иродов').length, 3);
  assert.equal(search('physics', 'Иродов'.normalize('NFD')).length, 3);
});

test('row titles lose what the year page heading and section already say', () => {
  const t = (title, year, round) => display.shortTitle({ title, year }, { round });
  assert.equal(t('Национална олимпиада по физика 2024 – II Областен кръг – 10. клас (условия)', 2024, 'II'), '10. клас (условия)');
  assert.equal(t('НОФ 2024 · III кръг (национален) · 11–12 клас · Експериментална задача 1 · Условия', 2024, 'III'),
    '11–12 клас · Експериментална задача 1 · Условия');
  assert.equal(t('Национална олимпиада по астрономия 2020, I кръг (общински) – условия (11-12 клас)', 2020, 'I'), 'Условия (11-12 клас)');
  assert.equal(t('IPhO 2019 · Теория · Задача 1 · Условия', 2019, 'theory'), 'Задача 1 · Условия');
  assert.equal(t('Всерусийска олимпиада 2003 · Зонален (окръжен) етап · Теория', 2003, 'zonal'), 'Теория');
  assert.equal(t('IPhO 2022 (online) · Официални документи · Етичен кодекс', 2022, null), 'Официални документи · Етичен кодекс');
  // another year in the title, or nothing left after the cut: unchanged
  assert.equal(t('IPhO 2018 – Резултати', 2019, null), 'IPhO 2018 – Резултати');
  assert.equal(t('IOAA 2019', 2019, null), 'IOAA 2019');
  // a round the section does not name stays
  assert.equal(t('НОФ 2024 · IV Подбор · Условия', 2024, 'IV'), 'IV Подбор · Условия');
});

test('page images of one document fold into one row', () => {
  const idpho = grouped.physics.competitions.IdPhO.filter(e => e.year === 2020 && e.round === 'experiment');
  const items = display.foldImageRuns(idpho.sort((a, b) => a.title.localeCompare(b.title, 'bg', { numeric: true })));
  const runs = items.filter(i => i.kind === 'images');
  assert.ok(runs.length >= 1);
  assert.ok(items.length < idpho.length / 3, `${items.length} rows for ${idpho.length} files`);
  assert.match(runs[0].title, /Решения$/);
  // two images are left as rows
  const two = idpho.filter(e => e.ext === 'img').slice(0, 2);
  assert.equal(display.foldImageRuns(two).length, 2);
});

test('library tree: nested folders, no „Книги“ level, Bulgarian folder names', () => {
  const tree = display.folderTree(grouped.physics.library, labels.folderLabel);
  const names = tree.map(n => n.name);
  assert.ok(!names.includes('Книги'));
  assert.ok(names.includes('Материали'), names.join(', '));
  const all = n => [n, ...n.children.flatMap(all)];
  const nodes = tree.flatMap(all);
  assert.ok(nodes.some(n => n.name === 'Иродов' && n.total === 3));
  const total = tree.reduce((a, n) => a + n.total, 0);
  assert.equal(total, grouped.physics.library.length);
});

test('competition collections sit on the competition page, not the library', () => {
  const lib = grouped.physics.library.map(e => e.id);
  assert.ok(!lib.includes('phys-ipho-book-1967-1984'));
  assert.ok(grouped.physics.competitions.IPhO.some(e => e.id === 'phys-ipho-book-1967-1984'));
});

test('archive keys link to the published problems of their paper', () => {
  const key = 'Физика/Състезания/Всерусийска/2015/2015-III/region15T.pdf';
  const papers = [
    { paper: { source: { archiveKey: key.normalize('NFD') }, solutionSource: { archiveKey: 'x/sol.pdf' } }, problems: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    { paper: { source: { archiveKey: 'y/unpublished.pdf' } }, problems: [{ id: 'z' }] },
  ];
  const urls = new Map([['a', '/problems/a/solution/'], ['b', '/problems/b/solution/']]);
  const links = catalog.archiveProblemLinks(papers, urls);
  assert.deepEqual(links.get(key), { url: '/problems/a/solution/', count: 2 });
  assert.deepEqual(links.get('x/sol.pdf'), { url: '/problems/a/solution/', count: 2 });
  assert.equal(links.has('y/unpublished.pdf'), false);
  const rows = [{ key, id: 'r' }, { key: 'q.pdf', id: 'q' }];
  assert.equal(catalog.attachProblemLinks(rows, links), 1);
  assert.equal(rows[0].onSite.count, 2);
});

test('file kinds, plurals and the science order', () => {
  assert.equal(labels.entryExt('a/b.mp4'), 'video');
  assert.equal(labels.entryExt('a/results.html'), 'web');
  assert.equal(labels.entryExt('a/w24.nb'), 'nb');
  assert.equal(labels.EXT_ICONS[labels.entryExt('a/gmcounter.exe')], 'ПРОГ');
  assert.equal(labels.filesCount(1), '1 файл');
  assert.equal(labels.filesCount(21), '21 файла');
  assert.deepEqual(catalog.sortSciences(['informatics', 'chemistry', 'physics', 'mathematics', 'astronomy', 'geography']),
    ['physics', 'astronomy', 'chemistry', 'geography', 'mathematics', 'informatics']);
  const card = catalog.scienceCard(grouped.physics);
  assert.ok(card.competitions > 20 && card.top[0] && card.yearMin < card.yearMax);
});
