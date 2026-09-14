import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageRecordFingerprint } from '../tx/page-assembly.mjs';
import { toPageCandidate, resolvePageCandidateSelectors } from '../tx/page-candidate.mjs';

const block = (id, text, number = null, type = 'paragraph') => ({ id, type, text,
  bbox: [20, 30, 900, 120], problemNumber: number, continuation: false });
function record(id, page, blocks, role = 'problems') {
  return { item: { id, paperId: 'test-paper', documentRole: role, pdfPage: page,
    sourcePdfPath: `/${role}.pdf`, sourcePdfSha256: (role === 'problems' ? 'a' : 'c').repeat(64),
    sourceArchiveKey: `${role}.pdf`, imagePath: `/${id}.png`, imageSha256: 'b'.repeat(64), viewTransform: 'none' },
  page: { schemaVersion: 1, blocks, uncertainties: [], normalizations: [] } };
}
function fixture() {
  const records = [record('page1', 1, [
    block('masthead', 'ТЕМА', null, 'heading'),
    block('p1-start', 'Задача 1. Начало $E=mc^2$.', '1'),
    block('p1-a', 'а) Повтор $E=mc^2$. (3 т.)', '1'),
    block('p1-common', 'Общо условие между а) и б).', '1'),
    block('p1-b', 'б) Повтор $E=mc^2$. (2 т.)', '1'),
    block('p1-after', 'След подусловията.', '1'),
    block('p2-start', 'Задача 2. Кратко условие.', '2'),
    block('shared', 'За двете задачи: $g=10$.'),
    block('footer', '1', null, 'footer'),
  ]), record('solutions1', 1, [
    block('solution-start', 'Задача 1.\n$E=mc^2$', '1'),
  ], 'solutions'), record('solutions2', 2, [
    block('solution-again', 'Задача 1.\n$E=mc^2$\n[3 т.]', '1'),
  ], 'solutions')];
  records[2].page.blocks[0].continuation = true;
  const assignments = { schemaVersion: 1, paperId: 'test-paper',
    pages: records.map(r => ({ pageId: r.item.id, recordSha256: pageRecordFingerprint(r) })),
    problems: [{ id: 'test-paper-p1', number: 1 }, { id: 'test-paper-p2', number: 2 }],
    assignments: records.flatMap(r => r.page.blocks.map(b => ({ pageId: r.item.id, blockId: b.id,
      target: b.id === 'masthead' ? { kind: 'document', role: 'header' }
        : b.id === 'footer' ? { kind: 'document', role: 'footer' }
          : b.id === 'shared' ? { kind: 'shared', problemIds: ['test-paper-p1', 'test-paper-p2'], section: 'statement' }
            : { kind: 'problem', problemId: `test-paper-p${b.problemNumber}`, section: r.item.documentRole === 'solutions' ? 'official-solution' : 'statement' } }))),
  };
  const sourceText = (pageId, blockId) => records.find(r => r.item.id === pageId).page.blocks.find(b => b.id === blockId).text;
  const span = (blockId, start = 0, end = undefined, pageId = 'page1') => {
    const text = sourceText(pageId, blockId); end ??= text.length;
    return { pageId, blockId, start, end, text: text.slice(start, end) };
  };
  const text = (...spans) => ({ spans, join: '\n\n' });
  const points = (blockId, value) => {
    const body = sourceText('page1', blockId), start = body.lastIndexOf('(');
    return { span: span(blockId, start), digits: { start: 1, end: 2, text: String(value) }, value };
  };
  const part = (blockId, value) => ({ label: span(blockId, 0, 2),
    statement: text(span(blockId, 2, sourceText('page1', blockId).lastIndexOf('('))), points: points(blockId, value) });
  const a = part('p1-a', 3); a.statementAfter = text(span('p1-common'));
  const mapping = { schemaVersion: 1,
    paper: { subject: 'physics', competition: 'NOF', year: 2005, roundType: 'theory', lang: 'bg',
      source: { archiveKey: 'problems.pdf' }, solutionSource: { archiveKey: 'solutions.pdf' } },
    title: text(span('masthead')),
    problems: [
      { id: 'test-paper-p1', heading: span('p1-start', 0, 'Задача 1.'.length),
        statement: text(span('p1-start', 'Задача 1.'.length)), parts: [a, part('p1-b', 2)],
        statementAfterParts: text(span('p1-after')),
        solution: { statement: text(span('solution-start', 0, undefined, 'solutions1'), span('solution-again', 0, undefined, 'solutions2')) } },
      { id: 'test-paper-p2', heading: span('p2-start', 0, 'Задача 2.'.length),
        statement: text(span('p2-start', 'Задача 2.'.length)), parts: [],
        solution: { missing: true, reason: 'В предоставените страници няма официално решение на задача 2.' } },
    ],
    documentNotes: [{ title: 'Общи указания', document: 'problems', page: 1, position: 'after-problem', statement: text(span('shared')) }],
    furniture: [{ span: span('footer'), reason: 'Printed page number, retained in evidence.' }], whitespace: [],
  };
  return { records, assignments, mapping, span, text };
}
const convert = f => toPageCandidate(f.records, f.assignments, f.mapping);
function rejected(change, pattern) {
  const f = fixture(); change(f);
  assert.throws(() => convert(f), pattern);
}

test('copies exact source text, repeated equations, and detached evidence into the candidate', () => {
  const f = fixture(), before = JSON.stringify(f), out = convert(f);
  assert.equal(JSON.stringify(f), before);
  assert.equal(out.problems[0].statement, ' Начало $E=mc^2$.');
  assert.deepEqual(out.problems[0].parts.map(p => p.statement), [' Повтор $E=mc^2$. ', ' Повтор $E=mc^2$. ']);
  assert.deepEqual(out.problems[0].parts.map(p => p.points), [3, 2]);
  assert.equal(out.paper.status, 'draft');
  assert.equal(out.tx.pageCandidate.publicationEligible, false);
  assert.equal(out.tx.pageCandidate.sourceFilesVerifiedByThisModule, false);
  assert.equal(out.tx.pageCandidate.assembly.blocks.length, 11);
  out.tx.pageCandidate.assembly.blocks[0].block.text = 'changed';
  out.problems[0].parts[0].statement = 'changed';
  out.tx.pageCandidate.fieldMapping.paper.year = 2006;
  assert.equal(JSON.stringify(f), before, 'No output object may alias the inputs');
});

test('middle common text and trailing text stay outside the labelled parts, in source order', () => {
  const out = convert(fixture()), p = out.problems[0];
  assert.equal(p.parts[0].statementAfter, 'Общо условие между а) и б).');
  assert.equal(p.parts[1].statementAfter, undefined);
  assert.equal(p.statementAfterParts, 'След подусловията.');
  assert.equal(p.statement.includes('Общо условие'), false);
  rejected(f => f.mapping.problems[0].parts.reverse(), /source order/);
  rejected(f => {
    f.mapping.problems[0].statementAfterParts = f.mapping.problems[0].parts[0].statementAfter;
    delete f.mapping.problems[0].parts[0].statementAfter;
  }, /source order/);
});

test('multi-page official solutions preserve repeated numbering and equations without guessing ownership', () => {
  const f = fixture(), out = toPageCandidate([...f.records].reverse(), f.assignments, f.mapping);
  assert.equal(out.problems[0].solution.statement, 'Задача 1.\n$E=mc^2$\n\nЗадача 1.\n$E=mc^2$\n[3 т.]');
  assert.equal(out.problems[0].solution.incomplete, false);
  assert.deepEqual(out.paper.source.pages, [1]);
  assert.deepEqual(out.paper.solutionSource.pages, [1, 2]);
  assert.deepEqual(out.problems[0].sourceSpans, [{ document: 'problems', page: 1 }, { document: 'solutions', page: 1 }, { document: 'solutions', page: 2 }]);
  rejected(f => f.mapping.problems[0].solution.statement.spans.reverse(), /source order/);
  rejected(f => f.mapping.problems[1].solution = f.mapping.problems[0].solution, /invalid supplied-solution|ownership/);
});

test('text role is independent of physical document role and source filenames', () => {
  const f = fixture();
  for (let i = 1; i < f.records.length; i++) {
    Object.assign(f.records[i].item, { documentRole: 'problems', pdfPage: i + 1, sourcePdfPath: '/problems.pdf',
      sourcePdfSha256: 'a'.repeat(64), sourceArchiveKey: 'problems.pdf' });
    f.assignments.pages[i].recordSha256 = pageRecordFingerprint(f.records[i]);
  }
  delete f.mapping.paper.solutionSource;
  const out = convert(f);
  assert.equal(out.problems[0].solution.statement.includes('Задача 1.'), true);
  assert.deepEqual(out.paper.source.pages, [1, 2, 3]);
  assert.equal(out.paper.solutionSource, undefined);
});

test('point removal requires exact marker text, exact anchored digits, and matching numeric value', () => {
  rejected(f => f.mapping.problems[0].parts[0].points.span.text = '(7 т.)', /inexact\/unknown source span/);
  rejected(f => f.mapping.problems[0].parts[0].points.value = 7, /points digits\/value/);
  rejected(f => f.mapping.problems[0].parts[0].points.digits.end = 3, /points digits\/value/);
  rejected(f => f.mapping.problems[0].parts[0].points.span.start -= 1, /inexact\/unknown source span/);
  rejected(f => f.mapping.problems[0].parts[1].points = structuredClone(f.mapping.problems[0].parts[0].points), /consumed more than once/);
  rejected(f => delete f.mapping.problems[0].parts[0].points, /unmapped source characters/);
  rejected(f => f.mapping.problems[0].parts[0].label.text = 'А)', /inexact\/unknown source span/);
  rejected(f => f.mapping.problems[0].heading.text = 'Задача 2.', /inexact\/unknown source span/);
  rejected(f => {
    const parts = f.mapping.problems[0].parts;
    [parts[0].points, parts[1].points] = [parts[1].points, parts[0].points];
  }, /points marker outside its part/);
});

test('every character is accounted for; omissions, duplicate use, and rewritten literals fail closed', () => {
  rejected(f => delete f.mapping.problems[0].parts[0].statementAfter, /unmapped source characters/);
  rejected(f => f.mapping.problems[0].statement.spans.push(structuredClone(f.mapping.problems[0].statement.spans[0])), /source order|consumed more than once/);
  rejected(f => f.mapping.problems[0].statement = 'Invented statement', /text mapping/);
  rejected(f => f.mapping.problems[0].statement.join = ' and ', /spans\/join/);
  rejected(f => f.mapping.furniture = [], /unmapped source characters/);
  rejected(f => f.mapping.whitespace.push(f.span('p1-common')), /non-whitespace/);
});

test('explicit whitespace spans are audited; the converter never trims the retained content', () => {
  const f = fixture(), s = f.mapping.problems[0].statement.spans[0];
  f.mapping.whitespace.push(f.span('p1-start', s.start, s.start + 1));
  s.start += 1; s.text = s.text.slice(1);
  const out = convert(f);
  assert.equal(out.problems[0].statement, 'Начало $E=mc^2$.');
  assert.equal(out.tx.pageCandidate.fieldMapping.whitespace[0].text, ' ');
});

test('shared instructions become one source-bound document note, not duplicated per owner', () => {
  const out = convert(fixture());
  assert.equal(out.paper.documentNotes.length, 1);
  assert.equal(out.paper.documentNotes[0].statement, 'За двете задачи: $g=10$.');
  assert.ok(out.problems.every(p => !p.statement.includes('За двете задачи')));
  rejected(f => f.mapping.documentNotes[0].page = 2, /ownership\/page/);
  rejected(f => f.mapping.problems[0].statement.spans.push(f.span('shared')), /ownership\/section/);
  rejected(f => f.mapping.furniture.push({ span: f.span('shared'), reason: 'Drop the common instruction' }), /whole document-owned header\/footer/);
});

test('no answer literals or invented official solutions; missing means no owned source solution', () => {
  const out = convert(fixture());
  assert.equal(out.problems[1].solution.incomplete, true);
  assert.equal(out.problems[1].solution.statement, '');
  assert.ok(out.problems.every(p => !own(p, 'answer') && p.parts.every(pt => !own(pt, 'answer'))));
  rejected(f => f.mapping.problems[0].answer = { kind: 'numeric', value: 42 }, /invalid problem/);
  rejected(f => f.mapping.problems[0].parts[0].answer = '42', /invalid part/);
  rejected(f => f.mapping.problems[1].solution = { statement: { spans: [], join: '' } }, /invalid supplied-solution/);
  rejected(f => f.mapping.problems[0].solution = { missing: true, reason: 'No solution' }, /missing-solution claim/);
  rejected(f => f.mapping.problems[0].statement = f.mapping.problems[0].solution.statement, /ownership\/section/);
});
const own = (x, k) => Object.hasOwn(x, k);

test('unsupported figures fail with original image-local source anchors, including cropped pages', () => {
  const f = fixture();
  f.records[0].page.blocks.push(block('diagram', '', '1', 'figure'));
  Object.assign(f.records[0].item, { parentUprightPixelSize: [1000, 1000], cropPixelBox: [500, 0, 1000, 1000],
    parentUprightImageSha256: 'd'.repeat(64), cropToParentPermille: [500, 0, 1000, 1000] });
  f.assignments.assignments.push({ pageId: 'page1', blockId: 'diagram', target: { kind: 'problem', problemId: 'test-paper-p1', section: 'statement' } });
  f.assignments.pages[0].recordSha256 = pageRecordFingerprint(f.records[0]);
  assert.throws(() => convert(f), error => {
    assert.equal(error.code, 'UNSUPPORTED_PAGE_CANDIDATE_SHAPE');
    assert.equal(error.sourceAnchor.coordinateSpace, 'input-image-permille');
    assert.deepEqual(error.sourceAnchor.bbox, [20, 30, 900, 120]);
    assert.equal(error.sourceAnchor.pdfRect, undefined);
    assert.deepEqual(error.sourcePage.cropPixelBox, [500, 0, 1000, 1000]);
    return true;
  });
});

test('numbering and provenance cannot be rewritten or quietly reconciled', () => {
  rejected(f => f.mapping.problems.reverse(), /IDs\/order differ/);
  rejected(f => f.mapping.problems[0].number = 3, /invalid problem/);
  rejected(f => f.mapping.paper.source.archiveKey = 'another.pdf', /archive key conflict/);
  rejected(f => f.mapping.paper.source.pages = [99], /source metadata/);
  rejected(f => f.mapping.paper.status = 'published', /paper metadata/);
  rejected(f => f.records[0].page.blocks[1].text += ' changed', /stale page fingerprint/);
  rejected(f => {
    f.assignments.problems[1].number = 'II';
    for (const a of f.assignments.assignments) if (a.target.problemId === 'test-paper-p2') a.numberOverrideReason = 'Explicit reviewed numbering.';
  }, /explicit contiguous integer numbering/);
});

test('schema-invalid metadata and non-JSON/getter inputs are rejected without side effects', () => {
  rejected(f => f.mapping.paper.year = '2005', /candidate schema/);
  rejected(f => f.mapping.paper.subject = 'invented', /candidate schema/);
  rejected(f => f.mapping.paper.extra = 'secret content', /paper metadata/);
  const f = fixture(); let called = false;
  Object.defineProperty(f.mapping, 'title', { enumerable: true, get() { called = true; return {}; } });
  assert.throws(() => convert(f), /accessor/);
  assert.equal(called, false);
  rejected(f => f.mapping[Symbol('lost')] = 'hidden', /hidden/);
  rejected(f => f.mapping.whitespace.push(f.mapping), /cyclic/);
});

test('uncertainties, normalization proposals and character coverage survive without being applied', () => {
  const f = fixture();
  f.records[0].page.uncertainties = [{ blockId: 'p1-start', note: 'Keep the printed expression.' }];
  f.records[0].page.normalizations = [{ blockId: 'p1-start', source: 'E', replacement: 'F', reason: 'Unapproved suggestion.' }];
  f.assignments.pages[0].recordSha256 = pageRecordFingerprint(f.records[0]);
  const out = convert(f), audit = out.tx.pageCandidate;
  assert.equal(out.problems[0].statement, ' Начало $E=mc^2$.');
  assert.equal(audit.assembly.blocks[1].uncertainties[0].note, 'Keep the printed expression.');
  assert.equal(audit.assembly.blocks[1].normalizations[0].replacement, 'F');
  for (const row of audit.coverage) {
    const text = audit.assembly.blocks.find(b => b.key === row.blockKey).block.text;
    assert.equal(row.ranges.map(r => text.slice(r.start, r.end)).join(''), text);
  }
});

test('cheap mapping selectors need no offsets or retyped whole blocks and retain the same candidate text', () => {
  const f = fixture(), expected = convert(f);
  f.mapping.title.spans = [{ pageId: 'page1', blockId: 'masthead' }];
  f.mapping.problems[0].heading = { pageId: 'page1', blockId: 'p1-start', exactText: 'Задача 1.' };
  f.mapping.problems[0].parts[0].label = { pageId: 'page1', blockId: 'p1-a', exactText: 'а)' };
  f.mapping.problems[0].parts[0].points = { span: { pageId: 'page1', blockId: 'p1-a', exactText: '(3 т.)' },
    digits: { exactText: '3' }, value: 3 };
  f.mapping.problems[0].parts[0].statementAfter.spans = [{ pageId: 'page1', blockId: 'p1-common' }];
  f.mapping.problems[0].solution.statement.spans = [{ pageId: 'solutions1', blockId: 'solution-start' }, { pageId: 'solutions2', blockId: 'solution-again' }];
  const before = JSON.stringify(f.mapping), expanded = resolvePageCandidateSelectors(f.records, f.assignments, f.mapping);
  assert.deepEqual(expanded.problems[0].parts[0].label, f.span('p1-a', 0, 2));
  assert.equal(JSON.stringify(f.mapping), before, 'Selector resolution must not mutate the model mapping');
  const out = convert(f);
  assert.deepEqual(out.paper, expected.paper);
  assert.deepEqual(out.problems, expected.problems);
  assert.equal(out.tx.pageCandidate.fieldMapping.problems[0].parts[0].points.digits.text, '3');
});

test('repeated and overlapping exactText selectors reject ambiguity unless occurrence is explicit', () => {
  const f = fixture();
  f.records[1].page.blocks[0].text = 'Задача 1.\n$E=mc^2$\n$E=mc^2$\naaa';
  f.assignments.pages[1].recordSha256 = pageRecordFingerprint(f.records[1]);
  const selector = { pageId: 'solutions1', blockId: 'solution-start', exactText: '$E=mc^2$' };
  f.mapping.problems[0].solution.statement.spans[0] = selector;
  const resolve = () => resolvePageCandidateSelectors(f.records, f.assignments, f.mapping);
  assert.throws(resolve, /ambiguous exactText \(2 occurrences\)/);
  selector.occurrence = 2;
  let span = resolve().problems[0].solution.statement.spans[0];
  assert.equal(span.start, f.records[1].page.blocks[0].text.lastIndexOf('$E=mc^2$'));
  assert.equal(span.text, '$E=mc^2$');
  selector.occurrence = 3;
  assert.throws(resolve, /occurrence outside/);
  selector.exactText = 'aa'; delete selector.occurrence;
  assert.throws(resolve, /ambiguous exactText \(2 occurrences\)/);
  selector.occurrence = 2;
  span = resolve().problems[0].solution.statement.spans[0];
  assert.equal(span.start, f.records[1].page.blocks[0].text.length - 2);
  // Resolution does not bypass the converter's exhaustive source accounting.
  assert.throws(() => convert(f), /unmapped source characters/);
});

test('invalid selectors and missing text cannot degrade into fuzzy matching or a whole-block fallback', () => {
  rejected(f => f.mapping.title.spans = [{ pageId: 'page1', blockId: 'masthead', exactText: 'Тема' }], /exactText absent/);
  rejected(f => f.mapping.title.spans = [{ pageId: 'page1', blockId: 'masthead', exactText: '' }], /empty exactText/);
  rejected(f => f.mapping.title.spans = [{ pageId: 'page1', blockId: 'masthead', occurrence: 1 }], /occurrence requires exactText/);
  rejected(f => f.mapping.title.spans = [{ pageId: 'page1', blockId: 'masthead', exactText: 'ТЕМА', occurrence: 0 }], /1-based occurrence/);
  rejected(f => f.mapping.title.spans = [{ pageId: 'page1', blockId: 'missing' }], /unknown block selector/);
  rejected(f => f.mapping.title.spans = [{ pageId: 'page1', blockId: 'masthead', replacement: 'Edited title' }], /invalid.*selector/);
});
