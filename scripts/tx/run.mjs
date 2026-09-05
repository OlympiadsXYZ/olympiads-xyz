#!/usr/bin/env node
// run.mjs <paperId> --reader <provider:model | agent:haiku|sonnet|opus> --checker <same> [--continue] [--no-promote] [--dry-run]
// Orchestrates prepare → reader → validate → figures → checker → receipt → promote
// with resumable state in tmp/tx/jobs.json. API providers run end to end. For an
// agent:<label> stage the run prepares, prints the harness task and exits 2; the
// harness supplies the agent's output at the printed path and calls
// `run.mjs <paperId> --continue` to resume from the job state.
// Exit codes: 0 promoted (or finished without promotion), 2 waiting for an agent,
// 3 escalated/failed verification, 1 error.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, fail, readJson, writeJson, JOBS_FILE, paperDir, candidateFile, readManifest, ROOT, nowIso, safeLabel } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['continue', 'no-promote', 'dry-run'] });
const paperId = args._[0];
if (!paperId) fail('usage: run.mjs <paperId> --reader <provider:model|agent:label> --checker <provider:model|agent:label> [--continue] [--no-promote]');
const jobs = readJson(JOBS_FILE, { version: 1, jobs: {} });
let job = jobs.jobs[paperId];
if (args.continue && !job) fail(`no job state for ${paperId} in ${path.relative(ROOT, JOBS_FILE)}`);
if (!args.continue) {
  if (!args.reader || !args.checker) fail('--reader and --checker are required (or --continue)');
  job = { paperId, reader: parseWho(args.reader), checker: parseWho(args.checker), stage: 'prepare', promote: !args['no-promote'], dryRun: !!args['dry-run'], createdAt: nowIso(), history: [], artefacts: {} };
  jobs.jobs[paperId] = job;
}
function parseWho(s) {
  const [provider, ...rest] = String(s).split(':');
  const model = rest.join(':');
  if (!provider || !model) fail(`bad stage spec "${s}" (provider:model or agent:label)`);
  if (!['anthropic', 'gemini', 'zai', 'agent'].includes(provider)) fail(`unknown provider "${provider}"`);
  return { provider, model };
}
const save = (note) => { job.updatedAt = nowIso(); if (note) job.history.push({ at: job.updatedAt, stage: job.stage, note }); writeJson(JOBS_FILE, jobs); };
const node = (script, argv, opts = {}) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'tx', script), ...argv], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return r;
};
const rel = f => path.relative(ROOT, f);
const dir = paperDir(paperId);
const readerOut = job.reader.provider === 'agent' ? candidateFile(paperId, 'agent', job.reader.model) : candidateFile(paperId, job.reader.provider, job.reader.model);
const checkerOut = path.join(dir, 'checks', `${safeLabel(job.checker.provider)}__${safeLabel(job.checker.model)}.json`);
const receiptOut = path.join(dir, 'receipt.json');

function waitForAgent(stage, out, extra = []) {
  const r = node('task.mjs', [paperId, '--stage', stage, '--out', out, '--model', job[stage].model, ...extra]);
  if (r.status !== 0) fail(`task.mjs failed: ${r.stderr}`);
  job.waitingFor = { stage, out };
  save(`waiting for agent (${stage}) to write ${rel(out)}`);
  process.stdout.write(r.stdout);
  console.log(`\n[run] waiting for the ${stage} agent. When ${rel(out)} exists, resume with:\n  node scripts/tx/run.mjs ${paperId} --continue`);
  process.exit(2);
}

// ---- state machine
for (;;) {
  if (job.stage === 'prepare') {
    const r = node('prepare.mjs', [paperId]);
    if (r.status !== 0) { save(`prepare failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    job.artefacts.manifest = rel(path.join(dir, 'manifest.json'));
    job.stage = 'reader'; save('prepared');
  } else if (job.stage === 'reader') {
    if (fs.existsSync(readerOut) && job.waitingFor?.stage === 'reader') { job.waitingFor = null; job.artefacts.candidate = rel(readerOut); job.stage = 'validate'; save('agent candidate received'); continue; }
    if (job.reader.provider === 'agent') waitForAgent('reader', readerOut);
    const r = node('transcribe.mjs', [paperId, '--provider', job.reader.provider, '--model', job.reader.model, '--stage', 'reader', ...(job.dryRun ? ['--dry-run'] : [])]);
    if (r.status !== 0) { save(`reader failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    if (job.dryRun) { save('dry-run: reader payload built, stopping'); console.log(r.stdout); process.exit(0); }
    job.artefacts.candidate = rel(readerOut); job.stage = 'validate'; save('reader done');
  } else if (job.stage === 'validate') {
    const r = node('validate.mjs', [path.join(ROOT, job.artefacts.candidate), '--paper-id', paperId, '--manifest', path.join(dir, 'manifest.json'), '--quiet']);
    process.stdout.write(r.stdout);
    if (r.status !== 0) {
      const full = node('validate.mjs', [path.join(ROOT, job.artefacts.candidate), '--paper-id', paperId, '--manifest', path.join(dir, 'manifest.json')]);
      fs.writeFileSync(path.join(dir, 'validate.json'), full.stdout);
      job.stage = 'failed'; save(`validate failed; see ${rel(path.join(dir, 'validate.json'))}`);
      console.error(`[run] candidate invalid — fix ${job.artefacts.candidate} (or re-run the reader) and resume with --continue after setting stage back: node scripts/tx/run.mjs ${paperId} --continue`);
      job.stage = 'validate'; save(); process.exit(3);
    }
    job.stage = 'figures'; save('validated');
  } else if (job.stage === 'figures') {
    const r = node('figures.mjs', [paperId, path.join(ROOT, job.artefacts.candidate), ...(job.dryRun ? ['--dry-run'] : [])]);
    fs.writeFileSync(path.join(dir, 'figures-report.json'), r.stdout);
    if (r.status !== 0) { save(`figures failed; see ${rel(path.join(dir, 'figures-report.json'))}`); fail(`figures.mjs failed: ${r.stderr || r.stdout.slice(-600)}`); }
    const rep = JSON.parse(r.stdout);
    job.artefacts.candidateWithFigures = rel(rep.out); job.stage = 'checker'; save(`figures done (${rep.figures.length})`);
  } else if (job.stage === 'checker') {
    const cand = path.join(ROOT, job.artefacts.candidateWithFigures);
    if (fs.existsSync(checkerOut) && job.waitingFor?.stage === 'checker') { job.waitingFor = null; job.artefacts.checker = rel(checkerOut); job.stage = 'receipt'; save('agent checker output received'); continue; }
    if (job.checker.provider === 'agent') waitForAgent('checker', checkerOut, ['--candidate', cand]);
    const r = node('transcribe.mjs', [paperId, '--provider', job.checker.provider, '--model', job.checker.model, '--stage', 'checker', '--candidate', cand]);
    if (r.status !== 0) { save(`checker failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    job.artefacts.checker = rel(checkerOut); job.stage = 'receipt'; save('checker done');
  } else if (job.stage === 'receipt') {
    const check = readJson(path.join(ROOT, job.artefacts.checker));
    const rid = check?.checker?.requestId || check?.requestId || `${job.checker.provider}-${Date.now()}`;
    const reviewer = `${job.checker.provider}:${job.checker.model}:${rid}`;
    const r = node('receipt.mjs', [paperId, '--candidate', path.join(ROOT, job.artefacts.candidateWithFigures), '--defects', path.join(ROOT, job.artefacts.checker), '--reviewer', reviewer, '--prompt-version', check?.checker?.promptVersion || 'v1', '--out', receiptOut]);
    process.stdout.write(r.stdout);
    job.artefacts.receipt = rel(receiptOut);
    const receipt = readJson(receiptOut);
    if (r.status === 0 && receipt?.verdict === 'pass') { job.stage = job.promote ? 'promote' : 'done'; save('receipt: pass'); }
    else { job.stage = receipt?.verdict === 'escalate' ? 'escalated' : 'defective'; save(`receipt: ${receipt?.verdict} (${receipt?.defects?.length ?? '?'} unresolved defects)`); console.error(`[run] ${paperId} ${job.stage}: see ${rel(receiptOut)}. Repair the candidate, re-run the checker on the changed regions, then set the job stage back to "checker" in ${rel(JOBS_FILE)} and --continue.`); process.exit(3); }
  } else if (job.stage === 'promote') {
    const r = node('promote.mjs', [paperId, '--candidate', path.join(ROOT, job.artefacts.candidateWithFigures), '--receipt', receiptOut]);
    process.stdout.write(r.stdout);
    if (r.status !== 0) { save(`promote failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    job.stage = 'done'; save('promoted');
  } else if (job.stage === 'done') {
    console.log(`[run] ${paperId} done (${job.history.at(-1)?.note}). Consider: node scripts/tx/prepare.mjs ${paperId} --gc`);
    process.exit(0);
  } else fail(`job ${paperId} is in stage "${job.stage}"; edit ${rel(JOBS_FILE)} to resume`);
}
