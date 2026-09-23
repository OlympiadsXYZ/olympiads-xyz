// D-P28: under a mechanical receipt an agreement error stays as printed. For each paper: restore the printed span of
// every kind:"agreement" edit in its field (exactly one occurrence of the fixed span, else the paper is skipped), move the
// record from tx.edits to tx.notes, write candidates/agent__opus-5-5.dp28.json. Prints the ids ready for run.mjs --retry.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
const jobs = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/tx/jobs.json'), 'utf8')).jobs;
const ready = [];
for (const id of process.argv.slice(2)) {
  const job = jobs[id];
  if (!job?.artefacts?.candidate) { console.log(`${id}: no job/candidate`); continue; }
  const src = path.join(ROOT, job.artefacts.candidate.split(String.fromCharCode(92)).join('/'));
  const c = JSON.parse(fs.readFileSync(src, 'utf8'));
  const edits = Array.isArray(c.tx?.edits) ? c.tx.edits : [];
  const agr = edits.filter(e => e && e.kind === 'agreement');
  if (!agr.length) { console.log(`${id}: no agreement edits`); continue; }
  let ok = true; const notes = [];
  for (const e of agr) {
    const keys = String(e.path).split('/').slice(1).map(k => (/^\d+$/.test(k) ? Number(k) : k));
    let parent = c; for (const k of keys.slice(0, -1)) parent = parent?.[k];
    const last = keys.at(-1), value = parent?.[last];
    if (typeof value !== 'string') { ok = false; console.log(`${id}: ${e.path} is not a string field`); break; }
    const n = value.split(e.fixed).length - 1;
    if (value.includes(e.printed) && n === 0) { notes.push(e); continue; } // already printed
    if (n !== 1) { ok = false; console.log(`${id}: „${e.fixed}“ occurs ${n}× in ${e.path}; left for a person`); break; }
    parent[last] = value.replace(e.fixed, e.printed);
    notes.push(e);
  }
  if (!ok) continue;
  c.tx.edits = edits.filter(e => !(e && e.kind === 'agreement'));
  const lines = notes.map(e => `D-P28: agreement error kept as printed (${e.document} p.${e.page}): „${e.printed}“ (reads as „${e.fixed}“); the mechanical receipt cannot verify an agreement fix.`);
  c.tx.notes = Array.isArray(c.tx.notes) ? [...c.tx.notes, ...lines] : [c.tx.notes, ...lines].filter(Boolean).join('\n');
  const out = path.join(ROOT, 'tmp/tx', id, 'candidates', 'agent__opus-5-5.dp28.json');
  fs.writeFileSync(out, JSON.stringify(c, null, 2) + '\n');
  console.log(`${id}: ${notes.length} agreement edit(s) restored to print`);
  ready.push(id);
}
console.log(`READY ${ready.join(' ')}`);
