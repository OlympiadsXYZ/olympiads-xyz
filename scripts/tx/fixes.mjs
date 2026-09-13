// Apply model-supplied replacement values (the refix stage) to a candidate, the
// same way repair.mjs applies a checker's suggestedFix: strings replace strings,
// numbers replace numbers (or a null points field), a 4-number box replaces a
// figure proposal and invalidates that figure's crop/upload evidence, and an
// object or array may only replace a value of the same shape. Every change is
// recorded under tx.repairs with who made it and which defect it answers.
// Anything else is reported as skipped and left for the adjudicator.
import { pointerGet, pointerSet, allFigures, nowIso } from './lib.mjs';

const parseBox = v => {
  if (Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number' && Number.isFinite(n))) return v.map(n => Math.round(n));
  if (v && typeof v === 'object' && !Array.isArray(v)) return parseBox(v.bbox ?? v.tx?.bbox ?? null);
  if (typeof v !== 'string') return null;
  // only a string that IS a box ("[x0, y0, x1, y1]" or "x0 y0 x1 y1"), never four numbers fished out of a sentence
  const m = /^\s*\[?\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*\]?\s*$/.exec(v);
  if (!m) return null;
  const box = m.slice(1, 5).map(Number).map(Math.round);
  return box[2] > box[0] && box[3] > box[1] ? box : null;
};

// Checkers sometimes answer with an instruction ("full text per pp. 2–3", "keep the
// intro paragraph", "remove this figure") instead of the replacement, and sometimes
// point a real fix at the wrong problem index. Pasting either corrupts the
// candidate. A replacement is applied only when it is text of the same kind as
// what it replaces: not an instruction, and sharing enough words with the current
// value (an omission fix must contain most of the current text and be longer).
// whole words only: "Използвайки получения резултат…" and "Вижда се, че…" open printed statements
const INSTRUCTION = /^\s*(keep|remove|delete|drop|full (solution )?text|see|split|repoint|use|replace|restore|move|add|insert|merge|set|the (statement|solution|text)|пълен текст|виж|запази|запазете|премахни|премахнете|добави|добавете|изтрий|изтрийте|замени|заменете|премести|преместете|обедини|обединете|раздели|разделете|постави|поставете|върни|върнете|коригирай|коригирайте|поправи|поправете|махни|махнете|отстрани|отстранете)\b/i;
const META = /(кандидат|транскрипци|полето|стойността на полето|етикет|label field|the field|the candidate|the transcription|^\s*(label|caption|alt|value|statement)\s*:|\bkeep the\b|\bunbulleted\b)/i;
// An instruction is a sentence or two; a long field ("The graph should present…", a solution) is content
export const looksLikeInstruction = s => typeof s === 'string' && ((s.length < 400 && INSTRUCTION.test(s)) || META.test(s.slice(0, 160)) || (s.length < 300 && /\be\.g\.|\betc\.|\(approximate|\bshould\b|\bmust\b/i.test(s)));
// a fix that is JSON (a spans list, a figure object) is bookkeeping echoed back, never the text of a field
export const looksLikeJson = s => typeof s === 'string' && /^\s*[\[{]\s*["{\[]/.test(s);
const words = s => new Set(String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1));
// Checker paths come back mangled now and then: a doubled prefix ("/problems/2/problems/2/figures/0"),
// a part written as "/p2/statement" (the second part), a solution figure under "/figures" instead
// of "/solution/figures". Try the obvious repairs and keep the first that resolves in the candidate.
export function repairDefectPath(candidate, path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return path;
  const resolves = p => { const keys = p.split('/').filter(Boolean); let o = candidate; for (let i = 0; i < keys.length; i++) { if (o == null || typeof o !== 'object') return false; if (!(keys[i] in o)) { return i === keys.length - 1 && /^(bbox|tx|caption|alt|label|points|title|statement|figures|solution|incomplete)$/.test(keys[i]) && o !== null; } o = o[keys[i]]; } return true; };
  if (resolves(path)) return path;
  const tries = [];
  let p = path.replace(/^(\/problems\/\d+)(?:\/problems\/\d+)+/, '$1');
  tries.push(p);
  tries.push(p.replace(/\/p(\d+)\/(statement|points|answer|figures|label)/, (m, n, f) => `/parts/${Number(n) - 1}/${f}`));
  tries.push(p.replace(/\/parts\/(\d+)\//, (m, n) => `/parts/${Number(n) - 1}/`)); // 1-based part index
  tries.push(p.replace(/^(\/problems\/(\d+))\/figures\//, '$1/solution/figures/'));
  tries.push(p.replace(/^\/problems\/(\d+)\//, (m, n) => `/problems/${Number(n) - 1}/`)); // 1-based problem index
  for (const t of tries) if (t !== path && resolves(t)) return t;
  return path;
}
// A checker sometimes quotes the right sentence under the wrong problem's path. When the
// addressed field shares almost nothing with the fix and exactly one other prose field of
// the paper shares most of it, the fix belongs there.
const PROSE_PATH = /\/(statement|caption|title)$/;
export function repointByContent(candidate, path, fix) {
  if (typeof fix !== 'string' || fix.trim().length < 20) return path;
  const b = words(fix);
  if (b.size < 4) return path;
  const score = s => { if (typeof s !== 'string') return 0; const a = words(s); if (!a.size) return 0; const shared = [...b].filter(w => a.has(w)).length; return shared / b.size; };
  const current = candidate && path.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), candidate);
  const own = score(current);
  const hits = [];
  const walk = (v, p) => { if (typeof v === 'string') { if (PROSE_PATH.test(p) && !/\/tx\b/.test(p) && p !== path) { const s = score(v); if (s >= 0.6) hits.push({ p, s }); } } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}/${k}`); };
  walk(candidate, '');
  hits.sort((a, b) => b.s - a.s);
  // the addressed field shares little with the fix and exactly one other field shares most of it; or —
  // neighbouring parts about the same thing (D.1/D.2 of one problem) share plenty — one other field is
  // nearly the fix itself while the addressed one is clearly not (an off-by-one part index)
  if (own < 0.3) return hits.length === 1 ? hits[0].p : path;
  if (hits.length && hits[0].s >= 0.85 && hits[0].s >= own + 0.3 && (hits.length === 1 || hits[1].s < own)) return hits[0].p;
  return path;
}
// A model asked for one field sometimes answers with the whole problem: a statement that
// now contains its parts, a part that contains its neighbours. Such a fix duplicates text
// that lives in sibling fields and is refused (the current value is the reference: text the
// field already shared with a sibling is not new duplication).
const opening = (s, n = 6) => String(s || '').replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, ' ').toLowerCase().replace(/^\s*[а-яa-z0-9]{1,3}[).]\s*/u, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, n).join(' ');
export function duplicatesSiblings(candidate, path, value, current) {
  const m = /^\/problems\/(\d+)\/(statement|parts\/(\d+)\/statement|solution\/statement)$/.exec(String(path));
  if (!m || typeof value !== 'string') return null;
  const pr = candidate?.problems?.[Number(m[1])];
  if (!pr) return null;
  const siblings = [], base = `/problems/${m[1]}`;
  if (m[2] !== 'statement') siblings.push({ what: 'the statement', text: pr.statement, path: `${base}/statement` });
  (pr.parts || []).forEach((x, j) => { if (!(m[3] != null && Number(m[3]) === j)) siblings.push({ what: `part ${x.label || j + 1}`, text: x.statement, path: `${base}/parts/${j}/statement` }); });
  if (m[2] !== 'solution/statement' && pr.solution?.statement) siblings.push({ what: 'the solution', text: pr.solution.statement, path: `${base}/solution/statement` });
  const flat = s => opening(s, 1000);
  const v = flat(value), cur = flat(current);
  for (const s of siblings) {
    const head = opening(s.text);
    if (head.split(' ').length < 5) continue;
    if (v.includes(head) && !cur.includes(head)) return { what: s.what, path: s.path };
  }
  return null;
}
export function plausibleReplacement(current, fix, kind, path = '') {
  if (typeof fix !== 'string' || typeof current !== 'string') return true;
  if (looksLikeInstruction(fix) || looksLikeJson(fix)) return false;
  if (/\(truncated\)\s*$/.test(fix) || /…\(truncated\)/.test(fix)) return false; // an echo of a clipped prompt value
  if (/\/label$/.test(path) && fix.trim().length <= 6) return true; // a label is a few characters; the current value may be a leaked instruction
  if (current.length < 40 || (current.length < 400 && looksLikeInstruction(current))) return true; // anything printed beats a stub or an earlier bad paste
  // a fix that is the leading part of the current text trims pasted trailing content, but only when what it
  // drops is a paste (it opens like a sibling field or a problem heading) — otherwise it is a truncation
  const flat = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  if (kind !== 'omission' && fix.length >= 40 && !/(…|\.\.\.)\s*\(truncated\)\s*$/.test(fix) && flat(current).startsWith(flat(fix))) {
    const dropped = flat(current).slice(flat(fix).length);
    if (/^\s*(задача|problem|question|task|aufgabe|probl[eè]me)\s*\d+/i.test(dropped)) return true;
    return false;
  }
  const a = words(current), b = words(fix);
  if (!a.size) return true;
  const shared = [...a].filter(w => b.has(w)).length;
  if (kind === 'omission') return fix.length > current.length && shared / a.size >= 0.6;
  return shared / (a.size + b.size - shared) >= 0.3;
}

// Checkers quote the sentence they object to, not the whole field: "Print reads
// 'в точка А'; candidate has 'в тчка А'" with the corrected sentence as the fix.
// Replacing the whole solution with that sentence (what a plain replacement does)
// throws the rest of the solution away, and the next checker asks for it back —
// the loop ping-pongs until its rounds run out. When a fix is a fragment of the
// field, splice it over the passage it corrects: anchor on its first words, end
// at its last words or, when those hold the typo, at the nearest sentence end.
export function spliceFragment(current, fix) {
  if (typeof current !== 'string' || typeof fix !== 'string') return null;
  const f = fix.trim().replace(/(\s*(…|\.\.\.))+$/, '').trim(); // checkers truncate their quotes with an ellipsis
  if (f.length < 8 || f.length >= 0.7 * current.length) return null;
  const words = f.split(/\s+/);
  if (words.length < 3) return null;
  let i = current.indexOf(words.slice(0, Math.min(4, words.length)).join(' '));
  if (i < 0 && words.length >= 4) i = current.indexOf(words.slice(0, 3).join(' '));
  if (i < 0 && words.length >= 4) {
    // the typo is in the first word: anchor on the next words and start one word earlier
    const k = current.indexOf(words.slice(1, Math.min(5, words.length)).join(' '));
    if (k > 0) { const before = current.slice(0, k).replace(/\s+$/, ''); i = Math.max(0, before.search(/\S+$/)); if (i < 0 || k - i > 40) i = -1; }
  }
  if (i < 0) return null;
  const tail = words.slice(-3).join(' ');
  const j = current.indexOf(tail, i);
  let end;
  if (j >= 0 && j - i <= f.length * 1.5) end = j + tail.length;
  else {
    // the last words hold the typo: replace the same number of words from the anchor on
    const m = new RegExp(`^(?:\\S+\\s+){${words.length - 1}}\\S+`).exec(current.slice(i));
    if (!m) return null;
    end = i + m[0].length;
  }
  const old = current.slice(i, end);
  // punctuation glued to the last replaced word stays when the fix does not carry its own
  const trail = (old.trim().match(/[.,;:!?)»“”]+$/) || [''])[0];
  const keep = trail && !/[.,;:!?)»“”]$/.test(f) ? trail : '';
  if (old.trim() === f) return null;
  return current.slice(0, i) + f + keep + current.slice(end);
}

// A solutions-only reader window sometimes "finds" a problem's statement on its pages and pastes the
// solution's narrative; the checker sees it, the refix answers "" (the printed problem is only its parts).
// "" is accepted for /problems/N/statement only when the problem has parts, the statement opens like the
// problem's own solution, and — when the problems document's text layer is at hand — that text is not
// printed there (a statement the solutions merely reprint is printed in the problems document too).
export function pastedSolutionStatement(candidate, path, current, problemsText = null) {
  const m = /^\/problems\/(\d+)\/statement$/.exec(String(path));
  if (!m) return false;
  const pr = candidate?.problems?.[Number(m[1])];
  if (!pr || !(pr.parts || []).length || !pr.solution?.statement) return false;
  const head = opening(current, 8);
  if (head.split(' ').length < 6 || !opening(pr.solution.statement, 100000).includes(head)) return false;
  if (typeof problemsText === 'string' && problemsText.trim()) {
    const printed = new Set(problemsText.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4));
    const ws = [...new Set(opening(current, 100000).split(' ').filter(w => w.length >= 4))];
    if (ws.length >= 10 && ws.filter(w => printed.has(w)).length >= 0.6 * ws.length) return false;
  }
  return true;
}
export function applyFixes(candidate, fixes, { defects, round = 1, by = 'refix', requestId = null, problemsText = null } = {}) {
  const byPath = new Map();
  for (const f of Array.isArray(fixes) ? fixes : []) if (f && typeof f.path === 'string') byPath.set(f.path, f);
  const applied = [], skipped = [], removals = [];
  const touched = new Set();
  const original = JSON.parse(JSON.stringify(candidate)); // duplication is judged against the state before this batch (the second half of a swap sees the first already applied)
  // A passage in the wrong field takes two changes: the listed field and the destination. The refix
  // returns the destination as an extra entry; it is taken along when it is a prose field of a problem
  // that has a listed defect (never a field of an untouched problem).
  const PROSE = /^\/problems\/(\d+)\/(statement|parts\/\d+\/statement|solution\/statement)$/;
  const listed = new Set((defects || []).map(d => d.path)), problemsListed = new Set((defects || []).map(d => (/^\/problems\/(\d+)/.exec(String(d.path)) || [])[1]).filter(Boolean));
  const extras = [...byPath.values()].filter(f => !listed.has(f.path) && PROSE.test(f.path) && problemsListed.has(PROSE.exec(f.path)[1]) && typeof f.value === 'string' && f.value.trim())
    .map(f => ({ path: f.path, kind: 'other', severity: 'minor', description: 'destination field returned alongside a listed defect (moved text)', extra: true }));
  for (const d of [...(defects || []), ...extras]) {
    const entry = { path: d.path, kind: d.kind, severity: d.severity, description: d.description };
    const f = byPath.get(d.path);
    if (!f) { skipped.push({ ...entry, reason: 'model returned no fix for this path' }); continue; }
    if (f.value == null && d.region) {
      // asked whether a printed region is a figure, the model looked and did not add one: not a figure
      candidate.tx = { ...(candidate.tx || {}), notFigures: [...(candidate.tx?.notFigures || []), { ...d.region, note: `unsettled: ${String(f.note || '').slice(0, 180)}` }] };
      applied.push({ ...entry, from: null, to: null, notFigure: d.region, note: f.note || null });
      continue;
    }
    // null for points means "nothing printed": the invented number goes (the prompt says so); elsewhere null is unsettled
    if (f.value === null && /\/(points|totalPoints)$/.test(String(d.path)) && typeof pointerGet(candidate, String(d.path)) === 'number') {
      const parent = pointerGet(candidate, String(d.path).replace(/\/[^/]+$/, '')); const key = String(d.path).split('/').at(-1);
      if (parent && typeof parent === 'object') { const from = parent[key]; delete parent[key]; applied.push({ ...entry, from, to: null, removed: true, note: f.note || null }); continue; }
    }
    if (f.value == null) { skipped.push({ ...entry, reason: `model could not settle it: ${String(f.note || '').slice(0, 200)}` }); continue; }
    let p = String(d.path);
    if (!p.startsWith('/')) { skipped.push({ ...entry, reason: 'path is not a JSON pointer' }); continue; }
    const figMatch = /^(.*\/figures\/\d+)(?:\/tx(?:\/bbox)?)?$/.exec(p);
    if (figMatch && (d.kind === 'figure' || /bbox$/.test(p) || parseBox(f.value) || f.value?.remove === true)) {
      const fig = pointerGet(candidate, figMatch[1]);
      if (!fig || typeof fig !== 'object') { skipped.push({ ...entry, reason: 'figure path unknown' }); continue; }
      // {"remove": true}: a decorative element or a duplicate that should not be a figure
      if (f.value && typeof f.value === 'object' && f.value.remove === true) {
        const arrPath = figMatch[1].replace(/\/\d+$/, ''), idx = Number(figMatch[1].match(/(\d+)$/)[1]);
        const arr = pointerGet(candidate, arrPath);
        if (!Array.isArray(arr)) { skipped.push({ ...entry, reason: 'figure list unknown' }); continue; }
        arr.splice(idx, 1);
        applied.push({ ...entry, from: fig.id || null, to: null, removed: true, note: f.note || null });
        continue;
      }
      const box = parseBox(f.value);
      if (!box) { skipped.push({ ...entry, reason: 'fix is not a 4-number box' }); continue; }
      const from = fig.tx?.bbox ?? null;
      // an object fix may also move the figure to another document/page and correct its caption/alt
      const o = f.value && typeof f.value === 'object' && !Array.isArray(f.value) ? f.value : null;
      const tx = o?.tx && typeof o.tx === 'object' ? o.tx : o || {};
      fig.tx = { ...(fig.tx || {}), ...(['problems', 'solutions'].includes(tx.document) ? { document: tx.document } : {}), ...(Number.isInteger(tx.page) && tx.page > 0 ? { page: tx.page } : {}), bbox: box, boxFrom: 'refix' }; // a judged box: snap.mjs leaves it alone
      if (o) for (const k of ['caption', 'alt']) if (typeof o[k] === 'string' && o[k]) fig[k] = o[k];
      touched.add(figMatch[1]);
      applied.push({ ...entry, from, to: box, ...(o?.tx ? { moved: `${fig.tx.document} p.${fig.tx.page}` } : {}), note: f.note || null });
      continue;
    }
    let current = pointerGet(candidate, p);
    // a checker that names the solution or a part (an object) and a refix that answers its text mean the
    // object's statement: the fix goes there
    if (typeof f.value === 'string' && current && typeof current === 'object' && !Array.isArray(current) && typeof current.statement === 'string' && !/\/figures\/\d+$/.test(p)) { p = `${p}/statement`; current = current.statement; }
    const sameShape = (a, b) => (Array.isArray(a) && Array.isArray(b)) || (typeof a === 'object' && a !== null && !Array.isArray(a) && typeof b === 'object' && b !== null && !Array.isArray(b));
    // A printed-graphic defect answered with a figures array that still covers no part of the
    // region (the same array, [], or an array changed elsewhere) means "not a figure": remember
    // the region so figures.mjs never raises it again, whatever else happens to the array.
    if (d.region && Array.isArray(f.value)) {
      const box = d.region.bbox;
      const covers = f.value.some(g => { const b = g?.tx?.bbox; if (!Array.isArray(b) || b.length !== 4) return false; const x0 = Math.max(b[0], box[0]), y0 = Math.max(b[1], box[1]), x1 = Math.min(b[2], box[2]), y1 = Math.min(b[3], box[3]); const i = x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0; return i >= 0.3 * Math.max(1, (box[2] - box[0]) * (box[3] - box[1])); });
      if (!covers) {
        candidate.tx = { ...(candidate.tx || {}), notFigures: [...(candidate.tx?.notFigures || []), { ...d.region, note: String(f.note || '').slice(0, 200) }] };
        if (current === undefined || JSON.stringify(current) === JSON.stringify(f.value)) { applied.push({ ...entry, from: null, to: null, notFigure: d.region, note: f.note || null }); continue; }
      }
    }
    // {"remove": true} on a problem or a part the paper does not print as such (a sub-task listed as a
    // problem of its own, a duplicate): applied after every other fix, highest index first, so the
    // paths of the fixes in this batch stay valid; the entries after it move up (numbers, ids follow)
    // (a checker often addresses the duplicate entry by its statement: the removal is of the entry, when the defect says so)
    const rm = /^(\/problems\/\d+(?:\/parts\/\d+)?)(\/statement)?$/.exec(p);
    if (f.value && typeof f.value === 'object' && f.value.remove === true && rm && (!rm[2] || /duplicat|invent|extra|not printed|does not exist|should not exist|no such|remove|дублир|измислен|излиш|няма такава|премахн/i.test(String(d.description || '')))) {
      const target = pointerGet(candidate, rm[1]);
      if (!target || typeof target !== 'object') { skipped.push({ ...entry, reason: 'no such entry to remove' }); continue; }
      removals.push({ entry, p: rm[1], note: f.note || null });
      continue;
    }
    if (typeof current === 'boolean' && typeof f.value === 'string' && /^(true|false)$/i.test(f.value.trim())) f.value = f.value.trim().toLowerCase() === 'true';
    if (typeof current === 'boolean' && typeof f.value === 'boolean') {
      if (current === f.value) { skipped.push({ ...entry, reason: 'model returned the current value unchanged' }); continue; }
      // a solution with no text is incomplete by definition (ipho-2023-experiment-q4: flipped to false, then invalid)
      if (p.endsWith('/incomplete') && f.value === false) { const sol = pointerGet(candidate, p.replace(/\/[^/]+$/, '')); if (sol && !String(sol.statement || '').trim()) { skipped.push({ ...entry, reason: 'a solution without text stays incomplete' }); continue; } }
      pointerSet(candidate, p, f.value);
      if (p.endsWith('/incomplete') && f.value === false) { const parent = pointerGet(candidate, p.replace(/\/[^/]+$/, '')); if (parent && typeof parent === 'object') delete parent.incompleteReason; }
      applied.push({ ...entry, from: current, to: f.value, note: f.note || null });
      continue;
    }
    // An omitted field (a whole solution the reader skipped) is missing, not
    // wrong: create it, and any missing object on the way, as long as no array
    // element has to be invented (a missing problem/part is not a field fix).
    // an unprinted caption/alt is dropped when the model answers ""; so is a problem statement that is
    // a copy of the problem's own solution when the printed problem is only its parts
    if (typeof current === 'string' && f.value === '' && (/\/(caption|alt|title)$/.test(p) || pastedSolutionStatement(candidate, p, current, problemsText))) {
      const parent = pointerGet(candidate, p.replace(/\/[^/]+$/, ''));
      if (parent && typeof parent === 'object') { delete parent[p.split('/').at(-1)]; applied.push({ ...entry, from: current, to: null, removed: true, note: f.note || null }); continue; }
    }
    if (current === undefined && (typeof f.value === 'string' || Array.isArray(f.value) || sameShape({}, f.value))) {
      const keys = p.split('/').filter(Boolean);
      let o = candidate, ok = true;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i], next = keys[i + 1];
        // a figures array may not conjure up a solution object around itself (a solution needs its text)
        if (o[k] === undefined) { if (/^\d+$/.test(k) || /^\d+$/.test(next) || (k === 'solution' && Array.isArray(f.value))) { ok = false; break; } o[k] = {}; }
        o = o[k];
        if (o === null || typeof o !== 'object') { ok = false; break; }
      }
      if (!ok) { skipped.push({ ...entry, reason: 'field is missing and its parent cannot be created (array element or absent solution)' }); continue; }
      pointerSet(candidate, p, f.value);
      applied.push({ ...entry, from: null, to: f.value, note: f.note || null, created: true });
      continue;
    }
    if (typeof current === 'string' && typeof f.value === 'string') {
      // an echo of a clipped prompt value ("…(truncated)") would cut the field
      if (/\(truncated\)\s*$/.test(f.value) || /…\(truncated\)/.test(f.value)) { skipped.push({ ...entry, reason: 'fix carries a truncation marker (an echo of the clipped prompt value)' }); continue; }
      if (current === f.value) {
        // the refix model, pages in hand, stands by the current text: the defect is disputed between two
        // model readings; run.mjs demotes a disputed *minor* model defect so it cannot park the paper
        candidate.tx = { ...(candidate.tx || {}), disputed: [...(candidate.tx?.disputed || []).filter(x => x.path !== p), { path: p, kind: d.kind, severity: d.severity, round, note: String(f.note || '').slice(0, 300) }] };
        skipped.push({ ...entry, reason: 'model returned the current value unchanged (disputed)' }); continue;
      }
      if (looksLikeInstruction(f.value)) { skipped.push({ ...entry, reason: 'fix is an instruction, not a replacement' }); continue; }
      if (looksLikeJson(f.value)) { skipped.push({ ...entry, reason: 'fix is JSON, not the text of the field' }); continue; }
      // text that lives in a sibling field is a paste — unless this batch also rewrites that sibling to
      // something else: then the passage is being moved (a swapped header and first part, an intro
      // that sat in part a), and both fields change together
      const dup = duplicatesSiblings(original, p, f.value, pointerGet(original, p));
      const sib = dup && byPath.get(dup.path)?.value;
      const moved = dup && ((typeof sib === 'string' && sib.trim() !== String(pointerGet(original, dup.path) || '').trim()) || (sib && typeof sib === 'object' && sib.remove === true) || byPath.get(dup.path.replace(/\/statement$/, ''))?.value?.remove === true);
      if (dup && !moved) { skipped.push({ ...entry, reason: `fix pastes the text of ${dup.what} into this field` }); continue; }
      if (dup && moved) { pointerSet(candidate, p, f.value); applied.push({ ...entry, from: current, to: f.value, movedFrom: dup.path, note: f.note || null }); continue; } // the text is printed (it sat in the sibling); resemblance to the old value is not expected
      const spliced = spliceFragment(current, f.value);
      if (spliced) { pointerSet(candidate, p, spliced); applied.push({ ...entry, from: current, to: spliced, spliced: f.value, note: f.note || null }); continue; }
      if (!plausibleReplacement(current, f.value, d.kind, p)) { skipped.push({ ...entry, reason: 'fix is an instruction or does not resemble the field it replaces (wrong path?)' }); continue; }
      pointerSet(candidate, p, f.value);
      applied.push({ ...entry, from: current, to: f.value, note: f.note || null });
      continue;
    }
    if (typeof current === 'number' || (current == null && /\/(points|totalPoints|timeLimitMin)$/.test(p))) {
      const n = typeof f.value === 'number' ? f.value : Number(String(f.value).replace(',', '.'));
      if (!Number.isFinite(n)) { skipped.push({ ...entry, reason: 'fix is not a number' }); continue; }
      pointerSet(candidate, p, n);
      applied.push({ ...entry, from: current ?? null, to: n, note: f.note || null });
      continue;
    }
    if (sameShape(current, f.value)) {
      pointerSet(candidate, p, f.value);
      applied.push({ ...entry, from: current, to: f.value, note: f.note || null });
      continue;
    }
    skipped.push({ ...entry, reason: `cannot apply a ${Array.isArray(f.value) ? 'array' : typeof f.value} fix to a ${current === undefined ? 'missing' : Array.isArray(current) ? 'array' : typeof current} field` });
  }
  // a solution left without text is incomplete by definition, whatever a fix said about its flag
  for (const pr of candidate.problems || []) { const s = pr.solution; if (s && typeof s === 'object' && !String(s.statement || '').trim() && !s.incomplete && !(s.figures || []).length) { s.incomplete = true; s.incompleteReason = s.incompleteReason || 'no solution text'; } }
  for (const r of removals.sort((a, b) => b.p.localeCompare(a.p, undefined, { numeric: true }))) {
    const arrPath = r.p.replace(/\/\d+$/, ''), idx = Number(r.p.split('/').at(-1));
    const arr = pointerGet(candidate, arrPath);
    if (!Array.isArray(arr) || !arr[idx]) { skipped.push({ ...r.entry, reason: 'no such entry to remove' }); continue; }
    const [gone] = arr.splice(idx, 1);
    if (arrPath === '/problems') arr.forEach((pr, i) => {
      if (Number.isInteger(pr.number)) pr.number = i + 1;
      if (typeof pr.id === 'string' && /-p\d+$/.test(pr.id)) pr.id = pr.id.replace(/-p\d+$/, `-p${i + 1}`);
      for (const list of [pr.figures, pr.solution?.figures, ...(pr.parts || []).map(pt => pt.figures)]) for (const fig of list || []) if (typeof fig?.id === 'string') fig.id = fig.id.replace(/^p\d+-/, `p${i + 1}-`);
    });
    applied.push({ ...r.entry, from: gone.id || gone.label || null, to: null, removed: true, note: r.note });
  }
  // a changed box invalidates the crop, upload and public-URL evidence of that figure
  for (const { fig, path: p } of allFigures(candidate)) {
    if (!touched.has(p)) continue;
    delete fig.url; delete fig.width; delete fig.height; delete fig.source;
    fig.tx = { document: fig.tx.document, page: fig.tx.page, bbox: fig.tx.bbox, ...(fig.tx.boxFrom ? { boxFrom: fig.tx.boxFrom } : {}) };
  }
  candidate.tx = { ...(candidate.tx || {}), repairs: [...(candidate.tx?.repairs || []), ...applied.map(a => ({ round, at: nowIso(), by, requestId, ...a }))] };
  return { applied, skipped, figuresToRedo: [...touched] };
}
