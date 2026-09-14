// Draft-only whole-block assembly. No model calls, ownership inference, source
// file verification, crops, receipts, or publication authority.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePageBlocks } from './page-assembly.mjs';
import { toPageCandidate } from './page-candidate.mjs';
import { originalPageFigureGeometry } from './page-figure.mjs';

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const ref = e => ({ pageId: e.sourceAnchor.pageId, blockId: e.block.id });
const text = entries => ({ spans: entries.map(ref), join: '\n\n' });
const samePage = (a, b) => a.sourceAnchor.pageId === b.sourceAnchor.pageId;
function reject(message, entry) {
  throw Object.assign(new Error(`Page fallback rejected: ${message}`), {
    code: 'UNSUPPORTED_PAGE_FALLBACK', ...(entry ? { sourceAnchor: structuredClone(entry.sourceAnchor) } : {}),
  });
}
// Never execute input accessors, lose unsupported values, or alias caller data.
function copyJson(value, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if ((!object(value) && !Array.isArray(value)) || ancestors.has(value)) reject('inputs must be finite acyclic JSON');
  const array = Array.isArray(value), keys = Reflect.ownKeys(value);
  if ((!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    || keys.some(k => typeof k !== 'string')
    || (array ? keys.length !== value.length + 1 : keys.length !== Object.keys(value).length)) reject('hidden or extended input');
  ancestors.add(value);
  const names = array ? Array.from({ length: value.length }, (_, i) => String(i)) : Object.keys(value);
  const entries = names.map(k => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) reject('accessor, sparse or hidden input');
    return [k, copyJson(d.value, ancestors)];
  });
  ancestors.delete(value);
  return array ? entries.map(e => e[1]) : Object.fromEntries(entries);
}

function makeMapping(records, assignments, paper, options) {
  if (!object(options) || Object.keys(options).some(k => k !== 'excludedFigures')
    || (options.excludedFigures !== undefined && (!Array.isArray(options.excludedFigures)
      || options.excludedFigures.some(f => !object(f))))) reject('invalid options');
  const a = assemblePageBlocks(records, assignments);
  // The fallback deliberately has one geometry contract, including text-only
  // pages: explicit upright full-page input or a proportional full-page resize.
  for (const p of a.pages) originalPageFigureGeometry(p.item, [0, 0, 1000, 1000]);
  const indexed = a.blocks.map((e, index) => ({ ...e, index }));
  const firstPage = a.pages[0].item.id;
  const firstContent = indexed.find(e => e.sourceAnchor.pageId === firstPage && e.assignment.target.kind !== 'document');
  const headers = indexed.filter(e => e.sourceAnchor.pageId === firstPage
    && e.assignment.target.kind === 'document' && e.assignment.target.role === 'header'
    && (!firstContent || e.index < firstContent.index));
  // A header cannot jump over an intervening document note to become the title.
  if (headers.length && indexed.some(e => e.index < headers.at(-1).index
    && e.block.type !== 'figure' && !headers.some(h => h.key === e.key))) reject('interleaved title/header placement');
  const titleKeys = new Set(headers.map(e => e.key));
  const excludedFigures = options.excludedFigures ?? [];
  const excludedKeys = new Set(excludedFigures.map(f => JSON.stringify([f.pageId, f.blockId])));
  for (const e of indexed) if (e.block.type === 'figure' && e.assignment.target.kind !== 'problem'
    && !excludedKeys.has(e.key)) reject('document/shared figure requires an explicit reviewed disposition', e);

  const documentNotes = [];
  for (const p of a.pages) {
    const entries = indexed.filter(e => e.sourceAnchor.pageId === p.item.id);
    const owned = entries.filter(e => e.assignment.target.kind === 'problem');
    const notes = entries.filter(e => e.assignment.target.kind !== 'problem'
      && e.block.type !== 'figure' && !titleKeys.has(e.key));
    const groups = { 'before-problem': [], 'after-problem': [] };
    for (const e of notes) {
      if (e.block.type === 'caption') reject('document/shared caption needs explicit figure placement', e);
      const t = e.assignment.target;
      if (t.kind === 'shared' && (t.section !== 'statement'
        || t.problemIds.length !== a.owners.length || a.owners.some(o => !t.problemIds.includes(o.id)))) {
        reject('shared content for only selected problems or solutions needs explicit placement', e);
      }
      if (owned.length && e.index > owned[0].index && e.index < owned.at(-1).index) reject('interior document/shared note needs explicit placement', e);
      groups[owned.length && e.index > owned.at(-1).index ? 'after-problem' : 'before-problem'].push(e);
    }
    for (const [position, entries] of Object.entries(groups)) if (entries.length) documentNotes.push({
      title: 'Допълнителен текст от източника', document: p.item.documentRole, page: p.item.pdfPage,
      position, statement: text(entries),
    });
  }

  function stream(owner, section) {
    const entries = indexed.filter(e => e.owner === owner.id && e.assignment.target.section === section);
    const first = entries.findIndex(e => e.block.type === 'figure');
    if (first === -1) {
      // Reader block types are not authoritative semantics: official score
      // columns may be labelled "caption". With no figure in this stream,
      // retain every such block inline rather than dropping/reclassifying it.
      return { statement: text(entries), figures: [], after: [] };
    }
    const before = entries.slice(0, first), figures = [];
    if (!before.length || before.some(e => e.block.type === 'caption')) reject('figure before a readable opening statement, or orphan caption', entries[first]);
    let at = first;
    while (at < entries.length && entries[at].block.type === 'figure') {
      const e = entries[at++];
      const f = { ...ref(e), id: `p${owner.number}-${section === 'official-solution' ? 'sol-' : ''}fig${figures.length + 1}` };
      if (entries[at]?.block.type === 'caption') {
        const c = entries[at++];
        // A caption must be immediately adjacent in the full frozen stream,
        // not made adjacent by filtering a different owner or document block.
        if (!samePage(e, c) || c.index !== e.index + 1) reject('caption is not adjacent on the same source page', c);
        const b = c.block.bbox, box = e.block.bbox;
        const enclosed = b[0] >= box[0] && b[1] >= box[1] && b[2] <= box[2] && b[3] <= box[3];
        // A wholly enclosed label stays in the source pixels. The converter
        // audits its exact text without emitting a second textual caption.
        f[enclosed ? 'embeddedCaption' : 'caption'] = text([c]);
      }
      figures.push(f);
    }
    const after = entries.slice(at);
    if (after.some(e => ['figure', 'caption'].includes(e.block.type))) reject('interleaved figure groups or orphan caption need explicit placement', after.find(e => ['figure', 'caption'].includes(e.block.type)));
    if (section === 'official-solution' && after.length) reject('solution text after a figure has no supported fallback renderer boundary', after[0]);
    return { statement: text(before), figures, after };
  }
  const problems = a.owners.map(owner => {
    const condition = stream(owner, 'statement'), solution = stream(owner, 'official-solution');
    return { id: owner.id, statement: condition.statement, figures: condition.figures, parts: [],
      ...(condition.after.length ? { statementAfterParts: text(condition.after) } : {}),
      solution: owner.officialSolution.length ? { statement: solution.statement, figures: solution.figures }
        : { missing: true, reason: 'В предоставените източници няма официално решение.' },
    };
  });
  return { schemaVersion: 2, paper, ...(headers.length ? { title: text(headers) } : {}),
    problems, documentNotes, furniture: [], whitespace: [], excludedFigures };
}

/**
 * Frozen page records + an explicit page-assembly assignment plan + the same
 * restricted paper metadata accepted by page-candidate.mjs. Optional
 * {excludedFigures:[{pageId,blockId,reason,sourceReviewed:true}]} is supplied
 * evidence, never inferred from a logo's appearance or assignment alone.
 *
 * Whole source blocks stay intact, including titles, labels and point awards.
 * No subpart/score inference: parts=[] and scores remain inline. A statement
 * can contain one figure group between its opening text and trailing text;
 * solution figures must follow all solution text. Only adjacent, separate
 * same-page captions can be attached; wholly enclosed captions stay in the
 * image with embedded-caption evidence. Partial overlaps fail closed.
 * Source uncertainties and normalization proposals remain unapplied in tx.
 * Every character/figure is checked by the existing converter before return.
 */
export function toFallbackCandidate(recordsInput, assignmentsInput, paperInput, optionsInput = {}) {
  const [records, assignments, paper, options] = copyJson([recordsInput, assignmentsInput, paperInput, optionsInput]);
  const mapping = makeMapping(records, assignments, paper, options);
  const candidate = toPageCandidate(records, assignments, mapping);
  candidate.tx.pageFallback = { schemaVersion: 1, method: 'whole-source-blocks',
    ownership: 'explicit supplied assignment plan; not inferred',
    labelsAndPoints: 'preserved inline; not extracted', publicationEligible: false,
    sourceFilesVerifiedByThisModule: false,
    requires: ['source fidelity and metadata review', 'supported placement review',
      'actual figure crop review where present', 'normal production validation and fresh review receipt'],
  };
  return candidate;
}

// This also validates the result; callers cannot mistake a partially assembled
// mapping for an accepted candidate. Returned spans are fully resolved by code.
export function buildFallbackMapping(records, assignments, paper, options = {}) {
  return toFallbackCandidate(records, assignments, paper, options).tx.pageCandidate.fieldMapping;
}

const help = 'Usage: node scripts/tx/page-fallback.mjs --records pages.json --assignments assignments.json --paper metadata.json --out NEW-draft.json [--excluded-figures reviewed-exclusions.json]\nOnly new draft files are written; input files and canonical content are never overwritten. No model calls, source verification or publication authority.';
function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--records', '--assignments', '--paper', '--out', '--excluded-figures'].includes(key)
      || Object.hasOwn(values, key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(help);
    values[key] = args[i + 1];
  }
  if (['--records', '--assignments', '--paper', '--out'].some(k => !values[k])) throw Error(help);
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const candidate = toFallbackCandidate(read(values['--records']), read(values['--assignments']), read(values['--paper']),
    values['--excluded-figures'] ? { excludedFigures: read(values['--excluded-figures']) } : {});
  const out = path.resolve(values['--out']);
  // Existing parent required: resolve junctions/symlinks before refusing writes
  // into the repository's canonical and generated publication directories.
  const parent = fs.realpathSync(path.dirname(out));
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const lowered = parent.toLowerCase();
  for (const dir of ['content', 'solutions']) {
    const denied = path.join(fs.realpathSync(repo), dir).toLowerCase();
    if (lowered === denied || lowered.startsWith(denied + path.sep)) throw Error('Draft output cannot be written into content or solutions');
  }
  fs.writeFileSync(path.join(parent, path.basename(out)), JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ path: out, paperId: candidate.paper.id, problems: candidate.problems.length, publicationEligible: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
