#!/usr/bin/env node
// backlog.mjs [--json] [--catalogue] [--include-live] [--collisions]
// Lists the Bulgarian backlog entries (tmp/shards/all.json), or with --catalogue every problems document of the
// archive catalogue, that are neither in content/problems nor in tmp/staging. Left out: a document whose archive key
// a published paper holds (whatever id the row would derive), a row whose id is a published paper's, a same-paper
// twin of another row, and the reviewed duplicates of published papers in content/backlog-exclusions.json. Read-only.
// --collisions (with --catalogue) lists, for review, each remaining row that shares a bucket with a published paper
// (see bucketCollisions): the candidates to read against the published file before a row is transcribed, since a
// re-upload, a Word source, a problems+solutions file or a whole-competition book of a published paper is filed
// under its own name and is not caught by the key, id or inventory-title checks.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { paperIdFor, derivePaperId, existingPaperIndex, loadCatalogue, loadBacklog, ROOT } from './lib.mjs';

export const EXCLUSIONS_FILE = path.join(ROOT, 'content', 'backlog-exclusions.json');
const nfc = s => String(s ?? '').normalize('NFC'); // archive keys arrive in NFC and NFD spellings (macOS file names)

// a multilingual edition: "_multi" / "-multi" / "multi.pdf" as a whole word of the file name — not "Multiple_Choice"
export const isMulti = f => /(^|[^a-z0-9])multi([^a-z0-9]|$)/i.test(path.basename(String(f)));

// content/backlog-exclusions.json: {version, entries: [{key, reason, duplicateOf, evidence}]} — problems documents
// reviewed as the same paper as one already published under another file (a re-upload, a .doc of the printed PDF, a
// compilation whose every problem is on the site). A translation is not listed there: it is a page of its own.
export function loadExclusions(file = EXCLUSIONS_FILE) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return new Map(); throw new Error(`${path.basename(file)}: ${e.message}`); }
  if (!j || !Array.isArray(j.entries)) throw new Error(`${path.basename(file)}: expected {version, entries: [...]}`);
  const out = new Map();
  for (const [i, e] of j.entries.entries()) {
    for (const f of ['key', 'reason', 'duplicateOf', 'evidence']) if (typeof e?.[f] !== 'string' || !e[f].trim()) throw new Error(`${path.basename(file)}: entries[${i}] needs a non-empty "${f}"`);
    if (out.has(nfc(e.key))) throw new Error(`${path.basename(file)}: ${e.key} is listed twice`);
    out.set(nfc(e.key), e);
  }
  return out;
}

// Why a backlog row is left out, or null when it stays: 'duplicate' (a twin of another row, see catalogueRows), 'live'
// (its archive key is a published paper's, whatever id it derives), 'live-id' (its id is a published paper's),
// 'staged', 'excluded' (content/backlog-exclusions.json).
export function leftOutReason(row, id, { live, staged = new Map(), stagedKeys = new Set(), exclusions = new Map() }) {
  const liveKeys = live.nfcKeys || (live.nfcKeys = new Set([...live.byKey.keys()].map(nfc)));
  if (row.duplicateOf) return 'duplicate';
  if (liveKeys.has(nfc(row.problemsKey))) return 'live';
  if (id && live.byId.has(id)) return 'live-id';
  if ((id && staged.has(id)) || stagedKeys.has(row.problemsKey)) return 'staged';
  if (exclusions.has(nfc(row.problemsKey))) return 'excluded';
  return null;
}

// A backlog row and a published paper whose documents may be one paper: same competition, language and round, the
// year equal or off by one (autumn rounds filed under the next year's folder, a catalogue year that is the school
// year), the grades equal or either one null (a whole-competition book, a special topic). exact: same year and grade.
// rows: {paperId, competition, year, round, grade, lang, problemsKey}; pubs: {id, competition, year, round, grade, lang, key}.
export function bucketCollisions(rows, pubs) {
  const out = [];
  const byComp = new Map();
  for (const p of pubs) (byComp.get(p.competition) || byComp.set(p.competition, []).get(p.competition)).push(p);
  for (const r of rows) {
    for (const p of byComp.get(r.competition) || []) {
      if (p.lang !== r.lang || (p.round ?? null) !== (r.round ?? null)) continue;
      const dy = Math.abs(Number(p.year) - Number(r.year));
      if (!(dy <= 1)) continue;
      const g = r.grade ?? null, pg = p.grade ?? null;
      if (g !== null && pg !== null && g !== pg) continue;
      out.push({ row: r, pub: p, exact: dy === 0 && g === pg });
    }
  }
  return out;
}
// the published papers as bucketCollisions takes them: the catalogue metadata of each published archive key
export function publishedBuckets(live, catalogue = loadCatalogue()) {
  const cat = new Map(catalogue.map(e => [nfc(e.file), e]));
  const out = [];
  for (const [key, id] of live.byKey) {
    const e = cat.get(nfc(key));
    if (e) out.push({ id, key, competition: e.competition, year: e.year, round: e.round ?? null, grade: e.group ?? null, lang: e.lang });
  }
  return out;
}

// prepare.mjs (lib.mjs resolvePaper) looks a paper id up in tmp/shards/all.json — first the row whose paperIdFor is
// the id, then the row whose derived proposal is — and refuses when that row's document is published under another
// id (NOF3_2014_10-12problemsD2 derived nof-2014-iii-10-12, which resolves to the published D1 file). Returns the
// shard row an id would resolve to when that row is another document, else null.
export function shadowingRow(id, problemsKey, { byPaperId, byDerived }) {
  const hit = byPaperId.get(id) || byDerived.get(id);
  return hit && nfc(hit.problemsKey) !== nfc(problemsKey) ? hit : null;
}
export function shardLookup(shards, live) {
  const byPaperId = new Map(), byDerived = new Map();
  for (const e of shards) {
    let a, b; try { a = paperIdFor(e, live); b = derivePaperId(e); } catch { continue; }
    if (!byPaperId.has(a)) byPaperId.set(a, e);
    if (!byDerived.has(b)) byDerived.set(b, e);
  }
  return { byPaperId, byDerived };
}

// --catalogue: every problems document of the archive catalogue (all subjects, competitions and
// languages), each paired with the solutions document of its bucket (same subject, competition,
// year, round, group, language; when several, the one whose file name matches best). The
// Bulgarian shards stay the default.
export const catalogueRows = () => {
  const cat = loadCatalogue().filter(e => e.kind === 'competition' && !e.hidden);
  const overrides = (() => { try { const o = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'solution-pairing-overrides.json'), 'utf8')); delete o._comment; return o; } catch { return {}; } })();
  const bucket = e => [e.subject, e.competition, e.year, e.round ?? '', e.group ?? '', e.lang].join('|');
  // a solutions document: typed as such, or an "answers"/"other" file whose name says so (ans-phys-10…, criteria_t_en, DA_Solution)
  const isSolution = e => e.type === 'solutions' || e.type === 'answers' || (e.type === 'other' && /(^|[^a-z])(ans|sol|resh|otg|criteri|key|reshen|otgov)/i.test(path.basename(e.file)));
  const sols = new Map();
  for (const e of cat) if (isSolution(e)) { const k = bucket(e); if (!sols.has(k)) sols.set(k, []); sols.get(k).push(e); }
  // file-name tokens minus the words that only say which side of the paper a file is
  const ROLE = /^(problems?|tasks?|task|zad|zadachi|zadania|uslovia|uslov|solutions?|sol|answers?|ans|resh|resheniya|otg|otgovori|criteria|criterion|key|keys|q|s|t|p|a|en|ru|bg|fr|de|final|v\d+|pdf)$/;
  // idTokens: the raw name words (derived ids depend on them and must stay stable). tokens: the same for pairing, with a
  // role letter glued to a number folded into the number (IPhO_2023_Q1 / IPhO_2023_S1, T2 / T2sol, prob3 / sol3).
  const stem = f => path.basename(f).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/\s*\(\d+\)$/, ''); // "T1_solution (1).pdf": a download's duplicate marker, not a number of the paper
  const idTokens = f => new Set(path.basename(f).toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter(t => t && !ROLE.test(t)));
  const tokens = f => new Set(stem(f).split(/[^a-z0-9]+/).map(t => t.replace(/^(?:q|s|a|t|p|e|z|r|sol|ans|prob|task|zad|resh|otg)(\d+)(?:sol|ans|resh|otg)?$/, '$1')).filter(t => t && !ROLE.test(t)));
  const jaccard = (a, b) => { const i = [...a].filter(x => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 0; };
  // the short numbers in a name (Q1 / T1_solution, not the year) — equal sets pair the files whatever else the names carry
  const numbers = s => new Set([...s].filter(t => /^\d{1,2}$/.test(t)));
  const sameNumbers = (a, b) => { const x = numbers(a), y = numbers(b); return x.size > 0 && x.size === y.size && [...x].every(n => y.has(n)); };
  const live = existingPaperIndex();
  const liveKeys = new Set([...live.byKey.keys()].map(nfc));
  const inventory = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'archive-index.json'), 'utf8')).rows || []; } catch { return []; } })();
  const invByFile = new Map(inventory.map(r => [r.file, r]));
  const rows = [];
  let images = 0;
  const instructions = [], textCopies = [];
  // buckets that hold a PDF or Word problems document: a .txt problems file next to one is a plain-text copy of it
  const printed = new Set(cat.filter(e => e.type === 'problems' && !/\.(zip|txt|gif|jpe?g|png)$/i.test(e.file)).map(bucket));
  for (const e of cat) {
    if (e.type !== 'problems') continue;
    if (/\.(zip|gif)$/i.test(e.file)) continue; // bundles and animations: not a paper
    // plain text is a paper when it is the only edition of its bucket (IYPT 1994–2014 exist only as <year>.txt; the IAO
    // 2001–2003 Bulgarian theory papers only as .txt next to English/Russian scans); prepare.mjs typesets it to a PDF
    if (/\.txt$/i.test(e.file) && printed.has(bucket(e))) { textCopies.push(e.file); continue; }
    if (/\.(jpe?g|png)$/i.test(e.file)) { images++; continue; } // photographed sheets: often one paper split over several files — grouped later
    // a general-instructions or cover sheet typed as problems (APhO "exam-experiment-G0-english.pdf": rules, a constants
    // table as an image, no problem) is not a paper; the inventory lists no problem in it
    if (/(^|[^a-z0-9])g0([^a-z0-9]|$)|instruction|general|cover/i.test(path.basename(e.file)) && !(invByFile.get(e.file)?.problems || []).length) { instructions.push(e.file); continue; }
    // a theory file never takes the practical round's answers (10-IV-praktML ↔ a10-IV-teor share every other
    // token); photographed solution sheets are several files of one paper and are grouped later, not paired
    const kindOf = f => /teor|theor/i.test(path.basename(f)) ? 'theory' : /prakt|prak|practic|exper|(^|[^a-z])exp([^a-z]|$)/i.test(path.basename(f)) ? 'practical' : null;
    const kind = kindOf(e.file);
    const all = sols.get(bucket(e)) || [];
    const cands = all.filter(s => !/\.(jpe?g|png|gif)$/i.test(s.file) && !(kind && kindOf(s.file) && kindOf(s.file) !== kind));
    let solution = null;
    if (overrides[e.file]) solution = { file: overrides[e.file] }; // a name that pairs wrongly, settled by hand (content/solution-pairing-overrides.json)
    else if (all.length === 1 && cands.length === 1) solution = cands[0]; // the bucket's only solutions file
    else if (cands.length) { // several in the bucket (some ruled out above): the names must agree
      // an exact token match wins; else the best overlap, ties broken by a file typed as solutions; a real tie pairs nothing
      const t = tokens(e.file);
      // an exact name match wins outright; else the name overlap, plus half a point when the short numbers agree
      // (Q1 ↔ T1_solution), so two candidates with the same number are still told apart by the rest of the name
      const scored = cands.map(s => { const u = tokens(s.file); const eq = u.size === t.size && [...t].every(x => u.has(x)); return { s, j: eq ? 2 : jaccard(t, u) + (sameNumbers(t, u) ? 0.5 : 0), typed: s.type === 'solutions' ? 1 : 0 }; }).sort((a, b) => b.j - a.j || b.typed - a.typed);
      const [a, b] = scored;
      if (a && (a.j >= 0.5 || (t.size === 0 && a.j === 0 && a.typed)) && !(b && b.j === a.j && b.typed === a.typed)) solution = a.s;
    }
    rows.push({ competition: e.competition, year: e.year, round: e.round ?? null, grade: e.group ?? null, subject: e.subject, lang: e.lang, problemsKey: e.file, solutionsKey: solution?.file || null, catalogueId: e.id });
  }
  // Two problems documents of one bucket that the inventory lists with the same problem titles are one paper twice
  // (a multilingual "_multi" file next to the English one, "ver Jul 29" next to "ver 0730", a 1-page duplicate of
  // eupho2023_theory_problems.pdf): the one with a solutions file wins, then the single-language file, then the one
  // with more pages; the other is dropped here (batch logs it as skipped: duplicate).
  const titlesOf = f => (invByFile.get(f)?.problems || []).map(p => String(p.title || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
  const pagesOf = f => Number(invByFile.get(f)?.pages) || 0;
  const groups = new Map();
  for (const r of rows) { const k = bucket({ subject: r.subject, competition: r.competition, year: r.year, round: r.round, group: r.grade, lang: r.lang }); (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  const dropped = new Set();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (dropped.has(a) || dropped.has(b)) continue;
      // a multilingual "_multi" edition next to a single-language file of the same bucket is that file again
      // (its inventory titles may be in another language); otherwise the inventory titles must match
      const multiPair = isMulti(a.problemsKey) !== isMulti(b.problemsKey) && !!(a.round || b.round) && a.round === b.round;
      const ta = titlesOf(a.problemsKey), tb = titlesOf(b.problemsKey);
      if (!multiPair && (ta.length < 2 || ta.length !== tb.length || !ta.every((t, n) => t === tb[n]))) continue;
      // files that differ by a small number on each side (10_prob / 11_prob: two grades whose problems share titles)
      // are two papers; a small number on one side only is a date or a download marker ("ver Jul 29 (1)" next to
      // "ver 20150730_1717": ioaa-2015-data-analysis ran twice)
      const ia = idTokens(a.problemsKey), ib = idTokens(b.problemsKey);
      const small = list => list.some(t => /^\d{1,2}$/.test(t));
      if (small([...ia].filter(t => !ib.has(t))) && small([...ib].filter(t => !ia.has(t)))) continue;
      // a published file always wins: its twin is then that published paper again and leaves the backlog with it
      const score = r => (liveKeys.has(nfc(r.problemsKey)) ? 8 : 0) + (r.solutionsKey ? 4 : 0) + (isMulti(r.problemsKey) ? 0 : 2) + Math.min(1, pagesOf(r.problemsKey) / 100);
      const [keep, drop] = score(a) >= score(b) ? [a, b] : [b, a];
      drop.duplicateOf = keep.problemsKey; dropped.add(drop);
    }
  }
  // two rows of one bucket derive the same id (theory and practical files, two problem files of one round):
  // the file-name tokens they do not share tell them apart; identical names get a running number
  const byId = new Map();
  for (const r of rows) { const id = paperIdFor(r); (byId.get(id) || byId.set(id, []).get(id)).push(r); }
  for (const [id, group] of byId) {
    if (group.length < 2) { group[0].derivedId = id; continue; }
    const sets = group.map(r => idTokens(r.problemsKey));
    const common = [...sets[0]].filter(t => sets.every(s => s.has(t)));
    const used = new Set();
    group.forEach((r, i) => {
      const own = [...sets[i]].filter(t => !common.includes(t)).slice(0, 2).join('-').replace(/[^a-z0-9-]/g, '');
      let cand = own ? `${id}-${own}` : `${id}-${i + 1}`;
      if (used.has(cand)) cand = `${cand}-${i + 1}`;
      used.add(cand); r.derivedId = cand;
    });
  }
  // an id prepare.mjs would resolve to another document of the shards (see shadowingRow) takes the name words that
  // document does not have (nof-2014-iii-10-12 → nof-2014-iii-10-12-d2), else a running number
  const shards = shardLookup(loadBacklog(), live);
  const taken = new Set([...rows.map(r => r.derivedId), ...live.byId.keys()]);
  let renamed = 0;
  for (const r of rows) {
    // a published document, or an id a published paper already holds (left out as 'live-id': another file of that paper)
    if (liveKeys.has(nfc(r.problemsKey)) || live.byId.has(r.derivedId)) continue;
    const hit = shadowingRow(r.derivedId, r.problemsKey, shards);
    if (!hit) continue;
    const other = idTokens(hit.problemsKey);
    // a name word glued to a role word loses it and the numbers the id already has ("12problemsD2" → "d2")
    const parts = new Set(r.derivedId.split('-'));
    const own = [...idTokens(r.problemsKey)].filter(t => !other.has(t)).flatMap(t => t.split(/problems?|solutions?|tasks?|zadachi|zad/)).filter(t => t && !parts.has(t)).slice(0, 2).join('-').replace(/[^a-z0-9-]/g, '');
    let cand = own ? `${r.derivedId}-${own}` : `${r.derivedId}-2`;
    for (let n = 2; taken.has(cand) || shadowingRow(cand, r.problemsKey, shards); n++) cand = `${own ? `${r.derivedId}-${own}` : r.derivedId}-${n}`;
    taken.add(cand); r.derivedId = cand; renamed++;
  }
  if (images) console.error(`${images} image-only problem sheets left out (grouping needed)`);
  if (instructions.length) console.error(`${instructions.length} instructions/cover sheet(s) left out: ${instructions.map(f => path.basename(f)).join(', ')}`);
  if (textCopies.length) console.error(`${textCopies.length} plain-text copy(ies) of a PDF/Word paper left out: ${textCopies.map(f => path.basename(f)).join(', ')}`);
  if (renamed) console.error(`${renamed} id(s) renamed that prepare.mjs would resolve to another (published) document`);
  return rows;
};
function main() {
const all = process.argv.includes('--catalogue') ? catalogueRows() : JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/shards/all.json'), 'utf8'));
const live = existingPaperIndex();
const exclusions = loadExclusions();
const staged = new Map();
(function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json') && !/^list\d+\.json$/.test(e.name)) {
      try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j.paper?.id) staged.set(j.paper.id, j.paper.source?.archiveKey || null); } catch {}
    }
  }
})(path.join(ROOT, 'tmp/staging'));
const stagedKeys = new Set([...staged.values()].filter(Boolean));
const remaining = [];
const counts = {};
const includeLive = process.argv.includes('--include-live');
for (const row of all) {
  let id; try { id = row.derivedId || paperIdFor(row); } catch { id = null; }
  const why = leftOutReason(row, id, { live, staged, stagedKeys, exclusions });
  const inLive = why === 'live' || why === 'live-id';
  // --include-live lists the published papers too (marked live: true), for a fresh re-read of a paper whose pairing changed
  if (why && !(includeLive && inLive)) { counts[why] = (counts[why] || 0) + 1; continue; }
  remaining.push({ paperId: id, competition: row.competition, year: row.year, round: row.round, grade: row.grade, subject: row.subject, lang: row.lang, catalogueId: row.catalogueId, problemsKey: row.problemsKey, solutionsKey: row.solutionsKey, ...(inLive ? { live: true } : {}) });
}
const rowKeys = new Set(all.map(r => nfc(r.problemsKey)));
const stale = [...exclusions.values()].filter(e => !rowKeys.has(nfc(e.key)));
if (stale.length && process.argv.includes('--catalogue')) console.error(`warning: ${stale.length} backlog-exclusions.json key(s) match no catalogue problems document: ${stale.map(e => e.key).join(', ')}`);
if (process.argv.includes('--collisions')) {
  // review list, not a filter: one line per remaining row and published paper that may be the same paper
  const hits = bucketCollisions(remaining, publishedBuckets(live));
  if (process.argv.includes('--json')) console.log(JSON.stringify(hits.map(h => ({ paperId: h.row.paperId, problemsKey: h.row.problemsKey, publishedId: h.pub.id, publishedKey: h.pub.key, exact: h.exact })), null, 1));
  else for (const h of hits) console.log(`${h.exact ? 'same-bucket' : 'near-bucket'}\t${h.row.paperId}\t${h.row.problemsKey}\t${h.pub.id}\t${h.pub.key}`);
  console.error(`${new Set(hits.map(h => h.row.problemsKey)).size} backlog row(s) share a bucket with a published paper (${hits.filter(h => h.exact).length} same-bucket pair(s)); read each against the published file and list true duplicates in content/backlog-exclusions.json`);
} else if (process.argv.includes('--json')) console.log(JSON.stringify(remaining, null, 1));
else for (const r of remaining) console.log(`${r.paperId ?? '?'}\t${r.competition} ${r.year} ${r.round ?? ''} ${r.grade ?? ''}\t${r.problemsKey}`);
const label = { live: 'published (same file)', 'live-id': 'published (same id, other file)', staged: 'staged', excluded: 'reviewed duplicates of published papers (content/backlog-exclusions.json)', duplicate: 'duplicate document(s)' };
console.error(`${remaining.length} backlog entries not in content/problems or tmp/staging (of ${all.length}; left out: ${Object.entries(counts).map(([k, n]) => `${n} ${label[k]}`).join(', ') || 'none'})`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
