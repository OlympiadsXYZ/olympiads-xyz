import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemblePageBlocks, pageRecordFingerprint, validatePageAssignments } from '../tx/page-assembly.mjs';

const block = (id, type, text, number = null, continuation = false) => ({
  id, type, text, bbox: [25, 30, 800, 120], problemNumber: number, continuation,
});
const record = (id, page, blocks) => ({
  item: { id, paperId: 'test-paper', documentRole: 'problems', pdfPage: page,
    sourcePdfPath: '/source.pdf', sourcePdfSha256: 'a'.repeat(64),
    imagePath: `/${id}.png`, imageSha256: 'b'.repeat(64), viewTransform: 'none' },
  page: { schemaVersion: 1, blocks, uncertainties: [], normalizations: [] },
});
const problem = (problemId, section = 'statement') => ({ kind: 'problem', problemId, section });
function fixture() {
  const records = [
    record('page1', 1, [
      block('header', 'heading', 'ТЕМА'),
      block('start', 'paragraph', '  Задача 1. $a=εr$\n[1 т.]  ', '1'),
      block('diagram', 'figure', '', '1'),
      block('caption', 'caption', 'Фиг. 1', '1'),
      block('shared', 'paragraph', 'Общо указание: не променяйте Δ.'),
      block('second', 'paragraph', 'Задача 2. 25,2 mL; $r^2$.', '2'),
      block('footer', 'footer', '1'),
    ]),
    // The physical problems PDF can contain official solutions. Assignment
    // section must remain independent of the source document filename.
    record('page2', 2, [
      block('header', 'heading', 'РЕШЕНИЯ'),
      block('continuation', 'paragraph', 'Продължение на условието. $a=εr$', '1', true),
      block('solution1', 'equation', '$xv_x-yv_y=0$; 2 точки.', '1'),
      block('solution2', 'paragraph', 'Официално решение на втората задача.', '2'),
    ]),
  ];
  const plan = { schemaVersion: 1, paperId: 'test-paper',
    pages: records.map(r => ({ pageId: r.item.id, recordSha256: pageRecordFingerprint(r) })),
    problems: [{ id: 'p1', number: 1 }, { id: 'p2', number: 2 }],
    assignments: records.flatMap(r => r.page.blocks.map(b => {
      let target;
      if (b.id === 'header' || b.id === 'footer') target = { kind: 'document', role: b.id };
      else if (b.id === 'shared') target = { kind: 'shared', section: 'statement', problemIds: ['p1', 'p2'] };
      else target = problem(`p${b.problemNumber}`, b.id.startsWith('solution') ? 'official-solution' : 'statement');
      return { pageId: r.item.id, blockId: b.id, target };
    })).reverse(),
  };
  return { records, plan };
}
function rejected(mutator, pattern) {
  const f = fixture(); mutator(f);
  assert.equal(validatePageAssignments(f.records, f.plan).ok, false);
  assert.throws(() => assemblePageBlocks(f.records, f.plan), pattern);
}

test('preserves exact text, duplicate formulas, inline figures and all source order without rewriting', () => {
  const { records, plan } = fixture(), before = JSON.stringify({ records, plan });
  const assembled = assemblePageBlocks([...records].reverse(), plan);
  assert.equal(JSON.stringify({ records, plan }), before);
  assert.deepEqual(assembled.blocks.map(e => e.block), records.flatMap(r => r.page.blocks));
  assert.equal(new Set(assembled.blocks.map(e => e.key)).size, 11);
  assert.deepEqual(assembled.blocks.slice(1, 4).map(e => e.block.type), ['paragraph', 'figure', 'caption']);
  assert.equal(assembled.blocks[1].block.text, '  Задача 1. $a=εr$\n[1 т.]  ');
  assert.equal(assembled.owners[0].statement.length, 4);
  assert.equal(assembled.owners[0].officialSolution.length, 1);
  assert.equal(assembled.blocks[9].sourceAnchor.document, 'problems');
  assert.equal(assembled.blocks[9].assignment.target.section, 'official-solution');
  assert.equal(assembled.blocks[9].block.text, '$xv_x-yv_y=0$; 2 точки.');
  assert.equal(assembled.blocks[8].block.continuation, true);
  assert.equal(assembled.txCandidate, null);
  assert.equal(assembled.publicationEligible, false);
  assembled.blocks[1].block.text = 'changed result';
  assert.equal(JSON.stringify({ records, plan }), before, 'Output must not alias input objects');
});

test('shared instruction is stored once, referenced by both owners; null-owned furniture is retained', () => {
  const { records, plan } = fixture(), out = assemblePageBlocks(records, plan);
  const shared = out.blocks.filter(e => e.block.id === 'shared');
  assert.equal(shared.length, 1); assert.equal(shared[0].owner, null);
  assert.deepEqual(out.owners.map(p => p.shared), [[shared[0].key], [shared[0].key]]);
  assert.equal(out.document.length, 3);
  assert.ok(out.blocks.filter(e => out.document.includes(e.key)).every(e => e.owner === null));
});

test('requires every block exactly once, even headers and footers; no unknown/invented assignments', () => {
  rejected(f => f.plan.assignments.pop(), /unassigned block/);
  rejected(f => f.plan.assignments.push(structuredClone(f.plan.assignments[0])), /more than once/);
  rejected(f => f.plan.assignments[0].blockId = 'invented', /unknown block/);
  rejected(f => f.plan.assignments[0].text = 'rewritten text', /invalid assignment/);
  rejected(f => f.plan.assignments[0].target.replacement = 'rewrite', /invalid problem target/);
  rejected(f => f.plan.assignments.find(a => a.blockId === 'header').target.reason = {}, /invalid null-owned document target/);
});

test('explicit page order must cover all supplied records without duplicate alternatives', () => {
  rejected(f => f.plan.pages.pop(), /page absent/);
  rejected(f => f.plan.pages.push(structuredClone(f.plan.pages[0])), /duplicate/);
  rejected(f => f.records.push(structuredClone(f.records[0])), /duplicate page record/);
});

test('frozen fingerprints reject edits to text, figures, source identity or reader uncertainty', () => {
  for (const change of [
    r => r.page.blocks[1].text += ' new', r => r.page.blocks[2].bbox[2] = 900,
    r => r.item.imageSha256 = 'c'.repeat(64),
    r => r.page.uncertainties.push({ blockId: 'start', note: 'Faint' }),
  ]) rejected(f => change(f.records[0]), /stale page fingerprint/);
});

test('number conflicts require an explicit retained override; owners cannot be invented or silently dropped', () => {
  rejected(f => f.plan.assignments.find(a => a.blockId === 'start').target = problem('p2'), /number\/ownership conflict/);
  const f = fixture(), assignment = f.plan.assignments.find(a => a.blockId === 'start');
  assignment.target = problem('p2'); assignment.numberOverrideReason = 'Source review: page-reader number was wrong.';
  const out = assemblePageBlocks(f.records, f.plan);
  assert.equal(out.blocks[1].assignment.numberOverrideReason, assignment.numberOverrideReason);
  assert.equal(out.blocks[1].block.problemNumber, '1', 'Original model claim is retained, not silently rewritten');
  rejected(f => f.plan.problems.push({ id: 'missing', number: 3 }), /no owned block/);
  rejected(f => f.plan.assignments[0].target.problemId = 'unknown', /invalid problem target/);
  rejected(f => f.plan.problems[1].number = 1, /duplicate problem/);
});

test('shared ownership must explicitly name known distinct problems and a content section', () => {
  for (const ids of [[], ['p1', 'p1'], ['unknown']]) rejected(f => {
    f.plan.assignments.find(a => a.blockId === 'shared').target.problemIds = ids;
  }, /invalid shared ownership/);
  rejected(f => f.plan.assignments[0].target.section = 'inferred-answer', /invalid problem target/);
});

test('retains per-block uncertainty/normalization evidence without applying or normalizing it', () => {
  const f = fixture();
  f.records[0].page.uncertainties = [{ blockId: 'start', note: 'Printed sign appears wrong; keep it.' }];
  f.records[0].page.normalizations = [{ blockId: 'start', source: 'a', replacement: 'a', reason: 'Source claim retained for later validation.' }];
  f.plan.pages[0].recordSha256 = pageRecordFingerprint(f.records[0]);
  const out = assemblePageBlocks(f.records, f.plan);
  assert.deepEqual(out.blocks[1].uncertainties, f.records[0].page.uncertainties);
  assert.deepEqual(out.blocks[1].normalizations, f.records[0].page.normalizations);
  assert.equal(out.blocks[0].uncertainties.length, 0);
  rejected(f => f.records[0].page.uncertainties.push({ blockId: 'missing', note: 'x' }), /invalid uncertainties/);
});

test('preserves rotated split-leaf anchors without pretending they are PDF coordinates', () => {
  const f = fixture(), item = f.records[1].item;
  Object.assign(item, { viewTransform: 'clockwise90 then right half', parentUprightPixelSize: [3743, 2645],
    parentUprightImageSha256: 'd'.repeat(64), cropPixelBox: [1871, 0, 3743, 2645],
    cropToParentPermille: [1871 / 3743 * 1000, 0, 1000, 1000] });
  f.plan.pages[1].recordSha256 = pageRecordFingerprint(f.records[1]);
  const out = assemblePageBlocks(f.records, f.plan);
  assert.deepEqual(out.pages[1].item, item);
  assert.equal(out.blocks[9].sourceAnchor.coordinateSpace, 'input-image-permille');
  assert.equal(out.blocks[9].sourceAnchor.pdfRect, undefined);
  assert.equal(out.sourceFilesVerifiedByThisModule, false);
  item.cropToParentPermille[0] = 500;
  assert.match(validatePageAssignments(f.records, f.plan).errors.join(';'), /crop-to-parent/);
});

test('solutions-only input stays incomplete for tx conversion; never synthesizes a statement or answer', () => {
  const r = record('solution-leaf', 2, [block('solution', 'paragraph', 'Официален текст.', '1')]);
  const plan = { schemaVersion: 1, paperId: 'test-paper', pages: [{ pageId: r.item.id, recordSha256: pageRecordFingerprint(r) }],
    problems: [{ id: 'p1', number: 1 }], assignments: [{ pageId: r.item.id, blockId: 'solution', target: problem('p1', 'official-solution') }] };
  const out = assemblePageBlocks([r], plan);
  assert.deepEqual(out.owners[0].statement, []);
  assert.equal(out.owners[0].answer, undefined);
  assert.ok(out.conversionGaps.some(g => g.includes('no statement blocks')));
});

test('explicit nonconsecutive printed numbering is retained without inferred missing tasks', () => {
  const f = fixture();
  f.plan.problems[0].number = 3; f.plan.problems[1].number = 'VII';
  for (const r of f.records) for (const b of r.page.blocks) {
    if (b.problemNumber === '1') b.problemNumber = '3';
    else if (b.problemNumber === '2') b.problemNumber = 'VII';
  }
  f.plan.pages = f.records.map(r => ({ pageId: r.item.id, recordSha256: pageRecordFingerprint(r) }));
  const out = assemblePageBlocks(f.records, f.plan);
  assert.deepEqual(out.owners.map(p => p.number), [3, 'VII']);
  assert.equal(out.owners.length, 2);
});

test('rejects invalid geometry, duplicate source blocks, non-JSON values and accessor side effects', () => {
  rejected(f => f.records[0].page.blocks[2].bbox = [1, 2, 1, 4], /invalid\/duplicate block/);
  rejected(f => f.records[0].page.blocks[2].id = 'start', /invalid\/duplicate block/);
  rejected(f => f.records[0].page.blocks[2].text = 'A description instead of figure pixels', /invalid\/duplicate block/);
  rejected(f => f.records[0].page.blocks[1].bbox[0] = NaN, /JSON data/);
  const f = fixture(); let called = false;
  Object.defineProperty(f.records, '0', { get() { called = true; throw Error('side effect'); }, enumerable: true });
  assert.equal(validatePageAssignments(f.records, f.plan).ok, false);
  assert.equal(called, false);
});

test('rejects hidden getters and symbol fields without running or dropping them', () => {
  const f = fixture(); let called = false;
  Object.defineProperty(f.records[0].item, 'paperId', {
    get() { called = true; return 'test-paper'; }, enumerable: false,
  });
  assert.equal(validatePageAssignments(f.records, f.plan).ok, false);
  assert.throws(() => pageRecordFingerprint(f.records[0]), /hidden or symbol/);
  assert.equal(called, false);
  rejected(f => f.records[0].item[Symbol('extra')] = 'invisible', /JSON data/);
});

test('provenance hashes must be strings and one source document cannot have conflicting PDF hashes', () => {
  rejected(f => f.records[0].item.sourcePdfSha256 = ['a'.repeat(64)], /identity\/provenance/);
  rejected(f => f.records[0].item.imageSha256 = ['b'.repeat(64)], /identity\/provenance/);
  rejected(f => f.plan.pages[0].recordSha256 = [f.plan.pages[0].recordSha256], /unfrozen page/);
  rejected(f => {
    f.records[1].item.sourcePdfSha256 = 'c'.repeat(64);
    f.plan.pages[1].recordSha256 = pageRecordFingerprint(f.records[1]);
  }, /conflicting source PDF hashes/);
});
