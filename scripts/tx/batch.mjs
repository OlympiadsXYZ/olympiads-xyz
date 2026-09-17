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
// One scheduler per machine: tmp/tx/batch-async.lock ({pid, at}); a second one exits at
// once while the holder is alive, a dead holder's lock is taken over. --in-flight is an
// absolute bound on open jobs (running + parked, the parked ones adopted from an earlier
// run included): no paper starts while that many are open. The spend cap counts the
// money committed to the broker as well as the money spent: every enqueue books a
// provisional runs.jsonl line (transcribe.mjs --batch-async, the dry-run estimate at the
// batch price) that the collect's real record replaces, so a run cannot commit 24 h of
// requests before the first bill lands. The cap gates new starts only — a parked job is
// always resumed, since its result is paid for.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs, fail, readJson, readJsonSafe, updateJobs, JOBS_FILE, RUNS_FILE, ROOT, nowIso, paperDir, findContentFile, BATCH_DIRS, BATCH_ASYNC_LOCK, sleep, pidAlive, brokerAlive } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['backlog', 'catalogue', 'allow-same-model', 'no-promote', 'dry-run', 'redo', 'fresh', 'batch-async', 'no-broker-check', 'native-only', 'skip-escalated'] });
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
  // --native-only: papers whose problems document carries a real text layer per tmp/tx/classify.json (classify.mjs);
  // scans and unclassified papers are left out (the mechanical text check is the cheap half of verification)
  if (args['native-only'] || args['max-pages']) {
    const cls = readJson(path.join(ROOT, 'tmp', 'tx', 'classify.json'), { papers: {} }).papers || {};
    const before = entries.length;
    if (args['native-only']) entries = entries.filter(e => cls[e.paperId]?.native === true);
    // --max-pages N (catalogue mode): only papers whose prepared documents total at most N pages (classify.json)
    if (args['max-pages']) entries = entries.filter(e => Number.isFinite(cls[e.paperId]?.pages) && cls[e.paperId].pages <= Number(args['max-pages']));
    console.log(`[batch] ${args['native-only'] ? '--native-only ' : ''}${args['max-pages'] ? `--max-pages ${args['max-pages']} ` : ''}: ${entries.length} of ${before} papers selected (${Object.keys(cls).length} classified)`);
  }
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

// a half-written or corrupt jobs.json is logged and read as empty for this look (writeJson is atomic, so the next look sees the file)
const jobs = () => readJsonSafe(JOBS_FILE, { version: 2, jobs: {} })?.jobs || {};
const plan = [];
for (const id of ids) {
  const job = jobs()[id];
  // --redo sends a promoted paper back through validate → figures → checker with the
  // current rules (a re-promotion replaces the published paper with a new receipt)
  if (args.fresh) { if (!keysById.get(id)?.problems) { log({ paperId: id, outcome: 'skipped', reason: 'no catalogue keys for a fresh read' }); continue; } plan.push({ id, resume: false, fresh: true }); continue; }
  if (args.redo && job) { plan.push({ id, resume: true }); continue; } // whatever stage the job is in (a redo interrupted mid-way resumes)
  if (findContentFile(id)) { log({ paperId: id, outcome: 'skipped', reason: 'already in content/problems' }); continue; }
  if (job?.stage === 'promoted' || job?.stage === 'done') { log({ paperId: id, outcome: 'skipped', reason: `job already ${job.stage}` }); continue; }
  // --skip-escalated: parked papers (the expensive hard cases) are left for a deliberate --retry run, not resumed
  // alongside fresh work (2026-09-17: a scheduler resumed ioaa-2014 at round 15 next to new papers)
  if (args['skip-escalated'] && job?.stage === 'escalated') { log({ paperId: id, outcome: 'skipped', reason: 'escalated job left parked (--skip-escalated)' }); continue; }
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
// Money committed but not yet billed counts too: a provisional line ({provisional: true, customId, costUsd: the
// estimate}) written at every --batch-async enqueue stands in for a request until a later line with the same
// customId supersedes it — the collect's real record (ok: true, its costUsd counts instead), an error record (the
// request was not billed) or run.mjs's withdrawn line (never submitted). A provisional is counted once per customId.
const spendCap = args['max-spend-usd'] ? Number(args['max-spend-usd']) : null;
const spendSince = args['spend-since'] ? new Date(args['spend-since']).toISOString() : new Date().toISOString();
const spendProviders = new Set([args.reader, args.checker].filter(Boolean).map(s => String(s).split(':')[0]));
function spendTotals() {
  const f = RUNS_FILE; // tmp/tx/runs.jsonl (OLYMPIADS_TX_DIR-relative, like every other path of the pipeline)
  const totals = { spent: 0, provisional: 0, total: 0, provisionalRequests: 0 };
  if (!fs.existsSync(f)) return totals;
  let unpriced = 0;
  const provisional = new Map(); // customId → estimate, until superseded
  const settled = new Set();
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!(spendProviders.has(r.provider) && r.at >= spendSince)) continue;
    if (r.provisional) { if (r.customId && !settled.has(r.customId) && !provisional.has(r.customId)) provisional.set(r.customId, Number(r.costUsd) || 0); continue; }
    if (r.customId) { settled.add(r.customId); provisional.delete(r.customId); }
    if (!r.ok) continue;
    if (typeof r.costUsd === 'number') totals.spent += r.costUsd; else unpriced++;
  }
  for (const usd of provisional.values()) totals.provisional += usd;
  totals.provisionalRequests = provisional.size;
  totals.total = totals.spent + totals.provisional;
  // a model missing from prices.json records costUsd null: money the cap cannot see (reviewer finding 2026-09-17)
  if (unpriced && !spendTotals.warned) { spendTotals.warned = true; console.error(`[batch] WARNING: ${unpriced} successful call(s) carry no costUsd (model not in prices.json); the spend cap under-counts them`); }
  return totals;
}
const spendLine = () => { const s = spendTotals(); return `spent $${s.spent.toFixed(2)}${s.provisionalRequests ? ` + committed (provisional) $${s.provisional.toFixed(2)} for ${s.provisionalRequests} request(s)` : ''} = $${s.total.toFixed(2)} of $${spendCap}`; };
let capHit = false;
const results = [];
// true while the cap is reached (logged once); papers already running or parked finish their loops. New starts only:
// a resume collects a paid result and is never gated.
function overCap(remaining) {
  if (spendCap == null) return false;
  const s = spendTotals();
  if (s.total < spendCap) {
    // collected results replaced their (larger) provisional bookings: the total fell back under the cap, starts resume
    if (capHit) { capHit = false; log({ outcome: 'spend-cap-cleared', spentUsd: +s.spent.toFixed(4), provisionalUsd: +s.provisional.toFixed(4), totalUsd: +s.total.toFixed(4), capUsd: spendCap, remaining }); console.log(`[batch] spend back under the cap: ${spendLine()}; ${remaining} paper(s) may start`); }
    return false;
  }
  if (!capHit) { capHit = true; log({ outcome: 'spend-cap', spentUsd: +s.spent.toFixed(4), provisionalUsd: +s.provisional.toFixed(4), provisionalRequests: s.provisionalRequests, totalUsd: +s.total.toFixed(4), capUsd: spendCap, remaining }); console.log(`[batch] spend cap reached: ${spendLine()} since ${spendSince}; ${remaining} paper(s) not started`); }
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
  // one scheduler per machine: two would start and resume the same papers (run.mjs refuses the second on a live
  // runningPid, but every refusal is a wasted spawn and a logged error)
  for (let tries = 0; ; tries++) {
    // the broker and this scheduler share tmp/tx (TX_DIR is checkout-relative): with no broker alive every paper
    // would park and nothing would ever be submitted (verifier finding 2026-09-17)
    if (!brokerAlive() && !args['no-broker-check']) fail(`no batch broker is running for ${path.relative(ROOT, BATCH_DIRS.lock)} — start 'node scripts/tx/anthropic-batch-broker.mjs' from this checkout first (or pass --no-broker-check)`);
    try { fs.mkdirSync(path.dirname(BATCH_ASYNC_LOCK), { recursive: true }); fs.writeFileSync(BATCH_ASYNC_LOCK, JSON.stringify({ pid: process.pid, at: nowIso(), argv: process.argv.slice(2) }), { flag: 'wx' }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const held = readJsonSafe(BATCH_ASYNC_LOCK, null);
      if (held?.pid && held.pid !== process.pid && pidAlive(held.pid)) fail(`another batch.mjs --batch-async (pid ${held.pid}, since ${held.at}) holds ${path.relative(ROOT, BATCH_ASYNC_LOCK)}; one scheduler per machine — stop it first, or wait for it`);
      if (tries >= 3) fail(`could not take ${path.relative(ROOT, BATCH_ASYNC_LOCK)}`);
      if (held?.pid) console.error(`[batch] taking over ${path.relative(ROOT, BATCH_ASYNC_LOCK)} from pid ${held.pid} (since ${held.at}), which is no longer running`);
      try { fs.unlinkSync(BATCH_ASYNC_LOCK); } catch {}
    }
  }
  const releaseLock = () => { try { if (readJsonSafe(BATCH_ASYNC_LOCK, null)?.pid === process.pid) fs.unlinkSync(BATCH_ASYNC_LOCK); } catch {} };
  process.on('exit', releaseLock);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { releaseLock(); process.exit(130); });
  const inFlightCap = Math.max(1, Number(args['in-flight'] || 300));
  const pollSec = Math.max(1, Number(args['poll-sec'] || 30));
  const parkedOn = id => { const w = jobs()[id]?.waitingFor; return w?.transport === 'batch' && Array.isArray(w.customIds) ? w : null; };
  const resultsIn = id => { const w = parkedOn(id); return !!w && w.customIds.every(cid => fs.existsSync(path.join(BATCH_DIRS.results, `${cid}.json`))); };
  const waiting = new Map(), running = new Map();
  // after a crash or a stop, the plan's resumable jobs that are parked on a batch go straight to the waiting set
  const pending = [];
  for (const item of plan) { if (item.resume && parkedOn(item.id)) waiting.set(item.id, { id: item.id, resume: true }); else pending.push(item); }
  if (waiting.size) console.log(`[batch] ${waiting.size} job(s) already parked on a batch from an earlier run${waiting.size >= inFlightCap ? ` — at or over --in-flight ${inFlightCap}; no new paper starts until some finish` : ''}`);
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
  const open = () => running.size + waiting.size; // every open job counts against --in-flight, whichever run started it
  for (;;) {
    // resumes first: a parked job whose results are in collects paid work and is gated by neither the spend cap nor --in-flight
    for (const [id, item] of waiting) { if (running.size >= workers) break; if (resultsIn(id)) { waiting.delete(id); start(item); } }
    while (pending.length && running.size < workers && open() < inFlightCap && !overCap(pending.length)) start(pending.shift());
    if (!open() && (!pending.length || overCap(pending.length))) break;
    const status = `[batch ${new Date().toISOString().slice(11, 19)}] running ${running.size} | parked ${waiting.size} | pending ${pending.length} | done ${results.length}${open() >= inFlightCap ? ` | in-flight cap ${inFlightCap} reached` : ''}${spendCap != null ? ` | ${spendLine()}` : ''}`;
    if (status.replace(/^\[batch [^\]]+\]/, '') !== lastStatus.replace(/^\[batch [^\]]+\]/, '')) { console.log(status); lastStatus = status; }
    await Promise.race([sleep(pollSec * 1000), new Promise(r => { wake = r; })]);
  }
}
if (spendCap != null) console.log(`[batch] spend since ${spendSince}: ${spendLine()}`);
const counts = {};
for (const r of results) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
console.log('done:', JSON.stringify(counts));
