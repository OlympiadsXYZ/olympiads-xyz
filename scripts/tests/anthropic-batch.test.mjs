// Tests for the Anthropic Message Batches transport (scripts/tx/anthropic-batch-broker.mjs and
// transcribe.mjs --transport batch). No network: a node:http server on 127.0.0.1 stands in for
// api.anthropic.com (ANTHROPIC_BASE_URL), a throw-away OLYMPIADS_TX_DIR holds the queue, and a
// throw-away OLYMPIADS_KEYS_FILE holds a fake key — the real providers.env is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const txScript = name => path.join(repo, 'scripts', 'tx', name);
const txModule = name => pathToFileURL(txScript(name)).href;

// One sandbox for the file: lib.mjs fixes TX_DIR (and so the batch directories) when it is imported.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-batch-test-'));
const KEY = 'test-key-not-a-real-key-0000000000000000';
const keysFile = path.join(root, 'providers.env');
fs.writeFileSync(keysFile, `ANTHROPIC_API_KEY=${KEY}\n`);
process.env.OLYMPIADS_TX_DIR = root;
process.env.OLYMPIADS_KEYS_FILE = keysFile;
delete process.env.ANTHROPIC_BASE_URL;
const lib = await import(txModule('lib.mjs'));
const broker = await import(txModule('anthropic-batch-broker.mjs'));
const { BATCH_DIRS } = lib;
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

const envFor = (base, extra = {}) => ({ ...process.env, OLYMPIADS_TX_DIR: root, OLYMPIADS_KEYS_FILE: keysFile, ANTHROPIC_BASE_URL: base, ...extra });
// async, never spawnSync: the fake API lives in this process and must keep serving while the broker runs
function runBroker(base, argv = []) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [txScript('anthropic-batch-broker.mjs'), '--once', '--backoff-sec', '0', ...argv], { env: envFor(base) });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
const readLog = () => fs.existsSync(BATCH_DIRS.log) ? fs.readFileSync(BATCH_DIRS.log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const requestBody = (text = 'hello', extra = {}) => JSON.stringify({ model: 'claude-opus-5', max_tokens: 100, messages: [{ role: 'user', content: [{ type: 'text', text }] }], ...extra });
const message = (text, usage = { input_tokens: 10, output_tokens: 5 }) => ({ id: `msg_${lib.sha256(text).slice(0, 12)}`, type: 'message', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(pred, { timeoutMs = 20000, every = 100, what = 'condition' } = {}) { const t0 = Date.now(); for (;;) { const v = pred(); if (v) return v; if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`); await wait(every); } }

// A stand-in for api.anthropic.com: POST /v1/messages/batches, GET .../{id} (ended after `endAfterPolls`
// polls), GET .../{id}/results (JSONL built by `results(customId, params)`), GET /v1/messages/batches (list).
async function fakeApi(t, { endAfterPolls = 1, results = (id) => ({ type: 'succeeded', message: message(`reply to ${id}`) }), failPosts = 0, badIndexOnce = null, idPrefix = 'msgbatch_test' } = {}) {
  const state = { batches: new Map(), posts: [], n: 0, failPosts, badIndexOnce, badAuth: 0 };
  let base = '';
  const batchObj = b => {
    const ended = b.polls >= endAfterPolls;
    return { id: b.id, type: 'message_batch', processing_status: ended ? 'ended' : 'in_progress', request_counts: { processing: ended ? 0 : b.requests.length, succeeded: ended ? b.requests.length : 0, errored: 0, canceled: 0, expired: 0 }, ended_at: ended ? b.createdAt : null, created_at: b.createdAt, expires_at: b.createdAt, cancel_initiated_at: null, results_url: ended ? `${base}/v1/messages/batches/${b.id}/results` : null };
  };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
      const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
      if (req.headers['x-api-key'] !== KEY || req.headers['anthropic-version'] !== '2023-06-01') { state.badAuth++; return send(401, { type: 'error', error: { type: 'authentication_error', message: 'bad headers' } }); }
      const url = new URL(req.url, base);
      if (req.method === 'POST' && url.pathname === '/v1/messages/batches') {
        if (req.headers['content-type'] !== 'application/json') return send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'content-type' } });
        const body = JSON.parse(raw);
        state.posts.push({ headers: req.headers, body, bytes: Buffer.byteLength(raw) });
        if (state.failPosts > 0) { state.failPosts--; return send(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }); }
        if (state.badIndexOnce !== null) { const i = state.badIndexOnce; state.badIndexOnce = null; return send(400, { type: 'error', error: { type: 'invalid_request_error', message: `requests.${i}.params.messages.0.content.0.text: must not be empty` } }); }
        const b = { id: `${idPrefix}${++state.n}`, requests: body.requests, polls: 0, createdAt: new Date().toISOString() };
        state.batches.set(b.id, b);
        return send(200, batchObj(b));
      }
      if (req.method === 'GET' && url.pathname === '/v1/messages/batches') return send(200, { data: [...state.batches.values()].map(batchObj), has_more: false });
      const m = /^\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const b = state.batches.get(m[1]);
        if (!b) return send(404, { type: 'error', error: { type: 'not_found_error', message: `no batch ${m[1]}` } });
        if (m[2]) return send(200, b.requests.map(r => JSON.stringify({ custom_id: r.custom_id, result: results(r.custom_id, r.params) })).reverse().join('\n') + '\n', 'application/x-jsonl'); // any order
        b.polls++;
        return send(200, batchObj(b));
      }
      send(404, { type: 'error', error: { type: 'not_found_error', message: url.pathname } });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(r => server.close(r)));
  return { base, state };
}

test('a queued request is submitted, its result file appears when the batch ends, and a waiter reads it', async t => {
  const api = await fakeApi(t, { endAfterPolls: 2 });
  const body = requestBody('first');
  const customId = lib.batchCustomId('zz-2099-test-7', 'reader', 'all', body);
  assert.match(customId, lib.BATCH_CUSTOM_ID);
  assert.notEqual(customId, lib.batchCustomId('zz-2099-test-7', 'reader', 'all', body), 'a retry gets a fresh custom id');
  const files = lib.enqueueBatchRequest(customId, body, { paperId: 'zz-2099-test-7', stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  assert.ok(fs.existsSync(files.body) && fs.existsSync(files.meta));
  assert.equal(lib.batchRequestState(customId), 'queued');

  const first = await runBroker(api.base);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(api.state.posts.length, 1);
  assert.equal(api.state.posts[0].headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(api.state.posts[0].body, { requests: [{ custom_id: customId, params: JSON.parse(body) }] }, 'the exact queued body is the params');
  assert.ok(!fs.existsSync(files.body), 'moved out of the queue');
  assert.ok(fs.existsSync(path.join(BATCH_DIRS.submitted, 'msgbatch_test1', `${customId}.json`)));
  const rec = JSON.parse(fs.readFileSync(path.join(BATCH_DIRS.batches, 'msgbatch_test1.json'), 'utf8'));
  assert.equal(rec.status, 'in_progress'); assert.deepEqual(rec.customIds, [customId]); assert.equal(rec.count, 1); assert.equal(rec.resultsWrittenAt, null);
  assert.equal(lib.batchRequestState(customId), 'submitted:msgbatch_test1');
  assert.match(first.stdout, /queued 0 .*in flight 1 in 1 open batch/);
  assert.ok(!fs.existsSync(files.result), 'no result while the batch is in progress');

  // the waiter in its own process-independent form, started before the result exists
  const waiter = lib.waitForBatchResult(customId, { pollMs: 50, timeoutMs: 10000 });
  const second = await runBroker(api.base);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(api.state.posts.length, 1, 'never resubmitted');
  const result = await waiter;
  assert.equal(result.type, 'message');
  assert.equal(result.content[0].text, `reply to ${customId}`);
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 5 });
  assert.equal(result.batch.id, 'msgbatch_test1'); assert.equal(result.batch.customId, customId); assert.equal(result.batch.resultType, 'succeeded');
  assert.equal(lib.batchResultError(result), null);
  // what transcribe.mjs's anthropic parse() does with it
  const text = (result.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  assert.equal(text, `reply to ${customId}`);
  assert.equal(lib.batchRequestState(customId), 'done');
  assert.match(second.stdout, /in flight 0 in 0 open batch\(es\) \| results written 1/);
  const rec2 = JSON.parse(fs.readFileSync(path.join(BATCH_DIRS.batches, 'msgbatch_test1.json'), 'utf8'));
  assert.equal(rec2.status, 'ended'); assert.ok(rec2.resultsWrittenAt); assert.equal(rec2.resultsWritten, 1);
  assert.ok(!fs.existsSync(path.join(BATCH_DIRS.submitted, 'msgbatch_test1', `${customId}.json`)), 'the body is deleted once the result is on disk');
  assert.ok(fs.existsSync(path.join(BATCH_DIRS.submitted, 'msgbatch_test1', `${customId}.meta.json`)), 'the sidecar stays');
  const actions = readLog().map(l => l.action);
  for (const a of ['start', 'submitted', 'results-written']) assert.ok(actions.includes(a), `log has ${a}: ${actions}`);
  assert.equal(api.state.badAuth, 0);
  assert.doesNotMatch(fs.readFileSync(BATCH_DIRS.log, 'utf8'), new RegExp(KEY), 'the key never reaches the log');

  const status = spawnSync(process.execPath, [txScript('anthropic-batch-broker.mjs'), '--status'], { encoding: 'utf8', env: envFor(api.base) });
  assert.equal(status.status, 0, status.stderr);
  const st = JSON.parse(status.stdout);
  assert.equal(st.resultsWritten, 1); assert.equal(st.batchesOpen, 0); assert.equal(st.queued, 0);
});

test('errored, expired and overloaded results become {error} files the waiter classifies', async t => {
  const kinds = {};
  const api = await fakeApi(t, { results: id => kinds[id] });
  const ids = {};
  for (const [name, result] of Object.entries({
    invalid: { type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'messages.0.content.1.image: bad image' } } },
    overloaded: { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } },
    expired: { type: 'expired' },
  })) {
    const body = requestBody(name);
    const id = lib.batchCustomId('p', 'checker', 'all', body);
    ids[name] = id; kinds[id] = result;
    lib.enqueueBatchRequest(id, body, { paperId: 'p', stage: 'checker', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  }
  const run = await runBroker(api.base);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(api.state.posts.length, 1); assert.equal(api.state.posts[0].body.requests.length, 3);
  const invalid = await lib.waitForBatchResult(ids.invalid, { pollMs: 20, timeoutMs: 2000 });
  assert.deepEqual(invalid.error, { type: 'invalid_request_error', message: 'messages.0.content.1.image: bad image' });
  assert.equal(invalid.batch.resultType, 'errored');
  assert.deepEqual(lib.batchResultError(invalid), { type: 'invalid_request_error', message: 'messages.0.content.1.image: bad image', retryable: false });
  const overloaded = lib.readBatchResult(ids.overloaded);
  assert.equal(lib.batchResultError(overloaded).retryable, true);
  const expired = lib.readBatchResult(ids.expired);
  assert.equal(expired.error.type, 'expired'); assert.equal(expired.batch.resultType, 'expired');
  assert.equal(lib.batchResultError(expired).retryable, true);
  assert.equal(lib.batchResultError({ error: { type: 'canceled', message: 'canceled' } }).retryable, false);
  assert.equal(await lib.waitForBatchResult(`tx-${'0'.repeat(40)}-000000`, { pollMs: 20, timeoutMs: 120 }), null, 'a missing result times out to null');
});

test('grouping respects the request and byte caps (fake sizes) and rejects an oversize request', async t => {
  const MB = 1024 * 1024;
  const g1 = lib.groupBatchRequests(Array.from({ length: 5 }, (_, i) => ({ customId: `r${i}`, bytes: 90 * MB })));
  assert.deepEqual(g1.groups.map(g => g.map(e => e.customId)), [['r0', 'r1'], ['r2', 'r3'], ['r4']], '200 MB: two 90 MB requests per batch');
  assert.deepEqual(g1.rejected, []);
  const g2 = lib.groupBatchRequests(Array.from({ length: 250 }, (_, i) => ({ customId: `r${i}`, bytes: 1024 })));
  assert.deepEqual(g2.groups.map(g => g.length), [200, 50], '200 requests per batch');
  const g3 = lib.groupBatchRequests([{ customId: 'big', bytes: 300 * MB }, { customId: 'a', bytes: 150 * MB }, { customId: 'b', bytes: 60 * MB }, { customId: 'c', bytes: 40 * MB }]);
  assert.deepEqual(g3.rejected.map(e => e.customId), ['big']);
  assert.deepEqual(g3.groups.map(g => g.map(e => e.customId)), [['a'], ['b', 'c']], 'order is kept; a group closes when the next request would overflow it');
  assert.deepEqual(lib.groupBatchRequests([{ customId: 'x', bytes: 256 * MB }], { maxBytes: 256 * MB }).groups.length, 1, 'exactly the cap fits');
  assert.deepEqual(lib.groupBatchRequests([{ customId: 'x', bytes: 256 * MB + 1 }], { maxBytes: 256 * MB }).rejected.length, 1);

  // the broker applies the same rule: --max-mb 0.001 (1 KB) puts each ~750-byte request in its own batch
  const api = await fakeApi(t);
  const ids = [];
  for (const n of [1, 2, 3]) { const body = requestBody(`size test ${n} ${'x'.repeat(600)}`); const id = lib.batchCustomId('q', 'reader', `w${n}`, body); ids.push(id); lib.enqueueBatchRequest(id, body, { paperId: 'q', stage: 'reader', window: `w${n}`, model: 'claude-opus-5', createdAt: lib.nowIso() }); }
  const run = await runBroker(api.base, ['--max-mb', '0.001']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(api.state.posts.length, 3, 'one request per batch under a 1 KB cap');
  for (const id of ids) assert.equal((await lib.waitForBatchResult(id, { pollMs: 20, timeoutMs: 2000 })).content[0].text, `reply to ${id}`);
  // an oversize request never reaches the API: it fails at once with an {error} result
  const big = requestBody('x'.repeat(4000));
  const bigId = lib.batchCustomId('q', 'reader', 'big', big);
  lib.enqueueBatchRequest(bigId, big, { paperId: 'q', stage: 'reader', window: 'big', model: 'claude-opus-5', createdAt: lib.nowIso() });
  const run2 = await runBroker(api.base, ['--max-mb', '0.001']);
  assert.equal(run2.status, 0, run2.stderr);
  assert.equal(api.state.posts.length, 3);
  const rejected = lib.readBatchResult(bigId);
  assert.equal(rejected.error.type, 'request_too_large'); assert.equal(lib.batchResultError(rejected).retryable, false);
  assert.equal(lib.batchRequestState(bigId), 'done', 'a result (the error) exists, so the waiter sees it as done');
  assert.ok(fs.existsSync(path.join(BATCH_DIRS.failed, `${bigId}.json`)) && fs.existsSync(path.join(BATCH_DIRS.failed, `${bigId}.meta.json`)), 'the queued files moved to failed/');
  assert.ok(!fs.existsSync(path.join(BATCH_DIRS.queue, `${bigId}.json`)));
});

test('a 529 on submit leaves the queue alone and the next pass submits; a 400 naming the request fails only that one', async t => {
  const api = await fakeApi(t, { failPosts: 1 });
  const body = requestBody('overloaded once');
  const id = lib.batchCustomId('r', 'reader', 'all', body);
  lib.enqueueBatchRequest(id, body, { paperId: 'r', stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  const run = await runBroker(api.base);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(api.state.posts.length, 1);
  assert.equal(lib.batchRequestState(id), 'queued', 'still queued after the 529');
  assert.equal(fs.readdirSync(BATCH_DIRS.batches).filter(f => f.startsWith('pending-')).length, 0, 'no pending record left behind');
  assert.ok(readLog().some(l => l.action === 'backoff' && /529/.test(l.why)), 'backoff logged');
  assert.match(run.stdout, /queued 1 /);
  const again = await runBroker(api.base);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(api.state.posts.length, 2);
  assert.ok(await lib.waitForBatchResult(id, { pollMs: 20, timeoutMs: 2000 }));

  // a 400 that names requests.1: only that request fails, the other two are submitted on the next pass
  const api2 = await fakeApi(t, { badIndexOnce: 1 });
  const ids = ['a', 'b', 'c'].map(n => { const body = requestBody(`named ${n}`); const cid = lib.batchCustomId('s', 'reader', n, body); lib.enqueueBatchRequest(cid, body, { paperId: 's', stage: 'reader', window: n, model: 'claude-opus-5', createdAt: lib.nowIso() }); return cid; });
  const bad = (await runBroker(api2.base));
  assert.equal(bad.status, 0, bad.stderr);
  assert.equal(api2.state.posts.length, 1);
  const named = api2.state.posts[0].body.requests[1].custom_id; // the broker submits oldest first; whichever sat at index 1 is the one named
  const rejected = lib.readBatchResult(named);
  assert.equal(rejected.error.type, 'invalid_request_error'); assert.match(rejected.error.message, /requests\.1\./);
  assert.equal(lib.batchResultError(rejected).retryable, false);
  for (const cid of ids) if (cid !== named) assert.equal(lib.batchRequestState(cid), 'queued');
  const rest = await runBroker(api2.base);
  assert.equal(rest.status, 0, rest.stderr);
  assert.equal(api2.state.posts.length, 2); assert.equal(api2.state.posts[1].body.requests.length, 2);
  for (const cid of ids) if (cid !== named) assert.equal((await lib.waitForBatchResult(cid, { pollMs: 20, timeoutMs: 2000 })).content[0].text, `reply to ${cid}`);
});

test('a submission interrupted between the POST and the record is adopted from the API, never submitted twice', async t => {
  const api = await fakeApi(t, { idPrefix: 'msgbatch_adopt' }); // ids the earlier tests' records do not already hold (real ids are unique)
  const body = requestBody('interrupted');
  const id = lib.batchCustomId('i', 'reader', 'all', body);
  lib.enqueueBatchRequest(id, body, { paperId: 'i', stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  // the crash: the pending record exists, the API has the batch, the broker never wrote batches/<id>.json
  fs.writeFileSync(path.join(BATCH_DIRS.batches, 'pending-deadbeef0001.json'), JSON.stringify({ pending: true, token: 'deadbeef0001', customIds: [id], count: 1, bytes: 500, createdAt: lib.nowIso() }));
  const posted = await fetch(`${api.base}/v1/messages/batches`, { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ requests: [{ custom_id: id, params: JSON.parse(body) }] }) }).then(r => r.json());
  assert.equal(posted.id, 'msgbatch_adopt1');
  const run = await runBroker(api.base);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(api.state.posts.length, 1, 'adopted, not resubmitted');
  const rec = JSON.parse(fs.readFileSync(path.join(BATCH_DIRS.batches, 'msgbatch_adopt1.json'), 'utf8'));
  assert.equal(rec.adoptedFrom, 'deadbeef0001'); assert.deepEqual(rec.customIds, [id]);
  assert.ok(!fs.existsSync(path.join(BATCH_DIRS.batches, 'pending-deadbeef0001.json')));
  assert.equal((await lib.waitForBatchResult(id, { pollMs: 20, timeoutMs: 2000 })).content[0].text, `reply to ${id}`);
  assert.ok(readLog().some(l => l.action === 'adopted' && l.batchId === 'msgbatch_adopt1'));
  // a pending record with no batch behind it is dropped and its request goes out normally
  const body2 = requestBody('never reached the API');
  const id2 = lib.batchCustomId('i', 'reader', 'all', body2);
  lib.enqueueBatchRequest(id2, body2, { paperId: 'i', stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  fs.writeFileSync(path.join(BATCH_DIRS.batches, 'pending-deadbeef0002.json'), JSON.stringify({ pending: true, token: 'deadbeef0002', customIds: [id2], count: 1, bytes: 500, createdAt: lib.nowIso() }));
  const run2 = await runBroker(api.base);
  assert.equal(run2.status, 0, run2.stderr);
  assert.equal(api.state.posts.length, 2);
  assert.equal(api.state.posts[1].body.requests[0].custom_id, id2);
  assert.ok(readLog().some(l => l.action === 'pending-dropped' && l.pending === 'deadbeef0002'));
  assert.equal((await lib.waitForBatchResult(id2, { pollMs: 20, timeoutMs: 2000 })).batch.id, 'msgbatch_adopt2');
});

// ---- transcribe.mjs end to end in batch mode: a sandboxed paper, the fake API, the broker driven by hand
const PAPER = 'zz-2099-batch-7';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfocAAAAASUVORK5CYII=', 'base64');
const size = { page: 1, widthPt: 595.276, heightPt: 841.89 };
const manifest = {
  paperId: PAPER, meta: { competition: 'ZZ', year: 2099, round: null, grade: '7', subject: 'physics', lang: 'bg' }, renderDpi: 160,
  documents: {
    problems: { key: 'Физика/zz/problems.pdf', file: 'src/problems.pdf', sha256: 'a'.repeat(64), bytes: 1, pages: 2, pageSizes: [size, { ...size, page: 2 }], pageImages: ['pages/problems-01.png', 'pages/problems-02.png'], text: 'text/problems.txt' },
    solutions: { key: 'Физика/zz/solutions.pdf', file: 'src/solutions.pdf', sha256: 'b'.repeat(64), bytes: 1, pages: 1, pageSizes: [size], pageImages: ['pages/solutions-01.png'], text: 'text/solutions.txt' },
  },
};
const reply = () => ({
  paper: { id: PAPER, subject: 'physics', competition: 'ZZ', year: 2099, round: null, roundType: 'theory', grade: '7 клас', lang: 'bg', title: 'Тест', totalPoints: 10, source: { archiveKey: manifest.documents.problems.key, pages: [1, 2] }, solutionSource: { archiveKey: manifest.documents.solutions.key, pages: [1] }, status: 'draft' },
  problems: [{ id: `${PAPER}-p1`, number: 1, points: 10, problemType: 'theory', statement: 'Токът е $I = 1\\ \\mathrm{mA}$.', figures: [], parts: [{ label: 'а)', statement: 'Колко е зарядът за $t = 1\\ \\mathrm{min}$?', points: 10, answer: { kind: 'numeric', value: 0.06, unit: 'C' } }], topics: ['electricity/current'], difficulty: 'Easy', importance: 2, solution: { statement: 'Решение: $q = I t = 0{,}06\\ \\mathrm{C}$.' }, tx: { sourceSpans: [{ document: 'problems', page: 1 }, { document: 'solutions', page: 1 }] } }],
  tx: { printedMeta: 'Тест 2099, 7 клас', catalogDisagrees: false, textLayerTrustworthy: true, notes: 'test reply' },
});
function preparePaper() {
  const dir = path.join(root, PAPER);
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  for (const f of ['problems-01.png', 'problems-02.png', 'solutions-01.png']) fs.writeFileSync(path.join(dir, 'pages', f), PNG);
  return dir;
}
function startTranscribe(base, extra = []) {
  const child = spawn(process.execPath, [txScript('transcribe.mjs'), PAPER, '--provider', 'anthropic', '--model', 'claude-opus-5', '--stage', 'reader', ...extra], { encoding: 'utf8', env: envFor(base, { TX_ANTHROPIC_TRANSPORT: 'batch', TX_BATCH_POLL_MS: '200' }) });
  const out = { stdout: '', stderr: '', code: null };
  child.stdout.on('data', d => { out.stdout += d; }); child.stderr.on('data', d => { out.stderr += d; });
  out.done = new Promise(r => child.on('close', code => { out.code = code; r(code); }));
  return out;
}
// run the broker once whenever something is queued, until transcribe exits
async function driveBroker(base, proc, { maxPasses = 12 } = {}) {
  for (let i = 0; i < maxPasses && proc.code === null; i++) {
    await until(() => proc.code !== null || broker.listQueued().length > 0, { timeoutMs: 15000, what: 'a queued request' });
    if (proc.code !== null) break;
    const r = await runBroker(base);
    assert.equal(r.status, 0, r.stderr);
    await Promise.race([proc.done, wait(1500)]);
  }
  await Promise.race([proc.done, wait(15000)]);
  assert.notEqual(proc.code, null, `transcribe.mjs did not exit\n${proc.stderr}`);
}

test('transcribe.mjs --transport batch: the exact request is queued, the result is parsed, the cost is halved', async t => {
  preparePaper();
  const seen = {};
  const api = await fakeApi(t, { results: (id, params) => { seen[id] = params; return { type: 'succeeded', message: message(JSON.stringify(reply()), { input_tokens: 10000, output_tokens: 2000 }) }; } });
  const dry = spawnSync(process.execPath, [txScript('transcribe.mjs'), PAPER, '--provider', 'anthropic', '--model', 'claude-opus-5', '--stage', 'reader', '--dry-run', '--transport', 'batch'], { encoding: 'utf8', env: envFor(api.base) });
  assert.equal(dry.status, 0, dry.stderr);
  const dryOut = JSON.parse(dry.stdout);
  assert.equal(dryOut.transport, 'batch'); assert.equal(dryOut.endpoint, `${api.base}/v1/messages`);
  assert.equal(dryOut.estimatedCostUsd, lib.estimateCost('claude-opus-5', dryOut.approxInputTokens, 6000, undefined, { batch: true }), 'dry-run estimate at the batch price');
  assert.ok(Math.abs(dryOut.estimatedCostUsd * 2 - lib.estimateCost('claude-opus-5', dryOut.approxInputTokens, 6000)) < 2e-6, 'half the sync estimate');
  assert.match(dryOut.note, /Batch API's 50%/);
  assert.equal(api.state.posts.length, 0, 'a dry run queues nothing');
  assert.equal(broker.listQueued().length, 0);

  const proc = startTranscribe(api.base);
  await driveBroker(api.base, proc);
  assert.equal(proc.code, 0, proc.stderr);
  assert.equal(api.state.posts.length, 1);
  const req = api.state.posts[0].body.requests[0];
  assert.match(req.custom_id, lib.BATCH_CUSTOM_ID);
  assert.equal(req.params.model, 'claude-opus-5'); assert.deepEqual(req.params.thinking, { type: 'adaptive' }); assert.equal(req.params.output_config.effort, 'low');
  const content = req.params.messages[0].content;
  assert.equal(content.filter(b => b.type === 'image').length, 3, 'two problems pages and one solutions page');
  assert.equal(content[3].type, 'text'); assert.match(content[3].text, /PAGE IMAGES, in order: #1 problems p\.1; #2 problems p\.2; #3 solutions p\.1/);
  assert.equal(content[0].source.data, PNG.toString('base64'));
  assert.deepEqual(seen[req.custom_id], req.params, 'the API saw the exact queued body');
  assert.match(proc.stderr, /queued .* MB for the Anthropic batch broker as tx-/);

  const summary = JSON.parse(proc.stdout);
  assert.equal(summary.transport, 'batch'); assert.equal(summary.batchId, 'msgbatch_test1'); assert.equal(summary.customId, req.custom_id);
  assert.equal(summary.inputTokens, 10000); assert.equal(summary.outputTokens, 2000);
  assert.equal(lib.estimateCost('claude-opus-5', 10000, 2000), 0.1);
  assert.equal(summary.costUsd, 0.05, 'half of the sync price');
  assert.equal(summary.attempts, 1); assert.equal(summary.stopReason, 'end_turn');
  const candidate = JSON.parse(fs.readFileSync(summary.out, 'utf8'));
  assert.equal(candidate.tx.reader.transport, 'batch'); assert.equal(candidate.tx.reader.batchId, 'msgbatch_test1'); assert.equal(candidate.tx.reader.costUsd, 0.05);
  assert.equal(candidate.tx.reader.requestId, `msg_${lib.sha256(JSON.stringify(reply())).slice(0, 12)}`, 'the message id stands in for the request id');
  assert.equal(candidate.problems[0].number, 1); assert.equal(candidate.paper.id, PAPER);
  const runs = fs.readFileSync(path.join(root, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const last = runs[runs.length - 1];
  assert.equal(last.transport, 'batch'); assert.equal(last.ok, true); assert.equal(last.costUsd, 0.05); assert.equal(last.batchId, 'msgbatch_test1'); assert.equal(last.paperId, PAPER);
  assert.equal(broker.listQueued().length, 0);
});

test('transcribe.mjs re-queues a retryable batch error once and fails on a non-retryable one with the API text', async t => {
  preparePaper();
  let calls = 0;
  const api = await fakeApi(t, { results: () => (++calls === 1
    ? { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }
    : { type: 'succeeded', message: message(JSON.stringify(reply()), { input_tokens: 100, output_tokens: 50 }) }) });
  const proc = startTranscribe(api.base);
  await driveBroker(api.base, proc);
  assert.equal(proc.code, 0, proc.stderr);
  assert.equal(api.state.posts.length, 2, 'the retry is a new request in a new batch');
  assert.notEqual(api.state.posts[0].body.requests[0].custom_id, api.state.posts[1].body.requests[0].custom_id);
  assert.match(proc.stderr, /attempt 1\/3 failed .*overloaded_error.*re-queueing/);
  const summary = JSON.parse(proc.stdout);
  assert.equal(summary.attempts, 2); assert.equal(summary.batchId, 'msgbatch_test2');
  const runs = fs.readFileSync(path.join(root, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.paperId === PAPER);
  const failed = runs.filter(r => r.ok === false);
  assert.equal(failed.length, 1); assert.equal(failed[0].transport, 'batch'); assert.match(failed[0].error, /overloaded_error/);

  const api2 = await fakeApi(t, { results: () => ({ type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'messages.0.content.0.image.source.data: image is too small' } } }) });
  const proc2 = startTranscribe(api2.base);
  await driveBroker(api2.base, proc2);
  assert.equal(proc2.code, 1);
  assert.equal(api2.state.posts.length, 1, 'no retry for an invalid request');
  assert.match(proc2.stderr, /error: anthropic batch request failed \(all\): batch msgbatch_test1 errored: .*image is too small/);
  assert.equal(broker.listQueued().length, 0, 'nothing left queued');
});

test('a sync run is untouched: no transport field, full price, no queue', async t => {
  preparePaper();
  // a fake /v1/messages so the sync path can be exercised against the same server
  const server = http.createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_sync_1' }); res.end(JSON.stringify(message(JSON.stringify(reply()), { input_tokens: 10000, output_tokens: 2000 }))); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  // async like runBroker: the fake server above must keep serving while transcribe.mjs runs
  const r = await new Promise(resolve => {
    const child = spawn(process.execPath, [txScript('transcribe.mjs'), PAPER, '--provider', 'anthropic', '--model', 'claude-opus-5', '--stage', 'reader', '--transport', 'sync'], { env: envFor(base, { TX_ANTHROPIC_TRANSPORT: 'batch' }) });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.transport, undefined); assert.equal(summary.costUsd, 0.1); assert.equal(summary.requestId, 'req_sync_1');
  const candidate = JSON.parse(fs.readFileSync(summary.out, 'utf8'));
  assert.equal(candidate.tx.reader.transport, undefined);
  assert.equal(broker.listQueued().length, 0);
});
