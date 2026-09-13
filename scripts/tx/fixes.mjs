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
const INSTRUCTION = /^\s*(keep|remove|delete|drop|full (solution )?text|see |split|repoint|use |replace|restore|move|add |insert|merge|set |the (statement|solution|text)|пълен текст|виж|запази|премахни|добави|изтрий|замени|премести|обедин|раздел|постав|върн|използва|коригира|поправ|махн|отстран)/i;
export const looksLikeInstruction = s => typeof s === 'string' && (INSTRUCTION.test(s) || /\be\.g\.|\betc\.|\(approximate|\bshould\b|\bmust\b/i.test(s.slice(0, 200)));
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
  if (score(current) >= 0.3) return path;
  const hits = [];
  const walk = (v, p) => { if (typeof v === 'string') { if (PROSE_PATH.test(p) && !/\/tx\b/.test(p)) { const s = score(v); if (s >= 0.6) hits.push({ p, s }); } } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}/${k}`); };
  walk(candidate, '');
  return hits.length === 1 ? hits[0].p : path;
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
  const siblings = [];
  if (m[2] !== 'statement') siblings.push({ what: 'the statement', text: pr.statement });
  (pr.parts || []).forEach((x, j) => { if (!(m[3] != null && Number(m[3]) === j)) siblings.push({ what: `part ${x.label || j + 1}`, text: x.statement }); });
  if (m[2] !== 'solution/statement' && pr.solution?.statement) siblings.push({ what: 'the solution', text: pr.solution.statement });
  const flat = s => opening(s, 1000);
  const v = flat(value), cur = flat(current);
  for (const s of siblings) {
    const head = opening(s.text);
    if (head.split(' ').length < 5) continue;
    if (v.includes(head) && !cur.includes(head)) return s.what;
  }
  return null;
}
export function plausibleReplacement(current, fix, kind, path = '') {
  if (typeof fix !== 'string' || typeof current !== 'string') return true;
  if (looksLikeInstruction(fix)) return false;
  if (/\/label$/.test(path) && fix.trim().length <= 6) return true; // a label is a few characters; the current value may be a leaked instruction
  if (current.length < 40 || looksLikeInstruction(current)) return true; // anything printed beats a stub or an earlier bad paste
  // a fix that is the leading part of the current text trims pasted trailing content (the next problem, a repeated part)
  const flat = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  if (kind !== 'omission' && fix.length >= 40 && flat(current).startsWith(flat(fix).slice(0, Math.min(flat(fix).length, 200)))) return true;
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

export function applyFixes(candidate, fixes, { defects, round = 1, by = 'refix', requestId = null } = {}) {
  const byPath = new Map();
  for (const f of Array.isArray(fixes) ? fixes : []) if (f && typeof f.path === 'string') byPath.set(f.path, f);
  const applied = [], skipped = [];
  const touched = new Set();
  for (const d of defects || []) {
    const entry = { path: d.path, kind: d.kind, severity: d.severity, description: d.description };
    const f = byPath.get(d.path);
    if (!f) { skipped.push({ ...entry, reason: 'model returned no fix for this path' }); continue; }
    if (f.value == null && d.region) {
      // asked whether a printed region is a figure, the model looked and did not add one: not a figure
      candidate.tx = { ...(candidate.tx || {}), notFigures: [...(candidate.tx?.notFigures || []), { ...d.region, note: `unsettled: ${String(f.note || '').slice(0, 180)}` }] };
      applied.push({ ...entry, from: null, to: null, notFigure: d.region, note: f.note || null });
      continue;
    }
    if (f.value == null) { skipped.push({ ...entry, reason: `model could not settle it: ${String(f.note || '').slice(0, 200)}` }); continue; }
    const p = String(d.path);
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
    const current = pointerGet(candidate, p);
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
    if (typeof current === 'boolean' && typeof f.value === 'boolean') {
      if (current === f.value) { skipped.push({ ...entry, reason: 'model returned the current value unchanged' }); continue; }
      pointerSet(candidate, p, f.value);
      if (p.endsWith('/incomplete') && f.value === false) { const parent = pointerGet(candidate, p.replace(/\/[^/]+$/, '')); if (parent && typeof parent === 'object') delete parent.incompleteReason; }
      applied.push({ ...entry, from: current, to: f.value, note: f.note || null });
      continue;
    }
    // An omitted field (a whole solution the reader skipped) is missing, not
    // wrong: create it, and any missing object on the way, as long as no array
    // element has to be invented (a missing problem/part is not a field fix).
    // an unprinted caption/alt is dropped when the model answers ""
    if (typeof current === 'string' && f.value === '' && /\/(caption|alt|title)$/.test(p)) {
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
      if (current === f.value) {
        // the refix model, pages in hand, stands by the current text: the defect is disputed between two
        // model readings; run.mjs demotes a disputed *minor* model defect so it cannot park the paper
        candidate.tx = { ...(candidate.tx || {}), disputed: [...(candidate.tx?.disputed || []).filter(x => x.path !== p), { path: p, kind: d.kind, severity: d.severity, round, note: String(f.note || '').slice(0, 300) }] };
        skipped.push({ ...entry, reason: 'model returned the current value unchanged (disputed)' }); continue;
      }
      if (looksLikeInstruction(f.value)) { skipped.push({ ...entry, reason: 'fix is an instruction, not a replacement' }); continue; }
      const dup = duplicatesSiblings(candidate, p, f.value, current);
      if (dup) { skipped.push({ ...entry, reason: `fix pastes the text of ${dup} into this field` }); continue; }
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
  // a changed box invalidates the crop, upload and public-URL evidence of that figure
  for (const { fig, path: p } of allFigures(candidate)) {
    if (!touched.has(p)) continue;
    delete fig.url; delete fig.width; delete fig.height; delete fig.source;
    fig.tx = { document: fig.tx.document, page: fig.tx.page, bbox: fig.tx.bbox, ...(fig.tx.boxFrom ? { boxFrom: fig.tx.boxFrom } : {}) };
  }
  candidate.tx = { ...(candidate.tx || {}), repairs: [...(candidate.tx?.repairs || []), ...applied.map(a => ({ round, at: nowIso(), by, requestId, ...a }))] };
  return { applied, skipped, figuresToRedo: [...touched] };
}
