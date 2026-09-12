#!/usr/bin/env node
// batch.mjs --ids a,b,c | --backlog [--limit N] --reader p:m --checker p:m [--workers 2]
//   [--allow-same-model] [--no-promote] [--log tmp/tx/batch.log] [--max-rounds 2]
// Walks a list of papers through run.mjs, a few at a time, and keeps going when
// one fails: every outcome (exit code, final stage, receipt verdict, cost) is
// appended to the log as one JSON line. A paper with an unfinished job in
// tmp/tx/jobs.json is resumed with --continue; a paper already promoted (job
// state promoted, or present in content/problems) is skipped. Safe to re-run.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs, fail, readJson, JOBS_FILE, ROOT, nowIso, paperDir, findContentFile } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['backlog', 'allow-same-model', 'no-promote', 'dry-run'] });
if (!args.ids && !args.backlog) fail('usage: batch.mjs --ids a,b | --backlog [--limit N] --reader p:m --checker p:m [--workers 2] [--allow-same-model] [--no-promote]');
if (!args.reader || !args.checker) fail('--reader and --checker are required');
const workers = Number(args.workers || 2);
const logFile = path.resolve(args.log || path.join(ROOT, 'tmp', 'tx', 'batch.log'));
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = entry => fs.appendFileSync(logFile, JSON.stringify({ at: nowIso(), ...entry }) + '\n');

let ids = [];
if (args.ids) ids = String(args.ids).split(',').map(s => s.trim()).filter(Boolean);
if (args.backlog) {
  // backlog.mjs owns the rule (catalogue entries in neither content/problems nor tmp/staging) and derives the ids
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'tx', 'backlog.mjs'), '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`backlog.mjs failed: ${r.stderr}`);
  ids = JSON.parse(r.stdout).map(e => e.paperId).filter(Boolean);
  if (args.limit) ids = ids.slice(0, Number(args.limit));
}
ids = [...new Set(ids)];
if (!ids.length) fail('nothing to do');

const jobs = () => readJson(JOBS_FILE, { version: 2, jobs: {} }).jobs;
const plan = [];
for (const id of ids) {
  const job = jobs()[id];
  if (findContentFile(id)) { log({ paperId: id, outcome: 'skipped', reason: 'already in content/problems' }); continue; }
  if (job?.stage === 'promoted' || job?.stage === 'done') { log({ paperId: id, outcome: 'skipped', reason: `job already ${job.stage}` }); continue; }
  plan.push({ id, resume: !!job });
}
console.log(`${plan.length} paper(s) to run with ${workers} worker(s); log: ${path.relative(ROOT, logFile)}`);

function runOne({ id, resume }) {
  return new Promise(resolve => {
    const argv = [path.join(ROOT, 'scripts', 'tx', 'run.mjs'), id];
    if (resume) argv.push('--continue');
    else {
      argv.push('--reader', args.reader, '--checker', args.checker);
      if (args['allow-same-model']) argv.push('--allow-same-model');
      if (args['no-promote']) argv.push('--no-promote');
      if (args['dry-run']) argv.push('--dry-run');
      if (args['max-rounds']) argv.push('--max-rounds', String(args['max-rounds']));
      if (args['window-pages']) argv.push('--window-pages', String(args['window-pages']));
    }
    const started = Date.now();
    const child = spawn(process.execPath, argv, { cwd: ROOT, env: process.env });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      const job = jobs()[id] || null;
      const receipt = readJson(path.join(paperDir(id), 'receipt.json'), null);
      const entry = {
        paperId: id, outcome: code === 0 ? (job?.stage === 'promoted' ? 'promoted' : 'finished') : code === 2 ? 'waiting-for-agent' : code === 3 ? 'escalated' : 'error',
        exit: code, stage: job?.stage || null, round: job?.round ?? null, receipt: receipt?.verdict || null,
        blockers: receipt?.blockers?.slice(0, 3) || [], seconds: Math.round((Date.now() - started) / 1000),
        tail: (err || out).trim().split('\n').slice(-3).join(' | ').slice(0, 400),
      };
      log(entry);
      console.log(`${entry.outcome.padEnd(18)} ${id} (exit ${code}, stage ${entry.stage}, receipt ${entry.receipt}, ${entry.seconds}s)`);
      resolve(entry);
    });
  });
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(workers, plan.length) }, async () => {
  while (next < plan.length) { const item = plan[next++]; results.push(await runOne(item)); }
}));
const counts = {};
for (const r of results) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
console.log('done:', JSON.stringify(counts));
