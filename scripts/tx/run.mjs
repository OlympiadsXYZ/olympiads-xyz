#!/usr/bin/env node
// run.mjs <paperId> --reader <provider:model | agent:label> --checker <same>
//   [--continue] [--repaired <file>] [--no-promote] [--dry-run] [--allow-same-model]
//   [--reasoning low|high|max] [--window-pages N] [--timeout-min 20] [--max-rounds 2]
// Orchestrates prepare → reader → validate → figures → checker → receipt → promote
// with resumable state in tmp/tx/jobs.json. API providers run end to end. For an
// agent:<label> stage the run prepares, prints the harness task and exits 2; the
// harness supplies the agent's output at the printed path and calls
// `run.mjs <paperId> --continue` to resume from the job state.
//
// Repair loop: a fail receipt goes to repair.mjs (applies the checker's
// suggestedFix values), then back through validate → figures → a FRESH checker →
// receipt, at most --max-rounds times; what repair.mjs cannot apply, and every
// checker `escalate`, parks the job as `escalated` and prints the adjudicator
// task. `--continue --repaired <file>` re-enters at validate with an operator- or
// adjudicator-supplied candidate. Any stage that finds the candidate bytes differ
// from the last validated bytes goes back to validate first.
// Exit codes: 0 promoted (or finished without promotion), 2 waiting for an agent,
// 3 escalated/failed verification, 1 error.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, fail, readJson, writeJson, JOBS_FILE, paperDir, candidateFile, checkFile, ROOT, nowIso, sha256File, independence } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['continue', 'no-promote', 'dry-run', 'allow-same-model', 'retry'] });
const paperId = args._[0];
if (!paperId) fail('usage: run.mjs <paperId> --reader <provider:model|agent:label> --checker <provider:model|agent:label> [--continue] [--repaired f] [--no-promote] [--allow-same-model]');
const jobs = readJson(JOBS_FILE, { version: 2, jobs: {} });
let job = jobs.jobs[paperId];
if (args.continue && !job) fail(`no job state for ${paperId} in ${path.relative(ROOT, JOBS_FILE)}`);
function parseWho(s) {
  const [provider, ...rest] = String(s).split(':');
  const model = rest.join(':');
  if (!provider || !model) fail(`bad stage spec "${s}" (provider:model or agent:label)`);
  if (!['anthropic', 'gemini', 'zai', 'agent'].includes(provider)) fail(`unknown provider "${provider}"`);
  return { provider, model };
}
if (!args.continue) {
  if (!args.reader || !args.checker) fail('--reader and --checker are required (or --continue)');
  const reader = parseWho(args.reader), checker = parseWho(args.checker);
  const indep = independence(reader, checker);
  if (!indep.independent && !args['allow-same-model']) fail(`reader and checker are the same model (${args.reader}); Codex §4 wants an independent check — choose another checker or pass --allow-same-model (recorded on the page as "same-model checker")`);
  if (!indep.differentProvider) console.error(`[run] note: reader and checker share the provider family (${reader.provider}); a different family is preferable`);
  job = {
    paperId, reader, checker, stage: 'prepare', promote: !args['no-promote'], dryRun: !!args['dry-run'], allowSameModel: !!args['allow-same-model'],
    options: { reasoning: args.reasoning || null, windowPages: args['window-pages'] || null, timeoutMin: args['timeout-min'] || null, maxRounds: Number(args['max-rounds'] || 2) },
    round: 0, createdAt: nowIso(), history: [], artefacts: {},
  };
  jobs.jobs[paperId] = job;
}
job.options ||= { maxRounds: 2 };
// --continue may raise the round budget, and --retry re-enters an escalated job
// at the repair stage (its last receipt is still on disk) — used after the
// pipeline learned a new trick, so escalations need not wait for an adjudicator.
if (args.continue && args['max-rounds']) job.options.maxRounds = Number(args['max-rounds']);
if (args.continue && args.retry && ['escalated', 'repair'].includes(job.stage)) { job.stage = 'validate'; delete job.artefacts.validatedSha256; job.history.push({ at: nowIso(), stage: job.stage, note: 'retry after escalation: re-validate the current candidate, fresh check' }); }
// Re-read before writing: several run.mjs processes share jobs.json and must not clobber each other's entries.
const save = (note) => { job.updatedAt = nowIso(); if (note) job.history.push({ at: job.updatedAt, stage: job.stage, note }); const current = readJson(JOBS_FILE, { version: 2, jobs: {} }); current.jobs[paperId] = job; jobs.jobs = current.jobs; writeJson(JOBS_FILE, current); };
const node = (script, argv, opts = {}) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'tx', script), ...argv], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const rel = f => path.relative(ROOT, f);
const abs = f => path.isAbsolute(f) ? f : path.join(ROOT, f);
const dir = paperDir(paperId);
const manifestPath = path.join(dir, 'manifest.json');
const readerOut = candidateFile(paperId, job.reader.provider, job.reader.model);
const checkerOutFor = round => checkFile(paperId, job.checker.provider, job.checker.model).replace(/\.json$/, round ? `.r${round}.json` : '.json');
const receiptOut = path.join(dir, 'receipt.json');
const transcribeOpts = [...(job.options.reasoning ? ['--reasoning', job.options.reasoning] : []), ...(job.options.timeoutMin ? ['--timeout-min', String(job.options.timeoutMin)] : [])];

function waitForAgent(stage, out, extra = []) {
  const r = node('task.mjs', [paperId, '--stage', stage, '--out', out, '--model', job[stage]?.model || 'opus', ...extra]);
  if (r.status !== 0) fail(`task.mjs failed: ${r.stderr}`);
  job.waitingFor = { stage, out };
  save(`waiting for agent (${stage}) to write ${rel(out)}`);
  process.stdout.write(r.stdout);
  console.log(`\n[run] waiting for the ${stage} agent. When ${rel(out)} exists, resume with:\n  node scripts/tx/run.mjs ${paperId} --continue`);
  process.exit(2);
}
function escalate(note) {
  job.stage = 'escalated'; save(note);
  const gold = path.join(dir, 'candidates', `adjudicated__${job.round}.gold.json`);
  console.error(`[run] ${paperId} escalated: ${note}`);
  console.error(`[run] adjudication (Opus/Fable tier, D-P9):\n  node scripts/tx/task.mjs ${paperId} --stage adjudicator --out ${rel(gold)} --model opus\n  # after the agent wrote the gold JSON and adjudication.json:\n  node scripts/tx/run.mjs ${paperId} --continue --repaired ${rel(gold)}`);
  process.exit(3);
}
// an operator- or adjudicator-supplied candidate re-enters at validate
if (args.continue && args.repaired) {
  const f = path.resolve(args.repaired);
  if (!fs.existsSync(f)) fail(`--repaired file not found: ${f}`);
  job.round = (job.round || 0) + 1;
  job.artefacts.candidate = rel(f); delete job.artefacts.candidateWithFigures; delete job.artefacts.validatedSha256; job.waitingFor = null;
  job.stage = 'validate'; save(`repaired candidate supplied (${rel(f)}), round ${job.round}`);
}
const currentCandidate = () => abs(job.artefacts.candidateWithFigures || job.artefacts.candidate);
const needsRevalidate = () => !job.artefacts.validatedSha256 || sha256File(abs(job.artefacts.candidate)) !== job.artefacts.validatedSha256;

// ---- state machine
for (;;) {
  if (job.stage === 'prepare') {
    const r = node('prepare.mjs', [paperId]);
    if (r.status !== 0) { save(`prepare failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    job.artefacts.manifest = rel(manifestPath);
    job.stage = 'reader'; save('prepared');
  } else if (job.stage === 'reader') {
    if (fs.existsSync(readerOut) && job.waitingFor?.stage === 'reader') { job.waitingFor = null; job.artefacts.candidate = rel(readerOut); job.stage = 'validate'; save('agent candidate received'); continue; }
    if (job.reader.provider === 'agent') waitForAgent('reader', readerOut);
    const r = node('transcribe.mjs', [paperId, '--provider', job.reader.provider, '--model', job.reader.model, '--stage', 'reader', ...transcribeOpts, ...(job.options.windowPages ? ['--window-pages', String(job.options.windowPages)] : []), ...(job.dryRun ? ['--dry-run'] : [])]);
    if (r.status !== 0 && r.status !== 3) { save(`reader failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    if (job.dryRun) { save('dry-run: reader payload built, stopping'); console.log(r.stdout); process.exit(0); }
    job.artefacts.candidate = rel(readerOut); job.stage = 'validate'; save(r.status === 3 ? 'reader done (assembly incomplete; validate will report)' : 'reader done');
  } else if (job.stage === 'validate') {
    const cand = abs(job.artefacts.candidate);
    const r = node('validate.mjs', [cand, '--paper-id', paperId, '--manifest', manifestPath, '--quiet']);
    process.stdout.write(r.stdout);
    if (r.status !== 0) {
      const full = node('validate.mjs', [cand, '--paper-id', paperId, '--manifest', manifestPath]);
      fs.writeFileSync(path.join(dir, 'validate.json'), full.stdout);
      save(`validate failed; see ${rel(path.join(dir, 'validate.json'))}`);
      console.error(`[run] candidate invalid — fix ${job.artefacts.candidate} (or re-run the reader) and resume:\n  node scripts/tx/run.mjs ${paperId} --continue --repaired ${job.artefacts.candidate}`);
      process.exit(3);
    }
    job.artefacts.validatedSha256 = sha256File(cand); delete job.artefacts.candidateWithFigures;
    job.stage = 'figures'; save('validated');
  } else if (job.stage === 'figures') {
    if (needsRevalidate()) { job.stage = 'validate'; save('candidate bytes changed since validation; re-validating'); continue; }
    const r = node('figures.mjs', [paperId, abs(job.artefacts.candidate), ...(job.dryRun ? ['--dry-run'] : [])]);
    fs.writeFileSync(path.join(dir, 'figures-report.json'), r.stdout);
    if (r.status !== 0) { save(`figures failed; see ${rel(path.join(dir, 'figures-report.json'))}`); fail(`figures.mjs failed: ${r.stderr || r.stdout.slice(-600)}`); }
    const rep = JSON.parse(r.stdout);
    job.artefacts.candidateWithFigures = rel(rep.out); job.stage = 'checker'; save(`figures done (${rep.figures.length})`);
  } else if (job.stage === 'checker') {
    if (needsRevalidate()) { job.stage = 'validate'; save('candidate bytes changed since validation; re-validating'); continue; }
    const cand = currentCandidate();
    const checkerOut = checkerOutFor(job.round);
    if (fs.existsSync(checkerOut) && job.waitingFor?.stage === 'checker') { job.waitingFor = null; job.artefacts.checker = rel(checkerOut); job.stage = 'receipt'; save('agent checker output received'); continue; }
    if (job.checker.provider === 'agent') waitForAgent('checker', checkerOut, ['--candidate', cand]);
    const r = node('transcribe.mjs', [paperId, '--provider', job.checker.provider, '--model', job.checker.model, '--stage', 'checker', '--candidate', cand, '--out', checkerOut, ...transcribeOpts]);
    if (r.status !== 0) { save(`checker failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    job.artefacts.checker = rel(checkerOut); job.stage = 'receipt'; save('checker done');
  } else if (job.stage === 'receipt') {
    const check = readJson(abs(job.artefacts.checker));
    const rid = check?.checker?.requestId || check?.requestId || check?.reviewer?.split(':').slice(2).join(':') || `${job.checker.provider}-${Date.now()}`;
    const reviewer = `${job.checker.provider}:${job.checker.model}:${rid}`;
    const r = node('receipt.mjs', [paperId, '--candidate', currentCandidate(), '--defects', abs(job.artefacts.checker), '--reviewer', reviewer, '--prompt-version', check?.checker?.promptVersion || 'v1', '--out', receiptOut, ...(job.allowSameModel ? ['--allow-same-model'] : [])]);
    process.stdout.write(r.stdout);
    if (!fs.existsSync(receiptOut)) fail(`receipt.mjs failed: ${r.stderr}`);
    job.artefacts.receipt = rel(receiptOut);
    const receipt = readJson(receiptOut);
    fs.copyFileSync(receiptOut, path.join(dir, `receipt.r${job.round}.json`));
    if (r.status === 0 && receipt?.verdict === 'pass') { job.stage = job.promote ? 'promote' : 'done'; save('receipt: pass'); continue; }
    if (receipt?.verdict === 'escalate') escalate(`checker escalated: ${receipt.summary || ''}`);
    if (receipt.blockers?.length && !receipt.defects?.length) escalate(`receipt blocked without repairable defects: ${receipt.blockers.join('; ')}`);
    if (job.round >= job.options.maxRounds) escalate(`still ${receipt.defects?.length} defect(s) after ${job.round} repair round(s)`);
    job.stage = 'repair'; save(`receipt: fail (${receipt.defects?.length} defects); repairing`);
  } else if (job.stage === 'repair') {
    job.round += 1;
    const repaired = abs(job.artefacts.candidate).replace(/\.json$/, `.r${job.round}.json`);
    const r = node('repair.mjs', [paperId, '--candidate', currentCandidate(), '--receipt', receiptOut, '--out', repaired, '--round', String(job.round)]);
    process.stdout.write(r.stdout);
    if (r.status === 1) { save(`repair failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    const rep = JSON.parse(r.stdout || '{}');
    job.artefacts.candidate = rel(repaired); delete job.artefacts.candidateWithFigures; delete job.artefacts.validatedSha256;
    if (r.status === 3) {
      // What the checker could not phrase as an exact fix goes back to the reader
      // model together with the relevant pages (transcribe.mjs --stage refix); an
      // agent reader has no API, so its leftovers go straight to adjudication.
      if (job.reader.provider === 'agent') escalate(`repair.mjs could not apply ${rep.skipped} defect(s) (no usable suggestedFix); applied ${rep.applied}`);
      const reportFile = repaired.replace(/\.json$/, '.repair.json');
      writeJson(reportFile, rep);
      const refixed = repaired.replace(/\.json$/, '.x.json');
      const x = node('transcribe.mjs', [paperId, '--provider', job.reader.provider, '--model', job.reader.model, '--stage', 'refix', '--candidate', repaired, '--defects', reportFile, '--out', refixed, '--round', String(job.round), ...transcribeOpts]);
      process.stdout.write(x.stdout);
      if ((x.status !== 0 && x.status !== 3) || !fs.existsSync(refixed)) { save(`refix failed: ${(x.stderr || '').slice(0, 300)}`); escalate(`repair.mjs could not apply ${rep.skipped} defect(s) and refix failed: ${(x.stderr || '').slice(0, 200)}`); }
      const xr = JSON.parse(x.stdout || '{}');
      job.artefacts.candidate = rel(refixed);
      if (x.status === 3) escalate(`refix could not settle ${xr.skipped} defect(s) from the pages (applied ${rep.applied} + ${xr.applied || 0})`);
      save(`refix applied ${xr.applied} defect(s) the checker could not phrase, round ${job.round}`);
    }
    job.stage = 'validate'; save(`repaired ${rep.applied} defect(s), round ${job.round}; re-validating, re-cropping, fresh check`);
  } else if (job.stage === 'promote') {
    const r = node('promote.mjs', [paperId, '--candidate', currentCandidate(), '--receipt', receiptOut]);
    process.stdout.write(r.stdout);
    if (r.status !== 0) { save(`promote failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    job.stage = 'done'; save('promoted');
  } else if (job.stage === 'done') {
    console.log(`[run] ${paperId} done (${job.history.at(-1)?.note}). Consider: node scripts/tx/prepare.mjs ${paperId} --gc`);
    process.exit(0);
  } else if (job.stage === 'escalated') {
    escalate(job.history.at(-1)?.note || 'parked for adjudication');
  } else fail(`job ${paperId} is in stage "${job.stage}"; edit ${rel(JOBS_FILE)} to resume`);
}
