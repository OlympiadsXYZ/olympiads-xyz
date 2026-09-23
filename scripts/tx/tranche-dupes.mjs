// Duplicate check for a tranche: prepare each paper (keys from the queue file), then compare the 5-word shingles of
// its problems text against every published paper, every other prepared text in tmp/tx, and each other.
// usage: node dupes2.mjs <queue.json> <args.json with papers[]> [--no-prepare]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib.mjs';
const [queueFile, argsFile] = process.argv.slice(2);
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, queueFile), 'utf8')).papers;
const ids = JSON.parse(fs.readFileSync(argsFile, 'utf8')).papers.map(p => p.id);
if (!process.argv.includes('--no-prepare')) for (const id of ids) {
  const q = queue.find(p => p.id === id);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/tx/prepare.mjs'), id, '--problems', q.problemsKey, ...(q.solutionsKey ? ['--solutions', q.solutionsKey] : [])], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) console.log(`prepare FAILED ${id}: ${(r.stderr || '').trim().split('\n').pop()}`);
}
const words = s => (s.normalize('NFC').toLowerCase().match(/\p{L}[\p{L}\p{M}]*|\d+/gu) || []);
const shingles = s => { const w = words(s); const set = new Set(); for (let i = 0; i + 5 <= w.length; i++) set.add(w.slice(i, i + 5).join(' ')); return set; };
const strings = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach(x => strings(x, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== 'tx') strings(v, out); return out; };
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : p.endsWith('.json') && !p.endsWith('schema.json') && o.push(p); } return o; };
const corpus = [];
for (const f of walk(path.join(ROOT, 'content/problems'))) { try { corpus.push({ id: path.basename(f, '.json'), kind: 'live', set: shingles(strings(JSON.parse(fs.readFileSync(f, 'utf8'))).join(' ')) }); } catch {} }
const live = new Set(corpus.map(c => c.id));
const tx = path.join(ROOT, 'tmp/tx');
const textOf = id => { const f = path.join(tx, id, 'text', 'problems.txt'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
for (const id of fs.readdirSync(tx)) { if (live.has(id) || /superseded/.test(id)) continue; const t = textOf(id); if (t) corpus.push({ id, kind: ids.includes(id) ? 'tranche' : 'pending', set: shingles(t) }); }
let flagged = 0;
for (const id of ids) {
  const t = textOf(id);
  if (!t) { console.log(`${id.padEnd(50)} NO TEXT`); continue; }
  const A = shingles(t);
  if (A.size < 20) continue;
  const hits = [];
  for (const c of corpus) { if (c.id === id || !c.set.size) continue; let n = 0; for (const s of A) if (c.set.has(s)) n++; const v = n / A.size; if (v >= 0.5) hits.push([c.kind + ':' + c.id, v]); }
  if (hits.length) { flagged++; console.log(`${id.padEnd(50)} ${String(A.size).padStart(5)} ${hits.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')}`); }
}
console.log(`${flagged} of ${ids.length} overlap another text by 50% or more`);
