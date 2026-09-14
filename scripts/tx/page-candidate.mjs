// Deterministic v1 text / v2 boundary-figure conversion. No writes,
// model calls, source-file verification, receipts, or publication authority.
import { createRequire } from 'node:module';
import { assemblePageBlocks } from './page-assembly.mjs';
import { originalPageFigureGeometry } from './page-figure.mjs';

const require = createRequire(import.meta.url);
const schema = structuredClone(require('../../content/problems/schema.json'));
delete schema.$schema;
const validateSchema = new (require('ajv'))({ allErrors: true, jsonPointers: true }).compile(schema);
// Same temporary figure allowances as lib.mjs compileSchema('candidate'). No
// fabricated URLs: figures.mjs must crop, upload and verify them separately.
const figureCandidateSchema = structuredClone(schema);
figureCandidateSchema.$defs.figure.required = ['id'];
figureCandidateSchema.$defs.figure.properties.tx = { type: 'object' };
const validateFigureCandidate = new (require('ajv'))({ allErrors: true, jsonPointers: true }).compile(figureCandidateSchema);
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
  const figures = (spec, where) => {
    if (Array.isArray(spec)) for (const [i, f] of spec.entries()) if (object(f)) {
      text(f.caption, `${where}/${i}/caption`);
      text(f.embeddedCaption, `${where}/${i}/embeddedCaption`);
    }
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
    figures(p.figures, `problem ${i} figures`);
    points(p.points, `problem ${i} points`);
    if (object(p.solution)) {
      text(p.solution.statement, `problem ${i} solution`);
      figures(p.solution.figures, `problem ${i} solution figures`);
    }
    if (Array.isArray(p.parts)) for (const [j, pt] of p.parts.entries()) if (object(pt)) {
      pt.label = span(pt.label, `problem ${i} part ${j} label`);
      text(pt.statement, `problem ${i} part ${j} statement`); text(pt.statementAfter, `problem ${i} part ${j} after`);
      figures(pt.figures, `problem ${i} part ${j} figures`);
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
 * V1 rejects all figure blocks. V2 additionally accepts optional figures arrays
 * on each problem, part and supplied solution. Each ref is
 * {pageId, blockId, id, caption?:Text, embeddedCaption?:Text}; only a frozen
 * figure-type block is valid. caption and embeddedCaption are mutually exclusive.
 * The existing renderer places these arrays after statement, part.statement,
 * and solution.statement respectively. Source order is checked at those exact
 * boundaries; arbitrary interior figures are rejected, never moved to the end.
 * Optional captions consume exact, separate, non-overlapping caption blocks.
 * embeddedCaption consumes one complete same-owner/same-page caption block
 * whose entire box is inside the figure box. Its exact text and source anchor
 * remain in figureCoverage only; the crop already displays it, so no textual
 * caption is emitted. It does not advance the text-order stream: a caption
 * inside a drawing may be listed after adjacent column text in the page record.
 * This is explicit audited image coverage, not permission to discard text.
 * V2 only accepts reviewed upright full pages or proportional full-page resizes.
 * Optional v2 excludedFigures:[{pageId,blockId,reason,sourceReviewed:true}]
 * accounts for explicitly source-reviewed decoration. Only null-numbered,
 * document/other-owned figures with an assignment reason may be excluded;
 * their full anchors remain audited in tx, and they never become crop entries.
 * Crops/rotations, shared figure disposition, alt prose, URLs, and
 * box overrides require other explicit reviewed workflows. Use figures.mjs
 * --no-snap for these boxes, and --dry-run for crop review before any upload.
 * Every figure is accounted exactly once, even though its text is empty.
 * A fresh source check and normal candidate validation are still required.
 */
export function toPageCandidate(recordsInput, assignmentsInput, mappingInput) {
  const { records, assignments, mapping } = jsonCopy({ records: recordsInput, assignments: assignmentsInput, mapping: mappingInput });
  const assembly = assemblePageBlocks(records, assignments);
  const m = expandSelectors(assembly, mapping);
  shape(m, ['schemaVersion', 'paper', 'title', 'problems', 'documentNotes', 'furniture', 'whitespace',
    ...(m?.schemaVersion === 2 ? ['excludedFigures'] : [])], 'mapping');
  if (![1, 2].includes(m.schemaVersion) || !Array.isArray(m.problems) || !Array.isArray(m.documentNotes)
    || !Array.isArray(m.furniture) || !Array.isArray(m.whitespace)) reject('mapping requires version 1 or 2 and explicit arrays');
  const withFigures = m.schemaVersion === 2;
  const entries = new Map(assembly.blocks.map((entry, index) => [entry.key, { ...entry, index }]));
  for (const e of entries.values()) if (e.block.type === 'figure' && !withFigures) reject(`figure block ${e.key} is unsupported in v1`,
    { code: 'UNSUPPORTED_PAGE_CANDIDATE_SHAPE', sourceAnchor: structuredClone(e.sourceAnchor),
      sourcePage: structuredClone(assembly.pages.find(p => p.item.id === e.sourceAnchor.pageId).item) });
  if (assembly.owners.some((p, i) => p.number !== i + 1)) reject('v1 requires explicit contiguous integer numbering; numbers are never inferred or changed');
  if (m.problems.length !== assembly.owners.length || m.problems.some((p, i) => p?.id !== assembly.owners[i].id)) reject('problem IDs/order differ from the assignment plan');

  const coverage = new Map([...entries.keys()].map(k => [k, []]));
  const figureCoverage = new Map(), figureIds = new Set(), figureRegions = new Set();
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
  function readFigures(spec, where, context, stream) {
    if (spec === undefined) return [];
    if (!withFigures || !Array.isArray(spec)) reject(`invalid figures array at ${where}`);
    return spec.map((f, i) => {
      const field = `${where}/${i}`;
      shape(f, ['pageId', 'blockId', 'id', 'caption', 'embeddedCaption'], `${field} figure reference`);
      if (own(f, 'caption') && own(f, 'embeddedCaption')) reject(`caption and embeddedCaption are mutually exclusive at ${field}`);
      const e = entries.get(key(f.pageId, f.blockId)), t = e?.assignment.target;
      if (!e || e.block.type !== 'figure') reject(`unknown/non-figure block at ${field}`);
      if (t.kind !== 'problem' || t.problemId !== context.id || t.section !== context.section) reject(`figure ownership/section conflict at ${field}`);
      if (figureCoverage.has(e.key)) reject(`figure consumed more than once at ${field}`);
      if (typeof f.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.id) || figureIds.has(f.id)) reject(`invalid/duplicate figure id at ${field}`);
      const rank = [e.index, 0], prior = tape.get(stream);
      if (prior && !before(prior, rank)) reject(`source order changed in ${stream} at ${field}; figure is not at a supported renderer boundary`);
      tape.set(stream, rank);
      const item = assembly.pages.find(p => p.item.id === f.pageId).item;
      const geometry = originalPageFigureGeometry(item, e.block.bbox);
      const region = JSON.stringify([geometry.document, geometry.page, geometry.bbox]);
      if (figureRegions.has(region)) reject(`duplicate original source figure box at ${field}`);
      figureRegions.add(region);
      const fig = { id: f.id, tx: { document: geometry.document, page: geometry.page, bbox: geometry.bbox,
        rotation: 0, sourceAnchor: structuredClone(e.sourceAnchor), geometry,
        placement: field, requiresNoSnap: true } };
      figureIds.add(f.id);
      figureCoverage.set(e.key, { blockKey: e.key, field, id: f.id, disposition: 'rendered-at-existing-boundary', sourceAnchor: structuredClone(e.sourceAnchor) });
      if (own(f, 'caption')) {
        shape(f.caption, ['spans', 'join'], `${field} caption`);
        if (!Array.isArray(f.caption.spans) || !f.caption.spans.length) reject(`empty caption at ${field}`);
        for (const span of f.caption.spans) {
          const c = anchor(span, `${field}/caption`), a = e.block.bbox, b = c.block.bbox;
          if (c.block.type !== 'caption' || c.sourceAnchor.pageId !== e.sourceAnchor.pageId) reject(`caption is not a separate same-page caption block at ${field}`);
          if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) reject(`caption overlaps figure crop at ${field}; would render printed caption twice`);
        }
        fig.caption = readText(f.caption, `${field}/caption`, context, stream);
        if (!nonempty(fig.caption) || fig.caption.trim() !== fig.caption || /[\r\n]/.test(fig.caption)) reject(`caption must be exact single-line unpadded text at ${field}`);
      }
      if (own(f, 'embeddedCaption')) {
        const where = `${field}/embeddedCaption`, spec = f.embeddedCaption;
        shape(spec, ['spans', 'join'], `${where} mapping`);
        if (!Array.isArray(spec.spans) || spec.spans.length !== 1) reject(`embeddedCaption requires one whole caption block at ${field}`);
        const span = spec.spans[0], c = anchor(span, where), a = e.block.bbox, b = c.block.bbox;
        if (c.block.type !== 'caption' || c.sourceAnchor.pageId !== e.sourceAnchor.pageId
          || span.start !== 0 || span.end !== c.block.text.length) reject(`embeddedCaption must be one whole same-page caption block at ${field}`);
        if (b[0] < a[0] || b[1] < a[1] || b[2] > a[2] || b[3] > a[3]) reject(`embeddedCaption box is not wholly inside figure crop at ${field}`);
        // Ownership, exact characters and duplicate use are checked by readText.
        // The text is visible in the image, not in another renderer text slot.
        const text = readText(spec, where, context);
        if (!nonempty(text)) reject(`empty embeddedCaption at ${field}`);
        figureCoverage.get(e.key).embeddedCaption = { disposition: 'visible-in-source-image',
          text, blockKey: c.key, sourceAnchor: structuredClone(c.sourceAnchor),
          span: structuredClone(span), emittedTextualCaption: false };
      }
      return fig;
    });
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
    shape(spec, ['id', 'problemType', 'heading', 'points', 'statement', 'parts', 'statementAfterParts', 'solution', ...(withFigures ? ['figures'] : [])], `problem ${i}`);
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
    pr.figures = readFigures(spec.figures, `${root}/figures`, context, stream);
    const labels = new Set();
    for (const [j, pt] of spec.parts.entries()) {
      const field = `${root}/parts/${j}`;
      shape(pt, ['label', 'statement', 'points', 'statementAfter', ...(withFigures ? ['figures'] : [])], `part ${field}`);
      const label = consume(pt.label, `${field}/label`, context, stream);
      if (!nonempty(label) || label.trim() !== label || labels.has(label)) reject(`empty, padded or duplicate part label at ${field}`);
      labels.add(label);
      const part = { label, statement: readText(pt.statement, `${field}/statement`, context, stream), points: readPoints(pt.points, `${field}/points`, context) };
      if (!nonempty(part.statement)) reject(`empty mapped part at ${field}`);
      if (own(pt, 'figures')) part.figures = readFigures(pt.figures, `${field}/figures`, context, stream);
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
      // The renderer puts the score beside part.statement, before its figures.
      // A source score below the drawing cannot be moved above it silently.
      const firstFigure = pt.figures?.[0];
      if (firstFigure && !before(rank(marker), [entries.get(key(firstFigure.pageId, firstFigure.blockId)).index, 0])) reject(`points marker follows its rendered figure at ${root}/parts/${j}`);
    }
    if (!nonempty(pr.statement) && !pr.parts.length) reject(`missing statement at ${root}; never synthesize one`);
    shape(spec.solution, ['missing', 'reason', 'statement', ...(withFigures ? ['figures'] : [])], `${root} solution mapping`);
    if (spec.solution.missing === true) {
      if (own(spec.solution, 'statement') || own(spec.solution, 'figures') || !nonempty(spec.solution.reason) || owner.officialSolution.length) reject(`missing-solution claim conflicts with supplied blocks at ${root}`);
      pr.solution = { statement: '', figures: [], incomplete: true, incompleteReason: spec.solution.reason };
    } else {
      if (own(spec.solution, 'missing') || own(spec.solution, 'reason') || !owner.officialSolution.length) reject(`invalid supplied-solution mapping at ${root}`);
      const statement = readText(spec.solution.statement, `${root}/solution/statement`,
        { kind: 'problem', id: owner.id, section: 'official-solution' }, `${owner.id} solution order`);
      if (!nonempty(statement)) reject(`empty supplied solution at ${root}`);
      pr.solution = { statement, figures: readFigures(spec.solution.figures, `${root}/solution/figures`,
        { kind: 'problem', id: owner.id, section: 'official-solution' }, `${owner.id} solution order`), incomplete: false };
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
  if (own(m, 'excludedFigures')) {
    if (!withFigures || !Array.isArray(m.excludedFigures)) reject('invalid excludedFigures array');
    m.excludedFigures.forEach((f, i) => {
      const field = `/excludedFigures/${i}`;
      shape(f, ['pageId', 'blockId', 'reason', 'sourceReviewed'], `${field} decorative exclusion`);
      const e = entries.get(key(f.pageId, f.blockId)), t = e?.assignment.target;
      if (!e || e.block.type !== 'figure' || e.block.problemNumber !== null
        || t.kind !== 'document' || t.role !== 'other' || !nonempty(t.reason)
        || f.sourceReviewed !== true || !nonempty(f.reason)) reject(`decorative exclusion must be source-reviewed, null-numbered and document-owned at ${field}`);
      if (figureCoverage.has(e.key)) reject(`figure consumed more than once at ${field}`);
      figureCoverage.set(e.key, { blockKey: e.key, field, disposition: 'excluded-decoration', reason: f.reason,
        sourceReviewed: true, sourceAnchor: structuredClone(e.sourceAnchor),
        sourcePage: structuredClone(assembly.pages.find(p => p.item.id === f.pageId).item) });
    });
  }
  for (const [k, ranges] of coverage) {
    if (entries.get(k).block.type === 'figure' && !figureCoverage.has(k)) reject(`unmapped figure block ${k}`);
    ranges.sort((a, b) => a.start - b.start);
    let end = 0;
    for (const r of ranges) {
      if (r.start !== end) reject(`unmapped source characters in ${k} at ${end}`);
      end = r.end;
    }
    if (end !== entries.get(k).block.text.length) reject(`unmapped source characters in ${k} at ${end}`);
  }
  const candidate = { paper, problems };
  const validate = withFigures ? validateFigureCandidate : validateSchema;
  if (!validate(candidate)) reject(`candidate schema: ${validate.errors.map(e => `${e.dataPath} ${e.message}`).join('; ')}`);
  candidate.tx = { pageCandidate: { schemaVersion: m.schemaVersion, publicationEligible: false, sourceFilesVerifiedByThisModule: false,
    fieldMapping: m, assignments, assembly, coverage: [...coverage].map(([blockKey, ranges]) => ({ blockKey, ranges })),
    ...(withFigures ? { figureCoverage: [...figureCoverage.values()], requiredFigureWorkflow: 'figures.mjs --no-snap; inspect --dry-run crops; separately upload/verify before final validation' } : {}) } };
  return candidate;
}
