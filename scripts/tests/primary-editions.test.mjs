import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  readPapers,
  readJson,
  publicationState,
  sha256,
} from '../lib/problem-data.mjs';
import { loadTsModule, loadTreeModule } from '../lib/load-tree.mjs';
import { inspectPrimaryEditions } from '../primary-editions.mjs';
import { checkNavigation } from '../check-navigation.mjs';
import { loadNavigation } from '../lib/navigation.mjs';
import { readConsolidations } from '../lib/problem-consolidations.mjs';
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const api = loadTsModule(path.join(root, 'src/problems/editions.ts'), root);
const tree = loadTreeModule(root);
const hash = 'a'.repeat(64);
const fixture = () => {
  const papers = ['bg', 'en', 'ru'].map(lang => ({
    paper: {
      id: `exam-${lang}`,
      subject: 'astronomy',
      competition: 'IAO',
      year: 2007,
      roundType: 'theory',
      grade: 'alpha',
      lang,
    },
    problems: [
      { id: `exam-${lang}-p1`, number: 1, title: 'Task' },
      { id: `exam-${lang}-p2`, number: 2, title: `Unique ${lang}` },
    ],
  }));
  const config = {
    version: 1,
    inputs: Object.fromEntries(
      papers.map(p => [
        p.paper.id,
        {
          path: `content/problems/${p.paper.id}.json`,
          sha256: hash,
          lang: p.paper.lang,
        },
      ])
    ),
    groups: [
      {
        id: 'exam-alpha',
        subject: 'astronomy',
        competition: 'IAO',
        year: 2007,
        roundType: 'theory',
        cohort: 'alpha',
        originalLanguage: 'en',
        paperIds: papers.map(p => p.paper.id),
        tasks: [{ key: '1', members: papers.map(p => p.problems[0].id) }],
        evidence: 'Original alpha sheets compared',
      },
    ],
  };
  return {
    papers,
    config,
    ids: new Set(papers.flatMap(p => p.problems.map(q => q.id))),
    hashes: new Map(papers.map(p => [p.paper.id, hash])),
  };
};
const project = f =>
  api.buildEditionProjection(f.config, f.papers, f.ids, f.hashes);
test('Bulgarian wins, official original language is next, unavailable originals do not hide available tasks', () => {
  const f = fixture();
  let p = project(f);
  assert.equal(p.primaryById.get('exam-ru-p1'), 'exam-bg-p1');
  assert.deepEqual([...p.suppressedIds], ['exam-en-p1', 'exam-ru-p1']);
  f.ids.delete('exam-bg-p1');
  p = project(f);
  assert.equal(p.primaryById.get('exam-ru-p1'), 'exam-en-p1');
  f.config.groups[0].originalLanguage = 'ru';
  p = project(f);
  assert.equal(p.primaryById.get('exam-en-p1'), 'exam-ru-p1');
  f.ids.delete('exam-ru-p1');
  assert.equal(project(f).suppressedIds.size, 0);
});
test('only explicitly mapped tasks disappear from discovery; all unique tasks and canonical objects survive', () => {
  const f = fixture(),
    before = JSON.stringify(f.papers),
    p = project(f);
  const visible = api.primaryEditionPapers(f.papers, p);
  assert.deepEqual(
    visible.flatMap(p => p.problems.map(q => q.id)),
    ['exam-bg-p1', 'exam-bg-p2', 'exam-en-p2', 'exam-ru-p2']
  );
  assert.equal(JSON.stringify(f.papers), before);
});
test('version, hash, missing ID and cohort mismatch fail open and remain gate errors', () => {
  for (const change of [
    f => (f.config.version = 2),
    f => f.hashes.set('exam-en', 'b'.repeat(64)),
    f => f.config.groups[0].tasks[0].members.push('missing-p1'),
    f => (f.papers[1].paper.grade = 'beta'),
  ]) {
    const f = fixture();
    change(f);
    const p = project(f);
    assert.equal(p.suppressedIds.size, 0);
    assert.ok(p.issues.length);
    const records = f.papers.map(data => ({ data }));
    const result = checkNavigation(
      records,
      {
        labels: { rounds: { IAO: { '|theory': 'Теоретичен тур' } } },
        numbers: {},
      },
      tree,
      { editions: p }
    );
    assert.ok(result.failures.some(x => x.startsWith('problem-editions:')));
  }
});
test('malformed groups and repeated correspondence never suppress tasks', () => {
  const f = fixture();
  f.config.groups.push(null);
  assert.equal(project(f).suppressedIds.size, 0);
  const g = fixture();
  g.config.groups.push({ ...g.config.groups[0], id: 'other' });
  assert.equal(project(g).suppressedIds.size, 0);
});
const records = readPapers(root),
  ledger = readJson(path.join(root, 'content/problem-publication.json'), null);
const eligible = records.filter(r => publicationState(r, ledger).eligible);
const storedIds = new Set(
  eligible.flatMap(r => r.data.problems.map(p => p.id))
);
const { retiredProblemIds } = readConsolidations(root, records, ledger);
const ids = new Set([...storedIds].filter(id => !retiredProblemIds.has(id)));
const actual = inspectPrimaryEditions(root, records, ids);
test('real audited inputs are current; IAO2007 cohort language copies collapse independently', () => {
  assert.deepEqual(actual.projection.issues, []);
  for (const cohort of ['alpha', 'beta'])
    for (const n of [1, 2, 3, 4, 5]) {
      const bg = `iao-2007-theory-${cohort}-bg-p${n}`;
      assert.equal(
        actual.projection.primaryById.get(`iao-2007-theory-${cohort}-en-p${n}`),
        bg
      );
      assert.equal(
        actual.projection.primaryById.get(`iao-2007-theory-${cohort}-ru-p${n}`),
        bg
      );
    }
  const iao = records
    .filter(
      r => r.data.paper.year === 2007 && r.data.paper.competition === 'IAO'
    )
    .map(r => r.data);
  const urls = new Map(
    iao.flatMap(f => f.problems.map(p => [p.id, `/problems/${p.id}/solution`]))
  );
  const projected = tree.assembleProblemsTree(
    api.primaryEditionPapers(iao, actual.projection),
    urls,
    undefined,
    loadNavigation(root)
  );
  assert.equal(projected.count, 14);
  assert.equal(
    iao.reduce((n, p) => n + p.problems.length, 0),
    42
  );
});
test('the real static search and sidebar writers use the same audited IAO2007 primary IDs', t => {
  const parent = path.resolve(os.tmpdir());
  const temporary = fs.mkdtempSync(
    path.join(parent, 'olympiads-primary-editions-')
  );
  t.after(() => {
    assert.equal(path.dirname(path.resolve(temporary)), parent);
    assert.ok(
      path.basename(temporary).startsWith('olympiads-primary-editions-')
    );
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const groups = actual.config.groups.filter(
    g => g.competition === 'IAO' && g.year === 2007
  );
  const paperIds = new Set(groups.flatMap(g => g.paperIds));
  const inputs = Object.fromEntries(
    Object.entries(actual.config.inputs).filter(([id]) => paperIds.has(id))
  );
  fs.mkdirSync(path.join(temporary, 'content'), { recursive: true });
  fs.writeFileSync(
    path.join(temporary, 'content/problem-editions.json'),
    JSON.stringify({ version: 1, inputs, groups })
  );
  for (const input of Object.values(inputs)) {
    const destination = path.join(temporary, input.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, input.path), destination);
  }
  for (const file of ['round-labels.json', 'question-numbers.json'])
    fs.copyFileSync(
      path.join(root, 'content', file),
      path.join(temporary, 'content', file)
    );
  const require = createRequire(path.join(root, 'package.json'));
  const ts = require('typescript');
  const routes = readJson(path.join(root, 'content/problem-routes.json'), {});
  const module = { exports: {} };
  const compiled = ts.transpileModule(
    fs.readFileSync(path.join(root, 'src/problems/index-node.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'module', 'exports', compiled)(
    specifier => {
      // Isolate the model's UI-only imports; use the frozen URL contract also
      // checked against every alternate page in the route preservation test.
      if (specifier === '../models/problem')
        return {
          recentUsaco: [],
          getProblemURL: node =>
            routes[node.uniqueId] ?? `/problems/${node.uniqueId}`,
        };
      if (specifier.startsWith('.'))
        return loadTsModule(
          path.resolve(root, 'src/problems', specifier) + '.ts',
          root
        );
      return require(specifier);
    },
    module,
    module.exports
  );
  const writers = module.exports;
  const nodes = records
    .filter(r => paperIds.has(r.data.paper.id))
    .flatMap(r =>
      r.data.problems.map(p => ({
        uniqueId: p.id,
        name: p.title,
        source: 'IAO 2007',
        url: '',
        difficulty: '',
        tags: [],
      }))
    );
  const before = JSON.stringify(nodes);
  assert.equal(writers.writeProblemsIndex(temporary, nodes), 14);
  const sidebar = writers.writeProblemsTree(temporary, nodes);
  assert.equal(sidebar.count, 14);
  const index = readJson(
    path.join(temporary, 'static/problems-data/index.json'),
    []
  );
  const sidebarIds = sidebar.subjects.flatMap(s =>
    s.competitions.flatMap(c =>
      c.years.flatMap(y => y.papers.flatMap(p => p.problems.map(q => q.id)))
    )
  );
  assert.deepEqual(index.map(p => p.uniqueId).sort(), sidebarIds.sort());
  assert.ok(index.every(p => p.uniqueId.includes('-bg-')));
  assert.equal(JSON.stringify(nodes), before);
});
test('every alternate retains its generated page and exact frozen route, with bidirectional edition links', () => {
  const routes = readJson(path.join(root, 'content/problem-routes.json'), {});
  const generated = readJson(
    path.join(root, 'content/problem-generated.json'),
    {}
  );
  const urls = new Map([...ids].map(id => [id, `${routes[id]}/solution`]));
  for (const id of actual.projection.suppressedIds) {
    assert.ok(routes[id], `${id}: frozen route missing`);
    assert.ok(
      generated.problemIds.includes(id),
      `${id}: generated ProblemInfo missing`
    );
    const paper = records.find(r => r.data.problems.some(p => p.id === id));
    const file = `solutions/${paper.data.paper.subject}/${paper.data.paper.id}/${id}.mdx`;
    assert.equal(
      sha256(fs.readFileSync(path.join(root, file))),
      generated.files[file],
      `${id}: generated page bytes changed`
    );
    const primary = actual.projection.primaryById.get(id);
    assert.ok(
      api
        .problemEditionLinks(primary, actual.projection, urls)
        .some(link => link.id === id && link.url === `${routes[id]}/solution`)
    );
    assert.ok(
      api
        .problemEditionLinks(id, actual.projection, urls)
        .some(link => link.id === primary)
    );
  }
});
test('real discovery totals agree while stored editions and unrelated AstroSat task stay intact', () => {
  const papers = eligible.map(r => ({
      ...r.data,
      problems: r.data.problems.filter(p => ids.has(p.id)),
    })),
    urls = new Map([...ids].map(id => [id, `/problems/${id}/solution`]));
  const visible = api.primaryEditionPapers(papers, actual.projection);
  const data = tree.assembleProblemsTree(
    visible,
    urls,
    undefined,
    loadNavigation(root)
  );
  assert.equal(data.count, ids.size - actual.projection.suppressedIds.size);
  assert.ok(!actual.projection.suppressedIds.has('ioaa-2016-theory-qp-p12'));
  assert.ok(!actual.projection.suppressedIds.has('ioaa-2016-theory-bg-p12'));
});
