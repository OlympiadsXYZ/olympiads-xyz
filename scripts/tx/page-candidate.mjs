// Deterministic, no-figure v1 conversion. Reads the committed schema; no writes,
// model calls, source-file verification, receipts, or publication authority.
import { createRequire } from 'node:module';
import { assemblePageBlocks } from './page-assembly.mjs';

const require = createRequire(import.meta.url);
const schema = structuredClone(require('../../content/problems/schema.json'));
delete schema.$schema;
const validateSchema = new (require('ajv'))({ allErrors: true, jsonPointers: true }).compile(schema);
const own = (x, k) => Object.hasOwn(x, k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const key = (pageId, blockId) => JSON.stringify([pageId, blockId]);
const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
function reject(message, extra = {}) {
  throw Object.assign(new Error(`Page candidate rejected: ${message}`), { code: 'INVALID_PAGE_CANDIDATE_MAPPING', ...extra });
}
function shape(value, keys, where) {
  if (!object(value) || Object.keys(value).some(k => !keys.includes(k))) reject(`invalid ${where}`);
}

// Reject accessors/hidden fields before inspecting them, and return detached
// canonical JSON. In particular, structuredClone alone would execute getters.
function jsonCopy(value, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!object(value) && !Array.isArray(value)) reject('inputs must be finite JSON data');
  if (ancestors.has(value)) reject('cyclic input');
  const array = Array.isArray(value), keys = Reflect.ownKeys(value);
  if ((!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    || keys.some(k => typeof k !== 'string')
    || (array ? keys.length !== value.length + 1 : keys.length !== Object.keys(value).length)) reject('hidden, extended or non-JSON input');
  ancestors.add(value);
  const names = array ? Array.from({ length: value.length }, (_, i) => String(i)) : Object.keys(value).sort();
  const entries = names.map(k => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d || !own(d, 'value') || !d.enumerable) reject('accessor, sparse or hidden input');
    return [k, jsonCopy(d.value, ancestors)];
  });
  ancestors.delete(value);
  return array ? entries.map(e => e[1]) : Object.fromEntries(entries);
}

function selectText(text, selector, where) {
  if (!own(selector, 'exactText')) {
    if (own(selector, 'occurrence')) reject(`occurrence requires exactText at ${where}`);
    return { start: 0, end: text.length, text };
  }
  if (typeof selector.exactText !== 'string' || !selector.exactText.length) reject(`empty exactText selector at ${where}`);
  if (own(selector, 'occurrence') && (!Number.isSafeInteger(selector.occurrence) || selector.occurrence < 1)) reject(`invalid 1-based occurrence at ${where}`);
  const hits = [];
  for (let at = text.indexOf(selector.exactText); at !== -1; at = text.indexOf(selector.exactText, at + 1)) hits.push(at);
  if (!hits.length) reject(`exactText absent at ${where}`);
  if (!own(selector, 'occurrence') && hits.length !== 1) reject(`ambiguous exactText (${hits.length} occurrences) at ${where}`);
  const start = hits[(selector.occurrence ?? 1) - 1];
  if (start === undefined) reject(`occurrence outside source matches at ${where}`);
  return { start, end: start + selector.exactText.length, text: selector.exactText };
}

// Resolve only the contract's span slots, never arbitrary metadata strings.
function expandSelectors(assembly, mapping) {
  const m = mapping, blocks = new Map(assembly.blocks.map(e => [e.key, e.block.text]));
  const span = (s, where) => {
    if (!object(s) || ['start', 'end', 'text'].some(k => own(s, k))) return s;
    shape(s, ['pageId', 'blockId', 'exactText', 'occurrence'], `${where} selector`);
    const text = blocks.get(key(s.pageId, s.blockId));
    if (text === undefined) reject(`unknown block selector at ${where}`);
    return { pageId: s.pageId, blockId: s.blockId, ...selectText(text, s, where) };
  };
  const text = (spec, where) => {
    if (object(spec) && Array.isArray(spec.spans)) spec.spans = spec.spans.map((s, i) => span(s, `${where}/${i}`));
  };
  const points = (spec, where) => {
    if (!object(spec)) return;
    spec.span = span(spec.span, where);
    const d = spec.digits;
    if (object(d) && !['start', 'end', 'text'].some(k => own(d, k))) {
      shape(d, ['exactText', 'occurrence'], `${where} digits selector`);
      if (!object(spec.span) || typeof spec.span.text !== 'string') reject(`invalid points span at ${where}`);
      spec.digits = selectText(spec.span.text, d, `${where}/digits`);
    }
  };
  if (!object(m)) return m;
  text(m.title, 'title');
  if (Array.isArray(m.problems)) for (const [i, p] of m.problems.entries()) if (object(p)) {
    if (own(p, 'heading')) p.heading = span(p.heading, `problem ${i} heading`);
    text(p.statement, `problem ${i} statement`); text(p.statementAfterParts, `problem ${i} after parts`);
    points(p.points, `problem ${i} points`);
    if (object(p.solution)) text(p.solution.statement, `problem ${i} solution`);
    if (Array.isArray(p.parts)) for (const [j, pt] of p.parts.entries()) if (object(pt)) {
      pt.label = span(pt.label, `problem ${i} part ${j} label`);
      text(pt.statement, `problem ${i} part ${j} statement`); text(pt.statementAfter, `problem ${i} part ${j} after`);
      points(pt.points, `problem ${i} part ${j} points`);
    }
  }
  if (Array.isArray(m.documentNotes)) for (const note of m.documentNotes) if (object(note)) text(note.statement, 'document note');
  if (Array.isArray(m.furniture)) for (const f of m.furniture) if (object(f)) f.span = span(f.span, 'furniture');
  if (Array.isArray(m.whitespace)) m.whitespace = m.whitespace.map(s => span(s, 'whitespace'));
  return m;
}

// Optional preflight for inspecting resolved model selectors. This only expands
// selectors against frozen source records; toPageCandidate also performs full
// coverage, ownership, ordering and candidate checks (and resolves automatically).
export function resolvePageCandidateSelectors(recordsInput, assignmentsInput, mappingInput) {
  const { records, assignments, mapping } = jsonCopy({ records: recordsInput, assignments: assignmentsInput, mapping: mappingInput });
  return expandSelectors(assemblePageBlocks(records, assignments), mapping);
}

/**
 * toPageCandidate(records, assignments, mapping) -> existing {paper, problems, tx}
 *
 * records + assignments are the frozen page-assembly.mjs inputs. mapping is:
 * {
 *   schemaVersion: 1,
 *   paper: {subject, competition, year, roundType, lang, source:{archiveKey},
 *           solutionSource?:{archiveKey}, round?, grade?, held?, organiser?, timeLimitMin?},
 *   title?: Text,
 *   problems: [{id, problemType?, heading?: Span, points?: Points,
 *     statement: Text, parts:[{label:Span, statement:Text, points?:Points,
 *                              statementAfter?:Text}], statementAfterParts?:Text,
 *     solution: {statement:Text} | {missing:true, reason:string}}],
 *   documentNotes: [{title:string, document, page, position, statement:Text}],
 *   furniture: [{span:Span, reason:string}], whitespace: [Span]
 * }
 * Span = {pageId, blockId, start, end, text}; offsets are UTF-16 [start,end),
 *        and text MUST equal that exact frozen substring. No implicit trim.
 *        Models may instead use {pageId,blockId} for a whole block, or
 *        {pageId,blockId,exactText,occurrence?}. No counting offsets is needed.
 *        occurrence is 1-based; ambiguous text requires it explicitly, including
 *        overlapping matches. The resolver records the expanded exact spans.
 * Text = {spans:[Span,...], join:''|' '|'\n'|'\n\n'}; no literal prose.
 * Points = {span:Span, digits:{start,end,text}, value:number}; digits offsets
 *          are relative to span.text and must parse exactly to value.
 *          digits may also be {exactText:'3',occurrence?} within the marker.
 *
 * Every source character must be consumed exactly once. Headings, labels and
 * point markers use explicit anchored spans, never regex stripping. Heading
 * removal is only for a statement's leading structural label. Furniture must
 * be an entire explicitly document-owned header/footer. Whitespace removal
 * must itself cite exact whitespace spans. All consumed bytes remain in tx.
 *
 * Problem IDs/order/contiguous integer numbers come unchanged from assignments.
 * Content order is checked across statement, labels, parts and common text.
 * Official solutions use a separate ordered stream, including repeated labels
 * and equations; a missing solution is allowed only with no owned solution
 * blocks. Shared ownership goes to one document note, never duplicated prose.
 * Text notes cannot span source pages. Source pages/hashes/anchors are derived.
 * All figure blocks (including decorative ones), other metadata/content fields,
 * answers, unrepresented bytes and unsupported numbering fail closed in v1.
 * A fresh source check and normal candidate validation are still required.
 */
export function toPageCandidate(recordsInput, assignmentsInput, mappingInput) {
  const { records, assignments, mapping } = jsonCopy({ records: recordsInput, assignments: assignmentsInput, mapping: mappingInput });
  const assembly = assemblePageBlocks(records, assignments);
  const m = expandSelectors(assembly, mapping);
  shape(m, ['schemaVersion', 'paper', 'title', 'problems', 'documentNotes', 'furniture', 'whitespace'], 'mapping');
  if (m.schemaVersion !== 1 || !Array.isArray(m.problems) || !Array.isArray(m.documentNotes)
    || !Array.isArray(m.furniture) || !Array.isArray(m.whitespace)) reject('mapping requires version 1 and explicit arrays');
  const entries = new Map(assembly.blocks.map((entry, index) => [entry.key, { ...entry, index }]));
  for (const e of entries.values()) if (e.block.type === 'figure') reject(`figure block ${e.key} is unsupported in v1`,
    { code: 'UNSUPPORTED_PAGE_CANDIDATE_SHAPE', sourceAnchor: structuredClone(e.sourceAnchor),
      sourcePage: structuredClone(assembly.pages.find(p => p.item.id === e.sourceAnchor.pageId).item) });
  if (assembly.owners.some((p, i) => p.number !== i + 1)) reject('v1 requires explicit contiguous integer numbering; numbers are never inferred or changed');
  if (m.problems.length !== assembly.owners.length || m.problems.some((p, i) => p?.id !== assembly.owners[i].id)) reject('problem IDs/order differ from the assignment plan');

  const coverage = new Map([...entries.keys()].map(k => [k, []]));
  const tape = new Map();
  function anchor(span, where) {
    shape(span, ['pageId', 'blockId', 'start', 'end', 'text'], `${where} span`);
    const e = entries.get(key(span.pageId, span.blockId));
    if (!e || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
      || span.start < 0 || span.start >= span.end || span.end > e.block.text.length
      || typeof span.text !== 'string' || e.block.text.slice(span.start, span.end) !== span.text) reject(`inexact/unknown source span at ${where}`);
    for (const cut of [span.start, span.end]) if (cut > 0 && cut < e.block.text.length
      && /[\uD800-\uDBFF]/.test(e.block.text[cut - 1]) && /[\uDC00-\uDFFF]/.test(e.block.text[cut])) reject(`split Unicode character at ${where}`);
    return e;
  }
  function consume(span, where, context, stream = null) {
    const e = anchor(span, where), t = e.assignment.target;
    if (context.kind === 'problem') {
      if (t.kind !== 'problem' || t.problemId !== context.id || t.section !== context.section) reject(`ownership/section conflict at ${where}`);
    } else if (context.kind === 'note') {
      if (!['document', 'shared'].includes(t.kind) || e.sourceAnchor.document !== context.document || e.sourceAnchor.page !== context.page) reject(`document-note ownership/page conflict at ${where}`);
    } else if (context.kind === 'title') {
      if (t.kind !== 'document' || t.role !== 'header') reject(`title must use document-owned header text at ${where}`);
    } else if (context.kind === 'furniture') {
      if (t.kind !== 'document' || !['header', 'footer'].includes(t.role) || span.start !== 0 || span.end !== e.block.text.length) reject(`furniture must be a whole document-owned header/footer at ${where}`);
    }
    const used = coverage.get(e.key);
    if (used.some(r => span.start < r.end && span.end > r.start)) reject(`source span consumed more than once at ${where}`);
    used.push({ start: span.start, end: span.end, field: where });
    if (stream) {
      const rank = [e.index, span.start], prior = tape.get(stream);
      if (prior && !before(prior, rank)) reject(`source order changed in ${stream} at ${where}`);
      tape.set(stream, rank);
    }
    return span.text;
  }
  function readText(spec, where, context, stream = null) {
    shape(spec, ['spans', 'join'], `${where} text mapping`);
    if (!Array.isArray(spec.spans) || !['', ' ', '\n', '\n\n'].includes(spec.join)) reject(`invalid spans/join at ${where}`);
    let previous;
    return spec.spans.map((span, i) => {
      const e = anchor(span, where), rank = [e.index, span.start];
      if (previous && !before(previous, rank)) reject(`source order changed at ${where}`);
      previous = rank;
      return consume(span, `${where}/spans/${i}`, context, stream);
    }).join(spec.join);
  }
  function readPoints(spec, where, context) {
    if (spec === undefined) return null;
    shape(spec, ['span', 'digits', 'value'], `${where} points mapping`);
    shape(spec.digits, ['start', 'end', 'text'], `${where} digits`);
    const d = spec.digits;
    anchor(spec.span, where);
    if (!Number.isSafeInteger(d.start) || !Number.isSafeInteger(d.end) || d.start < 0 || d.end <= d.start
      || d.end > spec.span.text.length || typeof d.text !== 'string' || spec.span.text.slice(d.start, d.end) !== d.text
      || !/^\d+(?:[.,]\d+)?$/.test(d.text) || typeof spec.value !== 'number' || spec.value < 0 || spec.value > 200
      || Number(d.text.replace(',', '.')) !== spec.value) reject(`inexact points digits/value at ${where}`);
    consume(spec.span, where, context);
    return spec.value;
  }

  shape(m.paper, ['subject', 'competition', 'year', 'round', 'roundType', 'grade', 'lang', 'held', 'organiser', 'timeLimitMin', 'source', 'solutionSource'], 'paper metadata');
  const paper = { ...m.paper, id: assembly.paperId, status: 'draft' };
  for (const [role, field] of [['problems', 'source'], ['solutions', 'solutionSource']]) {
    const sourcePages = assembly.pages.filter(p => p.item.documentRole === role);
    if (!sourcePages.length) {
      if (field === 'source' || own(m.paper, field)) reject(`missing supplied ${role} source pages`);
      continue;
    }
    shape(m.paper[field], ['archiveKey'], `${field} metadata`);
    if (!nonempty(m.paper[field].archiveKey) || sourcePages.some(p => p.item.sourceArchiveKey !== undefined
      && p.item.sourceArchiveKey !== m.paper[field].archiveKey)) reject(`source archive key conflict for ${role}`);
    paper[field] = { archiveKey: m.paper[field].archiveKey, pages: [...new Set(sourcePages.map(p => p.item.pdfPage))].sort((a, b) => a - b) };
  }
  if (own(m, 'title')) {
    paper.title = readText(m.title, '/paper/title', { kind: 'title' });
    if (!nonempty(paper.title)) reject('empty mapped paper title');
  }
  const problems = m.problems.map((spec, i) => {
    shape(spec, ['id', 'problemType', 'heading', 'points', 'statement', 'parts', 'statementAfterParts', 'solution'], `problem ${i}`);
    const owner = assembly.owners[i], root = `/problems/${i}`;
    const context = { kind: 'problem', id: owner.id, section: 'statement' };
    if (!owner.id.startsWith(`${assembly.paperId}-`) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(owner.id)) reject(`invalid production problem id ${owner.id}`);
    if (!Array.isArray(spec.parts)) reject(`explicit parts array required at ${root}`);
    // Statement tapes are shared across owners: interleaved statement layouts
    // cannot be silently regrouped into canonical problem order in v1.
    const stream = 'canonical statement order';
    if (own(spec, 'heading')) consume(spec.heading, `${root}/heading`, context, stream);
    const pr = { id: owner.id, number: owner.number, points: readPoints(spec.points, `${root}/points`, context),
      statement: readText(spec.statement, `${root}/statement`, context, stream), figures: [], parts: [] };
    if (own(spec, 'problemType')) pr.problemType = spec.problemType;
    const labels = new Set();
    for (const [j, pt] of spec.parts.entries()) {
      const field = `${root}/parts/${j}`;
      shape(pt, ['label', 'statement', 'points', 'statementAfter'], `part ${field}`);
      const label = consume(pt.label, `${field}/label`, context, stream);
      if (!nonempty(label) || label.trim() !== label || labels.has(label)) reject(`empty, padded or duplicate part label at ${field}`);
      labels.add(label);
      const part = { label, statement: readText(pt.statement, `${field}/statement`, context, stream), points: readPoints(pt.points, `${field}/points`, context) };
      if (!nonempty(part.statement)) reject(`empty mapped part at ${field}`);
      if (own(pt, 'statementAfter')) part.statementAfter = readText(pt.statementAfter, `${field}/statementAfter`, context, stream);
      pr.parts.push(part);
    }
    if (own(spec, 'statementAfterParts')) pr.statementAfterParts = readText(spec.statementAfterParts, `${root}/statementAfterParts`, context, stream);
    // A numerically valid marker from the neighbouring part must not silently
    // change this part's allocation. Prefix and suffix markers both fit between
    // this part's label and the next part's label (or trailing common text).
    for (const [j, pt] of spec.parts.entries()) if (own(pt, 'points')) {
      const label = pt.label, marker = pt.points.span;
      const rank = s => [anchor(s, `${root}/parts/${j}/points`).index, s.start];
      const next = pt.statementAfter?.spans[0] || spec.parts[j + 1]?.label || spec.statementAfterParts?.spans[0];
      if (!before(rank(label), rank(marker)) || (next && !before(rank(marker), rank(next)))) reject(`points marker outside its part at ${root}/parts/${j}`);
    }
    if (!nonempty(pr.statement) && !pr.parts.length) reject(`missing statement at ${root}; never synthesize one`);
    shape(spec.solution, ['missing', 'reason', 'statement'], `${root} solution mapping`);
    if (spec.solution.missing === true) {
      if (own(spec.solution, 'statement') || !nonempty(spec.solution.reason) || owner.officialSolution.length) reject(`missing-solution claim conflicts with supplied blocks at ${root}`);
      pr.solution = { statement: '', figures: [], incomplete: true, incompleteReason: spec.solution.reason };
    } else {
      if (own(spec.solution, 'missing') || own(spec.solution, 'reason') || !owner.officialSolution.length) reject(`invalid supplied-solution mapping at ${root}`);
      const statement = readText(spec.solution.statement, `${root}/solution/statement`,
        { kind: 'problem', id: owner.id, section: 'official-solution' }, `${owner.id} solution order`);
      if (!nonempty(statement)) reject(`empty supplied solution at ${root}`);
      pr.solution = { statement, figures: [], incomplete: false };
    }
    const spans = assembly.blocks.filter(e => e.owner === owner.id).map(e => ({ document: e.sourceAnchor.document, page: e.sourceAnchor.page }));
    pr.sourceSpans = [...new Map(spans.map(s => [JSON.stringify(s), s])).values()];
    return pr;
  });
  paper.documentNotes = m.documentNotes.map((note, i) => {
    shape(note, ['title', 'document', 'page', 'position', 'statement'], `document note ${i}`);
    if (!nonempty(note.title) || !['problems', 'solutions'].includes(note.document) || !Number.isSafeInteger(note.page)
      || note.page < 1 || !['before-problem', 'after-problem'].includes(note.position)) reject(`invalid document note ${i}`);
    const statement = readText(note.statement, `/paper/documentNotes/${i}/statement`,
      { kind: 'note', document: note.document, page: note.page }, 'document note order');
    if (!nonempty(statement)) reject(`empty document note ${i}`);
    return { title: note.title, statement, document: note.document, page: note.page, position: note.position };
  });
  m.furniture.forEach((f, i) => {
    shape(f, ['span', 'reason'], `furniture ${i}`);
    if (!nonempty(f.reason)) reject(`furniture reason required at ${i}`);
    consume(f.span, `/furniture/${i}`, { kind: 'furniture' });
  });
  m.whitespace.forEach((span, i) => {
    anchor(span, `/whitespace/${i}`);
    if (!/^\s+$/.test(span.text)) reject(`non-whitespace cannot be discarded at ${i}`);
    consume(span, `/whitespace/${i}`, { kind: 'whitespace' });
  });
  for (const [k, ranges] of coverage) {
    ranges.sort((a, b) => a.start - b.start);
    let end = 0;
    for (const r of ranges) {
      if (r.start !== end) reject(`unmapped source characters in ${k} at ${end}`);
      end = r.end;
    }
    if (end !== entries.get(k).block.text.length) reject(`unmapped source characters in ${k} at ${end}`);
  }
  const candidate = { paper, problems };
  if (!validateSchema(candidate)) reject(`candidate schema: ${validateSchema.errors.map(e => `${e.dataPath} ${e.message}`).join('; ')}`);
  candidate.tx = { pageCandidate: { schemaVersion: 1, publicationEligible: false, sourceFilesVerifiedByThisModule: false,
    fieldMapping: m, assignments, assembly, coverage: [...coverage].map(([blockKey, ranges]) => ({ blockKey, ranges })) } };
  return candidate;
}
