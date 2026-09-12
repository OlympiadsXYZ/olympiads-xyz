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
  const m = v.match(/-?\d+(?:\.\d+)?/g);
  return m && m.length === 4 ? m.map(Number).map(Math.round) : null;
};

// Checkers sometimes answer with an instruction ("full text per pp. 2–3", "keep the
// intro paragraph", "remove this figure") instead of the replacement, and sometimes
// point a real fix at the wrong problem index. Pasting either corrupts the
// candidate. A replacement is applied only when it is text of the same kind as
// what it replaces: not an instruction, and sharing enough words with the current
// value (an omission fix must contain most of the current text and be longer).
const INSTRUCTION = /^\s*(keep|remove|delete|drop|full (solution )?text|see |split|repoint|use |replace|restore|move|add |insert|the (statement|solution|text)|пълен текст|виж|запази|премахни|добави|изтрий|замени|премести)\b/i;
export const looksLikeInstruction = s => typeof s === 'string' && (INSTRUCTION.test(s) || /\be\.g\.|\betc\.|\(approximate|\bshould\b|\bmust\b/i.test(s.slice(0, 200)));
const words = s => new Set(String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1));
export function plausibleReplacement(current, fix, kind) {
  if (typeof fix !== 'string' || typeof current !== 'string') return true;
  if (looksLikeInstruction(fix)) return false;
  if (current.length < 40 || looksLikeInstruction(current)) return true; // anything printed beats a stub or an earlier bad paste
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
  const f = fix.trim();
  if (f.length < 8 || f.length >= 0.7 * current.length) return null;
  const words = f.split(/\s+/);
  if (words.length < 3) return null;
  let i = current.indexOf(words.slice(0, Math.min(4, words.length)).join(' '));
  if (i < 0 && words.length >= 4) i = current.indexOf(words.slice(0, 3).join(' '));
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
      fig.tx = { ...(fig.tx || {}), ...(['problems', 'solutions'].includes(tx.document) ? { document: tx.document } : {}), ...(Number.isInteger(tx.page) && tx.page > 0 ? { page: tx.page } : {}), bbox: box };
      if (o) for (const k of ['caption', 'alt']) if (typeof o[k] === 'string' && o[k]) fig[k] = o[k];
      touched.add(figMatch[1]);
      applied.push({ ...entry, from, to: box, ...(o?.tx ? { moved: `${fig.tx.document} p.${fig.tx.page}` } : {}), note: f.note || null });
      continue;
    }
    const current = pointerGet(candidate, p);
    const sameShape = (a, b) => (Array.isArray(a) && Array.isArray(b)) || (typeof a === 'object' && a !== null && !Array.isArray(a) && typeof b === 'object' && b !== null && !Array.isArray(b));
    // An omitted field (a whole solution the reader skipped) is missing, not
    // wrong: create it, and any missing object on the way, as long as no array
    // element has to be invented (a missing problem/part is not a field fix).
    if (current === undefined && (typeof f.value === 'string' || sameShape({}, f.value))) {
      const keys = p.split('/').filter(Boolean);
      let o = candidate, ok = true;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i], next = keys[i + 1];
        if (o[k] === undefined) { if (/^\d+$/.test(k) || /^\d+$/.test(next)) { ok = false; break; } o[k] = {}; }
        o = o[k];
        if (o === null || typeof o !== 'object') { ok = false; break; }
      }
      if (!ok) { skipped.push({ ...entry, reason: 'field is missing and its parent cannot be created (array element)' }); continue; }
      pointerSet(candidate, p, f.value);
      applied.push({ ...entry, from: null, to: f.value, note: f.note || null, created: true });
      continue;
    }
    if (typeof current === 'string' && typeof f.value === 'string') {
      if (current === f.value) { skipped.push({ ...entry, reason: 'model returned the current value unchanged' }); continue; }
      if (looksLikeInstruction(f.value)) { skipped.push({ ...entry, reason: 'fix is an instruction, not a replacement' }); continue; }
      const spliced = spliceFragment(current, f.value);
      if (spliced) { pointerSet(candidate, p, spliced); applied.push({ ...entry, from: current, to: spliced, spliced: f.value, note: f.note || null }); continue; }
      if (!plausibleReplacement(current, f.value, d.kind)) { skipped.push({ ...entry, reason: 'fix is an instruction or does not resemble the field it replaces (wrong path?)' }); continue; }
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
    fig.tx = { document: fig.tx.document, page: fig.tx.page, bbox: fig.tx.bbox };
  }
  candidate.tx = { ...(candidate.tx || {}), repairs: [...(candidate.tx?.repairs || []), ...applied.map(a => ({ round, at: nowIso(), by, requestId, ...a }))] };
  return { applied, skipped, figuresToRedo: [...touched] };
}
