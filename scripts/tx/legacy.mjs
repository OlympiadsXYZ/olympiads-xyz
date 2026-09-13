#!/usr/bin/env node
// legacy.mjs [--ids a,b | --all] [--workers 3] [--max-rounds 4] [--limit N] [--log tmp/tx/legacy.log]
// Re-verifies papers that are on the site without a loop receipt (ledger kind
// "legacy": transcribed by an Opus/Fable agent before the pipeline existed).
// For each paper: prepare (download + render) → from-final.mjs (the published
// JSON back into candidate shape, text untouched) → a job with reader
// agent:claude-opus-5 and checker zai:glm-5.3-flash (an independent check) →
// run.mjs --continue --repaired <candidate> through validate → figures →
// text-layer + region + model check → repair/refix rounds → promote --replace.
// A paper that passes keeps its text and earns a `reviewed` receipt; one that
// does not is parked (stage escalated) with its receipt. Resumable: a paper
// with a job already past the reader stage is continued, a promoted one skipped.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs, fail, readJson, JOBS_FILE, ROOT, nowIso, paperDir, findContentFile } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['all', 'dry-run'] });
if (!args.ids && !args.all) fail('usage: legacy.mjs --ids a,b | --all [--workers 3] [--max-rounds 4] [--limit N] [--log tmp/tx/legacy.log]');
const workers = Number(args.workers || 3), maxRounds = String(args['max-rounds'] || 4);
const checker = args.checker || 'zai:glm-5.3-flash';
const logFile = path.resolve(args.log || path.join(ROOT, 'tmp', 'tx', 'legacy.log'));
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = entry => fs.appendFileSync(logFile, JSON.stringify({ at: nowIso(), ...entry }) + '\n');

const ledger = readJson(path.join(ROOT, 'content', 'problem-publication.json'), {});
const entries = ledger.papers || ledger;
let ids = args.ids ? String(args.ids).split(',').map(s => s.trim()).filter(Boolean) : Object.entries(entries).filter(([, v]) => v.kind === 'legacy').map(([k]) => k);
if (args.limit) ids = ids.slice(0, Number(args.limit));
const jobs = () => readJson(JOBS_FILE, { version: 2, jobs: {} }).jobs;
const plan = [];
for (const id of ids) {
  const job = jobs()[id];
  if (entries[id]?.kind === 'reviewed') { log({ paperId: id, outcome: 'skipped', reason: 'already reviewed' }); continue; }
  if (!findContentFile(id)) { log({ paperId: id, outcome: 'skipped', reason: 'no content file' }); continue; }
  if (job?.stage === 'done' && job.history?.some(h => h.note === 'promoted' && h.at > '2026-09-13')) { log({ paperId: id, outcome: 'skipped', reason: 'promoted by this route' }); continue; }
  plan.push({ id, resume: !!job && !['prepare', 'reader'].includes(job.stage) });
}
console.log(`${plan.length} legacy paper(s) with ${workers} worker(s); log: ${path.relative(ROOT, logFile)}`);
if (args['dry-run']) { console.log(plan.slice(0, 20).map(p => `${p.id}${p.resume ? ' (resume)' : ''}`).join('\n')); process.exit(0); }

const node = (script, argv) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'tx', script), ...argv], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env });
function runAsync(argv) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, argv, { cwd: ROOT, env: process.env });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => resolve({ code, out, err }));
  });
}
async function one({ id, resume }) {
  const started = Date.now();
  const fin = () => Math.round((Date.now() - started) / 1000);
  try {
    let argv;
    if (resume) {
      const stage = jobs()[id]?.stage;
      argv = [path.join(ROOT, 'scripts', 'tx', 'run.mjs'), id, '--continue', ...(['escalated', 'repair', 'validate', 'figures', 'done'].includes(stage) ? ['--retry', '--max-rounds', maxRounds] : [])];
    } else {
      const prep = node('prepare.mjs', [id]);
      if (prep.status !== 0) { log({ paperId: id, outcome: 'error', step: 'prepare', tail: (prep.stderr || prep.stdout).trim().split('\n').slice(-2).join(' | ').slice(0, 300), seconds: fin() }); return 'error'; }
      const cand = path.join(paperDir(id), 'candidates', 'agent__claude-opus-5.json');
      const conv = node('from-final.mjs', [id, '--in', findContentFile(id), '--out', cand, '--drop-unplaced']);
      if (conv.status !== 0 || !fs.existsSync(cand)) { log({ paperId: id, outcome: 'error', step: 'from-final', tail: (conv.stderr || conv.stdout).trim().split('\n').slice(-2).join(' | ').slice(0, 300), seconds: fin() }); return 'error'; }
      // create the job (the reader is an agent whose output we already have: run.mjs exits 2 waiting for it)
      const mk = node('run.mjs', [id, '--reader', 'agent:claude-opus-5', '--checker', checker, '--max-rounds', maxRounds]);
      if (mk.status !== 2 && mk.status !== 0) { log({ paperId: id, outcome: 'error', step: 'create-job', tail: (mk.stderr || mk.stdout).trim().split('\n').slice(-2).join(' | ').slice(0, 300), seconds: fin() }); return 'error'; }
      argv = [path.join(ROOT, 'scripts', 'tx', 'run.mjs'), id, '--continue', '--repaired', cand, '--max-rounds', maxRounds];
    }
    const r = await runAsync(argv);
    const job = jobs()[id] || null;
    const receipt = readJson(path.join(paperDir(id), 'receipt.json'), null);
    const promoted = job?.stage === 'done' && job.history?.some(h => h.note === 'promoted');
    const outcome = r.code === 0 ? (promoted ? 'promoted' : 'finished') : r.code === 3 ? 'escalated' : 'error';
    log({ paperId: id, outcome, exit: r.code, stage: job?.stage || null, round: job?.round ?? null, receipt: receipt?.verdict || null, blockers: receipt?.blockers?.slice(0, 3) || [], defects: receipt?.defects?.length ?? null, seconds: fin(), tail: (r.err || r.out).trim().split('\n').slice(-2).join(' | ').slice(0, 300) });
    return outcome;
  } catch (e) { log({ paperId: id, outcome: 'error', tail: String(e.message || e).slice(0, 300), seconds: fin() }); return 'error'; }
}
const counts = {};
let next = 0;
await Promise.all(Array.from({ length: Math.min(workers, plan.length) }, async () => {
  while (next < plan.length) { const item = plan[next++]; const o = await one(item); counts[o] = (counts[o] || 0) + 1; console.log(`${o.padEnd(10)} ${item.id}  [${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}]`); }
}));
console.log('done:', JSON.stringify(counts));
