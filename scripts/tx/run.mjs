#!/usr/bin/env node
// run.mjs <paperId> --reader <provider:model | agent:label> --checker <same>
//   [--continue] [--repaired <file>] [--no-promote] [--dry-run] [--allow-same-model]
//   [--reasoning low|high|max] [--window-pages N] [--timeout-min 20] [--max-rounds 2] [--escalation-model p:m]
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
import { parseArgs, fail, readJson, writeJson, JOBS_FILE, paperDir, candidateFile, checkFile, ROOT, nowIso, sha256File, independence, findContentFile, normaliseCandidate, sha256, splitMath, fixHomoglyphs, pointerGet, mergeProblemsIntoOne } from './lib.mjs';
import { textLayerCheck, profileFor } from './textlayer.mjs';
import { spliceFragment, repairDefectPath, repointByContent } from './fixes.mjs';
import { regionsFor, coverFrac } from './snap.mjs';
import { allFigures } from './lib.mjs';
const allFigureBoxes = c => allFigures(c).map(({ fig }) => fig?.tx || {}).filter(t => Array.isArray(t.bbox) && t.bbox.length === 4 && t.page);

const args = parseArgs(process.argv.slice(2), { flags: ['continue', 'no-promote', 'dry-run', 'allow-same-model', 'retry'] });
const paperId = args._[0];
if (!paperId) fail('usage: run.mjs <paperId> --reader <provider:model|agent:label> --checker <provider:model|agent:label> [--continue] [--repaired f] [--no-promote] [--allow-same-model]');
const jobs = readJson(JOBS_FILE, { version: 2, jobs: {} });
let job = jobs.jobs[paperId];
if (args.continue && !job) fail(`no job state for ${paperId} in ${path.relative(ROOT, JOBS_FILE)}`);
// a fresh start on a promoted paper (a second batch parent working through the same plan) would replace the job
// and re-read the paper from scratch; the re-verification route is --continue --retry, the re-read route batch --fresh
if (!args.continue && job?.stage === 'done') fail(`${paperId} is already promoted (job done): re-verify with --continue --retry, or re-read it with batch.mjs --fresh`);
function parseWho(s) {
  const [provider, ...rest] = String(s).split(':');
  const model = rest.join(':');
  if (!provider || !model) fail(`bad stage spec "${s}" (provider:model or agent:label)`);
  if (!['anthropic', 'gemini', 'zai', 'chatgpt', 'agent', 'mechanical'].includes(provider)) fail(`unknown provider "${provider}"`);
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
    options: { reasoning: args.reasoning || null, windowPages: args['window-pages'] || null, timeoutMin: args['timeout-min'] || null, maxRounds: Number(args['max-rounds'] || 2), ...(args['escalation-model'] ? { escalation: parseWho(args['escalation-model']) } : {}) },
    ...(args.problems ? { keys: { problems: args.problems, solutions: args.solutions || null } } : {}), // a paper outside the Bulgarian shards names its archive keys
    round: 0, createdAt: nowIso(), history: [], artefacts: {},
  };
  jobs.jobs[paperId] = job;
}
job.options ||= { maxRounds: 2 };
// --continue may raise the round budget, and --retry re-enters an escalated job
// at the repair stage (its last receipt is still on disk) — used after the
// pipeline learned a new trick, so escalations need not wait for an adjudicator.
if (args.continue && args['max-rounds']) job.options.maxRounds = Number(args['max-rounds']);
if (args.continue && args['escalation-model']) job.options.escalation = parseWho(args['escalation-model']);
if (args.continue && args.retry && !job.waitingFor) { // from any stage: an escalation can also be parked at validate (schema budget) or figures
  // the budget is N more rounds from here, not N in total (earlier rounds already count);
  // a done job re-enters the same way when the pipeline learned a new check (re-promotion replaces the paper)
  job.options.maxRounds = (job.round || 0) + Number(args['max-rounds'] || 2);
  const was = job.stage;
  job.stage = 'validate'; delete job.artefacts.validatedSha256;
  job.history.push({ at: nowIso(), stage: job.stage, note: `retry after ${was === 'done' ? 'promotion' : 'escalation'}: re-validate the current candidate, fresh check; up to ${job.options.maxRounds} rounds` });
}
// Re-read before writing: several run.mjs processes share jobs.json and must not clobber each other's entries.
const save = (note) => { job.updatedAt = nowIso(); if (note) job.history.push({ at: job.updatedAt, stage: job.stage, note }); const current = readJson(JOBS_FILE, { version: 2, jobs: {} }); current.jobs[paperId] = job; jobs.jobs = current.jobs; writeJson(JOBS_FILE, current); };
const node = (script, argv, opts = {}) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'tx', script), ...argv], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const rel = f => path.relative(ROOT, f);
const abs = f => path.isAbsolute(f) ? f : path.join(ROOT, f);
const dir = paperDir(paperId);
// One loop per paper: a second run.mjs on the same paper (two batch parents, a hand retry next to a batch worker)
// would race on the candidates and the job (ipho-2023-experiment-q4 was promoted and "escalated" within a second).
{
  const lockFile = path.join(dir, '.running');
  fs.mkdirSync(dir, { recursive: true });
  const held = readJson(lockFile, null);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  if (held?.pid && held.pid !== process.pid && alive(held.pid)) fail(`another run.mjs (pid ${held.pid}, since ${held.at}) is working on ${paperId}; not starting a second loop`);
  writeJson(lockFile, { pid: process.pid, at: nowIso() });
  const release = () => { try { const cur = readJson(lockFile, null); if (cur?.pid === process.pid) fs.unlinkSync(lockFile); } catch {} };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { release(); process.exit(130); });
}
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
// The model checker re-reads the page with the reader's eyes; the PDF's own text
// layer does not. Its mechanical verdict (textlayer.mjs) is merged into the
// checker output the receipt is built from: omissions, misreadings and unprinted
// words become defects of the same shape (a pass becomes a fail), and a model
// "fix" that would introduce words the document never prints is demoted to info
// — that is how a printed typo gets "corrected" round after round.
function mergeTextLayer(candFile, checkOut) {
  const check = readJson(checkOut, null);
  const manifest = readJson(manifestPath, null);
  const candidate = readJson(candFile, null);
  if (!check || !manifest || !candidate) return null;
  // page numbers typed as strings ("5") make the receipt see an unknown page every round
  const num = o => { if (o && typeof o.page === 'string') { const m = /^\s*["']?(\d+)["']?\s*$/.exec(o.page); if (m) o.page = Number(m[1]); } }; // "5" or a stray-quoted 5"
  for (const p of check.coverage?.pagesRead || []) num(p);
  for (const d of check.defects || []) num(d);
  // a page the document does not have (p.50 of 24: a checker mixing up the two documents) would block the receipt
  // outright; the defect goes to the addressed problem's first page in that document instead
  for (const d of check.defects || []) {
    const pages = manifest.documents?.[d.document]?.pages;
    if (!d.document || !pages || (Number.isInteger(d.page) && d.page >= 1 && d.page <= pages)) continue;
    const m = /^\/problems\/(\d+)/.exec(String(d.path || ''));
    const span = (m && candidate.problems?.[Number(m[1])]?.tx?.sourceSpans || []).find(s => s.document === d.document);
    d.pageAsWritten = d.page; d.page = span?.page || 1;
  }
  if (typeof check.coverage?.problemsChecked === 'string') check.coverage.problemsChecked = Number(check.coverage.problemsChecked);
  // A printed penalty rule ("Task E8: Intentional damage penalty (-0.5 pts)") is not a problem: validate has the
  // reader fold it away, and a checker that still counts it must not block the receipt (eupho-2026-experiment-x)
  if (check.coverage?.problemsChecked === (candidate.problems || []).length + 1 && /penalt|наказ|штраф/i.test(`${check.summary || ''} ${(check.defects || []).map(d => d.description).join(' ')}`)) { check.coverage.problemsCheckedAsWritten = check.coverage.problemsChecked; check.coverage.problemsChecked = candidate.problems.length; }
  // A checker that counts the printed sub-tasks ("10.1 and 10.2": problemsChecked 2 for one problem with two parts)
  // checked the same paper; the count is the paper's problems (ioaa-2021-theory-tq-10-q, blocked twice on the count)
  {
    const nProblems = (candidate.problems || []).length, nParts = (candidate.problems || []).reduce((s, p) => s + (p.parts || []).length, 0);
    const pc = check.coverage?.problemsChecked;
    if (Number.isInteger(pc) && pc !== nProblems && nParts > 0 && (pc === nParts || pc === nProblems + nParts)) { check.coverage.problemsCheckedAsWritten = pc; check.coverage.problemsChecked = nProblems; }
  }
  if (typeof check.coverage?.figuresChecked === 'string') check.coverage.figuresChecked = Number(check.coverage.figuresChecked);
  // a mangled checker path ("/problems/2/problems/2/…", "/p2/statement") is repaired when the repair resolves in the candidate
  let repairedPaths = 0;
  for (const d of check.defects || []) {
    // a checker that types the word instead of the JSON value ("null", "undefined") gave no fix (nof-2024-i-9: three
    // invented points totals with the string "null" slipped past the points rule below and cost a refix round)
    if (typeof d.suggestedFix === 'string' && /^\s*(null|undefined|n\/a)\s*$/i.test(d.suggestedFix)) { d.suggestedFixAsWritten = d.suggestedFix; d.suggestedFix = null; }
    // a JSON "fix" (a spans list, a figure object) on a prose path is bookkeeping echoed back, not text:
    // it must not reach the mechanical merge; a defect about tx bookkeeping (sourceSpans) is a note
    if (typeof d.suggestedFix === 'string' && /^\s*[\[{]\s*["{\[]/.test(d.suggestedFix) && /\/(statement|caption|alt|title|label)$/.test(String(d.path))) { d.suggestedFixAsWritten = d.suggestedFix; delete d.suggestedFix; }
    if (d.kind === 'metadata' && /sourceSpans|\btx\.|\btx\b/.test(String(d.description || ''))) d.severity = 'info';
    // Cyrillic letters in a printed subscript ("\delta_В", "\delta_{СЛ}") are the print; KaTeX draws them (strict mode
    // warns) — a latex defect about them is a note, not a repair (nao-2024-ii-11-12)
    if (d.kind === 'latex' && /cyrillic|кирилиц|кирилски/i.test(String(d.description || '')) && d.severity !== 'info') { d.severity = 'info'; d.description = `[printed Cyrillic in math renders as printed] ${d.description}`; }
    // "10.0 pts" printed, 10 recorded: a points defect whose fix is the same number is a note, not a defect
    if (d.kind === 'points' && /\/(points|totalPoints)$/.test(String(d.path))) { const cur = pointerGet(candidate, String(d.path)); const fix = d.suggestedFix == null ? NaN : Number(String(d.suggestedFix).replace(/[^\d.,-]/g, '').replace(',', '.')); if (typeof cur === 'number' && Number.isFinite(fix) && Math.abs(fix - cur) < 1e-9) { d.severity = 'info'; d.description = `[same number: a formatting remark] ${d.description}`; } }
    // "No point value is printed for Problem 1; candidate invents points: 10": a problem total that is the sum of its
    // parts' printed points is a note; one with nothing printed under it is dropped (ioaa-2014-theory-short-theoretical)
    if (d.kind === 'points' && /^\/problems\/(\d+)\/points$/.test(String(d.path)) && /no point|not printed|nowhere|invent|does not print|no printed|prints no/i.test(String(d.description || '')) && d.suggestedFix == null) {
      const pr = candidate.problems?.[Number(/^\/problems\/(\d+)/.exec(String(d.path))[1])];
      const partPoints = (pr?.parts || []).map(x => x.points).filter(x => typeof x === 'number');
      const sum = partPoints.reduce((s, x) => s + x, 0);
      if (typeof pr?.points === 'number' && partPoints.length && Math.abs(sum - pr.points) < 1e-9) { d.severity = 'info'; d.description = `[the problem total is the sum of its parts' printed points (${partPoints.join(' + ')})] ${d.description}`; }
      else if (typeof pr?.points === 'number') { d.suggestedFix = 'none'; d.description = `[no points printed for the problem: the value is dropped] ${d.description}`; }
    }
    // the same for a part: "The problems document prints no points for part А; the candidate assigns 2" (nao-2024-ii-7-8)
    if (d.kind === 'points' && /^\/problems\/\d+\/parts\/\d+\/points$/.test(String(d.path)) && /no point|not printed|nowhere|invent|does not print|no printed|prints no/i.test(String(d.description || '')) && d.suggestedFix == null && typeof pointerGet(candidate, String(d.path)) === 'number') {
      d.suggestedFix = 'none'; d.description = `[no points printed for the part: the value is dropped] ${d.description}`;
    }
    let p = repairDefectPath(candidate, d.path);
    if (typeof d.suggestedFix === 'string' && !d.source) p = repointByContent(candidate, p, d.suggestedFix);
    // a textual defect addressed to a whole problem or part object belongs to its statement
    if (['omission', 'reworded', 'wrong-value', 'wrong-unit', 'other', 'latex'].includes(d.kind)) { const o = pointerGet(candidate, p); if (o && typeof o === 'object' && !Array.isArray(o) && typeof o.statement === 'string') p = `${p}/statement`; }
    // a missing-figure defect addressed to a problem or its solution (an object) belongs to that object's figures array
    if (d.kind === 'figure' && /^\/problems\/\d+(\/solution)?$/.test(p)) { const o = pointerGet(candidate, p); if (o && typeof o === 'object' && !Array.isArray(o)) p = `${p}/figures`; }
    if (p !== d.path) { d.pathAsWritten = d.path; d.path = p; repairedPaths++; }
  }
  const tl = textLayerCheck(candidate, manifest, paperId);
  const tlFile = checkOut.replace(/\.json$/, '.textlayer.json');
  writeJson(tlFile, tl);
  const trusted = Object.entries(tl.documents).filter(([, i]) => i.trusted).map(([d]) => d);
  let vetoed = 0;
  if (trusted.length && Array.isArray(check.defects)) {
    const printed = new Set();
    for (const doc of trusted) { const f = path.join(dir, manifest.documents[doc].text); for (const m of fs.readFileSync(f, 'utf8').matchAll(/\p{L}+/gu)) printed.add(fixHomoglyphs(m[0]).toLowerCase()); }
    // the prose words of the paper's script (Cyrillic on a Bulgarian paper, Latin on an English one): the veto was
    // blind to every Latin paper until 2026-09-13 (ipho-2022-theory-q3: a checker "fixed" spaghetto → spaghetti)
    const content = profileFor(manifest?.meta?.lang || candidate?.paper?.lang || 'bg').content;
    const wordsOf = s => [...splitMath(String(s)).filter(x => !x.math).map(x => x.text).join(' ').matchAll(/\p{L}+/gu)].map(m => m[0].toLowerCase()).filter(w => w.length >= 4 && content.test(w));
    for (const d of check.defects) {
      if (typeof d.suggestedFix !== 'string' || d.severity === 'info' || !trusted.includes(d.document)) continue;
      // (a) the fix introduces words the document never prints (a rewording, a "corrected" typo)
      const bad = [...new Set(wordsOf(d.suggestedFix).filter(w => w.length >= 5 && !printed.has(w)))];
      // (b) the fix makes a printed word disappear from the field (the checker "fixing" a printed typo the transcription kept)
      const current = pointerGet(candidate, d.path);
      let gone = [];
      if (typeof current === 'string') {
        const after = spliceFragment(current, d.suggestedFix) || d.suggestedFix;
        const keep = new Set(wordsOf(after));
        gone = [...new Set(wordsOf(current).filter(w => printed.has(w) && !keep.has(w)))];
      }
      if (!bad.length && !gone.length) continue;
      d.textLayerVeto = { unprinted: bad, removesPrinted: gone }; d.severity = 'info';
      d.description = `[demoted: the suggested fix ${bad.length ? `uses words the ${d.document} document never prints (${bad.join(', ')})` : ''}${bad.length && gone.length ? ' and ' : ''}${gone.length ? `drops printed words (${gone.join(', ')})` : ''}] ${d.description}`;
      d.suggestedFix = null; vetoed++;
    }
  }
  // a minor model finding the refix model has already disputed (it re-read the page and kept the text) is recorded, not blocking
  let disputed = 0;
  const demoteDisputed = d => {
    const dis = (candidate.tx?.disputed || []).find(x => x.path === d.path);
    if (!dis) return false;
    d.severity = 'info'; d.disputed = dis.note || true; d.description = `[disputed: the refix model re-read the page and kept the current text — ${dis.note || 'no note'}] ${d.description}`; disputed++;
    return true;
  };
  for (const d of check.defects || []) if (d.severity === 'minor' && !d.source) demoteDisputed(d);
  // a minor crop-edge remark on a box a checker or refix already set from the crop is a second opinion, not a defect
  let rejudged = 0;
  for (const d of check.defects || []) {
    if (d.severity !== 'minor' || d.kind !== 'figure' || d.source) continue;
    const m = /^(.*\/figures\/\d+)/.exec(String(d.path || '')); if (!m) continue;
    const fig = pointerGet(candidate, m[1]);
    if (fig?.tx?.boxFrom) { d.severity = 'info'; d.rejudged = true; d.description = `[noted: this box was already set from the crop by the ${fig.tx.boxFrom}] ${d.description}`; rejudged++; }
  }
  check.textLayer = { version: tl.version, checked: trusted, notes: tl.notes, defects: tl.defects.length, vetoedModelFixes: vetoed, disputedMinors: disputed, repairedPaths, unmapped: (tl.unmapped || []).length, file: rel(tlFile) };
  // an "unprinted word" the refix model kept after re-reading the page (no mechanical fix existed) is a text-layer artefact more often than not
  for (const d of tl.defects) if (d.kind === 'reworded' && !d.suggestedFix) demoteDisputed(d);
  if (tl.defects.length) {
    check.defects = [...(check.defects || []), ...tl.defects];
    if (check.verdict === 'pass') check.verdict = 'fail';
    check.summary = `${check.summary || ''} Text-layer check (${trusted.join(', ')}): ${tl.summary.critical} critical, ${tl.summary.major} major, ${tl.summary.minor} minor defect(s), ${tl.summary.withFix} with a mechanical fix.`.trim();
  }
  // A box a checker says swallows body text, while the page's own drawing lies inside it and the box is
  // notably larger: the drawing's extent is the fix — decided by the PDF, not by a third model opinion
  // (ipho-2022-theory-q2: refix and checker traded the same box for five rounds).
  let tightened = 0;
  for (const d of check.defects || []) {
    if (d.source || d.kind !== 'figure' || d.severity === 'info') continue;
    const m = /^(.*\/figures\/\d+)(?:\/tx(?:\/bbox)?)?$/.exec(String(d.path)); if (!m) continue;
    if (!/text|paragraph|caption|body|sentence|line|includes|swallow|extend|too (large|big|wide|tall)|below|above/i.test(String(d.description || ''))) continue;
    const fig = pointerGet(candidate, m[1]); const t = fig?.tx; if (!t?.bbox || !t.document || !t.page) continue;
    const regs = regionsFor(paperId, manifest, t.document)?.pages?.find(pg => pg.page === t.page)?.regions || [];
    const graphic = g => !g.kind || g.kind === 'drawing' || g.kind === 'table';
    const inside = regs.filter(g => graphic(g) && coverFrac(g.core || g.bbox, t.bbox) >= 0.9);
    const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const PAD = 6, clamp = v => Math.round(Math.min(1000, Math.max(0, v)));
    let u = null, verb = 'tightened to';
    if (inside.length) {
      u = inside.map(g => g.bbox).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
      // the box hugs the drawing already (one model opinion against another) unless it is notably larger or
      // runs past the drawing by a text line on some side (a clipped line of body text under it)
      const over = Math.max(t.bbox[2] - u[2], u[0] - t.bbox[0], t.bbox[3] - u[3], u[1] - t.bbox[1]);
      if (area(t.bbox) < 1.1 * area(u) && over < 12) continue;
    } else {
      // the box sits on no drawing at all: when exactly one printed drawing of that page is covered by no figure,
      // the box was put in the wrong place and moves there (ioaa-2014: a celestial sphere in the upper half,
      // the box in the lower middle)
      const boxes = allFigureBoxes(candidate).filter(b => b.document === t.document && b.page === t.page).map(b => b.bbox);
      const free = regs.filter(g => graphic(g) && (g.areaFrac || 0) >= 0.01 && !boxes.some(b => coverFrac(g.core || g.bbox, b) >= 0.3));
      if (free.length !== 1) continue;
      u = free[0].bbox; verb = 'moved to';
    }
    d.suggestedFix = [clamp(u[0] - PAD), clamp(u[1] - PAD), clamp(u[2] + PAD), clamp(u[3] + PAD)];
    d.description = `[box ${verb} the printed drawing at ${JSON.stringify(u.map(Math.round))}] ${d.description}`;
    d.source = 'regions'; tightened++;
  }
  if (tightened) check.regions = { ...(check.regions || {}), tightened };
  // graphics the PDF prints that no figure box covers (figures.mjs, from the same candidate bytes)
  const figRep = readJson(path.join(dir, 'figures-report.json'), null);
  // A solutions document that reprints the problem before solving it reprints its figure too: a graphic on the
  // solutions side whose box is the box of a figure the same problem already has on the problems side is that
  // figure again, not one to add (rmph-2023-theory-t1-eng: three rounds of add / "it is a duplicate" / remove).
  const reprints = [];
  const isReprint = u => {
    if (u.document !== 'solutions' || !Array.isArray(u.bbox)) return false;
    const pr = candidate.problems?.[u.problemIndex];
    const own = [...(pr?.figures || []), ...(pr?.parts || []).flatMap(x => x.figures || [])].map(f => f?.tx).filter(t => t?.document === 'problems' && Array.isArray(t.bbox));
    const iou = (a, b) => { const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])); const inter = ix * iy; const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter; return ua > 0 ? inter / ua : 0; };
    return own.some(t => iou(t.bbox, u.bbox) >= 0.6);
  };
  const unplaced = (figRep?.unplaced || []).filter(u => u.defect && !(isReprint(u) && reprints.push(u))).map(u => u.defect);
  check.regions = { unplaced: (figRep?.unplaced || []).length, raised: unplaced.length, ...(reprints.length ? { reprints: reprints.map(u => ({ page: u.page, bbox: u.bbox.map(Math.round) })) } : {}) };
  if (reprints.length) (check.defects ||= []).push(...reprints.map(u => ({ path: u.path, document: u.document, page: u.page, severity: 'info', kind: 'figure', source: 'regions', confidence: 0.9, description: `[the solutions page reprints the problem's figure at ${JSON.stringify(u.bbox.map(Math.round))}; not a figure to add] ` })));
  if (unplaced.length) {
    check.defects = [...(check.defects || []), ...unplaced];
    if (check.verdict === 'pass') check.verdict = 'fail';
    check.summary = `${check.summary || ''} Region check: ${unplaced.length} printed graphic(s) not covered by any figure.`.trim();
  }
  // the verdict follows the defect list (a model sometimes says pass while listing defects, and the receipt refuses that every round)
  if (check.verdict !== 'escalate') { const open = (check.defects || []).some(d => d.severity && d.severity !== 'info'); if (open && check.verdict === 'pass') { check.verdict = 'fail'; check.verdictAdjusted = 'pass with defects listed'; } else if (!open && check.verdict === 'fail') { check.verdict = 'pass'; check.verdictAdjusted = 'fail with no open defect'; } }
  // every defect the receipt will read — the checker's, the text layer's, the region check's, a disputed one carried
  // from an earlier round — needs a page the document has (ioaa-2014-theory-short-theoretical: a carried text-layer
  // defect on "solutions p.50" of 24 blocked nine receipts)
  for (const d of check.defects || []) {
    const pages = manifest.documents?.[d.document]?.pages;
    if (!d.document || !pages) { const doc = Object.keys(manifest.documents || {})[0]; if (doc && (!d.document || !manifest.documents[d.document])) { d.documentAsWritten = d.document; d.document = doc; } }
    const n = manifest.documents?.[d.document]?.pages;
    if (n && !(Number.isInteger(d.page) && d.page >= 1 && d.page <= n)) {
      const m = /^\/problems\/(\d+)/.exec(String(d.path || ''));
      const span = (m && candidate.problems?.[Number(m[1])]?.tx?.sourceSpans || []).find(s => s.document === d.document);
      d.pageAsWritten = d.page; d.page = span?.page || 1;
    }
  }
  writeJson(checkOut, check);
  tl.regionDefects = unplaced.length;
  return tl;
}
// The free checks alone, shaped like a checker output so mergeTextLayer/repair.mjs read it unchanged: an empty
// verdict-pass check that the text layer and the region check then fill. Returns the open (non-info) defects.
function mechanicalPrecheck(candFile) {
  const candidate = readJson(candFile, null);
  if (!candidate) return null;
  const file = checkerOutFor(job.round).replace(/\.json$/, '.mech.json');
  writeJson(file, {
    verdict: 'pass', defects: [], summary: 'mechanical pre-check (text layer, printed regions); no model was asked',
    coverage: { pagesRead: [], problemsChecked: (candidate.problems || []).length, figuresChecked: allFigures(candidate).length },
    checker: { provider: 'mechanical', model: 'textlayer+regions', requestId: `mech-r${job.round}`, promptVersion: 'n/a', candidateSha256: sha256File(candFile) },
  });
  mergeTextLayer(candFile, file);
  const check = readJson(file, null);
  const open = (check?.defects || []).filter(d => d.severity && d.severity !== 'info');
  return { file, open, withFix: open.filter(d => d.suggestedFix != null && d.suggestedFix !== '').length, summary: check?.summary || '' };
}
// an operator- or adjudicator-supplied candidate re-enters at validate
if (args.continue && args.repaired) {
  let f = path.resolve(args.repaired);
  if (!fs.existsSync(f)) fail(`--repaired file not found: ${f}`);
  // a repaired candidate built from a checker view (no tx block) inherits the current candidate's tx: notFigures,
  // disputed and repairs are evidence the region check and the dispute rounds rely on (eupho-2025-experiment-x
  // came back with nine region defects the earlier rounds had already settled)
  {
    const supplied = readJson(f, null), current = job.artefacts.candidate ? readJson(abs(job.artefacts.candidate), null) : null;
    if (supplied && !supplied.tx && current?.tx) {
      const merged = f.replace(/\.json$/, '') + '.tx.json';
      writeJson(merged, { ...supplied, tx: current.tx });
      console.log(`[run] repaired candidate has no tx block; ${rel(merged)} carries the current candidate's tx (${Object.keys(current.tx).join(', ')})`);
      f = merged;
    }
  }
  job.round = (job.round || 0) + 1;
  job.artefacts.candidate = rel(f); delete job.artefacts.candidateWithFigures; delete job.artefacts.validatedSha256; job.waitingFor = null;
  job.stage = 'validate'; save(`repaired candidate supplied (${rel(f)}), round ${job.round}`);
}
const currentCandidate = () => abs(job.artefacts.candidateWithFigures || job.artefacts.candidate);
const require_sig = report => sha256(JSON.stringify((report?.errors || []).map(e => `${e.path}|${e.message}`).sort())).slice(0, 12);
const needsRevalidate = () => !job.artefacts.validatedSha256 || sha256File(abs(job.artefacts.candidate)) !== job.artefacts.validatedSha256;

// ---- state machine
for (;;) {
  if (job.stage === 'prepare') {
    const r = node('prepare.mjs', [paperId, ...(job.keys?.problems ? ['--problems', job.keys.problems] : []), ...(job.keys?.solutions ? ['--solutions', job.keys.solutions] : [])]);
    if (r.status !== 0) { save(`prepare failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    job.artefacts.manifest = rel(manifestPath);
    job.stage = 'reader'; save('prepared');
  } else if (job.stage === 'reader') {
    if (fs.existsSync(readerOut) && job.waitingFor?.stage === 'reader') { job.waitingFor = null; job.artefacts.candidate = rel(readerOut); job.stage = 'validate'; save('agent candidate received'); continue; }
    // A compilation (icho-21st-40th: 733 pages, ioaa-until-2013-by-topic: 254) is not a paper: it would cost tens of
    // dollars of reading and checking and come out as one unusable record. Parked before any model call unless
    // --max-pages raises the cap (default 120 pages over both documents; IZhO theory + solutions runs to 68).
    {
      const cap = Number(args['max-pages'] || job.options.maxPages || 120);
      const pages = Object.values(readJson(manifestPath, { documents: {} }).documents).reduce((a, d) => a + (d.pages || 0), 0);
      if (pages > cap && !job.artefacts.candidate) escalate(`too long for the bulk run: ${pages} pages over both documents (cap ${cap}; pass --max-pages to override) — a compilation to split, not a paper`);
    }
    if (job.reader.provider === 'agent') waitForAgent('reader', readerOut);
    const r = node('transcribe.mjs', [paperId, '--provider', job.reader.provider, '--model', job.reader.model, '--stage', 'reader', ...transcribeOpts, ...(job.options.windowPages ? ['--window-pages', String(job.options.windowPages)] : []), ...(job.dryRun ? ['--dry-run'] : [])]);
    if (r.status !== 0 && r.status !== 3) { save(`reader failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    if (job.dryRun) { save('dry-run: reader payload built, stopping'); console.log(r.stdout); process.exit(0); }
    // The model ran out of output tokens (stop reason "length"): the JSON was truncated and repaired, which
    // loses the tail of a long solution. Read again in smaller page windows, once per halving down to 3 pages.
    if (/"stopReason":\s*"(length|max_tokens)"/.test(r.stdout)) {
      const pages = Object.values(readJson(manifestPath, { documents: {} }).documents).reduce((a, d) => a + (d.pages || 0), 0);
      const current = job.options.windowPages || pages;
      const smaller = Math.max(3, Math.floor(current / 2));
      if (smaller < current) { job.options.windowPages = smaller; job.readerRetries = (job.readerRetries || 0) + 1; save(`reader output was cut off (stop reason length); reading again in windows of ${smaller} page(s)`); continue; }
    }
    job.artefacts.candidate = rel(readerOut); job.stage = 'validate'; save(r.status === 3 ? 'reader done (assembly incomplete; validate will report)' : 'reader done');
  } else if (job.stage === 'validate') {
    // rule-based normalisation first (figure geometry under tx, numeric answers, dates, KaTeX spacing)
    {
      const src = abs(job.artefacts.candidate);
      const data = readJson(src, null);
      if (data && typeof data === 'object') {
        const before = JSON.stringify(data);
        { const docs = readJson(manifestPath, null)?.documents || {}; normaliseCandidate(data, { solutionsDocument: !!docs.solutions, documents: Object.keys(docs) }); }
        // the archive keys are the manifest's, never the reader's copy of a long Cyrillic path
        const man = readJson(manifestPath, null);
        if (man?.documents?.problems && data.paper) {
          data.paper.source = { ...(data.paper.source || {}), archiveKey: man.documents.problems.key };
          if (man.documents.solutions) data.paper.solutionSource = { ...(data.paper.solutionSource || {}), archiveKey: man.documents.solutions.key };
          else if (data.paper.solutionSource) delete data.paper.solutionSource;
          // the competition code and subject are the catalogue's (the printed name lives in tx.printedMeta): a reader
          // that writes "НОФ" for NOF (nof-2024-i-12) parks the paper at validate for nothing
          for (const k of ['competition', 'subject']) if (man.meta?.[k] && data.paper[k] !== man.meta[k]) { (data.tx ||= {}).normalised = [...(data.tx.normalised || []), `/paper/${k}: "${data.paper[k]}" → catalogue "${man.meta[k]}"`]; data.paper[k] = man.meta[k]; }
        }
        if (JSON.stringify(data) !== before) {
          const out = /\.norm\.json$/.test(src) ? src : src.replace(/\.json$/, '.norm.json'); // a later rule may still apply to an already-normalised file
          writeJson(out, data);
          job.artefacts.candidate = rel(out); delete job.artefacts.candidateWithFigures; delete job.artefacts.validatedSha256;
          save(`normalised: ${(data.tx?.normalised || []).slice(-3).join('; ').slice(0, 200)}`);
        }
      }
    }
    const cand = abs(job.artefacts.candidate);
    const r = node('validate.mjs', [cand, '--paper-id', paperId, '--manifest', manifestPath, '--quiet']);
    process.stdout.write(r.stdout);
    if (r.status !== 0) {
      const full = node('validate.mjs', [cand, '--paper-id', paperId, '--manifest', manifestPath]);
      fs.writeFileSync(path.join(dir, 'validate.json'), full.stdout);
      // An API reader gets two chances to fix its own schema slips from the pages
      // (a malformed date, a part without its label, an unbalanced $) through the
      // refix stage; every validator error becomes a defect at its path.
      let report = null; try { report = JSON.parse(full.stdout); } catch {}
      // two attempts per distinct set of validator errors (a new slip after repairs gets its own budget)
      const sig = require_sig(report);
      job.schemaAttempts ||= {};
      const tries = job.schemaAttempts[sig] || 0;
      if ((job.reader.provider !== 'agent' || job.checker.provider !== 'agent') && report?.errors?.length && tries < 2) {
        const defectsFile = cand.replace(/\.json$/, `.s${tries + 1}.defects.json`);
        writeJson(defectsFile, { unapplied: report.errors.map(e => ({ path: e.path || '/paper', kind: 'schema', severity: 'major', description: `validator: ${e.message}` })) });
        const fixed = cand.replace(/\.json$/, `.s${tries + 1}.json`);
        const who = job.reader.provider === 'agent' ? job.checker : job.reader; const x = node('transcribe.mjs', [paperId, '--provider', who.provider, '--model', who.model, '--stage', 'refix', '--candidate', cand, '--defects', defectsFile, '--out', fixed, '--round', String(job.round), ...transcribeOpts]);
        process.stdout.write(x.stdout);
        job.schemaAttempts[sig] = tries + 1; job.schemaTries = (job.schemaTries || 0) + 1;
        if ((x.status === 0 || x.status === 3) && fs.existsSync(fixed)) { job.artefacts.candidate = rel(fixed); save(`schema refix ${tries + 1}: ${(x.stdout.match(/"applied": (\d+)/) || [])[1] || '?'} fix(es) applied; re-validating`); continue; }
        save(`schema refix failed: ${(x.stderr || '').slice(0, 200)}`);
      }
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
    // Mechanical pre-check (memo 2026-09-14: the paid checker was two thirds of the spend, and most first-round
    // failures were things the PDF itself decides). The free checks — text layer, printed graphics no box covers,
    // boxes to tighten — run first; what they find is repaired (and refixed) BEFORE a model is asked, so the
    // checker sees a candidate the document already agrees with. At most two such rounds per job; they do not
    // count against --max-rounds. The receipt written for such a round is marked mechanical and never promotes.
    // --checker mechanical:<label> (D-P21): no second model at all — the free checks are the check. Open defects go
    // through repair/refix (and the escalation model) like any checker's; a clean run is a pass whose coverage is
    // every page of every document (the text layer and the region check read them all).
    if (job.checker.provider === 'mechanical') {
      const mech = mechanicalPrecheck(cand);
      if (!mech) fail('mechanical check could not read the candidate');
      if (mech.open.length && (job.options.mechRounds || 0) < 2) {
        job.options.mechRounds = (job.options.mechRounds || 0) + 1; job.options.mechPending = true;
        writeJson(receiptOut, { paperId, verdict: 'fail', mechanical: true, candidateSha256: sha256File(cand), checkedAt: nowIso(), summary: mech.summary, defects: mech.open, blockers: [] });
        fs.copyFileSync(receiptOut, path.join(dir, `receipt.r${job.round}.mech.json`));
        job.artefacts.receipt = rel(receiptOut); job.artefacts.checker = rel(mech.file);
        job.stage = 'repair'; save(`mechanical check: ${mech.open.length} defect(s) (${mech.withFix} with a fix); repairing`); continue;
      }
      const man = readJson(manifestPath, { documents: {} });
      const check = readJson(mech.file, null);
      check.coverage.pagesRead = Object.entries(man.documents).flatMap(([document, d]) => Array.from({ length: d.pages || 0 }, (_, i) => ({ document, page: i + 1 })));
      check.candidateSha256 = sha256File(cand);
      check.checker = { ...(check.checker || {}), provider: 'mechanical', model: job.checker.model, promptVersion: 'mech-v1', candidateSha256: check.candidateSha256 };
      check.summary = `Mechanical check only (no second model): ${check.summary || ''}`.trim();
      writeJson(checkerOut, check);
      job.artefacts.checker = rel(checkerOut); job.stage = 'receipt'; save(`mechanical check ${mech.open.length ? `still ${mech.open.length} open defect(s) after ${job.options.mechRounds} repair round(s)` : 'clean'}; to the receipt`); continue;
    }
    if (job.checker.provider !== 'agent' && !job.waitingFor && (job.options.mechRounds || 0) < 2) {
      const mech = mechanicalPrecheck(cand);
      if (mech?.open.length) {
        job.options.mechRounds = (job.options.mechRounds || 0) + 1; job.options.maxRounds += 1; job.options.mechPending = true;
        writeJson(receiptOut, { paperId, verdict: 'fail', mechanical: true, candidateSha256: sha256File(cand), checkedAt: nowIso(), summary: mech.summary, defects: mech.open, blockers: [] });
        fs.copyFileSync(receiptOut, path.join(dir, `receipt.r${job.round}.mech.json`));
        job.artefacts.receipt = rel(receiptOut); job.artefacts.checker = rel(mech.file);
        job.stage = 'repair'; save(`mechanical pre-check: ${mech.open.length} defect(s) from the text layer / printed regions (${mech.withFix} with a fix); repairing before the checker`); continue;
      }
    }
    if (fs.existsSync(checkerOut) && job.waitingFor?.stage === 'checker') { job.waitingFor = null; const tl = mergeTextLayer(cand, checkerOut); job.artefacts.checker = rel(checkerOut); job.stage = 'receipt'; save(`agent checker output received; text-layer check: ${tl ? tl.defects.length : '?'} defect(s)`); continue; }
    if (job.checker.provider === 'agent') waitForAgent('checker', checkerOut, ['--candidate', cand]);
    const r = node('transcribe.mjs', [paperId, '--provider', job.checker.provider, '--model', job.checker.model, '--stage', 'checker', '--candidate', cand, '--out', checkerOut, ...transcribeOpts]);
    if (r.status !== 0) { save(`checker failed: ${r.stderr.slice(0, 300)}`); fail(r.stderr); }
    const tl = mergeTextLayer(cand, checkerOut);
    job.artefacts.checker = rel(checkerOut); job.stage = 'receipt'; save(`checker done; text-layer check (${tl ? tl.summary.checked.join(', ') || 'no trusted layer' : 'skipped'}): ${tl ? tl.defects.length : '?'} defect(s)`);
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
    // The reader split one printed problem into several: when the checker counts one and the archive inventory
    // lists one, the extra entries are folded into the first as parts and the loop goes on (izho-2013-experiment).
    const listedProblems = readJson(path.join(dir, 'manifest.json'), null)?.meta?.listed?.problems;
    if (receipt.blockers?.some(b => /problemsChecked/.test(b)) && check?.coverage?.problemsChecked === 1 && listedProblems === 1 && !job.options.foldedProblems) {
      const cand = readJson(currentCandidate());
      if ((cand?.problems || []).length > 1 && mergeProblemsIntoOne(cand)) {
        const folded = currentCandidate().replace(/\.json$/, '.folded.json');
        writeJson(folded, normaliseCandidate(cand));
        job.options.foldedProblems = true; job.round = (job.round || 0) + 1;
        job.artefacts.candidate = rel(folded); delete job.artefacts.candidateWithFigures; delete job.artefacts.validatedSha256;
        job.stage = 'validate'; save(`the checker counts one printed problem and the inventory lists one: ${cand.problems[0].parts.length} parts now, re-validating`); continue;
      }
    }
    if (receipt.blockers?.length && !receipt.defects?.length) {
      // a checker that skipped pages ("has not covered 2 source page(s)") gets one fresh check before the paper is
      // parked (nao-2018-ii-7-8, nao-2023-iii-11-12, nao-2016-iii-7-8-prak: the escalation queue was the only route)
      if (receipt.blockers.every(b => /has not covered/.test(b)) && !job.options.coverageRetried && job.round < job.options.maxRounds) {
        job.options.coverageRetried = true; job.round = (job.round || 0) + 1; job.stage = 'checker';
        save(`checker skipped pages (${receipt.blockers[0].slice(0, 100)}); a fresh check, round ${job.round}`); continue;
      }
      escalate(`receipt blocked without repairable defects: ${receipt.blockers.join('; ')}`);
    }
    if (job.round >= job.options.maxRounds) {
      // --escalation-model (D-P19: Fable 5.1): before a paper parks on leftover defects, the strongest model gets one
      // refix on them — once per job, with one more round for the fresh check
      if (job.options.escalation && !job.options.escalationUsed) { job.options.escalationUsed = true; job.options.escalateNextRefix = true; job.options.maxRounds = job.round + 1; job.stage = 'repair'; save(`round budget spent with ${receipt.defects?.length} defect(s) left: one refix by the escalation model ${job.options.escalation.provider}:${job.options.escalation.model}, then a fresh check`); continue; }
      escalate(`still ${receipt.defects?.length} defect(s) after ${job.round} repair round(s)`);
    }
    job.stage = 'repair'; save(`receipt: fail (${receipt.defects?.length} defects); repairing`);
  } else if (job.stage === 'repair') {
    job.round += 1;
    const mechRound = !!job.options.mechPending; job.options.mechPending = false;
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
      // the re-read is done by the reader model, or by the checker model when the reader was a harness agent (from-final route)
      const escalateNow = !!job.options.escalateNextRefix; job.options.escalateNextRefix = false;
      const refixWho = escalateNow ? job.options.escalation : (job.reader.provider === 'agent' ? job.checker : job.reader);
      if (refixWho.provider === 'agent') escalate(`repair.mjs could not apply ${rep.skipped} defect(s) (no usable suggestedFix); applied ${rep.applied}`);
      const reportFile = repaired.replace(/\.json$/, '.repair.json');
      writeJson(reportFile, rep);
      const refixed = repaired.replace(/\.json$/, '.x.json');
      const x = node('transcribe.mjs', [paperId, '--provider', refixWho.provider, '--model', refixWho.model, '--stage', 'refix', '--candidate', repaired, '--defects', reportFile, '--out', refixed, '--round', String(job.round), ...transcribeOpts]);
      process.stdout.write(x.stdout);
      if ((x.status !== 0 && x.status !== 3) || !fs.existsSync(refixed)) { save(`refix failed: ${(x.stderr || '').slice(0, 300)}`); escalate(`repair.mjs could not apply ${rep.skipped} defect(s) and refix failed: ${(x.stderr || '').slice(0, 200)}`); }
      const xr = JSON.parse(x.stdout || '{}');
      writeJson(refixed.replace(/\.json$/, '.report.json'), xr);
      job.artefacts.candidate = rel(refixed);
      // Leftovers are not the end of the road while the round made progress: the
      // fresh checker sees the repaired candidate and may phrase them next time.
      // Escalate only when nothing at all could be applied this round.
      // When everything left is a minor defect the refix disputed (it re-read the page and kept the text), the
      // next check records them as notes — but only if there is a next check: grant one more round, once
      // (izho-2021-experiment-exp-eng parked at max rounds on two disputed minors).
      const leftovers = xr.unapplied || [];
      const allDisputedMinor = leftovers.length > 0 && leftovers.every(u => /disputed/.test(String(u.reason)) && u.severity === 'minor');
      if (allDisputedMinor && !job.options.disputeRound) { job.options.disputeRound = true; job.options.maxRounds = Math.max(job.options.maxRounds, job.round + 1); save(`every leftover is a minor defect the refix disputed: one more check to record them as notes`); }
      // a mechanical round that settled nothing is not a dead end: the paid checker has not spoken yet — it runs next
      // (and no further pre-check is attempted on this job)
      else if (x.status === 3 && rep.applied + (xr.applied || 0) === 0 && mechRound) { job.options.mechRounds = 2; save(`mechanical pre-check leftovers could not be settled from the pages (${xr.skipped}); the checker decides`); }
      // the reader model could settle nothing: the escalation model reads the same pages once before the paper parks
      else if (x.status === 3 && rep.applied + (xr.applied || 0) === 0 && job.options.escalation && !job.options.escalationUsed && !escalateNow) {
        job.options.escalationUsed = true;
        const esc = job.options.escalation, refixed2 = repaired.replace(/\.json$/, '.esc.json');
        const y = node('transcribe.mjs', [paperId, '--provider', esc.provider, '--model', esc.model, '--stage', 'refix', '--candidate', repaired, '--defects', reportFile, '--out', refixed2, '--round', String(job.round), ...transcribeOpts]);
        process.stdout.write(y.stdout);
        const yr = (y.status === 0 || y.status === 3) && fs.existsSync(refixed2) ? JSON.parse(y.stdout || '{}') : null;
        if (yr) writeJson(refixed2.replace(/\.json$/, '.report.json'), yr);
        if (yr && (yr.applied || 0) > 0) { job.artefacts.candidate = rel(refixed2); save(`escalation refix by ${esc.provider}:${esc.model} applied ${yr.applied} defect(s) the reader could not${y.status === 3 ? `, ${yr.skipped} left` : ''}, round ${job.round}`); }
        else escalate(`nothing could be applied this round: repair skipped ${rep.skipped}, refix could not settle ${xr.skipped} defect(s) from the pages; the escalation model ${esc.provider}:${esc.model} ${yr ? `disputed them too (${yr.skipped} left)` : `failed: ${(y.stderr || '').slice(0, 160)}`}`);
      }
      else if (x.status === 3 && rep.applied + (xr.applied || 0) === 0) escalate(`nothing could be applied this round: repair skipped ${rep.skipped}, refix could not settle ${xr.skipped} defect(s) from the pages`);
      save(`refix applied ${xr.applied} defect(s) the checker could not phrase${x.status === 3 ? `, ${xr.skipped} left for the next round` : ''}, round ${job.round}`);
    }
    job.stage = 'validate'; save(`repaired ${rep.applied} defect(s), round ${job.round}; re-validating, re-cropping, fresh check`);
  } else if (job.stage === 'promote') {
    const r = node('promote.mjs', [paperId, '--candidate', currentCandidate(), '--receipt', receiptOut, ...(job.history.some(h => h.note === 'promoted') || fs.existsSync(path.join(ROOT, 'content', 'problems')) && findContentFile(paperId) ? ['--replace'] : [])]); // a re-run of a promoted paper replaces it (new hash, new approval)
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
