#!/usr/bin/env node
// spend.mjs [--provider anthropic|zai|gemini|chatgpt|all] [--since ISO] [--budget-usd 453.85] [--top 10] [--json] [--watch N]
// Read-only status and spend monitor for a provider run (default: the Anthropic grant run since 2026-09-17T00:00Z).
// Reads tmp/tx/runs.jsonl (one line per model call), tmp/tx/jobs.json, tmp/tx/batch.log + tmp/tx/batch-*.log
// (one line per finished paper), content/problem-publication.json (the ledger) and `backlog.mjs --json --catalogue`
// (the catalogue papers not yet in content). Writes nothing. A missing file counts as empty; a half-written
// line or file is skipped and reported under "warnings". Money in flight (a call that has not returned yet) is
// invisible to runs.jsonl and therefore to this report.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, TX_DIR, RUNS_FILE, JOBS_FILE, readJson, parseArgs, sleep } from './lib.mjs';

const LEDGER_FILE = path.join(ROOT, 'content', 'problem-publication.json');
const BACKLOG_SCRIPT = path.join(ROOT, 'scripts', 'tx', 'backlog.mjs');
const DEFAULTS = { provider: 'anthropic', since: '2026-09-17T00:00:00Z', budgetUsd: 453.85, top: 10, inflightMin: 10 };

const args = parseArgs(process.argv.slice(2), { flags: ['json', 'help'] });
if (args.help) {
  console.log('usage: node scripts/tx/spend.mjs [--provider anthropic|zai|gemini|chatgpt|all] [--since ISO] [--budget-usd N] [--top N] [--inflight-min N] [--json] [--watch [seconds]]');
  process.exit(0);
}
const opts = {
  provider: String(args.provider || DEFAULTS.provider).toLowerCase(),
  since: args.since ? String(args.since) : DEFAULTS.since,
  budgetUsd: args['budget-usd'] !== undefined ? Number(args['budget-usd']) : DEFAULTS.budgetUsd,
  top: args.top === true ? DEFAULTS.top : args.top !== undefined ? Number(args.top) : DEFAULTS.top,
  inflightMin: args['inflight-min'] !== undefined ? Number(args['inflight-min']) : DEFAULTS.inflightMin,
  json: !!args.json,
  watch: args.watch === undefined ? null : args.watch === true ? 30 : Number(args.watch),
};
if (Number.isNaN(Date.parse(opts.since))) { console.error(`error: --since is not a date: ${opts.since}`); process.exit(1); }
if (!Number.isFinite(opts.budgetUsd)) { console.error('error: --budget-usd must be a number'); process.exit(1); }
if (!Number.isInteger(opts.top) || opts.top < 0) { console.error('error: --top must be a non-negative integer'); process.exit(1); }
if (opts.watch !== null && !(opts.watch > 0)) { console.error('error: --watch takes a number of seconds'); process.exit(1); }
opts.since = new Date(opts.since).toISOString();

// ---------------------------------------------------------------- readers (tolerant)
function readJsonl(file, warnings) {
  if (!fs.existsSync(file)) { warnings.push(`${path.relative(ROOT, file)} is missing`); return []; }
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { warnings.push(`${path.relative(ROOT, file)}: ${e.code || e.message}`); return []; }
  const rows = [];
  let bad = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && typeof r === 'object') rows.push(r); else bad++; } catch { bad++; }
  }
  if (bad) warnings.push(`${path.relative(ROOT, file)}: ${bad} unparsable line(s) skipped (a write in progress, or damage)`);
  return rows;
}
function safeJson(file, fallback, warnings) {
  try { const v = readJson(file, undefined); if (v === undefined) warnings.push(`${path.relative(ROOT, file)} is missing`); return v ?? fallback; }
  catch (e) { warnings.push(`${path.relative(ROOT, file)}: ${e.code || e.message} (partial write?)`); return fallback; }
}
function batchLogFiles() {
  if (!fs.existsSync(TX_DIR)) return [];
  return fs.readdirSync(TX_DIR).filter(f => f === 'batch.log' || /^batch-.*\.log$/.test(f)).map(f => path.join(TX_DIR, f));
}
function catalogueBacklog(warnings) {
  const r = spawnSync(process.execPath, [BACKLOG_SCRIPT, '--json', '--catalogue'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) { warnings.push(`backlog.mjs failed: ${(r.error?.message || r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`}`); return null; }
  try { const a = JSON.parse(r.stdout); return Array.isArray(a) ? a : null; } catch { warnings.push('backlog.mjs printed no JSON array'); return null; }
}

// ---------------------------------------------------------------- collect
const ms = at => { const t = Date.parse(at); return Number.isNaN(t) ? null : t; };
const isTimeout = r => r.status == null && /timeout|timed out|ETIMEDOUT|UND_ERR_(HEADERS|BODY)_TIMEOUT|AbortError|no reply within/i.test(String(r.error || ''));
const TERMINAL_STAGES = new Set(['done', 'promoted', 'escalated']);

export function collect(o = opts) {
  const warnings = [];
  const now = Date.now();
  const sinceMs = Date.parse(o.since);
  const inPeriod = at => { const t = ms(at); return t !== null && t >= sinceMs; };
  const providerMatch = p => o.provider === 'all' || String(p || '').toLowerCase() === o.provider;

  // --- model calls
  const runsAll = readJsonl(RUNS_FILE, warnings);
  const runs = runsAll.filter(r => providerMatch(r.provider) && inPeriod(r.at));
  const cost = r => (r.ok && typeof r.costUsd === 'number' ? r.costUsd : 0);
  const stageRow = stage => ({ stage, calls: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, seconds: 0 });
  const byStage = new Map(), byModel = new Map(), perPaper = new Map();
  const errors = { http429: 0, http5xx: 0, timeouts: 0, http4xxOther: 0, other: 0 };
  let total = stageRow('total'), firstAt = null, lastAt = null;
  const uncosted = { calls: 0, byModel: {} }; // successful calls whose model has no price: they count as $0 below
  // provisional (booked at enqueue by the batch transport) and withdrawn lines are bookkeeping, not calls; the
  // committed money they represent is reported separately
  let provisionalUsd = 0, provisionalCount = 0;
  const settled = new Set(runs.filter(r => r.ok && r.customId).map(r => r.customId));
  for (const r of runs) {
    if (r.provisional) { if (!settled.has(r.customId)) { provisionalUsd += r.costUsd || 0; provisionalCount++; } continue; }
    if (r.withdrawn) continue;
    const rows = [byStage.get(r.stage) || byStage.set(r.stage, stageRow(r.stage)).get(r.stage), byModel.get(r.model) || byModel.set(r.model, stageRow(r.model)).get(r.model), total];
    for (const s of rows) {
      s.calls++;
      if (r.ok) { s.ok++; s.inputTokens += r.inputTokens || 0; s.outputTokens += r.outputTokens || 0; s.costUsd += cost(r); s.seconds += r.seconds || 0; } else s.failed++;
    }
    if (r.ok && typeof r.costUsd !== 'number') {
      uncosted.calls++;
      const u = uncosted.byModel[r.model] ||= { calls: 0, inputTokens: 0, outputTokens: 0 };
      u.calls++; u.inputTokens += r.inputTokens || 0; u.outputTokens += r.outputTokens || 0;
    }
    if (!r.ok) {
      const st = Number(r.status);
      if (st === 429) errors.http429++;
      else if (st >= 500 && st < 600) errors.http5xx++;
      else if (isTimeout(r)) errors.timeouts++;
      else if (st >= 400 && st < 500) errors.http4xxOther++;
      else errors.other++;
    }
    const t = ms(r.at);
    if (t !== null) { if (firstAt === null || t < firstAt) firstAt = t; if (lastAt === null || t > lastAt) lastAt = t; }
    const p = perPaper.get(r.paperId) || perPaper.set(r.paperId, { paperId: r.paperId, calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, stages: {}, lastAt: null }).get(r.paperId);
    p.calls++;
    if (r.ok) { p.inputTokens += r.inputTokens || 0; p.outputTokens += r.outputTokens || 0; p.costUsd += cost(r); p.stages[r.stage] = (p.stages[r.stage] || 0) + cost(r); } else p.failed++;
    if (t !== null && (p.lastAt === null || t > p.lastAt)) p.lastAt = t;
  }
  if (uncosted.calls) warnings.push(`${uncosted.calls} successful call(s) carry no costUsd and count as $0 here: ${Object.entries(uncosted.byModel).map(([m, u]) => `${m} ${u.calls} call(s), ${u.inputTokens.toLocaleString('en-US')} in / ${u.outputTokens.toLocaleString('en-US')} out tokens`).join('; ')} (add the model to scripts/tx/prices.json)`);
  const spent = total.costUsd;
  const lastHourSpend = runs.filter(r => r.ok && ms(r.at) >= now - 3600e3).reduce((a, r) => a + cost(r), 0);
  const lastHourCalls = runs.filter(r => ms(r.at) >= now - 3600e3).length;
  const spanHours = firstAt !== null && lastAt !== null ? (lastAt - firstAt) / 3600e3 : 0;
  // the last-hour window is shorter than an hour while the run is younger than that
  const lastHourWindow = firstAt === null ? 0 : Math.min(1, Math.max((now - firstAt) / 3600e3, 1 / 60));
  const lastHourRate = lastHourWindow > 0 ? lastHourSpend / lastHourWindow : null;

  // --- jobs and batch logs -> one outcome per paper in the period
  const jobsDoc = safeJson(JOBS_FILE, { jobs: {} }, warnings);
  const jobs = Object.entries(jobsDoc.jobs || {}).map(([id, j]) => ({ paperId: id, ...j }));
  const jobById = new Map(jobs.map(j => [j.paperId, j]));
  const logFiles = batchLogFiles();
  const batch = [];
  for (const f of logFiles) for (const e of readJsonl(f, warnings)) if (inPeriod(e.at)) batch.push({ ...e, file: path.basename(f) });
  batch.sort((a, b) => (ms(a.at) || 0) - (ms(b.at) || 0));
  const spendCapEvents = batch.filter(e => e.outcome === 'spend-cap');
  const outcome = new Map(); // paperId -> { outcome, at, source, stage, round, receipt }
  const record = (paperId, o) => { const cur = outcome.get(paperId); if (!cur || (ms(o.at) || 0) >= (ms(cur.at) || 0)) outcome.set(paperId, o); };
  const jobProvider = j => providerMatch(j.reader?.provider) || providerMatch(j.checker?.provider);
  // a batch-log line names no provider: the paper's job does (a paper without a job is kept)
  const paperMatch = id => { const j = jobById.get(id); return !j || jobProvider(j); };
  for (const e of batch) if (e.paperId && e.outcome && e.outcome !== 'skipped' && e.outcome !== 'spend-cap' && paperMatch(e.paperId)) record(e.paperId, { outcome: e.outcome, at: e.at, source: e.file, stage: e.stage ?? null, round: e.round ?? null, receipt: e.receipt ?? null });
  for (const j of jobs) {
    if (!jobProvider(j)) continue;
    const promotedAt = (j.history || []).filter(h => h.note === 'promoted' && inPeriod(h.at)).map(h => h.at).sort().pop();
    if (promotedAt) record(j.paperId, { outcome: 'promoted', at: promotedAt, source: 'jobs.json', stage: 'done', round: j.round ?? null, receipt: 'pass' });
    else if (j.stage === 'escalated' && inPeriod(j.updatedAt)) record(j.paperId, { outcome: 'escalated', at: j.updatedAt, source: 'jobs.json', stage: j.stage, round: j.round ?? null, receipt: null });
  }
  const outcomes = {};
  for (const o of outcome.values()) outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1;
  const promotedIds = [...outcome].filter(([, o]) => o.outcome === 'promoted').map(([id]) => id).sort();
  const promotedWithCalls = promotedIds.filter(id => perPaper.has(id));
  const promotedDirectCost = promotedWithCalls.reduce((a, id) => a + perPaper.get(id).costUsd, 0);
  const allInPerPromoted = promotedIds.length ? spent / promotedIds.length : null;
  const directPerPromoted = promotedWithCalls.length ? promotedDirectCost / promotedWithCalls.length : null;

  // --- in flight: a job touched within --inflight-min, not terminal, and no batch outcome logged after that touch
  const inflight = jobs.filter(j => {
    const t = ms(j.updatedAt);
    if (t === null || now - t > o.inflightMin * 60e3 || TERMINAL_STAGES.has(j.stage) || !jobProvider(j)) return false;
    const last = outcome.get(j.paperId);
    return !(last && last.source !== 'jobs.json' && (ms(last.at) || 0) >= t);
  }).map(j => ({ paperId: j.paperId, stage: j.stage, round: j.round ?? null, updatedAt: j.updatedAt, ageMin: +((now - ms(j.updatedAt)) / 60e3).toFixed(1), costUsd: perPaper.get(j.paperId)?.costUsd || 0 }))
    .sort((a, b) => a.ageMin - b.ageMin);
  const inflightIds = new Set(inflight.map(j => j.paperId));

  // --- ledger
  const ledgerDoc = safeJson(LEDGER_FILE, { papers: {} }, warnings);
  const ledger = { total: 0, reviewed: 0, legacy: 0, other: 0, recordedSince: 0, recordedSinceByReviewer: {} };
  for (const [, v] of Object.entries(ledgerDoc.papers || {})) {
    ledger.total++;
    const kind = v.kind ?? v.quality ?? 'other';
    if (kind === 'reviewed') ledger.reviewed++; else if (kind === 'legacy') ledger.legacy++; else ledger.other++;
    if (kind === 'reviewed' && inPeriod(v.recordedAt)) { ledger.recordedSince++; const who = v.review?.reviewer?.provider || '?'; ledger.recordedSinceByReviewer[who] = (ledger.recordedSinceByReviewer[who] || 0) + 1; }
  }

  // --- catalogue backlog and projection
  const backlog = catalogueBacklog(warnings);
  let remaining = null;
  if (backlog) {
    remaining = { total: backlog.length, escalated: 0, inflight: 0, touched: 0, untouched: 0 };
    for (const e of backlog) {
      const j = jobById.get(e.paperId);
      if (inflightIds.has(e.paperId)) remaining.inflight++;
      else if (j?.stage === 'escalated') remaining.escalated++;
      else if (j) remaining.touched++;
      else remaining.untouched++;
    }
  }
  const budgetLeft = o.budgetUsd - spent;
  const projection = {
    budgetUsd: o.budgetUsd, spentUsd: spent, leftUsd: budgetLeft,
    remainingPapers: remaining?.total ?? null,
    perPromotedUsd: allInPerPromoted,
    projectedUsd: remaining && allInPerPromoted !== null ? remaining.total * allInPerPromoted : null,
    affordablePapers: allInPerPromoted ? Math.max(0, Math.floor(budgetLeft / allInPerPromoted)) : null,
    hoursLeftAtLastHourRate: lastHourRate > 0 ? budgetLeft / lastHourRate : null,
  };

  // --- top papers
  const rnd = x => (x?.round != null ? ` r${x.round}` : '');
  const status = id => {
    const j = jobById.get(id), last = outcome.get(id);
    if (j && inflightIds.has(id)) return `in flight: ${j.stage}${rnd(j)}`;
    if (last) return `${last.outcome}${rnd(last)}`;
    return j ? `${j.stage}${rnd(j)}` : 'no job';
  };
  const outcomesBackInFlight = [...outcome.keys()].filter(id => inflightIds.has(id)).length;
  const topPapers = [...perPaper.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, o.top).map(p => ({ ...p, status: status(p.paperId) }));

  return {
    generatedAt: new Date(now).toISOString(), provider: o.provider, since: o.since, inflightMin: o.inflightMin,
    files: { runs: path.relative(ROOT, RUNS_FILE), runsRows: runsAll.length, runsInScope: runs.length, jobs: jobs.length, batchLogs: logFiles.map(f => path.basename(f)), batchEntriesInPeriod: batch.length },
    byStage: [...byStage.values()], byModel: [...byModel.values()], total,
    firstCallAt: firstAt === null ? null : new Date(firstAt).toISOString(), lastCallAt: lastAt === null ? null : new Date(lastAt).toISOString(), spanHours,
    rate: { lastHourUsd: lastHourSpend, lastHourCalls, lastHourWindowHours: lastHourWindow, lastHourUsdPerHour: lastHourRate, periodUsdPerHour: spanHours > 0 ? spent / spanHours : null, promotedPerHour: spanHours > 0 ? promotedIds.length / spanHours : null },
    papersTouched: perPaper.size, costPerTouchedPaper: perPaper.size ? spent / perPaper.size : null,
    outcomes, outcomesBackInFlight, promoted: promotedIds, promotedCount: promotedIds.length, allInPerPromotedUsd: allInPerPromoted, directPerPromotedUsd: directPerPromoted, promotedDirectCostUsd: promotedDirectCost,
    errors, spendCapEvents, uncosted, provisional: { usd: provisionalUsd, count: provisionalCount },
    inflight, ledger, remaining, projection, topPapers, warnings,
  };
}

// ---------------------------------------------------------------- render
const usd = v => v == null ? 'n/a' : `$${v.toFixed(v !== 0 && Math.abs(v) < 0.01 ? 4 : 2)}`;
const num = v => v == null ? 'n/a' : Math.round(v).toLocaleString('en-US');
const hhmm = iso => iso ? String(iso).slice(5, 10) + ' ' + String(iso).slice(11, 16) + 'Z' : 'n/a';
const pad = (s, n) => String(s).padStart(n);
const padEnd = (s, n) => String(s).padEnd(n);

export function render(d) {
  const L = [];
  L.push(`spend.mjs  provider ${d.provider}  since ${d.since}  now ${d.generatedAt.slice(0, 16)}Z`);
  L.push(`sources: ${d.files.runs} ${d.files.runsRows} rows (${d.files.runsInScope} in scope) | jobs.json ${d.files.jobs} jobs | batch logs: ${d.files.batchLogs.length ? d.files.batchLogs.join(', ') : 'none'} (${d.files.batchEntriesInPeriod} entries in period)`);
  L.push('');
  L.push(`${padEnd('calls by stage', 16)}${pad('calls', 6)}${pad('ok', 5)}${pad('fail', 5)}${pad('input tok', 12)}${pad('output tok', 12)}${pad('cost', 10)}${pad('avg s', 7)}`);
  const stageLine = s => `${padEnd('  ' + s.stage, 16)}${pad(s.calls, 6)}${pad(s.ok, 5)}${pad(s.failed, 5)}${pad(num(s.inputTokens), 12)}${pad(num(s.outputTokens), 12)}${pad(usd(s.costUsd), 10)}${pad(s.ok ? (s.seconds / s.ok).toFixed(0) : '-', 7)}`;
  for (const s of d.byStage) L.push(stageLine(s));
  L.push(stageLine(d.total));
  if (d.byModel.length > 1) for (const m of d.byModel) L.push(`  model ${m.stage}: ${m.calls} calls, ${usd(m.costUsd)}`);
  else if (d.byModel.length === 1) L.push(`  model: ${d.byModel[0].stage}`);
  L.push('');
  const oc = Object.entries(d.outcomes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  L.push(`papers: ${d.papersTouched} touched (${usd(d.costPerTouchedPaper)} each) | last outcome in period: ${oc}${d.outcomesBackInFlight ? ` (${d.outcomesBackInFlight} of these back in flight)` : ''}`);
  L.push(`per promoted paper: ${usd(d.allInPerPromotedUsd)} all-in (spend / ${d.promotedCount} promoted) | ${usd(d.directPerPromotedUsd)} direct (calls on the promoted papers only)${d.promoted.length ? ` | promoted: ${d.promoted.slice(0, 12).join(', ')}${d.promoted.length > 12 ? ` +${d.promoted.length - 12} more` : ''}` : ''}`);
  L.push(`errors: 429 x${d.errors.http429} | 5xx x${d.errors.http5xx} | timeouts x${d.errors.timeouts} | other 4xx x${d.errors.http4xxOther} | network/other x${d.errors.other}${d.spendCapEvents.length ? ` | SPEND CAP HIT ${d.spendCapEvents.length}x (last: $${d.spendCapEvents.at(-1).spentUsd} >= $${d.spendCapEvents.at(-1).capUsd})` : ''}`);
  if (d.provisional?.count) L.push(`committed to batches, not yet settled: $${d.provisional.usd.toFixed(2)} for ${d.provisional.count} request(s) (provisional estimates; the real cost lands when each result is collected)`);
  const win = d.rate.lastHourWindowHours > 0 && d.rate.lastHourWindowHours < 1 ? `last ${Math.max(1, Math.round(d.rate.lastHourWindowHours * 60))} min` : 'last hour';
  L.push(`rate: ${win} ${usd(d.rate.lastHourUsd)} = ${d.rate.lastHourUsdPerHour == null ? 'n/a' : usd(d.rate.lastHourUsdPerHour) + '/h'} (${d.rate.lastHourCalls} calls) | period ${d.rate.periodUsdPerHour == null ? 'n/a' : usd(d.rate.periodUsdPerHour) + '/h'} over ${d.spanHours.toFixed(2)} h (first call ${hhmm(d.firstCallAt)}, last ${hhmm(d.lastCallAt)})${d.rate.promotedPerHour != null ? ` | ${d.rate.promotedPerHour.toFixed(1)} promoted/h` : ''}`);
  L.push('');
  L.push(`in flight (job updated <= ${d.inflightMin} min ago, not done/escalated, no later batch outcome): ${d.inflight.length}`);
  for (const j of d.inflight) L.push(`  ${padEnd(j.paperId, 44)} ${padEnd(j.stage + (j.round != null ? ` r${j.round}` : ''), 14)} ${pad(j.ageMin.toFixed(1), 5)} min ago  ${usd(j.costUsd)} so far`);
  L.push('');
  const rv = Object.entries(d.ledger.recordedSinceByReviewer).map(([k, v]) => `${v} ${k}`).join(', ');
  L.push(`ledger: ${d.ledger.reviewed} reviewed / ${d.ledger.legacy} legacy${d.ledger.other ? ` / ${d.ledger.other} other` : ''} of ${d.ledger.total} | ${d.ledger.recordedSince} reviewed recorded since ${d.since.slice(0, 16)}Z${rv ? ` (${rv})` : ''}`);
  const p = d.projection, r = d.remaining;
  if (r) L.push(`remaining catalogue papers: ${r.total} (${r.escalated} escalated, ${r.inflight} in flight, ${r.touched} touched but unfinished, ${r.untouched} untouched)`);
  else L.push('remaining catalogue papers: unknown (backlog.mjs failed, see warnings)');
  L.push(`projection: ${r ? r.total : '?'} x ${usd(p.perPromotedUsd)} = ${usd(p.projectedUsd)} | budget ${usd(p.budgetUsd)}: spent ${usd(p.spentUsd)}, left ${usd(p.leftUsd)}${p.affordablePapers != null ? ` = ~${p.affordablePapers} more papers${r ? ` (${(100 * p.affordablePapers / Math.max(1, r.total)).toFixed(0)}% of the remaining)` : ''}` : ''}${p.hoursLeftAtLastHourRate != null ? ` | ~${p.hoursLeftAtLastHourRate.toFixed(1)} h left at the ${win} rate` : ''}`);
  if (d.topPapers.length) {
    L.push('');
    L.push(`top ${d.topPapers.length} papers by cost:`);
    for (const t of d.topPapers) L.push(`  ${pad(usd(t.costUsd), 8)}  ${padEnd(t.paperId, 44)} ${Object.entries(t.stages).map(([s, c]) => `${s} ${usd(c)}`).join(' / ')} | ${t.calls} calls${t.failed ? ` (${t.failed} failed)` : ''} | ${t.status}`);
  }
  if (d.warnings.length) { L.push(''); for (const w of d.warnings) L.push(`warning: ${w}`); }
  return L.join('\n');
}

// ---------------------------------------------------------------- main
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const isMain = !!process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url));
if (isMain) {
  const once = () => {
    const d = collect(opts);
    if (opts.json) process.stdout.write(JSON.stringify(d, null, 2) + '\n');
    else process.stdout.write(render(d) + '\n');
  };
  if (opts.watch === null) once();
  else {
    for (;;) {
      if (process.stdout.isTTY) console.clear(); else process.stdout.write('\n---- ' + new Date().toISOString() + ' ----\n');
      try { once(); } catch (e) { process.stdout.write(`error: ${e.message}\n`); }
      process.stdout.write(`(refreshing every ${opts.watch} s; Ctrl-C to stop)\n`);
      await sleep(opts.watch * 1000);
    }
  }
}
