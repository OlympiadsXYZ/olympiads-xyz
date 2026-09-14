import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pageRecordFingerprint } from '../tx/page-assembly.mjs';
import { buildFallbackMapping, toFallbackCandidate } from '../tx/page-fallback.mjs';
import { allFigures, stripTx } from '../tx/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = x => createHash('sha256').update(x).digest('hex');
const block = (id, text, problemNumber = '1', type = 'paragraph', bbox = [100, 100, 800, 140]) =>
  ({ id, text, problemNumber, type, bbox, continuation: false });
function freeze(f) {
  f.assignments.pages = f.records.map(r => ({ pageId: r.item.id, recordSha256: pageRecordFingerprint(r) }));
  return f;
}
function fixture() {
  const page = (id, number, blocks) => ({ item: { id, paperId: 'fallback-paper', documentRole: 'problems', pdfPage: number,
    sourcePdfPath: '/problems.pdf', sourcePdfSha256: 'a'.repeat(64), sourceArchiveKey: 'problems.pdf',
    imagePath: `/${id}.png`, imageSha256: String(number).repeat(64), imageWidth: 1000, imageHeight: 1400,
    viewTransform: 'original', pdfDeclaredRotation: 0, readyForDispatch: true, rotationNeedsReview: false },
    page: { schemaVersion: 1, blocks, uncertainties: [], normalizations: [] } });
  const records = [page('page1', 1, [
    block('header', 'ТЕМА ЗА 9. КЛАС', null, 'heading'),
    block('p1-start', 'Задача 1. Скорости\nа) $v_2=2v_1$ (3 т.)\nПовтор $v_2=2v_1$.'),
    block('f1', '', '1', 'figure', [100, 200, 400, 400]),
    block('c1', 'Фиг. 1', '1', 'caption', [100, 410, 400, 440]),
    block('p1-tail', 'б) Намерете $t_2$. (2 т.)\nОбщо 5 точки.'),
    block('p2', 'Задача 2. 𝛼 и $\\alpha$ остават различни.', '2'),
    block('footer', '1', null, 'footer'),
  ]), page('page2', 2, [
    block('solution-header', 'ОФИЦИАЛНИ РЕШЕНИЯ', null, 'heading'),
    block('solution', 'Задача 1.\n$v_2=2v_1$\n$v_2=2v_1$\n[3 т.]'),
    block('sf1', '', '1', 'figure', [100, 500, 400, 650]),
  ])];
  const assignments = { schemaVersion: 1, paperId: 'fallback-paper', pages: [],
    problems: [{ id: 'fallback-paper-p1', number: 1 }, { id: 'fallback-paper-p2', number: 2 }],
    assignments: records.flatMap(r => r.page.blocks.map(b => ({ pageId: r.item.id, blockId: b.id,
      target: b.type === 'heading' ? { kind: 'document', role: 'header' }
        : b.type === 'footer' ? { kind: 'document', role: 'footer' }
          : { kind: 'problem', problemId: `fallback-paper-p${b.problemNumber}`, section: r.item.pdfPage === 2 ? 'official-solution' : 'statement' },
    }))),
  };
  return freeze({ records, assignments, paper: { subject: 'physics', competition: 'NOF', year: 2001,
    roundType: 'theory', lang: 'bg', source: { archiveKey: 'problems.pdf' } }, options: {} });
}
const run = f => toFallbackCandidate(f.records, f.assignments, f.paper, f.options);
function add(f, pageIndex, at, b, target) {
  f.records[pageIndex].page.blocks.splice(at, 0, b);
  f.assignments.assignments.push({ pageId: f.records[pageIndex].item.id, blockId: b.id,
    target: target ?? { kind: 'problem', problemId: `fallback-paper-p${b.problemNumber}`, section: pageIndex ? 'official-solution' : 'statement' } });
  return freeze(f);
}
function rejects(change, pattern = /rejected|invalid|unsupported|conflict|stale/i) {
  const f = fixture(); change(f); assert.throws(() => run(f), pattern);
}

test('whole source blocks preserve printed titles, labels, point awards and repeated math without mutation', () => {
  const f = fixture(), before = JSON.stringify(f), out = run(f), p = out.problems[0];
  assert.equal(JSON.stringify(f), before);
  assert.equal(out.paper.title, f.records[0].page.blocks[0].text);
  assert.equal(p.statement, f.records[0].page.blocks[1].text);
  assert.equal(p.statementAfterParts, f.records[0].page.blocks[4].text);
  assert.equal(p.solution.statement, f.records[1].page.blocks[1].text);
  assert.deepEqual(p.parts, []); assert.equal(p.points, null);
  assert.equal(out.problems[1].statement, f.records[0].page.blocks[5].text);
  assert.equal(out.problems[1].solution.incomplete, true);
  assert.equal(out.paper.solutionSource, undefined, 'Solutions remain on their physical problems-PDF page');
  assert.ok(out.paper.documentNotes.some(n => n.page === 2 && n.document === 'problems' && n.statement === 'ОФИЦИАЛНИ РЕШЕНИЯ'));
  assert.deepEqual(out.tx.pageCandidate.coverage.map(row => {
    const e = out.tx.pageCandidate.assembly.blocks.find(e => e.key === row.blockKey);
    return row.ranges.map(s => e.block.text.slice(s.start, s.end)).join('');
  }), out.tx.pageCandidate.assembly.blocks.map(e => e.block.text));
  assert.equal(out.paper.status, 'draft');
  assert.equal(out.tx.pageFallback.publicationEligible, false);
  assert.equal(out.tx.pageCandidate.sourceFilesVerifiedByThisModule, false);
  assert.ok(allFigures(out).every(({ fig }) => !fig.url && !fig.source && fig.tx.requiresNoSnap));
  const mapping = buildFallbackMapping(f.records, f.assignments, f.paper);
  assert.deepEqual(mapping, out.tx.pageCandidate.fieldMapping);
  out.tx.pageCandidate.assembly.blocks[1].block.text = 'changed'; out.problems[0].figures[0].tx.bbox[0] = 0;
  assert.equal(JSON.stringify(f), before, 'All returned provenance and geometry are detached');
});

test('no-figure fallback retains the entire problem and solution with exact source ordering', () => {
  const f = fixture();
  for (const r of f.records) r.page.blocks = r.page.blocks.filter(b => !['figure', 'caption'].includes(b.type));
  f.assignments.assignments = f.assignments.assignments.filter(a => f.records.find(r => r.item.id === a.pageId).page.blocks.some(b => b.id === a.blockId));
  freeze(f); const out = run(f);
  assert.equal(out.problems[0].statement, [f.records[0].page.blocks[1].text, f.records[0].page.blocks[2].text].join('\n\n'));
  assert.equal(out.problems[0].statementAfterParts, undefined);
  assert.deepEqual(allFigures(out), []);
});

test('multiple consecutive figures stay ordered, and solution figures remain at the supported end slot', () => {
  const f = fixture(); add(f, 0, 4, block('f2', '', '1', 'figure', [500, 200, 800, 400]));
  const out = run(f);
  assert.deepEqual(out.problems[0].figures.map(x => x.tx.sourceAnchor.bbox), [[100, 200, 400, 400], [500, 200, 800, 400]]);
  assert.equal(out.problems[0].figures[0].caption, 'Фиг. 1');
  assert.equal(out.problems[0].solution.figures[0].tx.page, 2);
});

test('interleaved figures, leading figures and trailing solution prose reject instead of moving source content', () => {
  rejects(f => add(f, 0, 5, block('interior', '', '1', 'figure', [500, 500, 800, 650])), /interleaved/);
  rejects(f => { f.records[0].page.blocks.splice(1, 1); f.assignments.assignments = f.assignments.assignments.filter(a => a.blockId !== 'p1-start'); freeze(f); }, /opening statement/);
  rejects(f => add(f, 1, 3, block('sol-tail', 'Последен извод.')), /solution text after/);
  rejects(f => { const b = f.records[0].page.blocks; [b[4], b[5]] = [b[5], b[4]]; freeze(f); }, /source order/);
});

test('orphan, overlapping, separated and multiline captions require explicit assembly', () => {
  rejects(f => { f.records[0].page.blocks[3].bbox = [100, 380, 400, 440]; freeze(f); }, /overlaps/);
  rejects(f => add(f, 0, 5, block('orphan', 'Фиг. 2', '1', 'caption')), /orphan/);
  rejects(f => { f.records[0].page.blocks[3].text += '\nВтори ред'; freeze(f); }, /single-line/);
  rejects(f => add(f, 0, 3, block('between', 'Бележка', null), { kind: 'document', role: 'other', reason: 'Supplied note' }), /interior/);
  rejects(f => { f.records[0].page.blocks[3].problemNumber = '2'; f.assignments.assignments.find(a => a.blockId === 'c1').target.problemId = 'fallback-paper-p2'; freeze(f); }, /orphan|source order/);
});

test('fully enclosed caption stays in the image and retains exact source text in evidence only', () => {
  const f = fixture(); f.records[0].page.blocks[3].bbox = [120, 250, 350, 300]; freeze(f);
  const out = run(f), fig = out.problems[0].figures[0];
  assert.equal(fig.caption, undefined);
  const coverage = out.tx.pageCandidate.figureCoverage.find(x => x.id === fig.id);
  assert.equal(coverage.embeddedCaption.text, 'Фиг. 1');
  assert.equal(coverage.embeddedCaption.emittedTextualCaption, false);
  assert.deepEqual(coverage.embeddedCaption.sourceAnchor.bbox, [120, 250, 350, 300]);
  assert.equal(out.tx.pageCandidate.fieldMapping.problems[0].figures[0].embeddedCaption.spans[0].text, 'Фиг. 1');
});

test('standalone score blocks typed as captions stay inline in figure-free solution streams', () => {
  const f = fixture(); f.records[1].page.blocks.pop();
  f.assignments.assignments = f.assignments.assignments.filter(a => a.blockId !== 'sf1');
  add(f, 1, 2, block('score', '2 точки', '1', 'caption', [800, 500, 900, 520]));
  const out = run(f);
  assert.equal(out.problems[0].solution.statement, f.records[1].page.blocks[1].text + '\n\n2 точки');
  assert.deepEqual(out.problems[0].solution.figures, []);
});

test('source fingerprints and explicit ownership cannot be guessed, reordered or reconciled', () => {
  rejects(f => { f.records[0].page.blocks[1].text += ' invented'; }, /stale/);
  rejects(f => { f.assignments.assignments.pop(); }, /unassigned/);
  rejects(f => { f.assignments.assignments.find(a => a.blockId === 'p2').target.problemId = 'fallback-paper-p1'; }, /number\/ownership/);
  rejects(f => { f.assignments.problems.reverse(); }, /contiguous/);
  rejects(f => { f.paper.source.archiveKey = 'different.pdf'; }, /archive key/);
  rejects(f => { f.paper.status = 'published'; }, /paper metadata/);
});

test('interior notes and selected-problem shared text reject; whole-paper boundary instructions retain exact ownership evidence', () => {
  rejects(f => add(f, 0, 2, block('note', 'Не местете този текст.', null), { kind: 'document', role: 'other', reason: 'Interior source note' }), /interior/);
  rejects(f => add(f, 0, 6, block('shared', 'Само за задача 1.', null), { kind: 'shared', problemIds: ['fallback-paper-p1'], section: 'statement' }), /selected problems/);
  const f = fixture(); add(f, 0, 6, block('shared', 'За всички задачи: $g=10$.', null),
    { kind: 'shared', problemIds: ['fallback-paper-p1', 'fallback-paper-p2'], section: 'statement' });
  assert.ok(run(f).paper.documentNotes.some(n => n.statement.includes('За всички задачи: $g=10$.')));
});

test('unapproved normalizations and reader uncertainties survive without changing text', () => {
  const f = fixture();
  f.records[0].page.uncertainties.push({ blockId: 'p2', note: 'Source symbol remains uncertain.' });
  f.records[0].page.normalizations.push({ blockId: 'p2', source: '𝛼', replacement: 'a', reason: 'Unapproved suggestion.' });
  freeze(f); const out = run(f);
  assert.equal(out.problems[1].statement, f.records[0].page.blocks[5].text);
  assert.equal(out.tx.pageCandidate.assembly.blocks.find(b => b.block.id === 'p2').normalizations[0].replacement, 'a');
  assert.equal(out.tx.pageFallback.publicationEligible, false);
});

test('rotation, crop and unreviewed geometry reject even for text-only pages', () => {
  for (const change of [i => i.viewTransform = 'rotate-90', i => i.pdfDeclaredRotation = 90,
    i => i.rotationNeedsReview = true, i => delete i.readyForDispatch,
    i => i.rotation = 0]) rejects(f => { change(f.records[0].item); freeze(f); }, /figure rejected/);
  const f = fixture(), i = f.records[0].item;
  i.imageWidth = 500; i.imageHeight = 700; i.parentImageWidth = 1000; i.parentImageHeight = 1400;
  i.parentImagePath = '/parent.png'; i.parentImageSha256 = 'f'.repeat(64);
  i.viewTransform = { fullPage: true, rotateCW: 0, resizeFrom: [1000, 1400], resizeTo: [500, 700] };
  freeze(f); assert.deepEqual(run(f).problems[0].figures[0].tx.bbox, [100, 200, 400, 400]);
});

test('decorative exclusions require explicit reviewed evidence and remain in the source audit', () => {
  const f = fixture(); add(f, 0, 0, block('logo', '', null, 'figure', [10, 10, 80, 80]),
    { kind: 'document', role: 'other', reason: 'Reviewed institution logo' });
  assert.throws(() => run(f), /explicit reviewed disposition/);
  f.options.excludedFigures = [{ pageId: 'page1', blockId: 'logo', reason: 'Source reviewed decoration', sourceReviewed: true }];
  const out = run(f); assert.equal(allFigures(out).length, 2);
  assert.ok(out.tx.pageCandidate.figureCoverage.some(x => x.disposition === 'excluded-decoration'));
  f.options.excludedFigures[0].sourceReviewed = false; assert.throws(() => run(f), /source-reviewed/);
});

test('getter, cyclic, sparse and extra option inputs cannot cause side effects or silent omissions', () => {
  const f = fixture(); let called = false;
  Object.defineProperty(f.paper, 'title', { enumerable: true, get() { called = true; return 'invented'; } });
  assert.throws(() => run(f), /accessor/); assert.equal(called, false);
  rejects(f => { f.options.replaceText = true; }, /options/);
  rejects(f => { f.records.push(f.records); }, /acyclic/);
  rejects(f => { delete f.records[0]; }, /sparse|hidden or extended/);
});

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'page-fallback-test-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('page-fallback-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
test('CLI writes only a new draft and refuses overwriting input or canonical content', t => {
  const root = temporary(t), f = fixture();
  for (const [name, data] of Object.entries({ records: f.records, assignments: f.assignments, paper: f.paper })) fs.writeFileSync(path.join(root, name + '.json'), JSON.stringify(data));
  const args = ['--records', path.join(root, 'records.json'), '--assignments', path.join(root, 'assignments.json'), '--paper', path.join(root, 'paper.json')];
  const cli = out => spawnSync(process.execPath, [path.join(repo, 'scripts/tx/page-fallback.mjs'), ...args, '--out', out], { encoding: 'utf8' });
  const output = path.join(root, 'draft.json'); assert.equal(cli(output).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(output)).tx.pageFallback.publicationEligible, false);
  const original = fs.readFileSync(path.join(root, 'records.json'));
  assert.notEqual(cli(path.join(root, 'records.json')).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(root, 'records.json')), original);
  assert.notEqual(cli(path.join(repo, 'content', 'fallback-must-not-write.json')).status, 0);
  assert.equal(fs.existsSync(path.join(repo, 'content', 'fallback-must-not-write.json')), false);
});

test('actual site generator preserves fallback text/figure order without repeating point awards', t => {
  const root = temporary(t), out = stripTx(run(fixture()));
  for (const { fig } of allFigures(out)) fig.url = `https://example.invalid/${fig.id}.png`;
  const write = (name, value) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value)); return target; };
  const source = write('content/problems/physics/NOF/2001/fallback-paper.json', out);
  write('content/extraProblems.json', { EXTRA_PROBLEMS: [] });
  write('content/problem-publication.json', { version: 1, papers: { 'fallback-paper': { kind: 'legacy', contentHash: sha(fs.readFileSync(source)), sourceCommit: 'a'.repeat(40), recordedAt: '2026-09-14T00:00:00Z' } } });
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts/problems-to-site.mjs'), '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const mdx = fs.readFileSync(path.join(root, 'solutions/physics/fallback-paper/fallback-paper-p1.mdx'), 'utf8');
  let prior = -1;
  for (const marker of ['Задача 1. Скорости', '(3 т.)', 'https://example.invalid/p1-fig1.png', '<figcaption>Фиг. 1</figcaption>', 'б) Намерете $t_2$.', 'Общо 5 точки.', '## Решение', 'Задача 1.\n$v_2=2v_1$', 'https://example.invalid/p1-sol-fig1.png']) {
    const at = mdx.indexOf(marker); assert.ok(at > prior, `Missing/reordered ${marker}`); prior = at;
  }
  assert.equal(mdx.split('(3 т.)').length - 1, 1);
  assert.equal(mdx.split('https://example.invalid/p1-fig1.png').length - 1, 1);
  assert.equal(mdx.includes('## Отговори'), false);
});
