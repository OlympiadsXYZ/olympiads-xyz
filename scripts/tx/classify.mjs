#!/usr/bin/env node
// classify.mjs [--workers 6] [--langs a,b] [--limit N]
// Free pass over the catalogue backlog: prepare.mjs (download, render, text layer — no model call) for every
// paper not yet prepared, then classify each by its text layer: `native` when the problems document carries
// real text (≥ 200 characters per page on average), `scan` otherwise. Writes tmp/tx/classify.json
// {at, papers: {<id>: {pages, chars, charsPerPage, native, lang, subject, competition, solutions}}}
// and prints a summary. Re-runnable: prepared papers are only re-read from their manifest.
// Why: the mechanical text-layer check (the free half of verification) only works on native PDFs; scans need a
// model check every round and are the papers that park (D-P22, §12j) — the runs should take natives first.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs, readJson, writeJson, ROOT, paperDir, nowIso } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const workers = Number(args.workers || 6);
const out = path.join(ROOT, 'tmp', 'tx', 'classify.json');
const state = readJson(out, { at: null, papers: {} });

const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'tx', 'backlog.mjs'), '--json', '--catalogue'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
let entries = JSON.parse(r.stdout).filter(e => e.paperId);
if (args.langs) { const want = new Set(String(args.langs).split(',')); entries = entries.filter(e => want.has(e.lang)); }
const seen = new Set(); entries = entries.filter(e => !seen.has(e.paperId) && seen.add(e.paperId));
if (args.limit) entries = entries.slice(0, Number(args.limit));

function classify(e) {
  const man = readJson(path.join(paperDir(e.paperId), 'manifest.json'), null);
  if (!man?.documents?.problems) return null;
  const docs = man.documents;
  const chars = d => { try { return fs.readFileSync(path.join(paperDir(e.paperId), d.text), 'utf8').replace(/\s+/g, '').length; } catch { return 0; } };
  const pChars = docs.problems.text ? chars(docs.problems) : 0;
  const pages = (docs.problems.pages || 0) + (docs.solutions?.pages || 0);
  const cpp = docs.problems.pages ? pChars / docs.problems.pages : 0;
  return { pages, problemPages: docs.problems.pages || 0, chars: pChars, charsPerPage: Math.round(cpp), native: cpp >= 200, solutions: !!docs.solutions, lang: e.lang, subject: e.subject, competition: e.competition };
}

const todo = entries.filter(e => !classify(e));
console.log(`${entries.length} backlog paper(s); ${entries.length - todo.length} already prepared, ${todo.length} to prepare with ${workers} worker(s)`);
let next = 0, done = 0, failed = 0;
const started = Date.now();
await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, async () => {
  while (next < todo.length) {
    const e = todo[next++];
    await new Promise(resolve => {
      const argv = [path.join(ROOT, 'scripts', 'tx', 'prepare.mjs'), e.paperId, '--problems', e.problemsKey, ...(e.solutionsKey ? ['--solutions', e.solutionsKey] : [])];
      const child = spawn(process.execPath, argv, { cwd: ROOT, env: { ...process.env, PYTHONUTF8: '1' } });
      let err = '';
      child.stderr.on('data', d => { err += d; });
      child.on('close', code => {
        if (code === 0) done++; else { failed++; state.papers[e.paperId] = { error: err.trim().split('\n').slice(-1)[0].slice(0, 200), lang: e.lang, subject: e.subject, competition: e.competition }; }
        if ((done + failed) % 25 === 0) { for (const x of entries) { const c = classify(x); if (c) state.papers[x.paperId] = c; } state.at = nowIso(); writeJson(out, state); console.log(`${done + failed}/${todo.length} prepared (${failed} failed) in ${Math.round((Date.now() - started) / 60000)} min`); }
        resolve();
      });
    });
  }
}));
for (const e of entries) { const c = classify(e); if (c) state.papers[e.paperId] = c; }
state.at = nowIso(); writeJson(out, state);
const vals = entries.map(e => state.papers[e.paperId]).filter(Boolean);
const by = (k, f) => { const m = {}; for (const v of vals) { const key = v[k]; m[key] ||= { native: 0, scan: 0, err: 0, pages: 0 }; if (v.error) m[key].err++; else { m[key][v.native ? 'native' : 'scan']++; m[key].pages += v.pages; } } return m; };
console.log(JSON.stringify({ prepared: done, failed, total: vals.length, native: vals.filter(v => v.native).length, scan: vals.filter(v => v.native === false).length, errors: vals.filter(v => v.error).length, byLang: by('lang'), out: path.relative(ROOT, out) }, null, 2));
