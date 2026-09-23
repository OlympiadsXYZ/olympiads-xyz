// Dedupe plan for a queue (D-P27): pairwise 5-word-shingle containment between the queue's remaining papers, the
// published papers and the other prepared texts. At >= 80% containment:
//   in a published paper                 -> hold (twin of a live paper)
//   mutual twins inside the queue        -> keep one (has solutions > shorter id), hold the other
//   A inside a larger B (B is a compilation of A and more) -> keep A, hold B
// Writes <out>.json {keep:[ids in queue order], hold:[{id, reason}]}.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
const [queueFile, idsFile, out] = process.argv.slice(2);
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, queueFile), 'utf8')).papers;
const byId = new Map(queue.map(p => [p.id, p]));
const ids = JSON.parse(fs.readFileSync(idsFile, 'utf8')).papers.map(p => p.id);
const T = 0.9, TWIN = 0.95, BIG = 1.8;
const words = s => (s.normalize('NFC').toLowerCase().match(/\p{L}[\p{L}\p{M}]*|\d+/gu) || []);
const shingles = s => { const w = words(s); const set = new Set(); for (let i = 0; i + 5 <= w.length; i++) set.add(w.slice(i, i + 5).join(' ')); return set; };
const strings = (o, acc = []) => { if (typeof o === 'string') acc.push(o); else if (Array.isArray(o)) o.forEach(x => strings(x, acc)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== 'tx') strings(v, acc); return acc; };
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : p.endsWith('.json') && !p.endsWith('schema.json') && o.push(p); } return o; };
const textOf = id => { const f = path.join(ROOT, 'tmp/tx', id, 'text', 'problems.txt'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
const live = walk(path.join(ROOT, 'content/problems')).map(f => { try { return { id: path.basename(f, '.json'), set: shingles(strings(JSON.parse(fs.readFileSync(f, 'utf8')).problems).join(' ')) }; } catch { return null; } }).filter(Boolean);
const Q = ids.map(id => ({ id, set: shingles(textOf(id) || '') })).filter(x => x.set.size >= 20);
const cont = (a, b) => { let n = 0; for (const s of a) if (b.has(s)) n++; return n / a.size; };
const hold = new Map();
for (const p of Q) for (const l of live) if (l.set.size && cont(p.set, l.set) >= T) { hold.set(p.id, `twin of published ${l.id} (${(cont(p.set, l.set) * 100).toFixed(0)}%)`); break; }
const pref = (a, b) => { // the paper to keep of two mutual twins
  const sa = !!byId.get(a.id)?.solutionsKey, sb = !!byId.get(b.id)?.solutionsKey;
  if (sa !== sb) return sa ? a : b;
  return a.id.length !== b.id.length ? (a.id.length < b.id.length ? a : b) : (a.id < b.id ? a : b);
};
for (let i = 0; i < Q.length; i++) for (let j = i + 1; j < Q.length; j++) {
  const a = Q[i], b = Q[j];
  if (hold.has(a.id) && hold.has(b.id)) continue;
  const ab = cont(a.set, b.set), ba = cont(b.set, a.set);
  if (ab < T && ba < T) continue;
  const big = (x, y) => y.set.size >= BIG * x.set.size; // y is a compilation of x and more
  if (ab >= TWIN && ba >= TWIN) { const k = pref(a, b), h = k === a ? b : a; if (!hold.has(h.id) && !hold.has(k.id)) hold.set(h.id, `twin of ${k.id} (${(Math.min(ab, ba) * 100).toFixed(0)}%), kept`); }
  else if (ab >= T && big(a, b)) { if (!hold.has(b.id)) hold.set(b.id, `compilation containing ${a.id} (${(ab * 100).toFixed(0)}%)`); }
  else if (ba >= T && big(b, a)) { if (!hold.has(a.id)) hold.set(a.id, `compilation containing ${b.id} (${(ba * 100).toFixed(0)}%)`); }
}
const keep = ids.filter(id => !hold.has(id));
fs.writeFileSync(out, JSON.stringify({ keep, hold: [...hold].map(([id, reason]) => ({ id, reason })) }, null, 1));
const kinds = {}; for (const r of hold.values()) { const k = r.split(' ')[0] + ' ' + r.split(' ')[1]; kinds[k] = (kinds[k] || 0) + 1; }
console.log(`keep ${keep.length}, hold ${hold.size}: ${JSON.stringify(kinds)}`);
