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
  if (typeof v !== 'string') return null;
  const m = v.match(/-?\d+(?:\.\d+)?/g);
  return m && m.length === 4 ? m.map(Number).map(Math.round) : null;
};

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
    if (figMatch && (d.kind === 'figure' || /bbox$/.test(p) || parseBox(f.value))) {
      const box = parseBox(f.value);
      const fig = pointerGet(candidate, figMatch[1]);
      if (!box || !fig || typeof fig !== 'object') { skipped.push({ ...entry, reason: 'fix is not a 4-number box or the figure path is unknown' }); continue; }
      const from = fig.tx?.bbox ?? null;
      fig.tx = { ...(fig.tx || {}), bbox: box };
      touched.add(figMatch[1]);
      applied.push({ ...entry, from, to: box, note: f.note || null });
      continue;
    }
    const current = pointerGet(candidate, p);
    const sameShape = (a, b) => (Array.isArray(a) && Array.isArray(b)) || (typeof a === 'object' && a !== null && !Array.isArray(a) && typeof b === 'object' && b !== null && !Array.isArray(b));
    if (typeof current === 'string' && typeof f.value === 'string') {
      if (current === f.value) { skipped.push({ ...entry, reason: 'model returned the current value unchanged' }); continue; }
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
