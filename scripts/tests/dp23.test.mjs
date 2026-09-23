// D-P23 (2026-09-22): obvious print errors are fixed and recorded in tx.edits; acceptable printed
// forms are kept. Tests the text-layer check's handling of recorded fixes, the record's journey into
// paper.transcription.edits, and the schema. No network: a throw-away OLYMPIADS_TX_DIR holds the paper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const txScript = name => path.join(repo, 'scripts', 'tx', name);
const lib = await import(pathToFileURL(txScript('lib.mjs')).href);

const PAPER = 'zz-2099-dp23-7';
const size = { page: 1, widthPt: 595.276, heightPt: 841.89 };
const manifest = {
  paperId: PAPER, meta: { competition: 'ZZ', year: 2099, round: null, grade: '7', subject: 'physics', lang: 'bg' }, renderDpi: 160,
  documents: {
    problems: { key: 'Физика/zz/problems.pdf', file: 'src/problems.pdf', sha256: 'a'.repeat(64), bytes: 1, pages: 2, pageSizes: [size, { ...size, page: 2 }], pageImages: ['pages/problems-01.png', 'pages/problems-02.png'], text: 'text/problems.txt' },
    solutions: { key: 'Физика/zz/solutions.pdf', file: 'src/solutions.pdf', sha256: 'b'.repeat(64), bytes: 1, pages: 1, pageSizes: [size], pageImages: ['pages/solutions-01.png'], text: 'text/solutions.txt' },
  },
};
// page 1 prints two obvious errors: a non-word („обратопропорционална“) and an agreement error („намереният стойност“)
const PRINTED = [
  'Тънък проводник с дължина един метър е свързан към източник на постоянно напрежение и през него протича ток с големина един милиампер.',
  'Силата на тока е обратопропорционална на съпротивлението на проводника.',
  'Определете заряда, който преминава през напречното сечение на проводника за една минута, ако токът остава постоянен през цялото време на измерването.',
  'Сравнете намереният стойност с табличната стойност за медта.',
  'Приемете, че зависимостта от температурата е пренебрежимо малка.',
];
const PAGE2 = 'Бележка: всички измервания се правят при стайна температура и нормално атмосферно налягане в лабораторията на училището.';
const FIXED = PRINTED.join(' ').replace('обратопропорционална', 'обратнопропорционална').replace('намереният стойност', 'намерената стойност');
const edit = (over = {}) => ({ path: '/problems/0/statement', printed: 'обратопропорционална', fixed: 'обратнопропорционална', document: 'problems', page: 1, kind: 'misspelling', ...over });
const agreement = { path: '/problems/0/statement', printed: 'намереният стойност', fixed: 'намерената стойност', document: 'problems', page: 1, kind: 'agreement' };

function candidate({ statement = FIXED, edits } = {}) {
  const fig = { id: 'p1-fig1', alt: 'Графика', url: `${lib.R2_PUBLIC}/problems/${PAPER}/p1-fig1.png`, width: 600, height: 400, source: { page: 1, pdfRect: [100, 200, 300, 400], dpi: 300 },
    tx: { document: 'problems', page: 1, bbox: [365, 275, 625, 430], file: 'figs/problems/p1-fig1.png', public200: true, upload: 'new', dryRun: false } };
  return {
    paper: { id: PAPER, subject: 'physics', competition: 'ZZ', year: 2099, round: null, roundType: 'theory', grade: '7 клас', lang: 'bg', title: '', totalPoints: 10, source: { archiveKey: manifest.documents.problems.key, pages: [1, 2] }, solutionSource: { archiveKey: manifest.documents.solutions.key, pages: [1] }, status: 'draft' },
    problems: [
      { id: `${PAPER}-p1`, number: 1, points: 10, problemType: 'theory', statement, figures: [fig], parts: [], topics: ['electricity/current'], difficulty: 'Easy', importance: 2,
        solution: { statement: 'Решение: $q = I t = 0{,}06\\ \\mathrm{C}$.' }, tx: { sourceSpans: [{ document: 'problems', page: 1 }, { document: 'solutions', page: 1 }] } },
    ],
    tx: { printedMeta: 'Тест 2099, 7 клас', catalogDisagrees: false, textLayerTrustworthy: true, notes: 'n', ...(edits ? { edits } : {}), reader: { provider: 'agent', model: 'opus-5-5', promptVersion: 'v1', promptSha256: 'c'.repeat(64), requestId: 'req-1', at: '2026-09-22T00:00:00.000Z' } },
  };
}
function sandbox(t, { page1 = `Задача 1. \n${PRINTED.join('\n')}\n` } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dp23-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, PAPER);
  fs.mkdirSync(path.join(dir, 'text'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'candidates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'text', 'problems.txt'), `${page1}\f${PAGE2}\n\f`);
  fs.writeFileSync(path.join(dir, 'text', 'solutions.txt'), 'Решения\nЗадача 1. Зарядът е q = I t = 0,06 C.\n'); // too few words: not checked
  const check = c => {
    const f = path.join(dir, 'candidates', 'c.json'), out = path.join(dir, 'tl.json');
    fs.writeFileSync(f, JSON.stringify(c, null, 1));
    const r = spawnSync(process.execPath, [txScript('textlayer.mjs'), PAPER, '--candidate', f, '--out', out], { encoding: 'utf8', env: { ...process.env, OLYMPIADS_TX_DIR: root } });
    assert.ok([0, 3].includes(r.status), r.stderr + r.stdout);
    return { status: r.status, ...JSON.parse(fs.readFileSync(out, 'utf8')) };
  };
  return { check };
}

test('(a) a recorded misspelling and a recorded agreement fix are accepted as info, not defects', t => {
  const { check } = sandbox(t);
  const r = check(candidate({ edits: [edit(), agreement] }));
  assert.equal(r.documents.problems.trusted, true);
  assert.deepEqual(r.defects, [], JSON.stringify(r.defects, null, 1));
  assert.equal(r.status, 0);
  // an agreement fix is on the page, but only a model reading it tells it from a real-word swap
  assert.deepEqual(r.edits.map(e => e.status), ['accepted', 'needs-model']);
  assert.equal(r.edits[1].contiguous, true);
  assert.equal(r.info.length, 2);
  assert.ok(r.info.every(d => d.severity === 'info' && d.kind === 'source-error'));
  assert.match(r.info[1].description, /needs a model checker/);
  assert.deepEqual(r.summary.edits, { recorded: 2, accepted: 1, needsModel: 1, rejected: 0, unverified: 0, stale: 0 });
});

test('(a) a recorded misspelling broken at a line end in the layer is still found on its page', t => {
  const page1 = `Задача 1. \n${PRINTED.join('\n').replace('обратопропорционална на', 'обрато-\nпропорционална на')}\n`;
  const { check } = sandbox(t, { page1 });
  const r = check(candidate({ edits: [edit(), agreement] }));
  assert.deepEqual(r.edits.map(e => e.status), ['accepted', 'needs-model'], JSON.stringify(r.edits));
  assert.deepEqual(r.defects, [], JSON.stringify(r.defects, null, 1));
});

test('(c) the same fixes without a record stay defects with the restore-the-print mechanical fix', t => {
  const { check } = sandbox(t);
  const r = check(candidate());
  assert.equal(r.status, 3);
  const fixes = r.defects.filter(d => d.suggestedFix);
  assert.ok(fixes.some(d => d.suggestedFix.includes('обратопропорционална') && !d.suggestedFix.includes('обратнопропорционална')), JSON.stringify(r.defects, null, 1));
  assert.ok(fixes.some(d => /намереният/.test(d.suggestedFix)), 'the agreement fix is reverted mechanically too');
  assert.ok(fixes.every(d => d.path === '/problems/0/statement' && d.severity === 'major' && d.kind === 'reworded'));
  assert.ok(fixes.every(d => /tx\.edits/.test(d.description) && /restore the printed wording/.test(d.description)), 'the message states the D-P23 policy');
  // only one of two fixes recorded: the other is still flagged
  const one = check(candidate({ edits: [edit()] }));
  assert.ok(one.defects.some(d => d.suggestedFix && /намереният/.test(d.suggestedFix)));
  assert.ok(!one.defects.some(d => /обратопропорционална/.test(d.suggestedFix || '')), JSON.stringify(one.defects, null, 1));
});

test('(c) a miscopied acceptable form (the начинает → начинается case) is flagged with the printed word restored', t => {
  const { check } = sandbox(t);
  const r = check(candidate({ statement: FIXED.replace('остава постоянен', 'остане постоянен'), edits: [edit(), agreement] }));
  const d = r.defects.find(x => x.suggestedFix && /остава постоянен/.test(x.suggestedFix));
  assert.ok(d, JSON.stringify(r.defects, null, 1));
  assert.match(d.description, /„остава“/);
  assert.match(d.description, /no tx\.edits record/);
});

test('(b) a record whose printed words the text layer does not have is a defect: an invented printed error', t => {
  const { check } = sandbox(t);
  // the field is right, but the reader claims the page printed „остане постоянен“ and that it fixed it
  const invented = edit({ printed: 'остане постоянен', fixed: 'остава постоянен', kind: 'agreement' });
  const r = check(candidate({ edits: [edit(), agreement, invented] }));
  assert.equal(r.status, 3);
  assert.deepEqual(r.edits.map(e => e.status), ['accepted', 'needs-model', 'rejected']);
  const d = r.defects.find(x => /tx\.edits\[2\]/.test(x.description));
  assert.ok(d, JSON.stringify(r.defects, null, 1));
  assert.equal(d.severity, 'major');
  assert.equal(d.path, '/problems/0/statement');
  assert.match(d.description, /claimed printed form is not found in the text layer/);
  assert.match(d.description, /misreading/);
  assert.equal(r.summary.edits.rejected, 1);
});

test('(b) a record with the wrong page keeps its fix but asks for the page; words on the other page do not count', t => {
  const { check } = sandbox(t);
  const r = check(candidate({ edits: [edit({ page: 2 }), agreement] }));
  assert.equal(r.edits[0].status, 'misplaced');
  const d = r.defects.find(x => /tx\.edits\[0\]/.test(x.description));
  assert.equal(d?.severity, 'minor', JSON.stringify(r.defects, null, 1));
  assert.match(d.description, /p\.1/);
  assert.ok(!r.defects.some(x => /обратопропорционална/.test(x.suggestedFix || '')), 'the fix itself is not reverted');
});

test('a record that changes a number, unit or formula is a wrong-value defect; bad shapes are reported', t => {
  const { check } = sandbox(t);
  const r = check(candidate({ edits: [edit(), agreement, edit({ printed: '0,06 A', fixed: '0,06 C', kind: 'misspelling' }), edit({ kind: 'style' }), edit({ path: '/problems/0/nope' }), edit({ fixed: 'обратнопропорционалната' })] }));
  assert.deepEqual(r.edits.map(e => e.status), ['accepted', 'needs-model', 'invalid', 'invalid', 'invalid', 'invalid']);
  const science = r.defects.find(x => /tx\.edits\[2\]/.test(x.description));
  assert.equal(science.severity, 'major'); assert.equal(science.kind, 'wrong-value');
  assert.match(science.description, /never touches numbers/);
  assert.ok(r.defects.some(x => /tx\.edits\[3\]/.test(x.description) && /kind "style"/.test(x.description)));
  assert.ok(r.defects.some(x => x.path === '/tx/edits/4'), 'a record pointing at no text field is addressed to the record');
  assert.ok(r.defects.some(x => /tx\.edits\[5\]/.test(x.description) && /not in this field/.test(x.description)));
});

test('a record on a document without a trusted text layer is unverified (info), and omissions are still caught', t => {
  const { check } = sandbox(t);
  const omitted = FIXED.replace(' Приемете, че зависимостта от температурата е пренебрежимо малка.', '');
  const r = check(candidate({ statement: omitted, edits: [edit(), agreement, { path: '/problems/0/solution/statement', printed: 'Реше ние', fixed: 'Решение', document: 'solutions', page: 1, kind: 'spacing' }] }));
  assert.equal(r.edits[2].status, 'unverified');
  assert.ok(r.info.some(d => d.document === 'solutions' && /not verifiable/.test(d.description)));
  assert.ok(r.defects.some(d => d.kind === 'omission' && /Приемете, че зависимостта/.test(d.description)), JSON.stringify(r.defects, null, 1));
});

test('buildFinalPaper publishes tx.edits as paper.transcription.edits; without edits the bytes carry no edits key', () => {
  const prov = { provider: 'agent', model: 'opus-5-5', promptVersion: 'v1', promptSha256: 'c'.repeat(64), requestId: 'req-1', at: '2026-09-22', sourceSha256: { problems: 'a'.repeat(64), solutions: 'b'.repeat(64) }, verifiedBy: 'mechanical:textlayer+regions (test)', verifiedAt: '2026-09-22' };
  const { validate } = lib.compileSchema('final');
  const withEdits = candidate({ edits: [{ ...edit(), note: 'working field, not published' }, agreement] });
  const final = lib.buildFinalPaper(withEdits, prov);
  assert.deepEqual(final.data.paper.transcription.edits, [edit(), agreement]);
  assert.equal(final.data.tx, undefined);
  assert.ok(validate(final.data), JSON.stringify(validate.errors));
  const plain = lib.buildFinalPaper(candidate(), prov);
  assert.equal(plain.data.paper.transcription.edits, undefined);
  assert.doesNotMatch(plain.bytes.toString('utf8'), /"edits"/);
  assert.equal(lib.buildFinalPaper(candidate({ edits: [] }), prov).contentHash, plain.contentHash, 'an empty record changes nothing');
  // the checker sees the record (to verify it) but nothing else of the reader's working block
  const view = lib.checkerView(withEdits);
  assert.deepEqual(view.tx, { edits: [edit(), agreement] });
  assert.equal(lib.checkerView(candidate()).tx, undefined);
});

test('schema: transcription.edits validates when well formed, rejects extra keys and bad kinds; published papers still validate', () => {
  const { validate } = lib.compileSchema('final');
  const paper = { paper: { id: PAPER, subject: 'physics', competition: 'ZZ', year: 2099, round: null, grade: '7', lang: 'bg', title: 'T', status: 'review', transcription: { method: 'vision', model: 'm', at: '2026-09-22', edits: [edit()] } }, problems: [] };
  const ok = validate(paper);
  const errs = (validate.errors || []).filter(e => /transcription/.test(e.dataPath));
  assert.deepEqual(errs, [], JSON.stringify(errs));
  if (!ok) assert.ok(!(validate.errors || []).some(e => /edits/.test(e.dataPath)));
  paper.paper.transcription.edits = [{ ...edit(), note: 'x' }];
  validate(paper); assert.ok(validate.errors.some(e => /edits\/0/.test(e.dataPath)));
  paper.paper.transcription.edits = [edit({ kind: 'style' })];
  validate(paper); assert.ok(validate.errors.some(e => /edits\/0\/kind/.test(e.dataPath)));
  // candidate mode checks tx.edits from the first validate
  const cand = lib.compileSchema('candidate');
  cand.validate(candidate({ edits: [edit({ page: 0 })] }));
  assert.ok((cand.validate.errors || []).some(e => /\/tx\/edits\/0\/page/.test(e.dataPath)), JSON.stringify(cand.validate.errors));
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.json') && e.name !== 'schema.json' ? [path.join(d, e.name)] : []);
  const bad = walk(path.join(repo, 'content', 'problems')).filter(f => !validate(JSON.parse(fs.readFileSync(f, 'utf8'))));
  assert.deepEqual(bad.map(f => path.relative(repo, f)), []);
});

// ---- fix pass (review of D-P23): eligibility, span-exact acceptance, lapsed records, the agreement gate
const statuses = r => r.edits.map(e => e.status);
const restores = (r, word) => r.defects.some(d => d.suggestedFix && d.path === '/problems/0/statement' && d.suggestedFix.includes(word));

test('eligibility: a recorded real-word swap, meaning reversal or unit change is not accepted, and the print is restored', t => {
  const { check } = sandbox(t);
  // малка → голяма recorded as a "misspelling": four letters change, and „малка“ is a word of published papers
  const reversal = check(candidate({ statement: FIXED.replace('пренебрежимо малка', 'пренебрежимо голяма'), edits: [edit(), agreement, edit({ printed: 'малка', fixed: 'голяма' })] }));
  assert.equal(reversal.status, 3);
  assert.equal(statuses(reversal)[2], 'invalid');
  assert.ok(reversal.defects.some(d => /tx\.edits\[2\]/.test(d.description) && d.severity === 'major' && d.kind === 'reworded'), JSON.stringify(reversal.defects, null, 1));
  // (a line-final word with one neighbour has no mechanical restore; the refix re-reads the flagged field)
  assert.ok(reversal.defects.some(d => d.path === '/problems/0/statement' && /„малка“ \(problems p\.1/.test(d.description)), 'the printed word is reported missing');
  // a real word recorded as a misspelling at distance 2 (остава → остане): the lexicon of published papers knows it
  const swap = check(candidate({ statement: FIXED.replace('остава постоянен', 'остане постоянен'), edits: [edit(), agreement, edit({ printed: 'остава', fixed: 'остане' })] }));
  assert.equal(statuses(swap)[2], 'invalid');
  assert.match(swap.edits[2].reason, /is a word/);
  assert.ok(restores(swap, 'остава постоянен'));
  // unit words: милиампер → ампер, метър → милиметър
  const units = check(candidate({ statement: FIXED.replace('един милиампер', 'един ампер').replace('един метър', 'един милиметър'), edits: [edit(), agreement, edit({ printed: 'милиампер', fixed: 'ампер' }), edit({ printed: 'метър', fixed: 'милиметър' })] }));
  assert.deepEqual(statuses(units).slice(2), ['invalid', 'invalid']);
  assert.ok(units.edits.slice(2).every(e => /changes a unit/.test(e.reason)));
  assert.ok(restores(units, 'един милиампер') && restores(units, 'един метър'), JSON.stringify(units.defects, null, 1));
  // a pronoun record that touches й inside a word, and a symbol-only "spacing" record
  const pronoun = check(candidate({ statement: FIXED.replace('който', 'коѝто'), edits: [edit(), agreement, edit({ printed: 'който', fixed: 'коѝто', kind: 'pronoun' }), edit({ printed: '—', fixed: '-', kind: 'spacing' })] }));
  assert.match(pronoun.edits[2].reason, /standalone й/);
  assert.deepEqual(statuses(pronoun).slice(2), ['invalid', 'invalid']);
});

test('eligibility: the pilot case (начинает → начинается) is rejected as a misspelling and as an agreement fix', t => {
  const page1 = `Задача 1. \n${PRINTED.join('\n')}\nВлиянието на съпротивлението начинает сказываться при високи температури в експеримента.\n`;
  const { check } = sandbox(t, { page1 });
  const statement = `${FIXED} Влиянието на съпротивлението начинается сказываться при високи температури в експеримента.`;
  for (const kind of ['misspelling', 'agreement']) {
    const r = check(candidate({ statement, edits: [edit(), agreement, edit({ printed: 'начинает сказываться', fixed: 'начинается сказываться', kind })] }));
    assert.equal(statuses(r)[2], 'invalid', kind);
    assert.ok(restores(r, 'начинает сказываться'), `${kind}: ${JSON.stringify(r.defects, null, 1)}`);
  }
});

test('a real-word agreement swap the text layer cannot tell apart is needs-model, never accepted', t => {
  const { check } = sandbox(t);
  const r = check(candidate({ statement: FIXED.replace('остава постоянен', 'остане постоянен'), edits: [edit(), agreement, edit({ printed: 'остава', fixed: 'остане', kind: 'agreement' })] }));
  assert.deepEqual(statuses(r), ['accepted', 'needs-model', 'needs-model']);
  assert.equal(r.summary.edits.needsModel, 2);
  assert.deepEqual(lib.editsNeedingModel(candidate({ statement: FIXED.replace('остава постоянен', 'остане постоянен'), edits: [edit(), agreement, edit({ printed: 'остава', fixed: 'остане', kind: 'agreement' })] })).map(e => e.index), [1, 2]);
});

test('padding: a record cannot hide a dropped word or an invented word behind a real fix', t => {
  const { check } = sandbox(t);
  // printed padded with a word the statement dropped („постоянен“)
  const dropped = FIXED.replace('остава постоянен', 'остава');
  const x4 = check(candidate({ statement: dropped, edits: [edit({ printed: 'обратопропорционална постоянен' }), agreement] }));
  assert.equal(x4.status, 3);
  assert.equal(statuses(x4)[0], 'invalid');
  assert.ok(x4.defects.some(d => /„постоянен“/.test(d.description) || /pair word for word/.test(d.description)), JSON.stringify(x4.defects, null, 1));
  // fixed padded with a word the page never prints („квадратично“)
  const invented = FIXED.replace('обратнопропорционална', 'обратнопропорционална квадратично');
  const x7 = check(candidate({ statement: invented, edits: [edit({ fixed: 'обратнопропорционална квадратично' }), agreement] }));
  assert.equal(statuses(x7)[0], 'invalid');
  assert.ok(x7.defects.some(d => /„квадратично“/.test(d.description)), JSON.stringify(x7.defects, null, 1));
  // equal word counts, but more than one unchanged word of context
  const ctx = check(candidate({ edits: [edit({ printed: 'обратопропорционална на съпротивлението', fixed: 'обратнопропорционална на съпротивлението' }), agreement] }));
  assert.equal(statuses(ctx)[0], 'invalid');
  assert.match(ctx.edits[0].reason, /unchanged words/);
  // words that are on the page, but not as one printed span
  const apart = check(candidate({ statement: `${FIXED} остава обратнопропорционална`, edits: [edit(), agreement, edit({ printed: 'остава обратопропорционална', fixed: 'остава обратнопропорционална' })] }));
  assert.equal(statuses(apart)[2], 'rejected');
  assert.equal(apart.edits[2].contiguous, false);
  assert.ok(apart.defects.some(d => /tx\.edits\[2\]/.test(d.description) && d.severity === 'major' && /one printed span/.test(d.description)));
});

test('span-exact acceptance: one record explains one printed occurrence, not every occurrence on the page', t => {
  const extra = 'Мощността в проводника също е обратопропорционална на съпротивлението при постоянно напрежение.';
  const page1 = `Задача 1. \n${PRINTED.join('\n')}\n${extra}\n`;
  const { check } = sandbox(t, { page1 });
  const statement = `${FIXED} ${extra.replace('обратопропорционална', 'обратнопропорционална')}`;
  const one = check(candidate({ statement, edits: [edit(), agreement] }));
  assert.equal(one.status, 3, 'the second fixed occurrence has no record');
  assert.ok(one.defects.some(d => d.path === '/problems/0/statement' && /„обратопропорционална“ \(problems p\.1: „Мощността/.test(d.description)), JSON.stringify(one.defects, null, 1));
  const two = check(candidate({ statement, edits: [edit(), edit(), agreement] }));
  assert.deepEqual(two.defects, [], JSON.stringify(two.defects, null, 1));
  assert.deepEqual(statuses(two), ['accepted', 'accepted', 'needs-model']);
});

test('pronoun й → ѝ is accepted, precomposed or decomposed', t => {
  const page1 = `Задача 1. \n${PRINTED.join('\n').replace('Приемете, че', 'Дайте й отговор. Приемете, че')}\n`;
  const { check } = sandbox(t, { page1 });
  for (const fixed of ['ѝ', 'ѝ']) {
    const r = check(candidate({ statement: FIXED.replace('Приемете, че', `Дайте ${fixed} отговор. Приемете, че`), edits: [edit(), agreement, edit({ printed: 'й', fixed, kind: 'pronoun' })] }));
    assert.deepEqual(statuses(r), ['accepted', 'needs-model', 'accepted'], JSON.stringify(r.edits));
    assert.deepEqual(r.defects, []);
  }
});

test('a record whose field holds the printed wording again has lapsed: no defect, not shown to the checker, not published', t => {
  const { check } = sandbox(t);
  // the repair restored „малка“ after the ineligible record was rejected; the record is still in tx.edits
  const lapsed = edit({ printed: 'малка', fixed: 'голяма' });
  const c = candidate({ edits: [edit(), agreement, lapsed] });
  const r = check(c);
  assert.deepEqual(statuses(r), ['accepted', 'needs-model', 'stale']);
  assert.deepEqual(r.defects, [], JSON.stringify(r.defects, null, 1));
  assert.ok(r.notes.some(n => /tx\.edits\[2\]/.test(n) && /lapsed/.test(n)));
  assert.equal(lib.editFieldState(c, lapsed), 'printed');
  assert.deepEqual(lib.transcriptionEdits(c), [edit(), agreement]);
  assert.deepEqual(lib.checkerView(c).tx, { edits: [edit(), agreement] });
  // whole-word spans only: „ампер“ is not in „милиампер“
  assert.equal(lib.editFieldState(candidate(), edit({ printed: 'милиампер', fixed: 'ампер' })), 'printed');
  assert.equal(lib.editFieldState(candidate(), edit({ printed: 'x', fixed: 'ампер' })), 'neither');
});

test('receipt.mjs: an agreement fix blocks a crops/mechanical check and passes a full model check', t => {
  const { check } = sandbox(t);
  check(candidate()); // creates the sandbox paper directory
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dp23-receipt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, PAPER);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const run = (c, check, reviewer) => {
    const cand = path.join(dir, 'cand.json'); fs.writeFileSync(cand, JSON.stringify(c, null, 1));
    const chk = path.join(dir, 'check.json'), out = path.join(dir, 'receipt.json');
    fs.writeFileSync(chk, JSON.stringify({ verdict: 'pass', summary: 'ok', coverage: { pagesRead: [{ document: 'problems', page: 1 }, { document: 'problems', page: 2 }, { document: 'solutions', page: 1 }], problemsChecked: 1, figuresChecked: 1 }, defects: [], candidateSha256: lib.sha256File(cand), ...check }));
    const r = spawnSync(process.execPath, [txScript('receipt.mjs'), PAPER, '--candidate', cand, '--defects', chk, '--reviewer', reviewer, '--out', out], { encoding: 'utf8', env: { ...process.env, OLYMPIADS_TX_DIR: root } });
    return { status: r.status, receipt: JSON.parse(fs.readFileSync(out, 'utf8')), out: r.stdout + r.stderr };
  };
  const withAgreement = candidate({ edits: [edit(), agreement] });
  const crops = run(withAgreement, { mode: 'crops' }, 'gemini:gemini-3.8-flash:req-1');
  assert.equal(crops.status, 1, crops.out);
  assert.ok(crops.receipt.blockers.some(b => /tx\.edits\[1\].*agreement.*--checker-mode full/.test(b)), JSON.stringify(crops.receipt.blockers));
  const mech = run(withAgreement, {}, 'mechanical:textlayer+regions:mech-r1');
  assert.ok(mech.receipt.blockers.some(b => /agreement/.test(b)), JSON.stringify(mech.receipt.blockers));
  const full = run(withAgreement, {}, 'gemini:gemini-3.8-flash:req-2');
  assert.equal(full.status, 0, full.out + JSON.stringify(full.receipt.blockers));
  const misspellingOnly = run(candidate({ edits: [edit()] }), { mode: 'crops' }, 'gemini:gemini-3.8-flash:req-3');
  assert.equal(misspellingOnly.status, 0, JSON.stringify(misspellingOnly.receipt.blockers));
});
