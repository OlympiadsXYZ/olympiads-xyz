#!/usr/bin/env node
// anthropic-batch-broker.mjs [--poll-sec 45] [--once] [--status] [--max-requests 200] [--max-mb 200]
//   [--backoff-sec 30] [--keep-bodies]
// The other half of transcribe.mjs --transport batch: a long-running process that turns the
// request bodies transcribe.mjs drops in tmp/tx/anthropic-batch/queue/ into Anthropic Message
// Batches (50% of the sync price) and writes each answer back as
// tmp/tx/anthropic-batch/results/<customId>.json, where the waiting transcribe.mjs picks it up.
// Run it once per machine, next to batch.mjs: node scripts/tx/anthropic-batch-broker.mjs
//
// Every --poll-sec (default 45; floor 5) it does two passes:
//   submit: queue/*.json (oldest first, ids already in a batch skipped) grouped by
//     lib.mjs:groupBatchRequests — at most --max-requests (200) or --max-mb (200) per batch,
//     whichever comes first (the API allows 100,000 / 256 MB; base64 pages are big) — each
//     group POSTed to /v1/messages/batches as {requests: [{custom_id, params}]} with
//     x-api-key / anthropic-version: 2023-06-01 / content-type: application/json. On success
//     the queued files move to submitted/<batchId>/ and batches/<batchId>.json records the
//     ids, counts, createdAt and status. A batches/pending-*.json is written before the POST
//     and removed after it, so a crash between the two is recognised on restart: the broker
//     lists the API's recent batches and adopts one that matches the pending record (same
//     request count, created after it) instead of submitting the requests twice.
//   poll: every batch record not yet finished is GET /v1/messages/batches/{id}; when
//     processing_status is "ended" the results_url (JSONL; lines {custom_id, result}) is
//     fetched and one results/<custom_id>.json is written per line: for "succeeded" the
//     Message JSON plus a `batch` block; for errored / expired / canceled {error: {type,
//     message}, batch}. A custom id the JSONL does not mention gets {error: {type:
//     "missing_result"}} so no waiter hangs. Request bodies in submitted/<batchId>/ are
//     deleted once the results are on disk (--keep-bodies keeps them; the .meta.json stays).
// Refusals: a request over the cap or whose body is not JSON, and a request the API names in
//   a 400 (requests.N...), get {error} results and move to failed/. A 400/413 that names no
//   index is bisected (halves resubmitted) down to the culprit. 401/403 back off 10 min and
//   shout. 429 / 5xx / network errors back off (retry-after or --backoff-sec doubling, cap
//   15 min) and leave the queue alone. A POST that gets no answer at all (socket error / timeout) keeps
//   its pending record: the next pass reconciles it against the API (adopt or drop), never re-POSTs blind.
//   A queued request whose waiting process (meta pid) has died is failed as waiter_gone, unsubmitted;
//   a detached enqueue (transcribe.mjs --batch-async) carries no pid and is always submitted.
// One broker at a time (broker.lock with pid); every action is one JSON line in broker.log;
// a one-line status (queued, in flight, batches open, results written) is printed every
// poll. --once runs one submit + one poll pass and exits; --status prints the state and
// exits (no key needed). ANTHROPIC_BASE_URL overrides the API host (tests). Key: ANTHROPIC_API_KEY
// from ~/.config/olympiads-xyz/providers.env via lib.mjs:loadProviderKeys — never printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  parseArgs, fail, readJson, writeJson, writeFileAtomic, renameWithRetry, loadProviderKeys, nowIso, sleep, ROOT, pidAlive,
  ANTHROPIC_BASE_URL, BATCH_DIR, BATCH_DIRS, BATCH_CUSTOM_ID, BATCH_LIMITS, groupBatchRequests,
} from './lib.mjs';

const require = createRequire(import.meta.url);
const { fetch: ufetch, Agent } = require('undici');

const BATCH_ID = /^[A-Za-z0-9_-]{1,128}$/;
const API_CUSTOM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const redact = s => String(s).slice(0, 600).replace(/[A-Za-z0-9_-]{32,}/g, '…');
const mb = n => (n / 1048576).toFixed(1);

export function ensureDirs() { for (const d of ['queue', 'submitted', 'results', 'batches', 'failed']) fs.mkdirSync(BATCH_DIRS[d], { recursive: true }); }
export function log(entry) { fs.mkdirSync(BATCH_DIR, { recursive: true }); fs.appendFileSync(BATCH_DIRS.log, JSON.stringify({ at: nowIso(), ...entry }) + '\n'); }

// ---- state on disk
export function listQueued() {
  ensureDirs();
  return fs.readdirSync(BATCH_DIRS.queue).filter(f => /\.json$/.test(f) && !/\.meta\.json$/.test(f) && BATCH_CUSTOM_ID.test(f.slice(0, -5)))
    .map(f => { const file = path.join(BATCH_DIRS.queue, f); const st = fs.statSync(file); return { customId: f.slice(0, -5), file, meta: file.replace(/\.json$/, '.meta.json'), bytes: st.size + 128, mtimeMs: st.mtimeMs }; })
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.customId.localeCompare(b.customId));
}
export const batchRecordFile = id => path.join(BATCH_DIRS.batches, `${id}.json`);
export function listBatchRecords() {
  ensureDirs();
  return fs.readdirSync(BATCH_DIRS.batches).filter(f => /\.json$/.test(f) && !f.startsWith('pending-')).map(f => readJson(path.join(BATCH_DIRS.batches, f), null)).filter(r => r?.id);
}
export const listPending = () => fs.readdirSync(BATCH_DIRS.batches).filter(f => /^pending-.*\.json$/.test(f)).map(f => ({ file: path.join(BATCH_DIRS.batches, f), ...readJson(path.join(BATCH_DIRS.batches, f), {}) }));
export const inFlightIds = () => new Set([...listBatchRecords().flatMap(r => r.customIds || []), ...listPending().flatMap(p => p.customIds || [])]);
const resultCount = () => { try { return fs.readdirSync(BATCH_DIRS.results).filter(f => /\.json$/.test(f)).length; } catch { return 0; } };

function moveQueued(q, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, name] of [[q.file, `${q.customId}.json`], [q.meta, `${q.customId}.meta.json`]]) if (fs.existsSync(from)) renameWithRetry(from, path.join(dir, name));
}
export function writeResult(rec, row) {
  const customId = String(row?.custom_id || '');
  if (!API_CUSTOM_ID.test(customId)) { log({ action: 'bad-result-line', batchId: rec.id, customId: customId.slice(0, 80) }); return false; }
  const out = path.join(BATCH_DIRS.results, `${customId}.json`);
  if (fs.existsSync(out)) return false; // idempotent: a re-fetched results file never overwrites what a waiter may have read
  const res = row.result || {};
  const batch = { id: rec.id, customId, resultType: res.type || 'unknown', submittedAt: rec.submittedAt || null, endedAt: rec.endedAt || null, writtenAt: nowIso() };
  let payload;
  if (res.type === 'succeeded' && res.message && typeof res.message === 'object') payload = { ...res.message, batch };
  else if (res.type === 'errored') { const e = res.error && typeof res.error === 'object' ? (res.error.error && typeof res.error.error === 'object' ? res.error.error : res.error) : { type: 'errored', message: String(res.error || 'errored without detail') }; payload = { error: { type: e.type || 'errored', message: e.message || '' }, batch }; }
  else payload = { error: { type: res.type || 'unknown', message: `request ${res.type || 'without a result type'} by the Batches API` }, batch };
  writeFileAtomic(out, JSON.stringify(payload, null, 2) + '\n');
  return true;
}
function rejectRequest(q, error, extra = {}) {
  const rec = { id: null, submittedAt: null, endedAt: null };
  writeResult(rec, { custom_id: q.customId, result: { type: 'errored', error: { type: 'error', error } } });
  moveQueued(q, BATCH_DIRS.failed);
  log({ action: 'rejected', customId: q.customId, error, ...extra });
}

// ---- HTTP
let agent = null, apiKey = null;
const backoff = { until: 0, n: 0 };
const backingOff = () => Date.now() < backoff.until;
let backoffBaseMs = 30_000;
function setBackoff(ms, why) { backoff.n++; const wait = Math.min(ms ?? backoffBaseMs * 2 ** (backoff.n - 1), 15 * 60 * 1000); backoff.until = Date.now() + wait; log({ action: 'backoff', seconds: Math.round(wait / 1000), why: redact(why) }); console.error(`[broker] backing off ${Math.round(wait / 1000)} s — ${redact(why)}`); }
function clearBackoff() { backoff.n = 0; backoff.until = 0; }
async function api(method, pathOrUrl, body) {
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : ANTHROPIC_BASE_URL + pathOrUrl;
  const started = Date.now();
  try {
    const res = await ufetch(url, { method, headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(body ? { 'content-type': 'application/json' } : {}) }, body, dispatcher: agent });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    const ra = Number(res.headers.get('retry-after'));
    return { ok: res.ok, status: res.status, text, json, retryAfterMs: ra > 0 ? ra * 1000 : null, seconds: +((Date.now() - started) / 1000).toFixed(1) };
  } catch (e) {
    return { ok: false, status: null, text: '', json: null, error: `${e.code || e.cause?.code || e.name}: ${e.message}`, seconds: +((Date.now() - started) / 1000).toFixed(1) };
  }
}
const failureText = r => r.error || `HTTP ${r.status}: ${r.json?.error?.message || r.text}`;
const retryableStatus = r => r.status === null || r.status === 429 || r.status === 408 || r.status >= 500;

// ---- submit pass
const limits = { ...BATCH_LIMITS };
async function submitGroup(items) {
  if (!items.length) return;
  const bodyParts = [];
  const good = [];
  for (const q of items) {
    let text;
    try { text = fs.readFileSync(q.file, 'utf8'); JSON.parse(text); } catch (e) { rejectRequest(q, { type: 'invalid_request_error', message: `queued body is not JSON: ${e.message}` }); continue; }
    good.push(q); bodyParts.push(`{"custom_id":${JSON.stringify(q.customId)},"params":${text}}`);
  }
  if (!good.length) return;
  const body = `{"requests":[${bodyParts.join(',')}]}`;
  const bytes = Buffer.byteLength(body);
  const customIds = good.map(q => q.customId);
  const token = crypto.randomBytes(6).toString('hex');
  const pendingFile = path.join(BATCH_DIRS.batches, `pending-${token}.json`);
  writeJson(pendingFile, { pending: true, token, customIds, count: good.length, bytes, createdAt: nowIso() });
  const r = await api('POST', '/v1/messages/batches', body);
  if (r.ok && r.json?.id && BATCH_ID.test(r.json.id)) {
    const b = r.json;
    const rec = { id: b.id, customIds, count: good.length, bytes, createdAt: b.created_at || nowIso(), submittedAt: nowIso(), status: b.processing_status || 'in_progress', requestCounts: b.request_counts || null, expiresAt: b.expires_at || null, resultsUrl: b.results_url || null, endedAt: b.ended_at || null, resultsWrittenAt: null, polls: 0 };
    for (const q of good) moveQueued(q, path.join(BATCH_DIRS.submitted, b.id));
    writeJson(batchRecordFile(b.id), rec);
    try { fs.unlinkSync(pendingFile); } catch {}
    clearBackoff();
    log({ action: 'submitted', batchId: b.id, requests: good.length, bytes, seconds: r.seconds, papers: [...new Set(good.map(q => readJson(path.join(BATCH_DIRS.submitted, b.id, `${q.customId}.meta.json`), {}).paperId).filter(Boolean))] });
    console.error(`[broker] submitted ${b.id}: ${good.length} request(s), ${mb(bytes)} MB`);
    return;
  }
  const why = failureText(r);
  if (r.status === null) {
    // No answer at all (socket error or timeout after the body went out): the API may well have created the batch.
    // The pending record stays; reconcilePending() adopts the batch from the API on the next pass, or drops the
    // record when nothing matches — never a second POST from here (reviewer finding 2026-09-17).
    log({ action: 'submit-unknown', pending: token, requests: good.length, why: redact(why) });
    console.error(`[broker] submit of ${good.length} request(s) got no answer (${redact(why)}); pending ${token} kept for reconciliation`);
    setBackoff(r.retryAfterMs, `submit unanswered: ${why}`);
    return;
  }
  try { fs.unlinkSync(pendingFile); } catch {} // a definite non-2xx answer: nothing was created
  if (r.status === 400 || r.status === 413) {
    const m = /requests\.(\d+)\b/.exec(r.json?.error?.message || r.text || '');
    const idx = m ? Number(m[1]) : -1;
    const error = { type: r.json?.error?.type || (r.status === 413 ? 'request_too_large' : 'invalid_request_error'), message: r.json?.error?.message || r.text.slice(0, 600) };
    if (idx >= 0 && idx < good.length) { rejectRequest(good[idx], error, { status: r.status }); return; } // the rest go next pass
    if (good.length === 1) { rejectRequest(good[0], error, { status: r.status }); return; }
    log({ action: 'bisect', status: r.status, requests: good.length, why: redact(why) });
    const half = Math.ceil(good.length / 2);
    await submitGroup(good.slice(0, half));
    await submitGroup(good.slice(half));
    return;
  }
  if (r.status === 401 || r.status === 403) { setBackoff(10 * 60 * 1000, `auth ${r.status}: ${r.json?.error?.message || 'check ANTHROPIC_API_KEY in providers.env'}`); return; }
  if (retryableStatus(r)) { setBackoff(r.retryAfterMs, `submit failed: ${why}`); return; }
  setBackoff(null, `submit failed unexpectedly: ${why}`);
}
// A queued request whose waiter (the transcribe.mjs that wrote it, meta.pid) is gone would be paid for and read by
// nobody: it fails as waiter_gone before any submission. A detached enqueue (transcribe.mjs --batch-async, meta
// {detached: true}, no pid) has no waiting process by design and is never dropped.
export function dropGoneWaiters(queued) {
  const kept = [];
  for (const q of queued) {
    const meta = readJson(q.meta, null);
    if (meta && !meta.detached && Number.isInteger(meta.pid) && meta.pid > 0 && !pidAlive(meta.pid)) {
      rejectRequest(q, { type: 'waiter_gone', message: `the process that queued this request (pid ${meta.pid}) is no longer running; not submitted` }, { pid: meta.pid });
      continue;
    }
    kept.push(q);
  }
  return kept;
}
export async function submitPass() {
  const skip = inFlightIds();
  const queued = dropGoneWaiters(listQueued().filter(q => !skip.has(q.customId)));
  if (!queued.length) return { queued: 0 };
  if (backingOff()) return { queued: queued.length, skipped: 'backoff' };
  const { groups, rejected } = groupBatchRequests(queued, limits);
  for (const q of rejected) rejectRequest(q, { type: 'request_too_large', message: `queued request is ${mb(q.bytes)} MB, over the broker's ${mb(limits.maxBytes)} MB per-batch cap` });
  for (const group of groups) { if (backingOff()) break; await submitGroup(group); }
  return { queued: queued.length, groups: groups.length };
}

// ---- pending records left by a crash between POST and the record write
export async function reconcilePending() {
  const pending = listPending();
  if (!pending.length) return;
  const known = new Set(listBatchRecords().map(r => r.id));
  const r = await api('GET', '/v1/messages/batches?limit=20');
  const recent = Array.isArray(r.json?.data) ? r.json.data : null;
  for (const p of pending) {
    const since = Date.parse(p.createdAt || 0) - 2 * 60 * 1000;
    const match = recent?.find(b => b?.id && !known.has(b.id) && Date.parse(b.created_at || 0) >= since && Object.values(b.request_counts || {}).reduce((a, n) => a + (Number(n) || 0), 0) === p.count);
    if (match) {
      const rec = { id: match.id, customIds: p.customIds, count: p.count, bytes: p.bytes, createdAt: match.created_at, submittedAt: p.createdAt, status: match.processing_status, requestCounts: match.request_counts || null, expiresAt: match.expires_at || null, resultsUrl: match.results_url || null, endedAt: match.ended_at || null, resultsWrittenAt: null, polls: 0, adoptedFrom: p.token };
      for (const id of p.customIds) { const file = path.join(BATCH_DIRS.queue, `${id}.json`); if (fs.existsSync(file)) moveQueued({ customId: id, file, meta: file.replace(/\.json$/, '.meta.json') }, path.join(BATCH_DIRS.submitted, match.id)); }
      writeJson(batchRecordFile(match.id), rec); known.add(match.id);
      log({ action: 'adopted', batchId: match.id, requests: p.count, pending: p.token });
      console.error(`[broker] adopted ${match.id} for the interrupted submission ${p.token} (${p.count} request(s))`);
    } else {
      log({ action: 'pending-dropped', pending: p.token, requests: p.count, listed: recent ? recent.length : null, why: recent ? 'no matching batch at the API; the requests are still queued and will be submitted' : `could not list batches: ${redact(failureText(r))}` });
      console.error(`[broker] interrupted submission ${p.token}: ${recent ? 'no matching batch at the API, resubmitting from the queue' : 'could not list batches; resubmitting from the queue (a duplicate is possible — check the Console)'}`);
    }
    try { fs.unlinkSync(p.file); } catch {}
  }
}

// ---- poll pass
let keepBodies = false;
async function finishBatch(rec, b) {
  const seen = new Set();
  let written = 0, lines = 0;
  if (b.results_url) {
    const rr = await api('GET', b.results_url);
    if (!rr.ok) { if (retryableStatus(rr)) setBackoff(rr.retryAfterMs, `results of ${rec.id}: ${failureText(rr)}`); else log({ action: 'results-failed', batchId: rec.id, why: redact(failureText(rr)) }); return false; }
    for (const line of rr.text.split('\n')) {
      if (!line.trim()) continue;
      lines++;
      let row; try { row = JSON.parse(line); } catch { log({ action: 'bad-result-line', batchId: rec.id, line: line.slice(0, 120) }); continue; }
      if (row?.custom_id) { seen.add(row.custom_id); if (writeResult(rec, row)) written++; }
    }
  }
  for (const id of rec.customIds || []) if (!seen.has(id) && writeResult(rec, { custom_id: id, result: { type: 'errored', error: { type: 'error', error: { type: 'missing_result', message: `batch ${rec.id} ended ${b.results_url ? 'without a result for this request' : 'with no results file'}` } } } })) written++;
  rec.resultsWrittenAt = nowIso(); rec.resultsWritten = written; rec.resultLines = lines;
  writeJson(batchRecordFile(rec.id), rec);
  if (!keepBodies) { const dir = path.join(BATCH_DIRS.submitted, rec.id); for (const id of rec.customIds || []) { try { fs.unlinkSync(path.join(dir, `${id}.json`)); } catch {} } }
  log({ action: 'results-written', batchId: rec.id, written, lines, counts: b.request_counts || null, bodiesDeleted: !keepBodies });
  console.error(`[broker] ${rec.id} ended: ${written} result(s) written (${JSON.stringify(b.request_counts || {})})`);
  return true;
}
export async function pollPass() {
  const open = listBatchRecords().filter(r => !r.resultsWrittenAt);
  let ended = 0;
  for (const rec of open) {
    if (backingOff()) break;
    if (!BATCH_ID.test(rec.id)) continue;
    const r = await api('GET', `/v1/messages/batches/${rec.id}`);
    if (!r.ok) {
      if (r.status === 404) { log({ action: 'batch-unknown', batchId: rec.id, why: redact(failureText(r)) }); await finishBatch(rec, { results_url: null, request_counts: null }); continue; }
      if (retryableStatus(r)) setBackoff(r.retryAfterMs, `poll ${rec.id}: ${failureText(r)}`); else log({ action: 'poll-failed', batchId: rec.id, why: redact(failureText(r)) });
      continue;
    }
    const b = r.json || {};
    rec.status = b.processing_status || rec.status; rec.requestCounts = b.request_counts || rec.requestCounts; rec.resultsUrl = b.results_url || rec.resultsUrl; rec.endedAt = b.ended_at || rec.endedAt; rec.polls = (rec.polls || 0) + 1; rec.polledAt = nowIso();
    writeJson(batchRecordFile(rec.id), rec);
    if (b.processing_status === 'ended') { if (await finishBatch(rec, b)) ended++; }
  }
  return { open: open.length, ended };
}

// ---- status
export function state() {
  ensureDirs();
  const queued = listQueued();
  const records = listBatchRecords();
  const open = records.filter(r => !r.resultsWrittenAt);
  const held = readJson(BATCH_DIRS.lock, null);
  return {
    dir: path.relative(ROOT, BATCH_DIR), broker: held?.pid ? { pid: held.pid, since: held.at, alive: pidAlive(held.pid) } : null,
    queued: queued.length, queuedBytes: queued.reduce((a, q) => a + q.bytes, 0), inFlight: open.reduce((a, r) => a + (r.count || 0), 0), batchesOpen: open.length, batchesTotal: records.length,
    resultsWritten: resultCount(), pending: listPending().length, backoffUntil: backoff.until ? new Date(backoff.until).toISOString() : null,
    batches: records.map(r => ({ id: r.id, status: r.status, count: r.count, requestCounts: r.requestCounts, submittedAt: r.submittedAt, endedAt: r.endedAt, resultsWrittenAt: r.resultsWrittenAt })).slice(-50),
  };
}
const statusLine = (s, last) => `[broker ${new Date().toISOString().slice(11, 19)}] queued ${s.queued} (${mb(s.queuedBytes)} MB) | in flight ${s.inFlight} in ${s.batchesOpen} open batch(es) | results written ${s.resultsWritten}${s.pending ? ` | pending ${s.pending}` : ''}${backingOff() ? ` | backoff until ${s.backoffUntil}` : ''}${last ? ` | ${last}` : ''}`;

// ---- main
async function main() {
  const args = parseArgs(process.argv.slice(2), { flags: ['once', 'status', 'keep-bodies'] });
  ensureDirs();
  if (args.status) { console.log(JSON.stringify(state(), null, 2)); return; }
  const pollSec = args.once ? 0 : Math.max(5, Number(args['poll-sec'] || 45));
  if (args['max-requests']) limits.maxRequests = Math.max(1, Number(args['max-requests']));
  if (args['max-mb']) limits.maxBytes = Math.max(0.001, Number(args['max-mb'])) * 1024 * 1024; // fractions allowed (tests)
  if (args['backoff-sec'] !== undefined) backoffBaseMs = Math.max(0, Number(args['backoff-sec'])) * 1000;
  keepBodies = !!args['keep-bodies'];
  const cfg = loadProviderKeys();
  apiKey = cfg.keys.ANTHROPIC_API_KEY;
  if (!cfg.exists) fail(`${cfg.file} does not exist; create it with ANTHROPIC_API_KEY=<key> (never commit it)`);
  if (!apiKey) fail(`ANTHROPIC_API_KEY is not set in ${cfg.file}`);
  agent = new Agent({ headersTimeout: 10 * 60 * 1000, bodyTimeout: 10 * 60 * 1000, connectTimeout: 60_000 });
  // one broker at a time
  for (let tries = 0; ; tries++) {
    try { fs.writeFileSync(BATCH_DIRS.lock, JSON.stringify({ pid: process.pid, at: nowIso() }), { flag: 'wx' }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const held = readJson(BATCH_DIRS.lock, null);
      if (held?.pid && held.pid !== process.pid && pidAlive(held.pid)) fail(`another broker (pid ${held.pid}, since ${held.at}) holds ${path.relative(ROOT, BATCH_DIRS.lock)}`);
      if (tries >= 3) fail(`could not take ${path.relative(ROOT, BATCH_DIRS.lock)}`);
      try { fs.unlinkSync(BATCH_DIRS.lock); } catch {}
    }
  }
  const release = () => { try { if (readJson(BATCH_DIRS.lock, null)?.pid === process.pid) fs.unlinkSync(BATCH_DIRS.lock); } catch {} };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log({ action: 'stop', signal: sig }); release(); process.exit(130); });
  log({ action: 'start', pid: process.pid, once: !!args.once, pollSec, limits, baseUrl: ANTHROPIC_BASE_URL, keepBodies });
  console.error(`[broker] pid ${process.pid}; ${ANTHROPIC_BASE_URL}; ${path.relative(ROOT, BATCH_DIR)}; ${limits.maxRequests} requests / ${mb(limits.maxBytes)} MB per batch; poll ${pollSec || 'once'} s`);
  for (;;) {
    let last = '';
    try {
      await reconcilePending();
      const s = await submitPass();
      const p = await pollPass();
      last = `submit: ${s.queued} queued${s.groups ? `, ${s.groups} batch(es) sent` : s.skipped ? ` (${s.skipped})` : ''}; poll: ${p.open} open, ${p.ended} ended`;
    } catch (e) {
      last = `pass error: ${redact(e.stack || e.message)}`;
      log({ action: 'pass-error', error: redact(e.stack || e.message) });
    }
    console.log(statusLine(state(), last));
    if (args.once) break;
    await sleep(pollSec * 1000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
