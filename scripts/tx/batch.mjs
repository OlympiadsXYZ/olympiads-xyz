#!/usr/bin/env node
// batch.mjs --ids a,b,c | --backlog [--limit N] --reader p:m --checker p:m [--workers 2]
//   [--allow-same-model] [--no-promote] [--log tmp/tx/batch.log] [--max-rounds 2] [--max-spend-usd N] [--spend-since ISO] [--escalation-model p:m]
//   [--batch-async [--in-flight 300] [--poll-sec 30] [--workers 4]]
//   [--allow-same-model] [--no-promote] [--log tmp/tx/batch.log] [--max-rounds 2] [--max-spend-usd N] [--spend-since ISO] [--escalation-model p:m] [--checker-mode full|crops|auto]
// Walks a list of papers through run.mjs, a few at a time, and keeps going when
// one fails: every outcome (exit code, final stage, receipt verdict, cost) is
// appended to the log as one JSON line. A paper with an unfinished job in
// tmp/tx/jobs.json is resumed with --continue; a paper already promoted (job
// state promoted, or present in content/problems) is skipped. Safe to re-run.
//
// --batch-async (the archive run over the Anthropic Message Batches API, with
// scripts/tx/anthropic-batch-broker.mjs running alongside): the worker pool is
// replaced by a scheduler. Every run.mjs gets --batch-async, so an anthropic reader
// or checker queues its request and parks the job (exit 2, job.waitingFor.transport
// 'batch') instead of sleeping for the batch. The scheduler keeps up to --in-flight
// jobs open (running + parked; default 300), at most --workers run.mjs processes at a
// time (default 4: a resume runs validate/figures/crops, not only the collect), and
// every --poll-sec (30) resumes `run.mjs <id> --continue` for parked jobs whose
// result files all exist. Outcomes are logged as in the pool; the spend cap reads the
// same runs.jsonl (--batch-result appends the cost there). It exits when the plan is
// exhausted and nothing is running or parked. Resumable after a crash: the state is
// tmp/tx/jobs.json (waitingFor) plus tmp/tx/anthropic-batch/results/.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs, fail, readJson, updateJobs, JOBS_FILE, RUNS_FILE, ROOT, nowIso, paperDir, findContentFile, BATCH_DIRS, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['backlog', 'catalogue', 'allow-same-model', 'no-promote', 'dry-run', 'redo', 'fresh', 'batch-async'] });
if (!args.ids && !args.backlog && !args.catalogue) fail('usage: batch.mjs --ids a,b | --backlog | --catalogue [--subjects s,s] [--langs l,l] [--competitions c,c] [--limit N] --reader p:m --checker p:m [--workers 2] [--allow-same-model] [--no-promote] [--redo]');
if (!args.reader || !args.checker) fail('--reader and --checker are required');
const batchAsync = !!args['batch-async'];
let workers = Number(args.workers || (batchAsync ? 4 : 2));
const logFile = path.resolve(args.log || path.join(ROOT, 'tmp', 'tx', 'batch.log'));
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = entry => fs.appendFileSync(logFile, JSON.stringify({ at: nowIso(), ...entry }) + '\n');

let ids = [];
const keysById = new Map(); // archive keys for papers outside the Bulgarian shards (--catalogue)
if (args.ids) ids = String(args.ids).split(',').map(s => s.trim()).filter(Boolean);
if (args.backlog || args.catalogue) {
  // backlog.mjs owns the rule (catalogue entries in neither content/problems nor tmp/staging) and derives the ids;
  // --catalogue widens it from the Bulgarian shards to the whole archive catalogue (all subjects and languages)
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'tx', 'backlog.mjs'), '--json', ...(args.catalogue ? ['--catalogue'] : []), ...(args.fresh ? ['--include-live'] : [])], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`backlog.mjs failed: ${r.stderr}`);
  // benchmark fixtures (by id or by PDF) stay out of production until the benchmark is closed:
  // a production run would overwrite the candidates their adjudications are bound to
  const fixtures = readJson(path.join(ROOT, 'tmp', 'bench', 'fixtures.json'), []);
  const fxIds = new Set(fixtures.map(f => f.paperId)), fxKeys = new Set(fixtures.map(f => f.problemsKey));
  let entries = JSON.parse(r.stdout).filter(e => e.paperId);
  // --subjects physics,astronomy / --langs en,ru / --competitions IPhO,IAO narrow a catalogue run
  const pick = (opt, field) => { if (!args[opt]) return; const want = new Set(String(args[opt]).split(',').map(s => s.trim().toLowerCase())); entries = entries.filter(e => want.has(String(e[field] ?? '').toLowerCase())); };
  pick('subjects', 'subject'); pick('langs', 'lang'); pick('competitions', 'competition');
  for (const e of entries) if (fxIds.has(e.paperId) || fxKeys.has(e.problemsKey)) log({ paperId: e.paperId, outcome: 'skipped', reason: 'benchmark fixture' });
  entries = entries.filter(e => !fxIds.has(e.paperId) && !fxKeys.has(e.problemsKey));
  // two catalogue rows may derive the same id (a paper split over files): the first wins, the rest are logged
  const seen = new Set();
  for (const e of entries) { if (seen.has(e.paperId)) { log({ paperId: e.paperId, outcome: 'skipped', reason: `duplicate derived id for ${e.problemsKey}` }); continue; } seen.add(e.paperId); ids.push(e.paperId); if (args.catalogue) keysById.set(e.paperId, { problems: e.problemsKey, solutions: e.solutionsKey || null }); }
  if (args.limit) ids = ids.slice(0, Number(args.limit));
}
// --fresh: read the listed papers again from scratch (new job, both documents, the current prompts) — for a paper
// whose catalogue pairing changed after it was promoted (IPhO papers promoted without their solutions file). Only
// with an explicit --ids list; the catalogue is consulted for the keys only.
if (args.fresh) { if (!args.ids) fail('--fresh needs --ids a,b (the papers to re-read from scratch)'); ids = String(args.ids).split(',').map(s => s.trim()).filter(Boolean); }
ids = [...new Set(ids)];
if (!ids.length) fail('nothing to do');

const jobs = () => readJson(JOBS_FILE, { version: 2, jobs: {} }).jobs;
const plan = [];
for (const id of ids) {
  const job = jobs()[id];
  // --redo sends a promoted paper back through validate → figures → checker with the
  // current rules (a re-promotion replaces the published paper with a new receipt)
  if (args.fresh) { if (!keysById.get(id)?.problems) { log({ paperId: id, outcome: 'skipped', reason: 'no catalogue keys for a fresh read' }); continue; } plan.push({ id, resume: false, fresh: true }); continue; }
  if (args.redo && job) { plan.push({ id, resume: true }); continue; } // whatever stage the job is in (a redo interrupted mid-way resumes)
  if (findContentFile(id)) { log({ paperId: id, outcome: 'skipped', reason: 'already in content/problems' }); continue; }
  if (job?.stage === 'promoted' || job?.stage === 'done') { log({ paperId: id, outcome: 'skipped', reason: `job already ${job.stage}` }); continue; }
  plan.push({ id, resume: !!job });
}
// the ChatGPT app has one composer and "the current chat" is whichever the last call left open: one worker only
if (/^chatgpt:/.test(String(args.reader || '')) || /^chatgpt:/.test(String(args.checker || ''))) { if (workers > 1) console.error('[batch] the chatgpt provider runs one worker (the app holds one conversation at a time)'); workers = 1; }
if (batchAsync) console.log(`${plan.length} paper(s) to schedule: up to ${Number(args['in-flight'] || 300)} in flight, ${workers} run.mjs process(es) at a time, poll every ${Math.max(1, Number(args['poll-sec'] || 30))} s; log: ${path.relative(ROOT, logFile)}`);
else console.log(`${plan.length} paper(s) to run with ${workers} worker(s); log: ${path.relative(ROOT, logFile)}`);

function runOne({ id, resume, fresh }) {
  return new Promise(resolve => {
    if (fresh) {
      // the old working directory is kept aside (its candidates and receipts are evidence) and the job entry goes
      const dir = paperDir(id);
      if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}.superseded-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      updateJobs(state => { delete state.jobs[id]; });
    }
    if (!fresh) {
      // the plan was drawn at start; a job that appeared since (another batch parent, an orphan worker, a hand
      // retry) or reached done belongs to that loop — run.mjs would refuse or, worse, replace it
      const now = jobs()[id];
      if (!resume && now) { const e = { paperId: id, outcome: 'skipped', reason: `job appeared since planning (stage ${now.stage}); another loop has it` }; log(e); return resolve(e); }
      if (resume && now?.stage === 'done' && !args.redo) { const e = { paperId: id, outcome: 'skipped', reason: 'job done since planning' }; log(e); return resolve(e); }
    }
    const argv = [path.join(ROOT, 'scripts', 'tx', 'run.mjs'), id];
    if (resume) {
      argv.push('--continue');
      // an escalated or failed-repair job re-enters at validate with a fresh round budget
      const stage = jobs()[id]?.stage;
      if (['escalated', 'repair'].includes(stage) || (args.redo && stage === 'done')) argv.push('--retry', '--max-rounds', String(args['max-rounds'] || 3));
      if (args['escalation-model']) argv.push('--escalation-model', args['escalation-model']);
      if (batchAsync) argv.push('--batch-async'); // a job created before this flag learns it on resume
      if (args['checker-mode']) argv.push('--checker-mode', args['checker-mode']);
    } else {
      argv.push('--reader', args.reader, '--checker', args.checker);
      const keys = keysById.get(id);
      if (keys?.problems) { argv.push('--problems', keys.problems); if (keys.solutions) argv.push('--solutions', keys.solutions); }
      if (args['allow-same-model']) argv.push('--allow-same-model');
      if (args['no-promote']) argv.push('--no-promote');
      if (args['dry-run']) argv.push('--dry-run');
      if (args['max-rounds']) argv.push('--max-rounds', String(args['max-rounds']));
      if (args['window-pages']) argv.push('--window-pages', String(args['window-pages']));
      if (args['escalation-model']) argv.push('--escalation-model', args['escalation-model']);
      if (batchAsync) argv.push('--batch-async');
      if (args['checker-mode']) argv.push('--checker-mode', args['checker-mode']);
    }
    const started = Date.now();
    const child = spawn(process.execPath, argv, { cwd: ROOT, env: process.env });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      const job = jobs()[id] || null;
      const receipt = readJson(path.join(paperDir(id), 'receipt.json'), null);
      const promoted = job?.stage === 'done' && job.history?.some(h => h.note === 'promoted');
      const entry = {
        paperId: id, outcome: code === 0 ? (promoted ? 'promoted' : 'finished') : code === 2 ? (job?.waitingFor?.transport === 'batch' ? 'waiting-for-batch' : 'waiting-for-agent') : code === 3 ? 'escalated' : 'error',
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

// --max-spend-usd N [--spend-since ISO]: no new paper starts once the provider spend recorded in tmp/tx/runs.jsonl
// (every successful call's costUsd, both providers named in --reader/--checker) since --spend-since (default: this
// batch's start) reaches N. Papers already running finish their loop. The Anthropic grant is a fixed pot.
const spendCap = args['max-spend-usd'] ? Number(args['max-spend-usd']) : null;
const spendSince = args['spend-since'] ? new Date(args['spend-since']).toISOString() : new Date().toISOString();
const spendProviders = new Set([args.reader, args.checker].filter(Boolean).map(s => String(s).split(':')[0]));
function spentUsd() {
  const f = RUNS_FILE; // tmp/tx/runs.jsonl (OLYMPIADS_TX_DIR-relative, like every other path of the pipeline)
  if (!fs.existsSync(f)) return 0;
  let usd = 0, unpriced = 0;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!(r.ok && spendProviders.has(r.provider) && r.at >= spendSince)) continue;
    if (typeof r.costUsd === 'number') usd += r.costUsd; else unpriced++;
  }
  // a model missing from prices.json records costUsd null: money the cap cannot see (reviewer finding 2026-09-17)
  if (unpriced && !spentUsd.warned) { spentUsd.warned = true; console.error(`[batch] WARNING: ${unpriced} successful call(s) carry no costUsd (model not in prices.json); the spend cap under-counts them`); }
  return usd;
}
let capHit = false;
const results = [];
// true once the cap is reached (logged once); papers already running or parked finish their loops
function overCap(remaining) {
  if (spendCap == null) return false;
  const usd = spentUsd();
  if (usd < spendCap) return false;
  if (!capHit) { capHit = true; log({ outcome: 'spend-cap', spentUsd: +usd.toFixed(2), capUsd: spendCap, remaining }); console.log(`[batch] spend cap reached: $${usd.toFixed(2)} >= $${spendCap} since ${spendSince}; ${remaining} paper(s) not started`); }
  return true;
}
if (!batchAsync) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, plan.length) }, async () => {
    while (next < plan.length) {
      if (overCap(plan.length - next)) return;
      const item = plan[next++]; results.push(await runOne(item));
    }
  }));
} else {
  // ---- the scheduler (--batch-async): pending → running → parked (waiting for the broker) → running … → done
  const inFlightCap = Math.max(1, Number(args['in-flight'] || 300));
  const pollSec = Math.max(1, Number(args['poll-sec'] || 30));
  const parkedOn = id => { const w = jobs()[id]?.waitingFor; return w?.transport === 'batch' && Array.isArray(w.customIds) ? w : null; };
  const resultsIn = id => { const w = parkedOn(id); return !!w && w.customIds.every(cid => fs.existsSync(path.join(BATCH_DIRS.results, `${cid}.json`))); };
  const waiting = new Map(), running = new Map();
  // after a crash or a stop, the plan's resumable jobs that are parked on a batch go straight to the waiting set
  const pending = [];
  for (const item of plan) { if (item.resume && parkedOn(item.id)) waiting.set(item.id, { id: item.id, resume: true }); else pending.push(item); }
  if (waiting.size) console.log(`[batch] ${waiting.size} job(s) already parked on a batch from an earlier run`);
  let wake = null;
  const kick = () => { if (wake) { const w = wake; wake = null; w(); } };
  const start = item => {
    running.set(item.id, runOne(item).then(entry => {
      running.delete(item.id);
      if (entry.exit === 2 && parkedOn(item.id)) waiting.set(item.id, { id: item.id, resume: true });
      else results.push(entry);
      kick();
    }));
  };
  let lastStatus = '';
  for (;;) {
    for (const [id, item] of waiting) { if (running.size >= workers) break; if (resultsIn(id)) { waiting.delete(id); start(item); } }
    while (pending.length && running.size < workers && running.size + waiting.size < inFlightCap && !overCap(pending.length)) start(pending.shift());
    const open = running.size + waiting.size;
    if (!open && (!pending.length || capHit)) break;
    const status = `[batch ${new Date().toISOString().slice(11, 19)}] running ${running.size} | parked ${waiting.size} | pending ${pending.length} | done ${results.length}${spendCap != null ? ` | spent $${spentUsd().toFixed(2)} of $${spendCap}` : ''}`;
    if (status.replace(/^\[batch [^\]]+\]/, '') !== lastStatus.replace(/^\[batch [^\]]+\]/, '')) { console.log(status); lastStatus = status; }
    await Promise.race([sleep(pollSec * 1000), new Promise(r => { wake = r; })]);
  }
}
if (spendCap != null) console.log(`[batch] spend since ${spendSince}: $${spentUsd().toFixed(2)} (cap $${spendCap})`);
const counts = {};
for (const r of results) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
console.log('done:', JSON.stringify(counts));
