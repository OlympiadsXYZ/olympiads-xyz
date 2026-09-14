import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pageRecordFingerprint } from '../tx/page-assembly.mjs';
import { toPageCandidate } from '../tx/page-candidate.mjs';
import { originalPageFigureGeometry } from '../tx/page-figure.mjs';
import { allFigures, compileSchema, stripTx } from '../tx/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = value => createHash('sha256').update(value).digest('hex');
const ref = (blockId, pageId = 'conditions') => ({ pageId, blockId });
const text = (...spans) => ({ spans, join: '\n\n' });
const fig = (blockId, id, pageId = 'conditions') => ({ ...ref(blockId, pageId), id });
const block = (id, body, type = 'paragraph', box = [100, 100, 800, 140]) => ({
  id, type, text: body, bbox: box, problemNumber: '1', continuation: false,
});
function item(id = 'conditions', role = 'problems', page = 1) {
  return { id, paperId: 'figure-paper', documentRole: role, pdfPage: page,
    sourcePdfPath: `/${role}.pdf`, sourcePdfSha256: (role === 'solutions' ? 'c' : 'a').repeat(64),
    sourceArchiveKey: `${role}.pdf`, imagePath: `/${id}.png`, imageSha256: 'b'.repeat(64),
    imageWidth: 1000, imageHeight: 1400, viewTransform: 'none',
    pdfDeclaredRotation: 0, readyForDispatch: true, rotationNeedsReview: false };
}
function freeze(f) {
  f.assignments.pages = f.records.map(r => ({ pageId: r.item.id, recordSha256: pageRecordFingerprint(r) }));
  f.assignments.assignments = f.records.flatMap(r => r.page.blocks.map(b => ({
    pageId: r.item.id, blockId: b.id,
    target: { kind: 'problem', problemId: 'figure-paper-p1', section: r.item.documentRole === 'solutions' ? 'official-solution' : 'statement' },
  })));
  return f;
}
function fixture() {
  const record = (i, blocks) => ({ item: i, page: { schemaVersion: 1, blocks, uncertainties: [], normalizations: [] } });
  const records = [record(item(), [
    block('intro', 'Opening $E=mc^2$.'),
    block('opening-figure', '', 'figure', [100, 160, 400, 300]),
    block('opening-caption', 'Фиг. 1', 'caption', [100, 310, 400, 340]),
    block('part-label', 'а)'),
    block('part-text', 'First question $E=mc^2$.'),
    block('part-figure', '', 'figure', [100, 400, 400, 550]),
    block('common', 'Shared paragraph between the two questions.'),
    block('second-label', 'б)'),
    block('second-text', 'Second question $E=mc^2$.'),
    block('trailing', 'Common text after all parts.'),
  ]), record(item('solutions', 'solutions'), [
    block('solution-text', 'Задача 1.\n$E=mc^2$\nЗадача 1.\n$E=mc^2$'),
    block('solution-figure', '', 'figure', [100, 400, 400, 550]),
  ])];
  const mapping = { schemaVersion: 2,
    paper: { subject: 'physics', competition: 'NOF', year: 2002, roundType: 'theory', lang: 'bg',
      source: { archiveKey: 'problems.pdf' }, solutionSource: { archiveKey: 'solutions.pdf' } },
    problems: [{ id: 'figure-paper-p1', statement: text(ref('intro')),
      figures: [{ ...fig('opening-figure', 'p1-fig1'), caption: text(ref('opening-caption')) }],
      parts: [{ label: ref('part-label'), statement: text(ref('part-text')),
        figures: [fig('part-figure', 'p1-fig2')], statementAfter: text(ref('common')) },
      { label: ref('second-label'), statement: text(ref('second-text')) }],
      statementAfterParts: text(ref('trailing')),
      solution: { statement: text(ref('solution-text', 'solutions')),
        figures: [fig('solution-figure', 'p1-sol-fig1', 'solutions')] } }],
    documentNotes: [], furniture: [], whitespace: [],
  };
  return freeze({ records, assignments: { schemaVersion: 1, paperId: 'figure-paper', pages: [],
    problems: [{ id: 'figure-paper-p1', number: 1 }], assignments: [] }, mapping });
}
const convert = f => toPageCandidate(f.records, f.assignments, f.mapping);
function rejects(change, pattern = /rejected|invalid|unsupported|figure|source|caption|geometry/i) {
  const f = fixture(); change(f); assert.throws(() => convert(f), pattern);
}

test('v2 maps figures to all existing render slots once with exact text and detached provenance', () => {
  const f = fixture(), original = JSON.stringify(f), out = convert(f), p = out.problems[0];
  assert.equal(JSON.stringify(f), original);
  assert.equal(p.statement, 'Opening $E=mc^2$.');
  assert.equal(p.parts[0].statement, 'First question $E=mc^2$.');
  assert.equal(p.parts[0].statementAfter, 'Shared paragraph between the two questions.');
  assert.equal(p.solution.statement, 'Задача 1.\n$E=mc^2$\nЗадача 1.\n$E=mc^2$');
  assert.equal(p.figures[0].caption, 'Фиг. 1');
  assert.deepEqual(allFigures(out).map(f => f.path), ['/problems/0/figures/0', '/problems/0/parts/0/figures/0', '/problems/0/solution/figures/0']);
  assert.deepEqual(allFigures(out).map(f => f.fig.id), ['p1-fig1', 'p1-fig2', 'p1-sol-fig1']);
  for (const { fig: image } of allFigures(out)) {
    assert.equal(Object.hasOwn(image, 'url'), false);
    assert.equal(Object.hasOwn(image, 'source'), false, 'Original PDF crop rectangle is produced by the crop pipeline, not guessed here');
    assert.equal(image.tx.rotation, 0);
    assert.equal(image.tx.page, 1);
  }
  assert.deepEqual(p.figures[0].tx.bbox, [100, 160, 400, 300]);
  assert.equal(p.solution.figures[0].tx.document, 'solutions');
  const candidate = compileSchema('candidate').validate;
  assert.equal(candidate(stripTx(out)), true, JSON.stringify(candidate.errors));
  assert.equal(compileSchema('final').validate(stripTx(out)), false, 'No URL means this is not publishable final data');
  p.figures[0].tx.bbox[0] = 999;
  out.tx.pageCandidate.assembly.blocks[1].block.bbox[0] = 999;
  assert.equal(JSON.stringify(f), original, 'Neither figure nor audit objects may alias source inputs');
});

test('v1 continues to reject every figure block', () => {
  rejects(f => { f.mapping.schemaVersion = 1; }, /unsupported|figure/i);
});

test('empty figure blocks cannot disappear, be duplicated, or masquerade as text', () => {
  rejects(f => { delete f.mapping.problems[0].parts[0].figures; });
  rejects(f => { f.mapping.problems[0].parts[0].figures.push(fig('part-figure', 'p1-fig3')); });
  rejects(f => { f.mapping.problems[0].figures[0].blockId = 'intro'; });
  rejects(f => { f.mapping.problems[0].parts[0].statement.spans.push(ref('part-figure')); });
  rejects(f => { f.mapping.problems[0].parts[0].figures[0].blockId = 'absent'; });
});

test('global figure IDs are unique and refs cannot inject prose, URLs, boxes or crop metadata', () => {
  rejects(f => { f.mapping.problems[0].solution.figures[0].id = 'p1-fig1'; });
  for (const [key, value] of Object.entries({ bbox: [0, 0, 500, 500], url: 'https://example.org/a.png',
    alt: 'Invented explanation', source: { page: 3, pdfRect: [0, 0, 100, 100] }, rotation: 90 })) {
    rejects(f => { f.mapping.problems[0].figures[0][key] = value; });
  }
  rejects(f => { f.mapping.problems[0].figures[0].id = '../other'; });
});

test('statement and official-solution figures cannot cross ownership streams', () => {
  rejects(f => { f.mapping.problems[0].figures[0] = f.mapping.problems[0].solution.figures[0]; });
  rejects(f => { f.mapping.problems[0].solution.figures = f.mapping.problems[0].parts[0].figures; });
  rejects(f => {
    const a = f.assignments.assignments.find(a => a.blockId === 'part-figure');
    a.target = { kind: 'shared', problemIds: ['figure-paper-p1'], section: 'statement' };
  });
  rejects(f => {
    const a = f.assignments.assignments.find(a => a.blockId === 'part-figure');
    a.target = { kind: 'document', role: 'other', reason: 'decorative' };
  });
});

test('an interior problem figure cannot be moved after subsequent text', () => {
  rejects(f => {
    const blocks = f.records[0].page.blocks;
    blocks.splice(2, 0, block('intro-tail', 'Text that follows the figure in source.'));
    f.mapping.problems[0].statement.spans.push(ref('intro-tail'));
    freeze(f);
  }, /order/i);
});

test('figures cannot jump across common text or be regrouped at the end of a solution', () => {
  rejects(f => {
    const blocks = f.records[0].page.blocks;
    const at = blocks.findIndex(b => b.id === 'part-figure');
    [blocks[at], blocks[at + 1]] = [blocks[at + 1], blocks[at]];
    freeze(f);
  }, /order/i);
  rejects(f => {
    f.records[1].page.blocks.push(block('solution-tail', 'Then the printed derivation continues.'));
    f.mapping.problems[0].solution.statement.spans.push(ref('solution-tail', 'solutions'));
    freeze(f);
  }, /order/i);
});

test('multiple figures in one existing slot preserve source order and reject reversal', () => {
  const f = fixture();
  f.records[0].page.blocks.splice(3, 0, block('opening-second', '', 'figure', [500, 160, 800, 300]));
  f.mapping.problems[0].figures.push(fig('opening-second', 'p1-fig3')); freeze(f);
  assert.deepEqual(convert(f).problems[0].figures.map(f => f.id), ['p1-fig1', 'p1-fig3']);
  f.mapping.problems[0].figures.reverse();
  assert.throws(() => convert(f), /order/i);
});

test('distinct source blocks cannot silently duplicate the same original figure region', () => {
  rejects(f => {
    f.records[0].page.blocks.find(b => b.id === 'part-figure').bbox =
      [...f.records[0].page.blocks.find(b => b.id === 'opening-figure').bbox];
    freeze(f);
  }, /duplicate.*(source|figure|box)/i);
});

test('captions must be separate exact caption blocks on the same page outside the crop', () => {
  rejects(f => { f.mapping.problems[0].figures[0].caption = text(ref('intro')); });
  rejects(f => {
    f.records[0].page.blocks.find(b => b.id === 'opening-caption').bbox = [100, 180, 300, 220]; freeze(f);
  });
  rejects(f => {
    f.mapping.problems[0].figures[0].caption = { spans: [{ ...ref('opening-caption'), exactText: 'Fig. 1' }], join: '' };
  });
  for (const body of [' Фиг. 1', 'Фиг. 1\nSecond caption line']) rejects(f => {
    f.records[0].page.blocks.find(b => b.id === 'opening-caption').text = body; freeze(f);
  });
  rejects(f => {
    f.records[1].page.blocks.push(block('other-caption', 'Other page caption', 'caption', [100, 600, 300, 650]));
    f.mapping.problems[0].figures[0].caption = text(ref('other-caption', 'solutions')); freeze(f);
  });
});

function embeddedCaptionFixture() {
  const f = fixture(), image = f.mapping.problems[0].figures[0];
  image.embeddedCaption = image.caption; delete image.caption;
  f.records[0].page.blocks.find(b => b.id === 'opening-figure').bbox = [100, 160, 400, 340];
  // A column-adjacent caption may be listed after ordinary text even though its
  // pixels are inside the earlier drawing. It must not reorder that text.
  f.records[0].page.blocks.push(...f.records[0].page.blocks.splice(2, 1));
  return freeze(f);
}

test('embedded captions retain exact source identity without emitting duplicate visible text', () => {
  const f = embeddedCaptionFixture(), before = JSON.stringify(f), out = convert(f);
  assert.equal(Object.hasOwn(out.problems[0].figures[0], 'caption'), false);
  assert.equal(out.problems[0].parts[0].statement, 'First question $E=mc^2$.');
  const audit = out.tx.pageCandidate.figureCoverage.find(f => f.id === 'p1-fig1').embeddedCaption;
  assert.equal(audit.text, 'Фиг. 1'); assert.equal(audit.emittedTextualCaption, false);
  assert.equal(audit.disposition, 'visible-in-source-image');
  assert.equal(audit.blockKey, JSON.stringify(['conditions', 'opening-caption']));
  assert.deepEqual(audit.sourceAnchor.bbox, [100, 310, 400, 340]);
  assert.equal(audit.sourceAnchor.imageSha256, f.records[0].item.imageSha256);
  assert.equal(audit.span.start, 0); assert.equal(audit.span.end, 'Фиг. 1'.length);
  audit.sourceAnchor.bbox[0] = 999; audit.span.text = 'Changed';
  assert.equal(JSON.stringify(f), before, 'Embedded audit must not alias frozen input');
});

test('embedded caption must be fully contained, whole, same-page and caption-typed', () => {
  const changes = [
    f => f.records[0].page.blocks.find(b => b.id === 'opening-caption').bbox = [99, 310, 400, 340],
    f => f.records[0].page.blocks.find(b => b.id === 'opening-caption').bbox = [100, 159, 400, 340],
    f => f.records[0].page.blocks.find(b => b.id === 'opening-caption').bbox = [100, 310, 401, 340],
    f => f.records[0].page.blocks.find(b => b.id === 'opening-caption').bbox = [100, 310, 400, 341],
    f => f.records[0].page.blocks.find(b => b.id === 'opening-caption').type = 'paragraph',
    f => f.mapping.problems[0].figures[0].embeddedCaption.spans[0].exactText = 'Фиг.',
    f => f.mapping.problems[0].figures[0].embeddedCaption.spans = [],
    f => f.mapping.problems[0].figures[0].embeddedCaption.spans.push(ref('opening-caption')),
    f => {
      f.records[1].page.blocks.push(block('other-caption', 'Фиг. 1', 'caption', [100, 310, 400, 340]));
      f.mapping.problems[0].figures[0].embeddedCaption = text(ref('other-caption', 'solutions'));
    },
  ];
  for (const change of changes) { const f = embeddedCaptionFixture(); change(f); freeze(f); assert.throws(() => convert(f), /caption/i); }
});

test('embedded captions reject wrong ownership, rendered caption reuse and duplicate text consumption', () => {
  for (const target of [
    { kind: 'problem', problemId: 'figure-paper-p1', section: 'official-solution' },
    { kind: 'shared', problemIds: ['figure-paper-p1'], section: 'statement' },
    { kind: 'document', role: 'other', reason: 'Cannot discard problem caption as furniture.' },
  ]) {
    const f = embeddedCaptionFixture(), a = f.assignments.assignments.find(a => a.blockId === 'opening-caption');
    a.target = target; a.numberOverrideReason = 'Testing explicit ownership rejection.';
    assert.throws(() => convert(f), /ownership|section/i);
  }
  const f = embeddedCaptionFixture(); f.mapping.problems[0].figures[0].caption = text(ref('opening-caption'));
  assert.throws(() => convert(f), /mutually exclusive/i);
  const duplicate = embeddedCaptionFixture();
  duplicate.mapping.problems[0].statementAfterParts.spans.push(ref('opening-caption'));
  assert.throws(() => convert(duplicate), /consumed more than once/i);
});

test('a solution figure never licenses a missing-solution claim or an invented answer', () => {
  rejects(f => { f.mapping.problems[0].solution = { missing: true, reason: 'Not supplied', figures: f.mapping.problems[0].solution.figures }; });
  rejects(f => { f.mapping.problems[0].answer = { kind: 'numeric', value: 42 }; });
  rejects(f => { f.mapping.problems[0].solution.statement = text(); });
});

test('part score markers cannot move from after a figure to the rendered pre-figure text', () => {
  rejects(f => {
    const at = f.records[0].page.blocks.findIndex(b => b.id === 'part-figure');
    f.records[0].page.blocks.splice(at + 1, 0, block('part-points', '(3 т.)'));
    f.mapping.problems[0].parts[0].points = { span: ref('part-points'), digits: { exactText: '3' }, value: 3 };
    freeze(f);
  }, /point|order/i);
});

function decorationFixture() {
  const f = fixture();
  f.records[0].page.blocks.unshift({ ...block('logo', '', 'figure', [20, 20, 90, 90]), problemNumber: null });
  freeze(f);
  f.assignments.assignments.find(a => a.blockId === 'logo').target = {
    kind: 'document', role: 'other', reason: 'Source-reviewed ministry logo in page masthead.',
  };
  f.mapping.excludedFigures = [{ ...ref('logo'), reason: 'Source-reviewed ministry logo in page masthead.', sourceReviewed: true }];
  return f;
}

test('a reviewed document-owned logo is excluded once with its source identity in the audit', () => {
  const f = decorationFixture(), before = JSON.stringify(f), out = convert(f);
  assert.equal(allFigures(out).length, 3);
  const exclusion = out.tx.pageCandidate.figureCoverage.find(f => f.disposition === 'excluded-decoration');
  assert.ok(exclusion, 'Excluded empty figure still needs coverage');
  assert.equal(exclusion.blockKey, JSON.stringify(['conditions', 'logo']));
  assert.equal(exclusion.sourceAnchor.imageSha256, f.records[0].item.imageSha256);
  assert.deepEqual(exclusion.sourceAnchor.bbox, [20, 20, 90, 90]);
  assert.equal(JSON.stringify(f), before);
});

test('decoration exclusions reject unreviewed, numbered, shared, problem-owned, unexplained or reused figures', () => {
  for (const change of [
    f => delete f.mapping.excludedFigures,
    f => f.mapping.excludedFigures[0].sourceReviewed = false,
    f => delete f.mapping.excludedFigures[0].sourceReviewed,
    f => f.mapping.excludedFigures[0].reason = ' ',
    f => f.mapping.excludedFigures.push(structuredClone(f.mapping.excludedFigures[0])),
    f => f.mapping.problems[0].figures.unshift(fig('logo', 'p1-logo')),
    f => f.assignments.assignments.find(a => a.blockId === 'logo').target = { kind: 'document', role: 'other', reason: '' },
    f => f.assignments.assignments.find(a => a.blockId === 'logo').target = { kind: 'problem', problemId: 'figure-paper-p1', section: 'statement' },
    f => f.assignments.assignments.find(a => a.blockId === 'logo').target = { kind: 'shared', problemIds: ['figure-paper-p1'], section: 'statement' },
    f => {
      f.records[0].page.blocks.find(b => b.id === 'logo').problemNumber = '1';
      f.assignments.pages[0].recordSha256 = pageRecordFingerprint(f.records[0]);
      f.assignments.assignments.find(a => a.blockId === 'logo').numberOverrideReason = 'Do not let an override turn a numbered figure into decoration.';
    },
  ]) { const f = decorationFixture(); change(f); assert.throws(() => convert(f)); }
});

test('original and proportional full-page resize geometries retain original page permille', () => {
  const original = item(), bbox = [100, 200, 400, 500], before = JSON.stringify({ original, bbox });
  const g = originalPageFigureGeometry(original, bbox);
  assert.equal(g.document, 'problems'); assert.equal(g.page, 1); assert.equal(g.rotation, 0);
  assert.deepEqual(g.bbox, bbox); assert.equal(g.coordinateSpace, 'original-pdf-page-permille');
  assert.equal(g.sourcePdfSha256, original.sourcePdfSha256); assert.equal(g.inputImageSha256, original.imageSha256);
  assert.equal(g.sourceFilesVerifiedByThisModule, false);
  assert.equal(JSON.stringify({ original, bbox }), before);
  const resized = { ...item(), imageWidth: 2288, imageHeight: 3200,
    parentImageWidth: 5460, parentImageHeight: 7638, parentImagePath: '/original.png', parentImageSha256: 'e'.repeat(64),
    viewTransform: { rotateCW: 0, fullPage: true, resizeFrom: [5460, 7638], resizeTo: [2288, 3200], normalizedCoordinateMapping: 'Identity' } };
  const r = originalPageFigureGeometry(resized, bbox);
  assert.deepEqual(r.bbox, bbox); assert.equal(r.rotation, 0);
  assert.deepEqual(r.inputViewTransform, resized.viewTransform);
  r.bbox[0] = 1; assert.deepEqual(bbox, [100, 200, 400, 500]);
});

test('geometry rejects unproven rotations, crops, anisotropic resize and contradicted identity', () => {
  const box = [100, 200, 400, 500];
  for (const change of [
    i => delete i.viewTransform,
    i => delete i.pdfDeclaredRotation,
    i => i.pdfDeclaredRotation = 90,
    i => i.readyForDispatch = false,
    i => i.rotationNeedsReview = true,
    i => i.cropPixelBox = [0, 0, 1000, 1400],
    i => i.rotation = 0,
    i => i.parentUprightImageSha256 = 'e'.repeat(64),
    i => i.imageWidth = 0,
    i => i.sourcePdfSha256 = 'invalid',
  ]) { const i = item(); change(i); assert.throws(() => originalPageFigureGeometry(i, box)); }
  const base = { ...item(), imageWidth: 500, imageHeight: 700, parentImageWidth: 1000, parentImageHeight: 1400,
    parentImagePath: '/original.png', parentImageSha256: 'e'.repeat(64),
    viewTransform: { rotateCW: 0, fullPage: true, resizeFrom: [1000, 1400], resizeTo: [500, 700] } };
  for (const change of [
    i => i.viewTransform.rotateCW = 90,
    i => i.viewTransform.fullPage = false,
    i => i.viewTransform.resizeTo[1] = 701,
    i => { i.imageHeight = 600; i.viewTransform.resizeTo[1] = 600; },
    i => i.parentImageWidth = 999,
    i => delete i.parentImageSha256,
    i => i.parentImageSha256 = i.imageSha256,
    i => i.viewTransform.crop = [0, 0, 1000, 1000],
  ]) { const i = structuredClone(base); change(i); assert.throws(() => originalPageFigureGeometry(i, box), undefined, String(change)); }
  for (const bbox of [[-1, 0, 100, 100], [0, 0, 1001, 100], [100, 0, 100, 100], [0, 0, NaN, 100]]) {
    assert.throws(() => originalPageFigureGeometry(item(), bbox));
  }
});

for (const embedded of [false, true]) test(`converted boundary figures render once with the actual site generator (embedded caption: ${embedded})`, t => {
  // All files and simulated publication evidence live in this disposable fixture.
  // No upload, real ledger, canonical paper, or source file is changed.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'page-figure-render-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('page-figure-render-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const out = stripTx(convert(embedded ? embeddedCaptionFixture() : fixture()));
  for (const { fig } of allFigures(out)) fig.url = `https://example.invalid/${fig.id}.png`;
  const write = (name, value) => {
    const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n'); return target;
  };
  const source = write('content/problems/physics/NOF/2002/figure-paper.json', out);
  write('content/extraProblems.json', { EXTRA_PROBLEMS: [] });
  write('content/problem-publication.json', { version: 1, papers: { 'figure-paper': {
    kind: 'legacy', contentHash: sha(fs.readFileSync(source)), sourceCommit: 'a'.repeat(40), recordedAt: '2026-09-14T00:00:00Z',
  } } });
  const run = spawnSync(process.execPath, [path.join(repo, 'scripts/problems-to-site.mjs'), '--root', root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const mdx = fs.readFileSync(path.join(root, 'solutions/physics/figure-paper/figure-paper-p1.mdx'), 'utf8');
  const positions = ['Opening $E=mc^2$.', 'https://example.invalid/p1-fig1.png', ...(!embedded ? ['Фиг. 1'] : []),
    'First question $E=mc^2$.', 'https://example.invalid/p1-fig2.png', 'Shared paragraph between the two questions.',
    'Second question $E=mc^2$.', 'Common text after all parts.', '## Решение', 'Задача 1.', 'https://example.invalid/p1-sol-fig1.png'];
  let prior = -1;
  for (const marker of positions) { const at = mdx.indexOf(marker); assert.ok(at > prior, `Out of source order or absent: ${marker}`); prior = at; }
  for (const { fig } of allFigures(out)) assert.equal(mdx.split(fig.url).length - 1, 1, `Figure ${fig.id} must render exactly once`);
  assert.equal(mdx.split('<figcaption>Фиг. 1</figcaption>').length - 1, embedded ? 0 : 1, 'An embedded image caption must not become duplicate visible text');
  if (embedded) assert.equal(mdx.includes('Фиг. 1'), false, 'Embedded source text is audit-only; actual image retains its pixels');
  assert.equal(mdx.split('$E=mc^2$').length - 1, 5, 'Repeated source equations must not be deduplicated');
  assert.equal(mdx.includes('## Отговори'), false, 'No invented answers');
});
