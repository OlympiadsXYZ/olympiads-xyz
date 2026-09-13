#!/usr/bin/env node
// backlog.mjs [--json]
// Lists the Bulgarian backlog entries (tmp/shards/all.json) that are neither in content/problems
// nor in tmp/staging (matched by derived paper id or by archive key). Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { paperIdFor, existingPaperIndex, loadCatalogue, ROOT } from './lib.mjs';

// --catalogue: every problems document of the archive catalogue (all subjects, competitions and
// languages), each paired with the solutions document of its bucket (same subject, competition,
// year, round, group, language; when several, the one whose file name matches best). The
// Bulgarian shards stay the default.
const catalogueRows = () => {
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
  const rows = [];
  let images = 0;
  for (const e of cat) {
    if (e.type !== 'problems') continue;
    if (/\.(zip|txt|gif)$/i.test(e.file)) continue; // bundles and plain text: not a paper
    if (/\.(jpe?g|png)$/i.test(e.file)) { images++; continue; } // photographed sheets: often one paper split over several files — grouped later
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
  const inventory = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'archive-index.json'), 'utf8')).rows || []; } catch { return []; } })();
  const invByFile = new Map(inventory.map(r => [r.file, r]));
  const titlesOf = f => (invByFile.get(f)?.problems || []).map(p => String(p.title || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
  const pagesOf = f => Number(invByFile.get(f)?.pages) || 0;
  const isMulti = f => /multi/i.test(path.basename(f));
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
      // files that differ by a small number (10_prob / 11_prob: two grades whose problems share titles) are two papers
      const ia = idTokens(a.problemsKey), ib = idTokens(b.problemsKey);
      if ([...ia].filter(t => !ib.has(t)).concat([...ib].filter(t => !ia.has(t))).some(t => /^\d{1,2}$/.test(t))) continue;
      const score = r => (r.solutionsKey ? 4 : 0) + (isMulti(r.problemsKey) ? 0 : 2) + Math.min(1, pagesOf(r.problemsKey) / 100);
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
  if (images) console.error(`${images} image-only problem sheets left out (grouping needed)`);
  return rows;
};
const all = process.argv.includes('--catalogue') ? catalogueRows() : JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/shards/all.json'), 'utf8'));
const live = existingPaperIndex();
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
let duplicates = 0;
for (const row of all) {
  if (row.duplicateOf) { duplicates++; continue; } // the same paper under another file name (see catalogueRows)
  let id; try { id = row.derivedId || paperIdFor(row); } catch { id = null; }
  const inLive = (id && live.byId.has(id)) || live.byKey.has(row.problemsKey);
  const inStaged = (id && staged.has(id)) || stagedKeys.has(row.problemsKey);
  // --include-live lists the published papers too (marked live: true), for a fresh re-read of a paper whose pairing changed
  if ((!inLive && !inStaged) || (process.argv.includes('--include-live') && inLive)) remaining.push({ paperId: id, competition: row.competition, year: row.year, round: row.round, grade: row.grade, subject: row.subject, lang: row.lang, catalogueId: row.catalogueId, problemsKey: row.problemsKey, solutionsKey: row.solutionsKey, ...(inLive ? { live: true } : {}) });
}
if (process.argv.includes('--json')) console.log(JSON.stringify(remaining, null, 1));
else { for (const r of remaining) console.log(`${r.paperId ?? '?'}\t${r.competition} ${r.year} ${r.round ?? ''} ${r.grade ?? ''}\t${r.problemsKey}`); console.error(`${remaining.length} backlog entries not in content/problems or tmp/staging (of ${all.length}${duplicates ? `, ${duplicates} duplicate document(s) left out` : ''})`); }
