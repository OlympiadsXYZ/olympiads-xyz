// Build-time counts for the home page, the announcement bar and the 404 page (src/gatsby/site-stats.ts) and their
// wording (src/utils/siteStatsFormat.ts): counted from the published problems and the archive catalog, rounded down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// the TypeScript under src/, transpiled with the repository's typescript (as scripts/lib/load-tree.mjs does)
function loadTs(file) {
  const require = createRequire(path.join(repo, 'package.json'));
  const ts = require('typescript');
  const modules = new Map();
  const load = full => {
    if (modules.has(full)) return modules.get(full).exports;
    const module = { exports: {} };
    modules.set(full, module);
    const dependency = specifier => {
      if (!specifier.startsWith('.')) return require(specifier);
      const base = path.resolve(path.dirname(full), specifier);
      for (const extension of ['.ts', '.tsx']) if (fs.existsSync(base + extension)) return load(base + extension);
      throw new Error(`cannot resolve ${specifier} from ${full}`);
    };
    const compiled = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', compiled)(dependency, module, module.exports);
    return module.exports;
  };
  return load(path.join(repo, file));
}

const format = loadTs('src/utils/siteStatsFormat.ts');
const { computeSiteStats, hasOfficialSolution } = loadTs('src/gatsby/site-stats.ts');

const NBSP = String.fromCharCode(0xa0);

test('counts round down and group like Bulgarian text', () => {
  assert.equal(format.approxCount(9033), '9000');
  assert.equal(format.approxCount(7299), '7200');
  assert.equal(format.approxCount(58), '58');
  assert.equal(format.approxCount(345), '340');
  assert.equal(format.approxCount(0), '0');
  assert.equal(format.approxCount(12480), `12${NBSP}400`);
  assert.equal(format.formatCount(1234567), `1${NBSP}234${NBSP}567`);
});

test('"повечето с официални решения" only while more than half have one', () => {
  const stats = { problems: 100, problemsWithSolution: 51, papers: 1, subjects: [], archiveFiles: 0, archiveCompetitionFiles: 0, archiveCompetitions: 0 };
  assert.equal(format.mostHaveSolutions(stats), true);
  assert.equal(format.mostHaveSolutions({ ...stats, problemsWithSolution: 50 }), false);
  assert.equal(format.mostHaveSolutions({ ...stats, problems: 0, problemsWithSolution: 0 }), false);
});

test('subject list reads as Bulgarian', () => {
  assert.equal(format.subjectList(['physics', 'astronomy', 'chemistry', 'geography']), 'физика, астрономия, химия и география');
  assert.equal(format.subjectList(['physics', 'astronomy']), 'физика и астрономия');
  assert.equal(format.subjectList(['physics']), 'физика');
  assert.equal(format.subjectList([]), '');
});

test('an official solution is solution text or sections, as the problem page shows it', () => {
  assert.equal(hasOfficialSolution({ statement: 'Решение…' }), true);
  assert.equal(hasOfficialSolution({ statement: '', sections: [{}] }), true);
  assert.equal(hasOfficialSolution({ statement: '  ', incomplete: true }), false);
  assert.equal(hasOfficialSolution(null), false);
});

test('stats count published problems, their papers and the visible archive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-stats-'));
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), JSON.stringify(data));
  };
  write('content/extraProblems.json', { MODULE_ID: '', EXTRA_PROBLEMS: [{ uniqueId: 'a-p1' }, { uniqueId: 'a-p2' }, { uniqueId: 'b-p1' }] });
  write('content/problems/physics/X/2020/a.json', { paper: { id: 'a', subject: 'physics' }, problems: [
    { id: 'a-p1', solution: { statement: 'x' } }, { id: 'a-p2', solution: { statement: '' } }, { id: 'a-p3', solution: { statement: 'unpublished' } },
  ] });
  write('content/problems/astronomy/Y/2021/b.json', { paper: { id: 'b', subject: 'astronomy' }, problems: [{ id: 'b-p1', solution: { sections: [{}] } }] });
  write('content/problems/astronomy/Y/2022/c.json', { paper: { id: 'c', subject: 'astronomy' }, problems: [{ id: 'c-p1', solution: { statement: 'x' } }] });
  write('content/problems/schema.json', { paper: {}, problems: [{ id: 'a-p1' }] });
  const entry = (id, extra) => ({ id, subject: 'physics', kind: 'competition', competition: 'NOF', year: 2020, round: null, group: null, type: 'problems', lang: 'bg', title: id, file: `${id}.pdf`, size: 1, ...extra });
  write('archive-catalog/one.json', [
    entry('e1'), entry('e2', { competition: 'IPhO' }), entry('e3', { kind: 'book', competition: null }),
    entry('e4', { hidden: true }), entry('e5', { subject: 'astronomy', competition: 'NOF' }),
  ]);
  const stats = computeSiteStats(root);
  assert.deepEqual(stats, {
    problems: 3,
    problemsWithSolution: 2,
    papers: 2,
    subjects: ['physics', 'astronomy'],
    archiveFiles: 4,
    archiveCompetitionFiles: 3,
    archiveCompetitions: 3,
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('the repository counts are sane (a smoke check over the real content)', () => {
  const stats = computeSiteStats(repo);
  assert.ok(stats.problems > 1000, `${stats.problems} problems`);
  assert.ok(stats.problemsWithSolution <= stats.problems);
  assert.ok(stats.papers > 100);
  assert.ok(stats.archiveFiles >= stats.archiveCompetitionFiles);
  assert.ok(stats.subjects.includes('physics'));
});
