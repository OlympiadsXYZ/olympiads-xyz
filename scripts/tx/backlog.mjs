#!/usr/bin/env node
// backlog.mjs [--json]
// Lists the Bulgarian backlog entries (tmp/shards/all.json) that are neither in content/problems
// nor in tmp/staging (matched by derived paper id or by archive key). Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { paperIdFor, existingPaperIndex, ROOT } from './lib.mjs';

const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/shards/all.json'), 'utf8'));
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
for (const row of all) {
  let id; try { id = paperIdFor(row); } catch { id = null; }
  const inLive = (id && live.byId.has(id)) || live.byKey.has(row.problemsKey);
  const inStaged = (id && staged.has(id)) || stagedKeys.has(row.problemsKey);
  if (!inLive && !inStaged) remaining.push({ paperId: id, competition: row.competition, year: row.year, round: row.round, grade: row.grade, problemsKey: row.problemsKey, solutionsKey: row.solutionsKey });
}
if (process.argv.includes('--json')) console.log(JSON.stringify(remaining, null, 1));
else { for (const r of remaining) console.log(`${r.paperId ?? '?'}\t${r.competition} ${r.year} ${r.round ?? ''} ${r.grade ?? ''}\t${r.problemsKey}`); console.error(`${remaining.length} backlog entries not in content/problems or tmp/staging (of ${all.length})`); }
