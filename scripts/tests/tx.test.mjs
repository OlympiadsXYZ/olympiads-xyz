// Tests for the scripted transcription pipeline (scripts/tx). No network, no
// poppler/rclone: a throw-away OLYMPIADS_TX_DIR holds a hand-written manifest
// and candidates; only lib.mjs, receipt.mjs, repair.mjs, validate.mjs and
// assemble.mjs are exercised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const txScript = name => path.join(repo, 'scripts', 'tx', name);
const txModule = name => pathToFileURL(txScript(name)).href; // Windows needs file:// URLs for absolute imports
const lib = await import(txModule('lib.mjs'));
const { assembleWindows } = await import(txModule('assemble.mjs'));
const { bindCheckerResult, adjudicationEvidenceProblems, evidenceKey } = await import(txModule('evidence.mjs'));

test('API checker binding uses the bytes sent, preserving a bad model echo for audit', () => {
  const response = { candidateSha256: 'not supplied by old request', verdict: 'fail', defects: [] };
  const bound = bindCheckerResult(response, { candidateSha256: 'a'.repeat(64), requestId: 'request-1' });
  assert.equal(bound.candidateSha256, 'a'.repeat(64));
  assert.equal(bound.modelClaimedCandidateSha256, response.candidateSha256);
  assert.equal(response.candidateSha256, 'not supplied by old request');
});

test('an interrupted adjudication or stale candidate cannot become benchmark truth', () => {
  const candidates = [{ view: 'candidate.view.json', sha256: 'a'.repeat(64) }];
  const checks = [{ file: 'check.json', data: { defects: [{ severity: 'critical' }] } }];
  const complete = { candidates: [{ ...candidates[0], candidateSha256: candidates[0].sha256, verdict: 'fail', defects: [{ path: '/problems/0/statement', severity: 'critical', description: 'wrong unit' }] }], checkerFindings: [{ check: 'check.json', index: 0, truePositive: true, note: 'confirmed from page' }], escalations: [] };
  assert.deepEqual(adjudicationEvidenceProblems(complete, candidates, checks, repo), []);
  assert.match(adjudicationEvidenceProblems(null, candidates, checks, repo).join(), /incomplete/);
  assert.match(adjudicationEvidenceProblems({ ...complete, checkerFindings: [] }, candidates, checks, repo).join(), /missing checker/);
  assert.match(adjudicationEvidenceProblems(complete, [{ ...candidates[0], sha256: 'b'.repeat(64) }], checks, repo).join(), /stale candidate/);
  assert.match(adjudicationEvidenceProblems({ ...complete, checkerFindings: [...complete.checkerFindings, ...complete.checkerFindings] }, candidates, checks, repo).join(), /duplicate checker/);
  const cosmeticPass = { ...complete, candidates: [{ ...complete.candidates[0], verdict: 'pass' }] };
  assert.deepEqual(adjudicationEvidenceProblems(cosmeticPass, candidates, checks, repo), []); // report tightens it to fail; evidence is still complete
  assert.match(adjudicationEvidenceProblems({ ...complete, candidates: [{ ...complete.candidates[0], defects: [] }] }, candidates, checks, repo).join(), /without explaining defects/);
});

test('benchmark does not call an arbitrary reference gold or charge competing checks to a reader', t => {
  const s = sandbox(t);
  const cand = s.write('candidates/zai__glm-5.3-flash.json', candidate());
  fs.mkdirSync(path.join(s.dir, 'checks'));
  s.write('checks/own.json', { verdict: 'pass', candidateSha256: lib.sha256File(cand), checker: { provider: 'gemini', model: 'gemini-test', candidateSha256: lib.sha256File(cand), costUsd: 2 } });
  s.write('checks/competitor.json', { verdict: 'pass', checker: { candidateSha256: 'f'.repeat(64), costUsd: 100 } });
  fs.writeFileSync(path.join(s.root, 'runs.jsonl'), JSON.stringify({ paperId: PAPER, provider: 'zai', model: 'glm-5.3-flash', stage: 'reader', costUsd: 1, ok: true }) + '\n');
  const fx = s.write('fixtures.json', [{ paperId: PAPER, reference: cand }]);
  const out = path.join(s.dir, 'report');
  const run = s.run('bench.mjs', ['--fixtures', fx, '--candidates', cand, '--out-dir', out]);
  assert.equal(run.status, 0, run.stderr);
  const row = s.read(path.join(out, 'report.json')).papers[0];
  assert.equal(row.referenceKind, 'unverified-reference (not gold)');
  assert.equal(row.candidates[0].totalCostUsd, 3);
  s.write('checks/own.json', { verdict: 'pass', candidateSha256: lib.sha256File(cand) });
  assert.equal(s.run('bench.mjs', ['--fixtures', fx, '--candidates', cand, '--out-dir', out]).status, 0);
  assert.equal(s.read(path.join(out, 'report.json')).papers[0].candidates[0].totalCostUsd, null);
});

const PAPER = 'zz-2099-test-7';
const size = { page: 1, widthPt: 595.276, heightPt: 841.89 };
const manifest = {
  paperId: PAPER, meta: { competition: 'ZZ', year: 2099, round: null, grade: '7', subject: 'physics', lang: 'bg' }, renderDpi: 160,
  documents: {
    problems: { key: 'Физика/zz/problems.pdf', file: 'src/problems.pdf', sha256: 'a'.repeat(64), bytes: 1, pages: 2, pageSizes: [size, { ...size, page: 2 }], pageImages: ['pages/problems-01.png', 'pages/problems-02.png'], text: 'text/problems.txt' },
    solutions: { key: 'Физика/zz/solutions.pdf', file: 'src/solutions.pdf', sha256: 'b'.repeat(64), bytes: 1, pages: 1, pageSizes: [size], pageImages: ['pages/solutions-01.png'], text: 'text/solutions.txt' },
  },
};
function candidate({ uploaded = true, dryRun = false } = {}) {
  const fig = { id: 'p1-fig1', alt: 'Графика', tx: { document: 'problems', page: 1, bbox: [365, 275, 625, 430], file: 'figs/problems/p1-fig1.png' } };
  if (uploaded) Object.assign(fig, { url: `${lib.R2_PUBLIC}/problems/${PAPER}/p1-fig1.png`, width: 600, height: 400, source: { page: 1, pdfRect: [100, 200, 300, 400], dpi: 300 } }, { tx: { ...fig.tx, public200: true, upload: 'new', dryRun: false } });
  if (dryRun) fig.tx = { ...fig.tx, dryRun: true, upload: 'skipped (dry-run)' };
  return {
    paper: { id: PAPER, subject: 'physics', competition: 'ZZ', year: 2099, round: null, roundType: 'theory', grade: '7 клас', lang: 'bg', title: 'Тест', totalPoints: 10, source: { archiveKey: manifest.documents.problems.key, pages: [1, 2] }, solutionSource: { archiveKey: manifest.documents.solutions.key, pages: [1] }, status: 'draft' },
    problems: [
      { id: `${PAPER}-p1`, number: 1, points: 10, problemType: 'theory', statement: 'Токът е $I = 1\\ \\mathrm{mA}$ и $v_0/2$.', figures: [fig], parts: [{ label: 'а)', statement: 'Колко е зарядът за $t = 1\\ \\mathrm{min}$?', points: 10, answer: { kind: 'numeric', value: 0.06, unit: 'C' } }], topics: ['electricity/current'], difficulty: 'Easy', importance: 2,
        solution: { statement: 'Решение: $q = I t = 0{,}06\\ \\mathrm{C}$.' }, tx: { sourceSpans: [{ document: 'problems', page: 1 }, { document: 'solutions', page: 1 }] } },
    ],
    tx: { printedMeta: 'Тест 2099, 7 клас', catalogDisagrees: false, textLayerTrustworthy: true, notes: 'reader rationale: I decided X because Y', reader: { provider: 'zai', model: 'glm-5.3-flash', promptVersion: 'v1', promptSha256: 'c'.repeat(64), requestId: 'req-1', at: '2026-09-06T00:00:00.000Z', costUsd: 0.01 } },
  };
}
function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, PAPER);
  fs.mkdirSync(path.join(dir, 'figs', 'problems'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'candidates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'figs', 'problems', 'p1-fig1.png'), 'not really a png');
  const write = (name, value) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(value, null, 1) + '\n'); return f; };
  const run = (script, argv) => spawnSync(process.execPath, [txScript(script), ...argv], { encoding: 'utf8', env: { ...process.env, OLYMPIADS_TX_DIR: root } });
  return { root, dir, write, run, read: f => JSON.parse(fs.readFileSync(f, 'utf8')) };
}

test('bbox permille <-> preview pixel conversion round-trips', () => {
  const px = lib.bboxToPreviewPx([365, 275, 625, 430], size);
  assert.equal(px.length, 4);
  assert.ok(px[0] > 480 && px[0] < 484, `x0 in px: ${px[0]}`);
  assert.deepEqual(lib.previewPxToBbox(px, size), [365, 275, 625, 430]);
});

test('normaliseLatex ignores spacing/decimal spelling but keeps subscripts and signs', () => {
  assert.equal(lib.normaliseLatex('0{,}06\\ \\mathrm{C}'), lib.normaliseLatex('0,06 C'));
  assert.notEqual(lib.normaliseLatex('v_0/2'), lib.normaliseLatex('v_0'));
  assert.notEqual(lib.normaliseLatex('\\ell_1'), lib.normaliseLatex('\\ell_2'));
  assert.notEqual(lib.normaliseLatex('-5'), lib.normaliseLatex('5'));
});

test('isPrimaryCandidate skips derived copies, including models with dots', () => {
  assert.equal(lib.isPrimaryCandidate('zai__glm-5.3-flash.json'), true);
  for (const f of ['zai__glm-5.3-flash.figs.json', 'zai__glm-5.3-flash.view.json', 'zai__glm-5.3-flash.dryrun.json', 'zai__glm-5.3-flash.window-problems-01-08.json', 'zai__glm-5.3-flash.r1.json', 'adjudicated__1.gold.json', 'receipt.json']) assert.equal(lib.isPrimaryCandidate(f), false, f);
});

test('checkerView withholds the reader rationale and identity but keeps figure boxes, crop files and source pages', () => {
  const v = lib.checkerView(candidate());
  const text = JSON.stringify(v);
  assert.doesNotMatch(text, /rationale|glm-5\.3-flash|printedMeta|textLayerTrustworthy|catalogDisagrees|costUsd/);
  assert.deepEqual(v.problems[0].tx, { sourceSpans: [{ document: 'problems', page: 1 }, { document: 'solutions', page: 1 }] });
  assert.deepEqual(v.problems[0].figures[0].tx, { document: 'problems', page: 1, bbox: [365, 275, 625, 430], file: 'figs/problems/p1-fig1.png' });
  assert.equal(v.tx, undefined);
});

test('independence needs a different model; same provider is flagged', () => {
  assert.equal(lib.independence({ provider: 'zai', model: 'glm-5.3-flash' }, { provider: 'zai', model: 'glm-5.3-flash' }).independent, false);
  const r = lib.independence({ provider: 'zai', model: 'glm-5.3-flash' }, { provider: 'zai', model: 'glm-4.6v' });
  assert.equal(r.independent, true); assert.equal(r.differentProvider, false);
  assert.equal(lib.independence({ provider: 'zai', model: 'x' }, { provider: 'gemini', model: 'y' }).differentProvider, true);
});

test('pageWindows splits long documents with one-page overlap and leaves short ones whole', () => {
  assert.deepEqual(lib.pageWindows(manifest, 8), [null]);
  const long = { documents: { problems: { pages: 15 }, solutions: { pages: 3 } } };
  assert.deepEqual(lib.pageWindows(long, 8), [{ problems: [1, 8] }, { problems: [8, 15] }, { solutions: [1, 3] }]);
});

test('figureEvidenceProblems flags dry-run and unverified figures', () => {
  assert.deepEqual(lib.figureEvidenceProblems(candidate()), []);
  assert.match(lib.figureEvidenceProblems(candidate({ uploaded: false, dryRun: true }))[0].message, /dry-run/);
  assert.match(lib.figureEvidenceProblems(candidate({ uploaded: false }))[0].message, /not uploaded/);
});

test('buildFinalPaper writes real provenance fields, no [tx] blob, deterministic hash, schema-valid', () => {
  const prov = lib.provenanceFor(candidate(), { reviewer: { provider: 'gemini', model: 'gemini-3.8-flash' }, promptVersion: 'v1', checkedAt: '2026-09-06T01:00:00.000Z', sourceHashes: { problems: 'a'.repeat(64), solutions: 'b'.repeat(64) }, independent: true });
  const a = lib.buildFinalPaper(candidate(), prov), b = lib.buildFinalPaper(candidate(), prov);
  assert.equal(a.contentHash, b.contentHash);
  const tr = a.data.paper.transcription;
  assert.equal(tr.provider, 'zai'); assert.equal(tr.promptVersion, 'v1'); assert.equal(tr.promptSha256, 'c'.repeat(64)); assert.equal(tr.requestId, 'req-1');
  assert.deepEqual(tr.sourceSha256, { problems: 'a'.repeat(64), solutions: 'b'.repeat(64) });
  assert.match(tr.verifiedBy, /independent checker/);
  assert.doesNotMatch(tr.notes || '', /\[tx\]/);
  assert.equal(a.data.paper.status, 'review'); assert.equal(a.data.paper.grade, '7');
  assert.equal(JSON.stringify(a.data).includes('"tx"'), false);
  assert.deepEqual(a.data.problems[0].sourceSpans, [{ document: 'problems', page: 1 }, { document: 'solutions', page: 1 }]);
  const { validate } = lib.compileSchema('final');
  assert.equal(validate(a.data), true, JSON.stringify(validate.errors));
  assert.equal(lib.provenanceFor(candidate(), { reviewer: { provider: 'zai', model: 'glm-5.3-flash' }, promptVersion: 'v1', checkedAt: '2026-09-06', sourceHashes: {}, independent: false }).verifiedBy.includes('same-model checker'), true);
});

test('assembleWindows merges parts by number and replaces placeholders', () => {
  const c = candidate();
  const p1 = { paper: { ...c.paper, source: { ...c.paper.source, pages: [1] }, solutionSource: undefined }, problems: [{ ...c.problems[0], solution: undefined, tx: { sourceSpans: [{ document: 'problems', page: 1 }] } }], tx: { window: { problems: [1, 2] }, notes: 'w1', reader: { ...c.tx.reader, inputTokens: 100, costUsd: 0.01 } } };
  delete p1.paper.solutionSource; delete p1.problems[0].solution;
  const p2 = { paper: { ...c.paper, source: { ...c.paper.source, pages: [] } }, problems: [{ id: `${PAPER}-p1`, number: 1, statement: lib.WINDOW_PLACEHOLDER, parts: [], solution: c.problems[0].solution, tx: { sourceSpans: [{ document: 'solutions', page: 1 }] } }], tx: { window: { solutions: [1, 1] }, reader: { ...c.tx.reader, inputTokens: 50, costUsd: 0.005 } } };
  const { data, report } = assembleWindows([p1, p2], manifest);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(data.problems.length, 1);
  assert.match(data.problems[0].statement, /Токът/);
  assert.match(data.problems[0].solution.statement, /Решение/);
  assert.deepEqual(data.problems[0].tx.sourceSpans, [{ document: 'problems', page: 1 }, { document: 'solutions', page: 1 }]);
  assert.deepEqual(data.paper.source.pages, [1]); assert.deepEqual(data.paper.solutionSource.pages, [1]);
  assert.equal(data.tx.reader.inputTokens, 150); assert.equal(data.tx.reader.windows, 2);
  assert.deepEqual(report.uncoveredPages, [{ document: 'problems', page: 2 }]);
});

test('validate.mjs accepts the synthetic candidate and rejects a pixel-sized box', t => {
  const s = sandbox(t);
  const f = s.write('candidates/zai__glm-5.3-flash.json', candidate());
  const ok = s.run('validate.mjs', [f, '--paper-id', PAPER, '--manifest', path.join(s.dir, 'manifest.json')]);
  assert.equal(ok.status, 0, ok.stdout);
  const bad = candidate(); bad.problems[0].figures[0].tx.bbox = [487, 522, 1323, 1870];
  const r = s.run('validate.mjs', [s.write('candidates/bad.json', bad), '--paper-id', PAPER, '--manifest', path.join(s.dir, 'manifest.json')]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /outside 0\.\.1000 permille/);
});

test('receipt.mjs: pass only with candidateSha256, independent checker, uploaded figures; resolved flags are ignored', t => {
  const s = sandbox(t);
  const cand = s.write('candidates/zai__glm-5.3-flash.figs.json', candidate());
  const sha = lib.sha256File(cand);
  const base = { verdict: 'pass', summary: 'ok', coverage: { pagesRead: [{ document: 'problems', page: 1 }, { document: 'problems', page: 2 }, { document: 'solutions', page: 1 }], problemsChecked: 1, figuresChecked: 1 }, defects: [] };
  const rec = (name, check, extra = []) => {
    const r = s.run('receipt.mjs', [PAPER, '--candidate', cand, '--defects', s.write(`checks/${name}.json`, check), '--reviewer', 'gemini:gemini-3.8-flash:req-9', '--out', path.join(s.dir, `${name}.receipt.json`), ...extra]);
    return { status: r.status, receipt: s.read(path.join(s.dir, `${name}.receipt.json`)), out: r.stdout + r.stderr };
  };
  fs.mkdirSync(path.join(s.dir, 'checks'), { recursive: true });
  const noSha = rec('nosha', base);
  assert.equal(noSha.status, 1); assert.match(noSha.receipt.blockers.join(), /candidateSha256/);
  const good = rec('good', { ...base, candidateSha256: sha });
  assert.equal(good.status, 0, good.out); assert.equal(good.receipt.verdict, 'pass'); assert.equal(good.receipt.independence.independent, true);
  const incomplete = rec('incomplete', { ...base, candidateSha256: sha, coverage: { ...base.coverage, pagesRead: base.coverage.pagesRead.slice(0, 1) } });
  assert.equal(incomplete.status, 1); assert.match(incomplete.receipt.blockers.join(), /not covered 2 source page/);
  const absentDefects = rec('absent-defects', { ...base, candidateSha256: sha, defects: undefined });
  assert.equal(absentDefects.status, 1); assert.match(absentDefects.receipt.blockers.join(), /missing is not empty/);
  assert.equal(good.receipt.contentHash, lib.buildFinalPaper(candidate(), lib.provenanceFor(candidate(), { reviewer: { provider: 'gemini', model: 'gemini-3.8-flash' }, promptVersion: 'v1', checkedAt: good.receipt.checkedAt, sourceHashes: good.receipt.sourceHashes, independent: true })).contentHash);
  const resolved = rec('resolved', { ...base, candidateSha256: sha, defects: [{ path: '/problems/0/statement', severity: 'critical', kind: 'wrong-value', description: '1mA vs 1A', resolved: true }] });
  assert.equal(resolved.status, 1); assert.equal(resolved.receipt.defects.length, 1); assert.equal(resolved.receipt.ignoredResolvedFlags, 1);
  const stale = rec('stale', { ...base, candidateSha256: 'd'.repeat(64) });
  assert.equal(stale.status, 1); assert.match(stale.receipt.blockers.join(), /different candidate bytes/);
  const same = s.run('receipt.mjs', [PAPER, '--candidate', cand, '--defects', s.write('checks/same.json', { ...base, candidateSha256: sha }), '--reviewer', 'zai:glm-5.3-flash:req-2', '--out', path.join(s.dir, 'same.receipt.json')]);
  assert.equal(same.status, 1); assert.match(s.read(path.join(s.dir, 'same.receipt.json')).blockers.join(), /same model/);
  const allowed = s.run('receipt.mjs', [PAPER, '--candidate', cand, '--defects', path.join(s.dir, 'checks/same.json'), '--reviewer', 'zai:glm-5.3-flash:req-2', '--out', path.join(s.dir, 'allowed.receipt.json'), '--allow-same-model']);
  assert.equal(allowed.status, 0); assert.equal(s.read(path.join(s.dir, 'allowed.receipt.json')).independence.allowSameModel, true);
  const dryCand = s.write('candidates/dry.figs.json', candidate({ uploaded: false, dryRun: true }));
  const dry = s.run('receipt.mjs', [PAPER, '--candidate', dryCand, '--defects', s.write('checks/dry.json', { ...base, candidateSha256: lib.sha256File(dryCand) }), '--reviewer', 'gemini:gemini-3.8-flash:req-3', '--out', path.join(s.dir, 'dry.receipt.json')]);
  assert.equal(dry.status, 1); assert.match(s.read(path.join(s.dir, 'dry.receipt.json')).blockers.join(), /dry-run|schema/);
});

test('repair.mjs applies text/box/points fixes, resets touched figures, and reports what it could not apply', t => {
  const s = sandbox(t);
  const cand = s.write('candidates/c.figs.json', candidate());
  const receipt = s.write('receipt.json', { paperId: PAPER, verdict: 'fail', candidateSha256: lib.sha256File(cand), defects: [
    { path: '/problems/0/parts/0/statement', severity: 'critical', kind: 'wrong-value', description: 'min vs s', suggestedFix: 'Колко е зарядът за $t = 60\\ \\mathrm{s}$?' },
    { path: '/problems/0/figures/0/tx/bbox', severity: 'critical', kind: 'figure', description: 'clipped', suggestedFix: '[365, 275, 625, 445]' },
    { path: '/problems/0/points', severity: 'major', kind: 'points', description: 'printed 12', suggestedFix: '12' },
    { path: '/problems/0/solution/statement', severity: 'major', kind: 'omission', description: 'missing line', suggestedFix: null },
  ] });
  const out = path.join(s.dir, 'candidates', 'c.r1.json');
  const r = s.run('repair.mjs', [PAPER, '--candidate', cand, '--receipt', receipt, '--out', out]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.applied, 3); assert.equal(rep.skipped, 1);
  const fixed = s.read(out);
  assert.match(fixed.problems[0].parts[0].statement, /60/);
  assert.equal(fixed.problems[0].points, 12);
  const fig = fixed.problems[0].figures[0];
  assert.deepEqual(fig.tx, { document: 'problems', page: 1, bbox: [365, 275, 625, 445], boxFrom: 'checker' }); // a judged box: snap.mjs leaves it alone
  assert.equal(fig.url, undefined);
  assert.equal(fixed.tx.repairs.length, 3); assert.equal(fixed.tx.repairs[0].round, 1);
});

test('adjudication evidence written on another machine still binds by its tmp/-relative path', () => {
  const candidates = [{ view: 'tmp/tx/p/candidates/agent__sonnet.figs.view.json', sha256: 'b'.repeat(64) }];
  const checks = [{ file: 'tmp/tx/p/checks/zai__glm-5.3-flash__for-agent__sonnet.json', data: { defects: [{ severity: 'major' }] } }];
  const mac = '/Users/someone/Projects/olympiads-xyz/';
  const win = 'D:\\Projects\\olympiads-xyz\\';
  const adjudication = {
    candidates: [{ view: mac + candidates[0].view, candidateSha256: candidates[0].sha256, verdict: 'pass', defects: [] }],
    checkerFindings: [{ check: win + checks[0].file.replace(/\//g, '\\'), index: 0, truePositive: false, note: 'label is visible on the page' }],
    escalations: [],
  };
  assert.deepEqual(adjudicationEvidenceProblems(adjudication, candidates, checks, repo), []);
  assert.equal(evidenceKey(mac + 'tmp/tx/p/x.json', repo), 'tmp/tx/p/x.json');
  assert.equal(evidenceKey(win + 'tmp\\tx\\p\\x.json', repo), 'tmp/tx/p/x.json');
  assert.equal(evidenceKey('tmp/tx/p/x.json', repo), 'tmp/tx/p/x.json');
});

test('figure proposals snap onto detected graphics, never onto scans or merged groups', async () => {
  const { snapBox } = await import(txModule('snap.mjs'));
  const page = { scanned: false, regions: [
    { bbox: [100, 100, 400, 300], core: [110, 110, 390, 290] },
    { bbox: [600, 100, 900, 300], core: [610, 110, 890, 290] },
  ] };
  assert.equal(snapBox([120, 120, 380, 280], page).reason, 'region');           // overlaps one graphic: take its frame
  assert.deepEqual(snapBox([120, 120, 380, 280], page).bbox, [94, 94, 406, 306]);
  assert.equal(snapBox([100, 400, 400, 600], page).reason, 'nearest');          // on text: nearest free graphic
  assert.equal(snapBox([100, 400, 400, 600], page, { taken: [0] }), null);          // the near graphic is taken and the other one is far: stay
  assert.equal(snapBox([100, 100, 900, 300], page).reason, 'union');            // spans both: their union
  assert.equal(snapBox([120, 120, 380, 280], { scanned: true, regions: page.regions }).reason, 'region'); // a scan's regions come from its pixels (pdfregions v3+)
  assert.equal(snapBox([120, 120, 380, 280], { scanned: true, regions: [] }), null);
  assert.equal(snapBox([120, 120, 380, 280], { scanned: false, regions: [{ ...page.regions[0], kind: 'formula' }] }), null); // never onto a formula
  const group = { scanned: false, regions: [{ bbox: [0, 0, 1000, 600], core: [0, 0, 1000, 600] }] };
  assert.equal(snapBox([100, 100, 300, 300], group), null);                     // region 30x the box: a merged group, keep the reader's box
  const pair = { scanned: false, regions: [{ bbox: [128, 319, 906, 534], core: [128, 319, 906, 534] }] }; // Фиг. 1 (а) | Фиг. 1 (б) clustered together
  assert.equal(snapBox([122, 313, 455, 540], pair), null);                      // a good left-half proposal is left alone (not merged into the block)
  assert.deepEqual(snapBox([140, 340, 455, 500], pair).bbox, [134, 313, 461, 540]); // a short left-half proposal keeps its width, takes the block's height
});

test('refix applies model-supplied values like repair.mjs and never invents a field', async () => {
  const { applyFixes } = await import(txModule('fixes.mjs'));
  const c = candidate();
  const defects = [
    { path: '/problems/0/statement', kind: 'omission', severity: 'major', description: 'sentence missing' },
    { path: '/problems/0/figures/0/tx/bbox', kind: 'figure', severity: 'critical', description: 'clips the label' },
    { path: '/problems/0/points', kind: 'points', severity: 'minor', description: 'printed 12' },
    { path: '/problems/0/solution/statement', kind: 'omission', severity: 'critical', description: 'unreadable' },
    { path: '/problems/0/parts/0/answer', kind: 'wrong-value', severity: 'major', description: 'unit' },
  ];
  const fixes = [
    { path: '/problems/0/statement', value: 'Токът е $I = 1\ \mathrm{mA}$ и $v_0/2$. Определете заряда.', note: 'p.1' },
    { path: '/problems/0/figures/0/tx/bbox', value: [360, 270, 630, 445] },
    { path: '/problems/0/points', value: '12' },
    { path: '/problems/0/solution/statement', value: null, note: 'page 1 of the solutions is blank' },
    { path: '/problems/0/parts/0/answer', value: 'C' },
  ];
  const r = applyFixes(c, fixes, { defects, round: 2, by: 'zai:test refix', requestId: 'req-9' });
  assert.equal(r.applied.length, 3);
  assert.equal(r.skipped.length, 2);
  assert.match(r.skipped.map(s => s.reason).join(' | '), /could not settle/);
  assert.match(r.skipped.map(s => s.reason).join(' | '), /cannot apply a string fix to a object field/);
  assert.equal(c.problems[0].points, 12);
  assert.deepEqual(c.problems[0].figures[0].tx, { document: 'problems', page: 1, bbox: [360, 270, 630, 445], boxFrom: 'refix' });
  assert.equal(c.problems[0].figures[0].url, undefined);
  assert.deepEqual(r.figuresToRedo, ['/problems/0/figures/0']);
  assert.equal(c.tx.repairs.length, 3);
  assert.equal(c.tx.repairs[0].by, 'zai:test refix');
  assert.equal(c.tx.repairs[0].requestId, 'req-9');
});

test('refix may create a field the reader omitted, but never an array element', async () => {
  const { applyFixes } = await import(txModule('fixes.mjs'));
  const c = candidate();
  delete c.problems[0].solution;
  const defects = [
    { path: '/problems/0/solution/statement', kind: 'omission', severity: 'critical', description: 'solution missing' },
    { path: '/problems/0/parts/1/statement', kind: 'omission', severity: 'critical', description: 'part б) missing' },
  ];
  const r = applyFixes(c, [
    { path: '/problems/0/solution/statement', value: 'Решение: $q = I t$.' },
    { path: '/problems/0/parts/1/statement', value: 'б) …' },
  ], { defects });
  assert.equal(c.problems[0].solution.statement, 'Решение: $q = I t$.');
  assert.equal(r.applied[0].created, true);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /array element/);
});

test('normaliseCandidate settles structural slips without touching the transcription', () => {
  const c = candidate();
  const fig = c.problems[0].figures[0];
  delete fig.tx; Object.assign(fig, { document: 'problems', page: '1', bbox: '[365, 275, 625, 430]' });
  c.problems[0].parts[0].answer = { kind: 'numeric', value: '0,06', unit: 'C' };
  c.problems[0].answer = { kind: 'numeric', value: 'R(\\sqrt{5}-1)/2' };
  c.paper.held = { from: 'ноември 2011', to: '2011-11-12', place: ['Пловдив'] };
  c.problems[0].statement = 'Ъгъл $0\\,^{\\circ}$ и $T_1$.';
  lib.normaliseCandidate(c);
  assert.deepEqual(fig.tx, { document: 'problems', page: 1, bbox: [365, 275, 625, 430] });
  assert.equal(fig.document, undefined);
  assert.equal(c.problems[0].parts[0].answer.value, 0.06);
  assert.equal(c.problems[0].answer.kind, 'expression');
  assert.equal(c.problems[0].answer.latex, 'R(\\sqrt{5}-1)/2');
  assert.deepEqual(c.paper.held, { from: '2011-11-12', to: '2011-11-12', place: 'Пловдив' });
  assert.equal(c.problems[0].statement, 'Ъгъл $0\\,{}^{\\circ}$ и $T_1$.');
  assert.ok(c.tx.normalised.length >= 5);
});

test('a quoted sentence from the checker is spliced over the passage it corrects, not over the whole field', async () => {
  const { spliceFragment } = await import(txModule('fixes.mjs'));
  const solution = 'Означаваме с Tк и Tз периодите на кометата и Земята. Ако не се включат двигателите в тчка А, по-нататъшното движение е по елипса. Следователно отговорът е 2 години.';
  const out = spliceFragment(solution, 'Ако не се включат двигателите в точка А, по-нататъшното движение е по елипса.');
  assert.equal(out, 'Означаваме с Tк и Tз периодите на кометата и Земята. Ако не се включат двигателите в точка А, по-нататъшното движение е по елипса. Следователно отговорът е 2 години.');
  // the typo sits in the last words: replace the same number of words from the anchor on
  const out2 = spliceFragment(solution, 'Ако не се включат двигателите в точка А');
  assert.equal(out2, solution.replace('в тчка А', 'в точка А'));
  // a typo in the first word, and a quote the checker truncated with an ellipsis
  const st = 'Младият астроном стои в къщи. След той се заема да пресмята орбитата на Юпитер и записва резултата.';
  assert.equal(spliceFragment(st, 'После той се заема да пресмята…'), st.replace('След той', 'После той'));
  assert.equal(spliceFragment(solution, 'Съвсем друг текст без котва в решението'), null);
  assert.equal(spliceFragment('кратко', 'по-дълъг текст от полето'), null);
});

test('normaliseCandidate drops a second copy of the same problem', () => {
  const c = candidate();
  const p = c.problems[0];
  c.problems.push({ ...p, id: `${PAPER}-problem-1`, statement: 'Задача 1. ' + p.statement, parts: [] });
  c.problems.push({ ...p, number: 2, id: `${PAPER}-p2`, statement: 'Друга задача.' });
  lib.normaliseCandidate(c);
  assert.equal(c.problems.length, 2);
  assert.deepEqual(c.problems.map(x => x.number), [1, 2]);
  assert.match(c.tx.normalised.join(), /duplicate of problem 1/);
});

test('a Latin homoglyph inside a Cyrillic word is mapped, math and Latin words are left alone', () => {
  assert.equal(lib.fixHomoglyphs('Виждa ли се звездата, ако скоростта e $v_p = 3$ km/s и Fc е силата?'), 'Вижда ли се звездата, ако скоростта e $v_p = 3$ km/s и Fc е силата?');
  assert.equal(lib.fixHomoglyphs('да го снимa с телескопa'), 'да го снима с телескопа');
  assert.equal(lib.fixHomoglyphs('Hello свят'), 'Hello свят');
});

test('text-layer check: omitted sentence, misread word (mechanical fix), unprinted words; a wordless layer is skipped', async t => {
  const s = sandbox(t);
  fs.mkdirSync(path.join(s.dir, 'text'), { recursive: true });
  const printed = 'Тънък проводник с дължина един метър е свързан към източник на постоянно напрежение и през него протича ток с големина един милиампер. Определете заряда, който преминава през напреч-\nното сечение на проводника за една минута, ако токът остава постоянен през цялото време на измерването. Приемете, че съпротивлението на проводника не зависи от температурата. Отговорът дайте в кулони.';
  fs.writeFileSync(path.join(s.dir, 'text', 'problems.txt'), `МИНИСТЕРСТВО НА ОБРАЗОВАНИЕТО\nЗадача 1. Ток в проводник\n${printed}\nа) Колко е зарядът за t = 1 min?\n\f`);
  fs.writeFileSync(path.join(s.dir, 'text', 'solutions.txt'), 'Решения\nЗадача 1. Зарядът е q = I t = 0,06 C.\n');
  const c = candidate();
  c.paper.title = 'МИНИСТЕРСТВО НА ОБРАЗОВАНИЕТО';
  c.problems[0].title = 'Ток в проводник';
  // the reader dropped "Приемете, че…", typed "милиамер" and added a sentence the page does not print
  c.problems[0].statement = printed.replace(/напреч-\nното/, 'напречното').replace(' Приемете, че съпротивлението на проводника не зависи от температурата.', '').replace('милиампер', 'милиамер') + ' Отговорът закръглете до стотни.';
  const f = s.write('candidates/tl.json', c);
  const out = path.join(s.dir, 'checks', 'tl.json');
  const r = s.run('textlayer.mjs', [PAPER, '--candidate', f, '--out', out]);
  assert.equal(r.status, 3, r.stderr);
  const res = s.read(out);
  assert.equal(res.documents.problems.trusted, true);
  assert.equal(res.documents.solutions.trusted, false);
  assert.match(res.documents.solutions.reason, /only \d+ words/);
  const fix = res.defects.find(d => d.suggestedFix);
  assert.ok(fix, 'a misread word gets a mechanical fix');
  assert.equal(fix.path, '/problems/0/statement');
  assert.match(fix.suggestedFix, /милиампер/);
  assert.doesNotMatch(fix.suggestedFix, /милиамер\b/);
  const rest = res.defects.filter(d => !d.suggestedFix);
  assert.equal(rest.length, 1, JSON.stringify(res.defects, null, 1)); // omission and unprinted words merged per field
  assert.equal(rest[0].path, '/problems/0/statement');
  assert.match(rest[0].description, /Приемете, че съпротивлението/);
  assert.match(rest[0].description, /закръглете/);
  assert.doesNotMatch(rest[0].description, /напречното|напреч/); // a word broken over two lines is present
});

test('refix drops an unprinted caption, adds a figures array, and remembers a region that is not a figure', async () => {
  const { applyFixes } = await import(txModule('fixes.mjs'));
  const c = candidate();
  c.problems[0].figures[0].caption = 'Схема на опита';
  const region = { document: 'solutions', page: 1, bbox: [100, 100, 400, 300] };
  const defects = [
    { path: '/problems/0/figures/0/caption', kind: 'reworded', severity: 'minor', description: 'not printed' },
    { path: '/problems/0/solution/figures', kind: 'figure', severity: 'major', description: 'graphic not covered', region },
  ];
  const added = { id: 'p1-sol-fig1', alt: 'Сили', tx: { document: 'solutions', page: 1, bbox: [100, 100, 400, 300] } };
  const r = applyFixes(c, [{ path: '/problems/0/figures/0/caption', value: '' }, { path: '/problems/0/solution/figures', value: [added] }], { defects });
  assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped));
  assert.equal(c.problems[0].figures[0].caption, undefined);
  assert.deepEqual(c.problems[0].solution.figures, [added]);
  // the same region judged "not a figure": the array comes back unchanged and the region is remembered
  const c2 = candidate();
  c2.problems[0].solution.figures = [];
  const r2 = applyFixes(c2, [{ path: '/problems/0/solution/figures', value: [], note: 'a formula' }], { defects: [defects[1]] });
  assert.equal(r2.applied.length, 1);
  assert.deepEqual(c2.tx.notFigures[0].bbox, region.bbox);
  // no solution at all: a figures array may not conjure one up
  const c3 = candidate();
  delete c3.problems[0].solution;
  const r3 = applyFixes(c3, [{ path: '/problems/0/solution/figures', value: [added] }], { defects: [defects[1]] });
  assert.equal(r3.skipped.length, 1);
  assert.equal(c3.problems[0].solution, undefined);
});

test('LaTeX spacing and text commands outside math are normalised; a leftover command fails validation', async t => {
  const c = candidate();
  c.problems[0].solution.statement = '(2.1) \\quad $a_1 = \\dfrac{F}{m_1}$ \\ \\text{и} \\ $a_2 = \\dfrac{F}{m_2}$. \\quad **[1 т.]**';
  lib.normaliseCandidate(c);
  assert.equal(c.problems[0].solution.statement, '(2.1) $a_1 = \\dfrac{F}{m_1}$ и $a_2 = \\dfrac{F}{m_2}$. **[1 т.]**');
  assert.match(c.tx.normalised.join(), /LaTeX spacing/);
  const s = sandbox(t);
  const bad = candidate();
  bad.problems[0].statement = 'Ъгълът \\alpha е даден.';
  const r = s.run('validate.mjs', [s.write('candidates/latex.json', bad), '--paper-id', PAPER, '--manifest', path.join(s.dir, 'manifest.json')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /LaTeX command outside math \((\\\\|\\)alpha\)/); // the JSON report escapes the backslash
});

test('normaliseCandidate cleans parts: duplicated label, printed points markers, a statement that repeats its parts', () => {
  const c = candidate();
  const pr = c.problems[0];
  pr.parts = [
    { label: 'а)', statement: 'а) а) Намерете отношението на масите на двете колички. [3 т.]', points: 3 },
    { label: 'б)', statement: 'След колко време ще се ударят количките, ако и двете бъдат освободени? **[4 т.]**' },
    { label: 'в)', statement: 'Пресметнете отношението на кинетичните енергии в момента на удара. [2 т]', points: 5 },
  ];
  pr.statement = 'Два магнита са закрепени върху две колички.\n\nа) Намерете отношението на масите на двете колички. [3 т.]\n\nб) След колко време ще се ударят количките, ако и двете бъдат освободени?\n\nПриемете, че силата не зависи от разстоянието.';
  lib.normaliseCandidate(c);
  assert.equal(pr.parts[0].statement, 'Намерете отношението на масите на двете колички.');
  assert.equal(pr.parts[1].points, 4);
  assert.equal(pr.parts[1].statement, 'След колко време ще се ударят количките, ако и двете бъдат освободени?');
  assert.match(pr.parts[2].statement, /\[2 т\]$/); // disagrees with the points field: left for the checker
  assert.equal(pr.statement, 'Два магнита са закрепени върху две колички.\n\nПриемете, че силата не зависи от разстоянието.');
});

test('a fix that pastes a sibling field into this one is refused', async () => {
  const { applyFixes, duplicatesSiblings } = await import(txModule('fixes.mjs'));
  const c = candidate();
  c.problems[0].parts = [{ label: 'а)', statement: 'Колко е зарядът, който преминава през сечението за една минута?', points: 10 }];
  const whole = 'Токът е $I = 1\ \mathrm{mA}$ и $v_0/2$. Определете заряда.\n\nа) Колко е зарядът, който преминава през сечението за една минута?';
  assert.equal(duplicatesSiblings(c, '/problems/0/statement', whole, c.problems[0].statement), 'part а)');
  assert.equal(duplicatesSiblings(c, '/problems/0/statement', 'Токът е $I = 1\ \mathrm{mA}$ и $v_0/2$. Определете заряда.', c.problems[0].statement), null);
  const r = applyFixes(c, [{ path: '/problems/0/statement', value: whole }], { defects: [{ path: '/problems/0/statement', kind: 'omission', severity: 'major', description: 'sentence missing' }] });
  assert.equal(r.applied.length, 0);
  assert.match(r.skipped[0].reason, /pastes the text of part а\)/);
});

test('normaliseCandidate drops transient tx keys a refix flattened onto a figure and gives label-less parts their labels', () => {
  const c = candidate();
  const fig = c.problems[0].figures[0];
  Object.assign(fig, { file: 'x.png', remoteKey: 'k', upload: 'new', cropped: true, dryRun: false, boxFrom: 'refix', bbox: [1, 2, 3, 4] });
  c.problems[0].parts = [
    { statement: 'б) Намерете скоростта.', points: 2 },
    { statement: 'Намерете ускорението.', points: 3 },
  ];
  lib.normaliseCandidate(c);
  for (const k of ['file', 'remoteKey', 'upload', 'cropped', 'dryRun', 'boxFrom', 'bbox']) assert.equal(fig[k], undefined, k);
  assert.deepEqual(fig.tx.bbox, [365, 275, 625, 430]); // the tx block keeps its own box
  assert.equal(c.problems[0].parts[0].label, 'б)');
  assert.equal(c.problems[0].parts[0].statement, 'Намерете скоростта.');
  assert.equal(c.problems[0].parts[1].label, ''); // no printed label: left empty, never invented
});

test('a mangled checker path is repaired when the repair resolves in the candidate', async () => {
  const { repairDefectPath } = await import(txModule('fixes.mjs'));
  const c = candidate();
  c.problems[0].solution.figures = [{ id: 'p1-sol-fig1', alt: 'x', tx: { document: 'solutions', page: 1, bbox: [1, 1, 2, 2] } }];
  assert.equal(repairDefectPath(c, '/problems/0/problems/0/figures/0/tx/bbox'), '/problems/0/figures/0/tx/bbox');
  assert.equal(repairDefectPath(c, '/problems/0/p1/statement'), '/problems/0/parts/0/statement');
  assert.equal(repairDefectPath(c, '/problems/1/parts/0/statement'), '/problems/0/parts/0/statement'); // 1-based problem index
  assert.equal(repairDefectPath(c, '/problems/0/figures/1/tx/bbox'), '/problems/0/solution/figures/1/tx/bbox' === repairDefectPath(c, '/problems/0/figures/1/tx/bbox') ? '/problems/0/solution/figures/1/tx/bbox' : '/problems/0/figures/1/tx/bbox');
  assert.equal(repairDefectPath(c, '/problems/0/statement'), '/problems/0/statement');
  assert.equal(repairDefectPath(c, '/problems/7/nowhere'), '/problems/7/nowhere'); // nothing resolves: left as written
});

test('normaliseCandidate renames a figure that repeats an earlier id and clears its crop evidence', () => {
  const c = candidate();
  c.problems.push({ ...JSON.parse(JSON.stringify(c.problems[0])), id: `${PAPER}-p2`, number: 2 });
  const dup = c.problems[1].figures[0];
  assert.equal(dup.id, 'p1-fig1');
  lib.normaliseCandidate(c);
  assert.equal(c.problems[0].figures[0].id, 'p1-fig1');
  assert.equal(c.problems[0].figures[0].url !== undefined, true); // the first keeps its evidence
  assert.equal(dup.id, 'p2-fig1');
  assert.equal(dup.url, undefined);
  assert.deepEqual(Object.keys(dup.tx).sort(), ['bbox', 'document', 'page']);
});
