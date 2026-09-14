// Pure, lossless assembly of pilot {item, page} records. No IO or tx promotion.
// All ownership and page order come from a frozen explicit assignment plan.
import { createHash } from 'node:crypto';

const TYPES = new Set(['heading', 'paragraph', 'equation', 'table', 'figure', 'caption', 'footer']);
const SECTIONS = new Set(['statement', 'official-solution']);
const SHA = /^[a-f0-9]{64}$/;
const validSha = x => typeof x === 'string' && SHA.test(x);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const has = (x, k) => Object.hasOwn(x, k);
const only = (x, keys) => Object.keys(x).every(k => keys.includes(k));
const bbox = x => Array.isArray(x) && x.length === 4 && x.every(Number.isFinite)
  && x[0] >= 0 && x[1] >= 0 && x[2] <= 1000 && x[3] <= 1000 && x[0] < x[2] && x[1] < x[3];
const key = (pageId, blockId) => JSON.stringify([pageId, blockId]);

// JSON-only inputs prevent silent loss of undefined, NaN, functions or getters.
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1) throw Error('sparse or extended array');
    return Array.from({ length: value.length }, (_, i) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !has(descriptor, 'value')) throw Error('accessor property');
      return canonical(descriptor.value);
    });
  }
  if (object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    if (Reflect.ownKeys(value).length !== Object.keys(value).length) throw Error('hidden or symbol property');
    return Object.fromEntries(Object.keys(value).sort().map(k => {
      const descriptor = Object.getOwnPropertyDescriptor(value, k);
      if (!has(descriptor, 'value')) throw Error('accessor property');
      return [k, canonical(descriptor.value)];
    }));
  }
  throw Error('non-JSON value');
}

export function pageRecordFingerprint(record) {
  const data = canonical(record);
  if (!object(data?.item) || !object(data?.page)) throw Error('record requires item and page');
  return createHash('sha256').update(JSON.stringify({ item: data.item, page: data.page })).digest('hex');
}

function pageErrors(record, paperId) {
  const errors = [], { item, page } = record;
  if (!object(item) || !nonempty(item.id) || item.paperId !== paperId
    || !['problems', 'solutions'].includes(item.documentRole)
    || !Number.isSafeInteger(item.pdfPage) || item.pdfPage < 1
    || !validSha(item.sourcePdfSha256) || !validSha(item.imageSha256)
    || !nonempty(item.sourcePdfPath) || !nonempty(item.imagePath)) errors.push('invalid source identity/provenance');
  if (!object(page) || !only(page, ['schemaVersion', 'blocks', 'uncertainties', 'normalizations'])
    || page.schemaVersion !== 1 || !Array.isArray(page.blocks) || !page.blocks.length
    || !Array.isArray(page.uncertainties) || !Array.isArray(page.normalizations)) return [...errors, 'invalid pilot page'];
  const ids = new Set();
  for (const b of page.blocks) {
    if (!object(b) || !only(b, ['id', 'type', 'text', 'bbox', 'problemNumber', 'continuation'])
      || !nonempty(b.id) || ids.has(b.id) || !TYPES.has(b.type) || typeof b.text !== 'string'
      || !bbox(b.bbox) || !(b.problemNumber === null || typeof b.problemNumber === 'string')
      || typeof b.continuation !== 'boolean' || (b.type === 'figure' ? b.text !== '' : !b.text.trim())) {
      errors.push(`invalid/duplicate block ${b?.id ?? '?'}`);
    }
    if (b?.id) ids.add(b.id);
  }
  for (const field of ['uncertainties', 'normalizations']) {
    const fields = field === 'uncertainties' ? ['blockId', 'note'] : ['blockId', 'source', 'replacement', 'reason'];
    for (const n of page[field]) if (!object(n) || !only(n, fields) || fields.some(k => typeof n[k] !== 'string')
      || !ids.has(n.blockId)) errors.push(`invalid ${field} reference`);
  }
  // Cropped/rotated image coordinates remain image-local. Never reinterpret
  // them as original-PDF coordinates, even when the image is a full leaf.
  if (item && ['cropPixelBox', 'parentUprightPixelSize', 'parentUprightImageSha256', 'cropToParentPermille'].some(k => has(item, k))) {
    const size = item.parentUprightPixelSize, crop = item.cropPixelBox, scaled = item.cropToParentPermille;
    const valid = Array.isArray(size) && size.length === 2 && size.every(n => Number.isSafeInteger(n) && n > 0)
      && Array.isArray(crop) && crop.length === 4 && crop.every(Number.isSafeInteger)
      && crop[0] >= 0 && crop[1] >= 0 && crop[0] < crop[2] && crop[1] < crop[3]
      && crop[2] <= size[0] && crop[3] <= size[1] && validSha(item.parentUprightImageSha256)
      && bbox(scaled) && scaled.every((n, i) => Math.abs(n - crop[i] / size[i % 2] * 1000) < 1e-6);
    if (!valid) errors.push('incomplete/inconsistent crop-to-parent provenance');
  }
  return errors;
}

export function validatePageAssignments(records, plan) {
  const errors = [];
  try { canonical({ records, plan }); } catch { return { ok: false, errors: ['inputs must be finite, acyclic JSON data'] }; }
  if (!Array.isArray(records) || !records.length || !object(plan) || plan.schemaVersion !== 1
    || !nonempty(plan.paperId) || !Array.isArray(plan.pages) || !Array.isArray(plan.problems)
    || !plan.problems.length || !Array.isArray(plan.assignments)
    || !only(plan, ['schemaVersion', 'paperId', 'pages', 'problems', 'assignments'])) {
    return { ok: false, errors: ['invalid explicit assignment plan'] };
  }
  const pages = new Map(), blocks = new Map(), problems = new Map(), sourceHashes = new Map();
  const numbers = new Set();
  for (const p of plan.problems) {
    if (!object(p) || !only(p, ['id', 'number']) || !nonempty(p.id)
      || !(nonempty(p.number) || Number.isSafeInteger(p.number))
      || problems.has(p.id) || numbers.has(String(p.number))) { errors.push('invalid/duplicate problem declaration'); continue; }
    problems.set(p.id, p); numbers.add(String(p.number));
  }
  for (const record of records) {
    if (!object(record)) { errors.push('invalid page record'); continue; }
    const prefix = record.item?.id ?? '?';
    const failures = pageErrors(record, plan.paperId);
    errors.push(...failures.map(e => `${prefix}: ${e}`));
    if (failures.length) continue;
    if (pages.has(prefix)) { errors.push(`duplicate page record ${prefix}`); continue; }
    const { documentRole, sourcePdfSha256 } = record.item;
    if (sourceHashes.has(documentRole) && sourceHashes.get(documentRole) !== sourcePdfSha256) errors.push(`conflicting source PDF hashes for ${documentRole}`);
    sourceHashes.set(documentRole, sourcePdfSha256);
    pages.set(prefix, record);
    for (const block of record.page.blocks) blocks.set(key(prefix, block.id), block);
  }
  const orderedPages = new Set();
  for (const p of plan.pages) {
    if (!object(p) || !only(p, ['pageId', 'recordSha256']) || !pages.has(p.pageId)
      || orderedPages.has(p.pageId) || !validSha(p.recordSha256)) { errors.push('unknown/duplicate/unfrozen page in plan'); continue; }
    orderedPages.add(p.pageId);
    if (pageRecordFingerprint(pages.get(p.pageId)) !== p.recordSha256) errors.push(`stale page fingerprint ${p.pageId}`);
  }
  for (const id of pages.keys()) if (!orderedPages.has(id)) errors.push(`page absent from explicit order ${id}`);
  const assigned = new Set(), claimed = new Set();
  for (const a of plan.assignments) {
    if (!object(a) || !only(a, ['pageId', 'blockId', 'target', 'numberOverrideReason']) || !object(a.target)) {
      errors.push('invalid assignment'); continue;
    }
    const k = key(a.pageId, a.blockId), b = blocks.get(k), t = a.target;
    if (!b) { errors.push(`unknown block ${k}`); continue; }
    if (assigned.has(k)) errors.push(`block assigned more than once ${k}`);
    assigned.add(k);
    if (has(a, 'numberOverrideReason') && !nonempty(a.numberOverrideReason)) errors.push(`empty override reason ${k}`);
    if (t.kind === 'problem') {
      if (!only(t, ['kind', 'problemId', 'section']) || !problems.has(t.problemId) || !SECTIONS.has(t.section)) {
        errors.push(`invalid problem target ${k}`); continue;
      }
      claimed.add(t.problemId);
      if (b.problemNumber !== null && String(problems.get(t.problemId).number) !== b.problemNumber && !nonempty(a.numberOverrideReason)) {
        errors.push(`number/ownership conflict needs explicit override reason ${k}`);
      }
    } else if (t.kind === 'shared') {
      if (!only(t, ['kind', 'problemIds', 'section']) || !SECTIONS.has(t.section) || !Array.isArray(t.problemIds)
        || !t.problemIds.length || new Set(t.problemIds).size !== t.problemIds.length
        || t.problemIds.some(id => !problems.has(id))) errors.push(`invalid shared ownership ${k}`);
      else if (b.problemNumber !== null && !t.problemIds.some(id => String(problems.get(id).number) === b.problemNumber)
        && !nonempty(a.numberOverrideReason)) errors.push(`shared number/ownership conflict needs explicit override reason ${k}`);
    } else if (t.kind === 'document') {
      if (!only(t, ['kind', 'role', 'reason']) || !['header', 'footer', 'other'].includes(t.role)
        || (has(t, 'reason') && !nonempty(t.reason))
        || (t.role === 'header' && b.type !== 'heading' && b.type !== 'paragraph')
        || (t.role === 'footer' && b.type !== 'footer')
        || (t.role === 'other' && !nonempty(t.reason))) errors.push(`invalid null-owned document target ${k}`);
      if (b.problemNumber !== null && !nonempty(a.numberOverrideReason)) errors.push(`numbered block made null-owned without reason ${k}`);
    } else errors.push(`unknown target kind ${k}`);
  }
  for (const k of blocks.keys()) if (!assigned.has(k)) errors.push(`unassigned block ${k}`);
  for (const id of problems.keys()) if (!claimed.has(id)) errors.push(`declared problem has no owned block ${id}`);
  return { ok: errors.length === 0, errors };
}

export function assemblePageBlocks(records, plan) {
  const validation = validatePageAssignments(records, plan);
  if (!validation.ok) {
    const error = new Error(`Page assembly rejected: ${validation.errors.join('; ')}`);
    error.code = 'INVALID_BLOCK_ASSIGNMENT'; error.errors = validation.errors; throw error;
  }
  const pages = new Map(records.map(r => [r.item.id, r]));
  const assignments = new Map(plan.assignments.map(a => [key(a.pageId, a.blockId), a]));
  const output = {
    format: 'lossless-ordered-block-assembly', schemaVersion: 1, paperId: plan.paperId,
    publicationEligible: false, txCandidate: null,
    sourceFilesVerifiedByThisModule: false,
    pages: [], blocks: [],
    owners: plan.problems.map(p => ({ ...structuredClone(p), statement: [], officialSolution: [], shared: [] })),
    shared: [], document: [],
    conversionGaps: [
      'Explicit canonical field/subpart and document-note placement mapping is still required; no heading parsing, label removal or invented statements.',
      'Inline figure placement requires stable figure identity and final URL binding; current tx figures[] alone cannot retain arbitrary block positions.',
      'Image-local crop/rotation coordinates are not original-PDF bbox/pdfRect; preserve the transform and verify conversion before existing crop tools.',
      'Paper metadata, required canonical fields and source-backed missing-solution status must be supplied explicitly; this assembly is not a tx candidate.',
    ],
  };
  const owners = new Map(output.owners.map(p => [p.id, p]));
  for (const [pageIndex, declared] of plan.pages.entries()) {
    const record = pages.get(declared.pageId);
    output.pages.push({ item: structuredClone(record.item), recordSha256: declared.recordSha256, pageSchemaVersion: record.page.schemaVersion });
    for (const [blockIndex, block] of record.page.blocks.entries()) {
      const blockKey = key(record.item.id, block.id), assignment = assignments.get(blockKey), t = assignment.target;
      const entry = {
        key: blockKey, sourceOrder: { pageIndex, blockIndex },
        sourceAnchor: { pageId: record.item.id, document: record.item.documentRole, page: record.item.pdfPage,
          sourcePdfSha256: record.item.sourcePdfSha256, imageSha256: record.item.imageSha256,
          coordinateSpace: 'input-image-permille', bbox: [...block.bbox] },
        owner: t.kind === 'problem' ? t.problemId : null,
        assignment: structuredClone(assignment), block: structuredClone(block),
        uncertainties: structuredClone(record.page.uncertainties.filter(n => n.blockId === block.id)),
        normalizations: structuredClone(record.page.normalizations.filter(n => n.blockId === block.id)),
      };
      output.blocks.push(entry);
      if (t.kind === 'problem') owners.get(t.problemId)[t.section === 'statement' ? 'statement' : 'officialSolution'].push(blockKey);
      else if (t.kind === 'shared') {
        output.shared.push(blockKey);
        for (const id of t.problemIds) owners.get(id).shared.push(blockKey);
      } else output.document.push(blockKey);
    }
  }
  for (const p of output.owners) if (!p.statement.length) output.conversionGaps.push(`${p.id}: no statement blocks in supplied records; do not invent a missing statement.`);
  return output;
}
