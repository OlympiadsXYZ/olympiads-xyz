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
process.on('exit', () => { if (process.env.TX_TEST_KEEP) { console.error(`sandbox kept: ${root}`); return; } try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

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
async function fakeApi(t, { endAfterPolls = 1, results = (id) => ({ type: 'succeeded', message: message(`reply to ${id}`) }), failPosts = 0, badIndexOnce = null, idPrefix = 'msgbatch_test', destroyAfterPost = 0, failLists = 0 } = {}) {
  const state = { batches: new Map(), posts: [], n: 0, failPosts, badIndexOnce, badAuth: 0, destroyAfterPost, failLists, lists: 0 };
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
        if (state.destroyAfterPost > 0) { state.destroyAfterPost--; return req.socket.destroy(); } // the batch exists, the client never hears
        return send(200, batchObj(b));
      }
      if (req.method === 'GET' && url.pathname === '/v1/messages/batches') { state.lists++; if (state.failLists > 0) { state.failLists--; return send(500, { type: 'error', error: { type: 'api_error', message: 'Internal server error' } }); } return send(200, { data: [...state.batches.values()].map(batchObj), has_more: false }); }
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
  // a pending record with no batch behind it that is older than 30 minutes is dropped at once and its request goes out normally
  const body2 = requestBody('never reached the API');
  const id2 = lib.batchCustomId('i', 'reader', 'all', body2);
  lib.enqueueBatchRequest(id2, body2, { paperId: 'i', stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  fs.writeFileSync(path.join(BATCH_DIRS.batches, 'pending-deadbeef0002.json'), JSON.stringify({ pending: true, token: 'deadbeef0002', customIds: [id2], count: 1, bytes: 500, createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() }));
  const run2 = await runBroker(api.base);
  assert.equal(run2.status, 0, run2.stderr);
  assert.equal(api.state.posts.length, 2);
  assert.equal(api.state.posts[1].body.requests[0].custom_id, id2);
  const dropped = readLog().find(l => l.action === 'pending-dropped' && l.pending === 'deadbeef0002');
  assert.ok(dropped); assert.match(dropped.why, /older than 30 minutes/);
  assert.equal((await lib.waitForBatchResult(id2, { pollMs: 20, timeoutMs: 2000 })).batch.id, 'msgbatch_adopt2');
});

test('a pending record survives failed listings and listings that do not show the batch yet: no second POST; a fresh one with no batch is dropped only after 3 listings', async t => {
  const api = await fakeApi(t, { idPrefix: 'msgbatch_keep', failLists: 2 });
  const body = requestBody('interrupted, listing flaky');
  const id = lib.batchCustomId('k', 'reader', 'all', body);
  lib.enqueueBatchRequest(id, body, { paperId: 'k', stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  fs.writeFileSync(path.join(BATCH_DIRS.batches, 'pending-cafe00000001.json'), JSON.stringify({ pending: true, token: 'cafe00000001', customIds: [id], count: 1, bytes: 500, createdAt: lib.nowIso() }));
  const posted = await fetch(`${api.base}/v1/messages/batches`, { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ requests: [{ custom_id: id, params: JSON.parse(body) }] }) }).then(r => r.json());
  assert.equal(posted.id, 'msgbatch_keep1');
  // passes 1 and 2: the listing 500s — the record stays, the request stays queued but is never POSTed
  for (const n of [1, 2]) {
    const run = await runBroker(api.base);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(api.state.posts.length, 1, `pass ${n}: no second POST while the listing fails`);
    assert.ok(fs.existsSync(path.join(BATCH_DIRS.batches, 'pending-cafe00000001.json')), `pass ${n}: the pending record is kept`);
    assert.equal(lib.batchRequestState(id), 'queued');
    assert.match(run.stderr, /could not list batches .*kept for the next pass/);
  }
  assert.equal(readLog().filter(l => l.action === 'pending-unresolved' && l.pending === 'cafe00000001' && /could not list/.test(l.why)).length, 2);
  assert.equal(api.state.lists, 2, 'two failed listings');
  // pass 3: the listing works and shows the batch — adopted, still one POST
  const run3 = await runBroker(api.base);
  assert.equal(run3.status, 0, run3.stderr);
  assert.equal(api.state.posts.length, 1, 'adopted, never resubmitted');
  assert.ok(!fs.existsSync(path.join(BATCH_DIRS.batches, 'pending-cafe00000001.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(BATCH_DIRS.batches, 'msgbatch_keep1.json'), 'utf8')).adoptedFrom, 'cafe00000001');
  assert.equal(lib.batchRequestState(id), 'done', 'the same pass polled the adopted batch, which ended at once');
  assert.equal((await lib.waitForBatchResult(id, { pollMs: 20, timeoutMs: 2000 })).content[0].text, `reply to ${id}`);
  // a fresh pending record with no batch behind it: kept through two clean listings, dropped (and the request submitted) on the third
  const body2 = requestBody('no batch behind it');
  const id2 = lib.batchCustomId('k', 'reader', 'all', body2);
  lib.enqueueBatchRequest(id2, body2, { paperId: 'k', stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  const pendingFile = path.join(BATCH_DIRS.batches, 'pending-cafe00000002.json');
  fs.writeFileSync(pendingFile, JSON.stringify({ pending: true, token: 'cafe00000002', customIds: [id2], count: 1, bytes: 500, createdAt: lib.nowIso() }));
  for (const n of [1, 2]) {
    const run = await runBroker(api.base);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(api.state.posts.length, 1, `listing ${n}: still no POST`);
    assert.equal(JSON.parse(fs.readFileSync(pendingFile, 'utf8')).unmatchedListings, n, 'the record counts its clean listings');
    assert.equal(lib.batchRequestState(id2), 'queued');
  }
  const run6 = await runBroker(api.base);
  assert.equal(run6.status, 0, run6.stderr);
  assert.ok(!fs.existsSync(pendingFile), 'dropped after the third clean listing');
  const dropped = readLog().find(l => l.action === 'pending-dropped' && l.pending === 'cafe00000002');
  assert.ok(dropped); assert.equal(dropped.listings, 3); assert.match(dropped.why, /after 3 listings/);
  assert.equal(api.state.posts.length, 2, 'then submitted from the queue in the same pass');
  assert.equal(api.state.posts[1].body.requests[0].custom_id, id2);
  assert.equal((await lib.waitForBatchResult(id2, { pollMs: 20, timeoutMs: 2000 })).batch.id, 'msgbatch_keep2');
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
  fs.rmSync(path.join(dir, 'candidates'), { recursive: true, force: true }); // an earlier test's candidate must not pass for this one's
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  for (const f of ['problems-01.png', 'problems-02.png', 'solutions-01.png']) fs.writeFileSync(path.join(dir, 'pages', f), PNG);
  return dir;
}
function startTranscribe(base, extra = [], env = {}) {
  const child = spawn(process.execPath, [txScript('transcribe.mjs'), PAPER, '--provider', 'anthropic', '--model', 'claude-opus-5', '--stage', 'reader', ...extra], { encoding: 'utf8', env: envFor(base, { TX_ANTHROPIC_TRANSPORT: 'batch', TX_BATCH_POLL_MS: '200', ...env }) });
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

// ---- reviewer findings (2026-09-17): unknown-outcome POST, dead waiters, the submitted wait

test('a POST the API accepted but never answered keeps its pending record; the next pass adopts the batch without a second POST', async t => {
  const api = await fakeApi(t, { idPrefix: 'msgbatch_cut', destroyAfterPost: 1 });
  const body = requestBody('socket cut after the body went out');
  const id = lib.batchCustomId('cut', 'reader', 'all', body);
  lib.enqueueBatchRequest(id, body, { paperId: 'cut', stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  const first = await runBroker(api.base);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(api.state.posts.length, 1, 'the API saw the POST');
  assert.equal(api.state.batches.size, 1, 'and created the batch');
  const pending = fs.readdirSync(BATCH_DIRS.batches).filter(f => f.startsWith('pending-'));
  assert.equal(pending.length, 1, 'the pending record is kept on an unknown outcome');
  assert.equal(lib.batchRequestState(id), 'queued', 'the body stays in the queue until the batch is known');
  assert.ok(readLog().some(l => l.action === 'submit-unknown' && l.requests === 1), `submit-unknown logged: ${readLog().map(l => l.action)}`);
  assert.ok(!fs.existsSync(path.join(BATCH_DIRS.batches, 'msgbatch_cut1.json')), 'no record yet');
  const second = await runBroker(api.base);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(api.state.posts.length, 1, 'never POSTed again');
  const rec = JSON.parse(fs.readFileSync(path.join(BATCH_DIRS.batches, 'msgbatch_cut1.json'), 'utf8'));
  assert.deepEqual(rec.customIds, [id]); assert.ok(rec.adoptedFrom, 'adopted from the pending record');
  assert.equal(fs.readdirSync(BATCH_DIRS.batches).filter(f => f.startsWith('pending-')).length, 0);
  assert.equal((await lib.waitForBatchResult(id, { pollMs: 20, timeoutMs: 2000 })).content[0].text, `reply to ${id}`);
});

test('a queued request whose waiting process is gone fails as waiter_gone before submission; live and detached waiters are submitted', async t => {
  const api = await fakeApi(t, { idPrefix: 'msgbatch_gone', endAfterPolls: 5 });
  // a pid that certainly belonged to a process which has exited
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  const deadPid = Number(gone.stdout.trim());
  assert.ok(deadPid > 0 && !lib.pidAlive(deadPid), `pid ${deadPid} should be dead`);
  const mk = (name, extra) => { const body = requestBody(`waiter ${name}`); const id = lib.batchCustomId('w', 'reader', name, body); lib.enqueueBatchRequest(id, body, { paperId: 'w', stage: 'reader', window: name, model: 'claude-opus-5', createdAt: lib.nowIso(), ...extra }); return id; };
  const dead = mk('dead', { pid: deadPid });
  const live = mk('live', { pid: process.pid });
  const detached = mk('detached', { detached: true });
  const legacy = mk('legacy', {}); // no pid at all (an older sidecar): submitted
  const run = await runBroker(api.base);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(api.state.posts.length, 1);
  const submitted = api.state.posts[0].body.requests.map(r => r.custom_id).sort();
  assert.deepEqual(submitted, [live, detached, legacy].sort(), 'the dead waiter\'s request never reaches the API');
  const rejected = lib.readBatchResult(dead);
  assert.equal(rejected.error.type, 'waiter_gone'); assert.match(rejected.error.message, new RegExp(`pid ${deadPid}`));
  assert.equal(lib.batchResultError(rejected).retryable, false);
  assert.ok(fs.existsSync(path.join(BATCH_DIRS.failed, `${dead}.json`)) && fs.existsSync(path.join(BATCH_DIRS.failed, `${dead}.meta.json`)));
  assert.ok(readLog().some(l => l.action === 'rejected' && l.customId === dead && l.pid === deadPid));
  for (const id of [live, detached, legacy]) assert.equal(lib.batchRequestState(id), 'submitted:msgbatch_gone1');
});

test('the waiter gives up a queued (unpaid) request at the queued cap, but waits for a submitted one until its batch window + grace', async t => {
  // short constants through the environment: queued cap 1.5 s (a broker pass takes ~0.5 s to spawn and submit), batch window 4 s + 1 s grace, poll 100 ms
  const waitEnv = { TX_BATCH_QUEUED_TIMEOUT_MS: '1500', TX_BATCH_TTL_MS: '4000', TX_BATCH_GRACE_MS: '1000', TX_BATCH_POLL_MS: '100' };
  const started = Date.now();
  const d1 = lib.batchWaitDeadline(`tx-${'1'.repeat(40)}-000001`, started, { queuedTimeoutMs: 1500, ttlMs: 4000, graceMs: 1000 });
  assert.equal(d1.state, 'unknown'); assert.equal(d1.deadline, started + 1500, 'an unknown/queued request: the queued cap from the start');
  preparePaper();
  // (a) no broker at all: the queued request is withdrawn after the queued cap
  {
    const api = await fakeApi(t);
    const proc = startTranscribe(api.base, [], waitEnv);
    await proc.done;
    assert.equal(proc.code, 1, proc.stderr);
    assert.match(proc.stderr, /timed out \(all\): no batch result after .* \(queued; no broker running\); the queued request was withdrawn/);
    assert.equal(broker.listQueued().length, 0, 'withdrawn');
    assert.equal(api.state.posts.length, 0);
  }
  // (b) submitted, the batch takes longer than the queued cap: the waiter stays until the batch ends
  {
    const api = await fakeApi(t, { idPrefix: 'msgbatch_slow', endAfterPolls: 2, results: () => ({ type: 'succeeded', message: message(JSON.stringify(reply())) }) });
    const proc = startTranscribe(api.base, [], waitEnv);
    await until(() => broker.listQueued().length > 0, { what: 'the queued request' });
    const r1 = await runBroker(api.base);
    assert.equal(r1.status, 0, r1.stderr);
    const id = api.state.posts[0].body.requests[0].custom_id;
    assert.equal(lib.batchRequestState(id), 'submitted:msgbatch_slow1');
    const rec = JSON.parse(fs.readFileSync(path.join(BATCH_DIRS.batches, 'msgbatch_slow1.json'), 'utf8'));
    const d2 = lib.batchWaitDeadline(id, started, { queuedTimeoutMs: 1500, ttlMs: 4000, graceMs: 1000 });
    assert.equal(d2.state, 'submitted:msgbatch_slow1'); assert.equal(d2.batchId, 'msgbatch_slow1');
    assert.equal(d2.deadline, Date.parse(rec.createdAt) + 5000, 'submitted: the batch record\'s createdAt + window + grace');
    await wait(2200); // well past the 1.5 s queued cap, inside the batch window
    assert.equal(proc.code, null, `the waiter must not give up on a submitted request at the queued cap\n${proc.stderr}`);
    const r2 = await runBroker(api.base); // poll 2: the batch ends, the result is written
    assert.equal(r2.status, 0, r2.stderr);
    await Promise.race([proc.done, wait(5000)]);
    assert.equal(proc.code, 0, proc.stderr);
    assert.equal(JSON.parse(proc.stdout).batchId, 'msgbatch_slow1');
  }
  // (c) submitted but the batch never ends: the waiter gives up at the window + grace, and says the request stays in its batch
  {
    const api = await fakeApi(t, { idPrefix: 'msgbatch_stuck', endAfterPolls: 99 });
    const proc = startTranscribe(api.base, [], waitEnv);
    await until(() => broker.listQueued().length > 0, { what: 'the queued request' });
    const r1 = await runBroker(api.base);
    assert.equal(r1.status, 0, r1.stderr);
    const t0 = Date.now();
    await Promise.race([proc.done, wait(12000)]);
    assert.equal(proc.code, 1, proc.stderr);
    const took = Date.now() - t0;
    assert.ok(took >= 3000 && took < 9000, `gave up after the window + grace (${took} ms)`);
    assert.match(proc.stderr, /timed out \(all\): .*submitted:msgbatch_stuck1.*the request stays in its batch and its result will be ignored/);
  }
});

// ---- park-and-resume: --batch-async / --batch-result

const asyncEnv = { TX_BATCH_POLL_MS: '100' };
function transcribeSync(base, extra = [], env = {}) {
  return spawnSync(process.execPath, [txScript('transcribe.mjs'), PAPER, '--provider', 'anthropic', '--model', 'claude-opus-5', '--stage', 'reader', ...extra], { encoding: 'utf8', env: envFor(base, { ...asyncEnv, ...env }) });
}
const queuedLines = r => r.stdout.split(/\r?\n/).filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const runsAll = () => fs.readFileSync(path.join(root, 'runs.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const runsFor = () => runsAll().filter(r => r.paperId === PAPER && !r.provisional); // the real records; provisional bookings are asserted on their own
const provisionalFor = (paperId = PAPER) => runsAll().filter(r => r.paperId === paperId && r.provisional);

test('--batch-async queues the request and exits 2 with one JSON line; --batch-result runs the sync post-processing and writes the candidate', async t => {
  preparePaper();
  const api = await fakeApi(t, { idPrefix: 'msgbatch_async', results: () => ({ type: 'succeeded', message: message(JSON.stringify(reply()), { input_tokens: 10000, output_tokens: 2000 }) }) });
  const runsBefore = runsFor().length;
  const q = transcribeSync(api.base, ['--batch-async', '--no-broker-check']);
  assert.equal(q.status, 2, q.stderr);
  const lines = queuedLines(q);
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.equal(line.queued, true); assert.match(line.customId, lib.BATCH_CUSTOM_ID); assert.equal(line.stage, 'reader'); assert.equal(line.window, 'all'); assert.equal(line.paperId, PAPER);
  assert.equal(line.out, lib.candidateFile(PAPER, 'anthropic', 'claude-opus-5')); assert.equal(line.assembled, undefined, 'one window: no assembly');
  assert.ok(!fs.existsSync(line.out), 'nothing written at enqueue time');
  assert.equal(lib.batchRequestState(line.customId), 'queued', 'the queued request survives the exit (not withdrawn)');
  const meta = JSON.parse(fs.readFileSync(lib.batchFiles(line.customId).meta, 'utf8'));
  assert.equal(meta.detached, true); assert.equal(meta.pid, undefined, 'no waiting pid: the broker must not drop it as waiter_gone'); assert.equal(meta.out, line.out); assert.equal(meta.attempt, 1); assert.equal(meta.ask, 1);
  assert.equal(runsFor().length, runsBefore, 'no real record at enqueue time');
  const prov = provisionalFor().filter(r => r.customId === line.customId);
  assert.equal(prov.length, 1, 'one provisional booking for the enqueue');
  assert.equal(prov[0].ok, false); assert.equal(prov[0].provider, 'anthropic'); assert.equal(prov[0].model, 'claude-opus-5'); assert.equal(prov[0].stage, 'reader'); assert.equal(prov[0].transport, 'batch');
  const dryEst = JSON.parse(transcribeSync(api.base, ['--dry-run', '--batch-async', '--no-broker-check']).stdout).estimatedCostUsd;
  assert.ok(dryEst > 0 && prov[0].costUsd === dryEst, `the provisional cost is the dry-run estimate at the batch price (${prov[0].costUsd} vs ${dryEst})`);
  assert.match(q.stderr, /queued .* as tx-.* \(detached\); collect it with --batch-result/);

  // the result is not there yet: --batch-result fails at once, spends nothing
  const early = transcribeSync(api.base, ['--batch-result', line.customId]);
  assert.equal(early.status, 1); assert.match(early.stderr, /no result for tx-.* \(all\): queued/);
  assert.ok(!fs.existsSync(line.out));

  const r = await runBroker(api.base);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(api.state.posts.length, 1);
  assert.equal(api.state.posts[0].body.requests[0].custom_id, line.customId);
  assert.equal(api.state.posts[0].body.requests[0].params.messages[0].content.filter(b => b.type === 'image').length, 3, 'the exact request: three page images');
  assert.ok(fs.existsSync(lib.batchFiles(line.customId).result));

  const c = transcribeSync(api.base, ['--batch-result', line.customId]);
  assert.equal(c.status, 0, c.stderr);
  const summary = JSON.parse(c.stdout);
  assert.equal(summary.transport, 'batch'); assert.equal(summary.batchId, 'msgbatch_async1'); assert.equal(summary.customId, line.customId); assert.equal(summary.out, line.out);
  assert.equal(summary.costUsd, 0.05, 'half price'); assert.equal(summary.inputTokens, 10000); assert.equal(summary.attempts, 1);
  const candidate = JSON.parse(fs.readFileSync(line.out, 'utf8'));
  assert.equal(candidate.tx.reader.transport, 'batch'); assert.equal(candidate.tx.reader.batchId, 'msgbatch_async1'); assert.equal(candidate.tx.reader.customId, line.customId); assert.equal(candidate.tx.reader.costUsd, 0.05);
  assert.equal(candidate.tx.reader.requestId, `msg_${lib.sha256(JSON.stringify(reply())).slice(0, 12)}`);
  assert.equal(candidate.problems[0].number, 1); assert.equal(candidate.problems[0].parts[0].answer.value, 0.06, 'the same normalise/sanitise as the sync path');
  const runs = runsFor();
  assert.equal(runs.length, runsBefore + 1, 'one run record: the collected reply');
  const last = runs.at(-1);
  assert.equal(last.ok, true); assert.equal(last.transport, 'batch'); assert.equal(last.costUsd, 0.05); assert.equal(last.customId, line.customId); assert.equal(last.batchId, 'msgbatch_async1'); assert.equal(last.ask, 1);
  // collecting twice is refused nowhere but books nothing new either: the caller (run.mjs) collects once
  // a wrong provider or the sync transport cannot take the flags
  const bad = spawnSync(process.execPath, [txScript('transcribe.mjs'), PAPER, '--provider', 'gemini', '--model', 'x', '--stage', 'reader', '--batch-async', '--no-broker-check'], { encoding: 'utf8', env: envFor(api.base) });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /apply to the anthropic provider only/);
  const bad2 = transcribeSync(api.base, ['--batch-async', '--no-broker-check', '--transport', 'sync']);
  assert.equal(bad2.status, 1); assert.match(bad2.stderr, /need the batch transport/);
});

test('a windowed reader: --batch-async queues every window at once; --batch-result assembles once both results exist', async t => {
  preparePaper();
  const api = await fakeApi(t, { idPrefix: 'msgbatch_win', results: (id, params) => {
    const text = params.messages[0].content.at(-1).text;
    // the solutions window carries the solution; the problems window the statement — like a real windowed read
    const r = reply();
    if (/PAGE IMAGES, in order: #1 solutions/.test(text)) { r.paper.source.pages = []; r.problems[0].statement = lib.WINDOW_PLACEHOLDER; r.problems[0].parts = []; r.problems[0].tx.sourceSpans = [{ document: 'solutions', page: 1 }]; }
    else { delete r.paper.solutionSource; delete r.problems[0].solution; r.problems[0].tx.sourceSpans = [{ document: 'problems', page: 1 }]; }
    return { type: 'succeeded', message: message(JSON.stringify(r), { input_tokens: 5000, output_tokens: 1000 }) };
  } });
  const q = transcribeSync(api.base, ['--batch-async', '--no-broker-check', '--window-pages', '2']);
  assert.equal(q.status, 2, q.stderr);
  const lines = queuedLines(q);
  assert.deepEqual(lines.map(l => l.window), ['problems-01-02', 'solutions-01-01'], 'one line per window, in window order');
  const outFile = lib.candidateFile(PAPER, 'anthropic', 'claude-opus-5');
  for (const l of lines) { assert.equal(l.assembled, outFile); assert.equal(l.out, outFile.replace(/\.json$/, `.window-${l.window}.json`)); assert.equal(lib.batchRequestState(l.customId), 'queued'); }
  const ids = lines.map(l => l.customId);
  assert.deepEqual(broker.listQueued().map(q => q.customId).sort(), [...ids].sort(), JSON.stringify(broker.listQueued().map(q => JSON.parse(fs.readFileSync(q.meta, 'utf8')))));
  // one id for two windows is refused before anything is read
  const wrongCount = transcribeSync(api.base, ['--batch-result', ids[0], '--window-pages', '2']);
  assert.equal(wrongCount.status, 1); assert.match(wrongCount.stderr, /needs 2 custom id\(s\) for 2 window\(s\)/);
  // one result in, one not: nothing is written, nothing booked
  fs.writeFileSync(lib.batchFiles(ids[0]).result, JSON.stringify({ ...message('{}'), batch: { id: 'fake', customId: ids[0], resultType: 'succeeded', writtenAt: lib.nowIso() } }));
  const half = transcribeSync(api.base, ['--batch-result', ids.join(','), '--window-pages', '2']);
  assert.equal(half.status, 1); assert.match(half.stderr, /no result for tx-.* \(solutions-01-01\): queued/);
  assert.ok(!fs.existsSync(outFile));
  fs.unlinkSync(lib.batchFiles(ids[0]).result);
  const r1 = await runBroker(api.base);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(api.state.posts.length, 1, 'both windows in one batch');
  assert.ok(ids.every(id => fs.existsSync(lib.batchFiles(id).result)));
  const c = transcribeSync(api.base, ['--batch-result', ids.join(','), '--window-pages', '2']);
  assert.equal(c.status, 0, `${c.stderr}\n${c.stdout}`);
  const summary = JSON.parse(c.stdout);
  assert.equal(summary.out, outFile); assert.equal(summary.windows.length, 2);
  assert.deepEqual(summary.windows.map(w => w.customId), ids); assert.ok(summary.windows.every(w => w.transport === 'batch' && w.costUsd > 0));
  assert.equal(summary.assembly.ok, true, JSON.stringify(summary.assembly));
  const assembled = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(assembled.problems.length, 1); assert.match(assembled.problems[0].statement, /Токът/); assert.match(assembled.problems[0].solution.statement, /Решение/);
  assert.equal(assembled.tx.reader.windows, 2);
  for (const l of lines) { const part = JSON.parse(fs.readFileSync(l.out, 'utf8')); assert.equal(part.tx.reader.customId, l.customId); assert.equal(part.tx.reader.transport, 'batch'); }
  const runs = runsFor().slice(-2);
  assert.deepEqual(runs.map(r => r.customId), ids); assert.ok(runs.every(r => r.ok && r.transport === 'batch'));
});

test('--batch-result: a retryable error re-queues that window (exit 2, new id, others reused); a non-retryable one exits 1 with the API text; unusable JSON is asked once more', async t => {
  preparePaper();
  const kinds = new Map(); // customId → result kind
  const good = () => ({ type: 'succeeded', message: message(JSON.stringify(reply()), { input_tokens: 100, output_tokens: 50 }) });
  const api = await fakeApi(t, { idPrefix: 'msgbatch_rq', results: id => kinds.get(id)?.() || good() });
  // (a) overloaded on attempt 1 → re-queued; attempt 2 succeeds
  let q = transcribeSync(api.base, ['--batch-async', '--no-broker-check']);
  assert.equal(q.status, 2, q.stderr);
  const id1 = queuedLines(q)[0].customId;
  kinds.set(id1, () => ({ type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }));
  assert.equal((await runBroker(api.base)).status, 0);
  const rq = transcribeSync(api.base, ['--batch-result', id1]);
  assert.equal(rq.status, 2, rq.stderr);
  assert.match(rq.stderr, /attempt 1\/3 failed .*overloaded_error.*re-queueing/);
  const l2 = queuedLines(rq);
  assert.equal(l2.length, 1); assert.notEqual(l2[0].customId, id1); assert.equal(l2[0].replaces, id1); assert.equal(l2[0].attempt, 2); assert.equal(l2[0].reused, undefined);
  const id2 = l2[0].customId;
  assert.equal(JSON.parse(fs.readFileSync(lib.batchFiles(id2).meta, 'utf8')).attempt, 2);
  assert.ok(!fs.existsSync(l2[0].out));
  assert.equal(runsFor().at(-1).ok, false); assert.equal(runsFor().at(-1).customId, id1);
  assert.equal((await runBroker(api.base)).status, 0);
  const ok = transcribeSync(api.base, ['--batch-result', id2]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).attempts, 2);
  assert.equal(JSON.parse(fs.readFileSync(l2[0].out, 'utf8')).tx.reader.attempts, 2);
  // (b) a non-retryable error: exit 1 with the API's text, nothing queued
  q = transcribeSync(api.base, ['--batch-async', '--no-broker-check']);
  const id3 = queuedLines(q)[0].customId;
  kinds.set(id3, () => ({ type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'messages.0.content.0.image.source.data: image is too small' } } }));
  assert.equal((await runBroker(api.base)).status, 0);
  const bad = transcribeSync(api.base, ['--batch-result', id3]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /error: anthropic batch request failed \(all\): batch msgbatch_rq\d+ errored: .*image is too small/);
  assert.equal(broker.listQueued().length, 0);
  // (c) prose instead of JSON: the paid reply is booked (unusableJson) and the window is asked once more (ask 2); a second prose reply fails
  q = transcribeSync(api.base, ['--batch-async', '--no-broker-check']);
  const id4 = queuedLines(q)[0].customId;
  kinds.set(id4, () => ({ type: 'succeeded', message: message('Sorry, I cannot read these pages.', { input_tokens: 100, output_tokens: 10 }) }));
  assert.equal((await runBroker(api.base)).status, 0);
  const prose = transcribeSync(api.base, ['--batch-result', id4]);
  assert.equal(prose.status, 2, prose.stderr);
  assert.match(prose.stderr, /no usable JSON in the reply .*asking once more/);
  const l5 = queuedLines(prose);
  assert.equal(l5[0].ask, 2); assert.equal(l5[0].attempt, 1); assert.equal(l5[0].replaces, id4);
  const booked = runsFor().at(-1);
  assert.equal(booked.customId, id4); assert.equal(booked.ok, true); assert.equal(booked.unusableJson, true); assert.ok(booked.costUsd > 0, 'the tokens were billed');
  const id5 = l5[0].customId;
  kinds.set(id5, () => ({ type: 'succeeded', message: message('still prose', { input_tokens: 100, output_tokens: 10 }) }));
  assert.equal((await runBroker(api.base)).status, 0);
  const prose2 = transcribeSync(api.base, ['--batch-result', id5]);
  assert.equal(prose2.status, 1); assert.match(prose2.stderr, /no usable JSON in the reply for all after 2 asks/);
  // (d) a windowed re-queue keeps the good window's id (reused) and books nothing for it until the collect
  const win = transcribeSync(api.base, ['--batch-async', '--no-broker-check', '--window-pages', '2']);
  const wl = queuedLines(win); const [wa, wb] = wl.map(l => l.customId);
  kinds.set(wb, () => ({ type: 'expired' }));
  assert.equal((await runBroker(api.base)).status, 0);
  const runsBefore = runsFor().length;
  const mixed = transcribeSync(api.base, ['--batch-result', `${wa},${wb}`, '--window-pages', '2']);
  assert.equal(mixed.status, 2, mixed.stderr);
  const ml = queuedLines(mixed);
  assert.equal(ml.length, 2); assert.equal(ml[0].customId, wa); assert.equal(ml[0].reused, true); assert.notEqual(ml[1].customId, wb); assert.equal(ml[1].replaces, wb); assert.equal(ml[1].window, 'solutions-01-01');
  assert.equal(runsFor().length, runsBefore + 1, 'only the failed attempt is booked; the good window waits for the full collect');
  assert.ok(!fs.existsSync(wl[0].out), 'the good window is not written until every window is in');
  assert.equal((await runBroker(api.base)).status, 0);
  const done = transcribeSync(api.base, ['--batch-result', ml.map(l => l.customId).join(','), '--window-pages', '2']);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(runsFor().length, runsBefore + 3, 'both windows booked exactly once');
  assert.ok(fs.existsSync(wl[0].out) && fs.existsSync(wl[1].out) && fs.existsSync(lib.candidateFile(PAPER, 'anthropic', 'claude-opus-5')));
});

// ---- run.mjs --batch-async and the batch.mjs scheduler on sandboxed papers (a hand-written job at the reader stage:
// prepare.mjs needs rclone and poppler; figures.mjs still asks `which python3` / `which rclone` before it does
// nothing for a candidate without figures, so these two tests skip where those are not on PATH)
const toolsOnPath = ['python3', 'rclone'].every(t => lib.which(t));
const replyFor = id => { const r = reply(); r.paper.id = id; r.problems[0].id = `${id}-p1`; return r; };
const checkerReplyFor = text => ({ verdict: 'pass', candidateSha256: /Candidate bytes SHA-256 \(copy as candidateSha256\): ([0-9a-f]{64})/.exec(text)?.[1] || null, summary: 'fine', defects: [], coverage: { pagesRead: [{ document: 'problems', page: 1 }, { document: 'problems', page: 2 }, { document: 'solutions', page: 1 }], problemsChecked: 1, figuresChecked: 0 } });
// the fake API answers a reader request with the paper's transcription and a checker request with a pass
const pipelineResults = (id, params) => {
  const text = params.messages[0].content.at(-1).text;
  const body = /CANDIDATE TRANSCRIPTION/.test(text) ? checkerReplyFor(text) : replyFor(/zz-2099-batch-\d+/.exec(text)?.[0] || PAPER);
  return { type: 'succeeded', message: message(JSON.stringify(body), { input_tokens: 1000, output_tokens: 200 }) };
};
function preparePaperId(id) {
  const dir = path.join(root, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, paperId: id }));
  for (const f of ['problems-01.png', 'problems-02.png', 'solutions-01.png']) fs.writeFileSync(path.join(dir, 'pages', f), PNG);
  return dir;
}
const jobsFile = path.join(root, 'jobs.json');
const readJobs = () => (fs.existsSync(jobsFile) ? JSON.parse(fs.readFileSync(jobsFile, 'utf8')) : { version: 2, jobs: {} });
function plantJob(id, extra = {}) {
  const all = readJobs();
  all.jobs[id] = { paperId: id, reader: { provider: 'anthropic', model: 'claude-opus-5' }, checker: { provider: 'anthropic', model: 'claude-opus-5' }, stage: 'reader', promote: false, dryRun: false, allowSameModel: true, options: { maxRounds: 2, ...extra }, round: 0, createdAt: lib.nowIso(), history: [], artefacts: { manifest: path.relative(repo, path.join(root, id, 'manifest.json')) } };
  fs.writeFileSync(jobsFile, JSON.stringify(all));
}
const jobOf = id => readJobs().jobs[id];
function runAsync(script, argv, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [txScript(script), ...argv], { env, cwd: repo });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('run.mjs --batch-async parks the reader and the checker with waitingFor and resumes each on --continue once the result files exist', { skip: toolsOnPath ? false : 'python3 and rclone are not on PATH (figures.mjs asks for them)' }, async t => {
  const api = await fakeApi(t, { idPrefix: 'msgbatch_run', results: pipelineResults });
  const env = envFor(api.base, { TX_BATCH_POLL_MS: '100' });
  preparePaperId(PAPER);
  plantJob(PAPER, { batchAsync: true });
  const postsBefore = api.state.posts.length;
  // 1. the reader is queued, the job parks
  const r1 = await runAsync('run.mjs', [PAPER, '--continue'], env);
  assert.equal(r1.status, 2, r1.stderr);
  let job = jobOf(PAPER);
  assert.equal(job.stage, 'reader');
  assert.equal(job.waitingFor.transport, 'batch'); assert.equal(job.waitingFor.stage, 'reader'); assert.equal(job.waitingFor.customIds.length, 1); assert.equal(job.waitingFor.out, lib.candidateFile(PAPER, 'anthropic', 'claude-opus-5')); assert.ok(job.waitingFor.since);
  assert.match(r1.stdout, /reader queued for the Anthropic batch broker \(1 request\(s\): tx-/);
  const readerId = job.waitingFor.customIds[0];
  assert.equal(lib.batchRequestState(readerId), 'queued');
  assert.ok(job.history.at(-1).note.startsWith('queued 1 batch request(s) for the reader'));
  // 2. --continue before the result: exit 2 again, nothing queued, nothing spent
  const r2 = await runAsync('run.mjs', [PAPER, '--continue'], env);
  assert.equal(r2.status, 2, r2.stderr);
  assert.match(r2.stdout, /reader still waiting for 1 of 1 batch result\(s\)/);
  assert.deepEqual(jobOf(PAPER).waitingFor.customIds, [readerId], 'the same request, not a second one');
  assert.equal(broker.listQueued().length, 1);
  assert.equal(api.state.posts.length, postsBefore);
  // 3. the broker runs; --continue collects the reader, validates, crops (nothing to crop), queues the checker, parks again
  assert.equal((await runBroker(api.base)).status, 0);
  assert.ok(fs.existsSync(lib.batchFiles(readerId).result));
  const r3 = await runAsync('run.mjs', [PAPER, '--continue'], env);
  assert.equal(r3.status, 2, `${r3.stderr}\n${r3.stdout}`);
  job = jobOf(PAPER);
  assert.equal(job.stage, 'checker');
  assert.equal(job.waitingFor.stage, 'checker'); assert.equal(job.waitingFor.transport, 'batch'); assert.equal(job.waitingFor.customIds.length, 1);
  const checkerId = job.waitingFor.customIds[0];
  assert.notEqual(checkerId, readerId);
  assert.ok(job.artefacts.candidate && job.artefacts.candidateWithFigures && job.artefacts.validatedSha256, JSON.stringify(job.artefacts));
  const notes = job.history.map(h => h.note);
  assert.ok(notes.includes('reader done'), notes.join(' | ')); assert.ok(notes.includes('validated')); assert.ok(notes.some(n => /^figures done/.test(n)));
  assert.ok(notes.some(n => n.startsWith('queued 1 batch request(s) for the checker')));
  const candidate = JSON.parse(fs.readFileSync(path.resolve(repo, job.artefacts.candidate), 'utf8'));
  assert.equal(candidate.tx.reader.transport, 'batch'); assert.equal(candidate.tx.reader.customId, readerId);
  const checkerMeta = JSON.parse(fs.readFileSync(lib.batchFiles(checkerId).meta, 'utf8'));
  assert.equal(checkerMeta.stage, 'checker'); assert.equal(checkerMeta.detached, true);
  // 4. the checker's result lands; --continue collects it and the loop finishes (no promotion asked)
  assert.equal((await runBroker(api.base)).status, 0);
  const r4 = await runAsync('run.mjs', [PAPER, '--continue'], env);
  assert.equal(r4.status, 0, `${r4.stderr}\n${r4.stdout}`);
  job = jobOf(PAPER);
  assert.equal(job.stage, 'done'); assert.equal(job.waitingFor, null);
  assert.equal(job.history.at(-1).note, 'receipt: pass');
  const check = JSON.parse(fs.readFileSync(path.resolve(repo, job.artefacts.checker), 'utf8'));
  assert.equal(check.verdict, 'pass'); assert.equal(check.checker.transport, 'batch'); assert.equal(check.checker.customId, checkerId);
  const receipt = JSON.parse(fs.readFileSync(path.join(root, PAPER, 'receipt.json'), 'utf8'));
  assert.equal(receipt.verdict, 'pass');
  const runs = runsFor().slice(-2);
  assert.deepEqual(runs.map(r => [r.stage, r.transport, r.customId]), [['reader', 'batch', readerId], ['checker', 'batch', checkerId]]);
  assert.ok(runs.every(r => r.costUsd > 0));
  // a --continue on the finished job is the usual no-op
  const r5 = await runAsync('run.mjs', [PAPER, '--continue'], env);
  assert.equal(r5.status, 0); assert.match(r5.stdout, /done \(receipt: pass\)/);
});

test('batch.mjs --batch-async schedules two papers through the broker, survives a kill while they are parked, and exits when nothing is left', { skip: toolsOnPath ? false : 'python3 and rclone are not on PATH (figures.mjs asks for them)' }, async t => {
  const api = await fakeApi(t, { idPrefix: 'msgbatch_sched', results: pipelineResults });
  const env = envFor(api.base, { TX_BATCH_POLL_MS: '100' });
  const ids = ['zz-2099-batch-8', 'zz-2099-batch-9'];
  for (const id of ids) { preparePaperId(id); plantJob(id); } // no batchAsync on the job: batch.mjs passes --batch-async on --continue
  const logFile = path.join(root, 'batch.log');
  const readBatchLog = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const argv = ['--ids', ids.join(','), '--reader', 'anthropic:claude-opus-5', '--checker', 'anthropic:claude-opus-5', '--allow-same-model', '--no-promote', '--batch-async', '--no-broker-check', '--poll-sec', '1', '--workers', '2', '--in-flight', '10', '--log', logFile];
  // first scheduler: both readers park; the process is then killed with the jobs parked (no broker has run)
  const first = spawn(process.execPath, [txScript('batch.mjs'), ...argv], { env, cwd: repo });
  t.after(() => { try { first.kill(); } catch {} }); // a failed assertion must not leave the scheduler polling forever
  let out1 = '';
  first.stdout.on('data', d => { out1 += d; }); first.stderr.on('data', d => { out1 += d; });
  const firstDone = new Promise(r => first.on('close', r));
  await until(() => ids.every(id => jobOf(id)?.waitingFor?.transport === 'batch'), { timeoutMs: 30000, what: 'both jobs parked' });
  await until(() => readBatchLog().filter(l => l.outcome === 'waiting-for-batch').length >= 2, { timeoutMs: 10000, what: 'two waiting-for-batch log lines' });
  first.kill();
  await firstDone;
  assert.match(out1, /2 paper\(s\) to schedule: up to 10 in flight, 2 run.mjs process\(es\) at a time, poll every 1 s/);
  assert.match(out1, /running 0 \| parked 2 \| pending 0 \| done 0/);
  assert.equal(api.state.posts.length, 0, 'the scheduler itself never talks to the API');
  assert.equal(broker.listQueued().length, 2);
  // the broker runs while nothing schedules: the results land on disk
  assert.equal((await runBroker(api.base)).status, 0);
  assert.equal(api.state.posts.length, 1); assert.equal(api.state.posts[0].body.requests.length, 2, 'both readers in one batch');
  // second scheduler: resumes the parked jobs from jobs.json + results/, drives them to done; the test runs the broker
  // whenever something is queued (the checkers)
  const second = runAsync('batch.mjs', argv, env);
  let brokerRuns = 0;
  const pump = (async () => { for (;;) { const done = await Promise.race([second.then(() => true), wait(300).then(() => false)]); if (done) return; if (broker.listQueued().length) { assert.equal((await runBroker(api.base)).status, 0); brokerRuns++; } } })();
  const r = await Promise.race([second, wait(90000).then(() => null)]);
  assert.ok(r, 'batch.mjs --batch-async did not exit');
  await pump;
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 job\(s\) already parked on a batch from an earlier run/);
  assert.match(r.stdout, /done: \{"finished":2\}/);
  for (const id of ids) { const j = jobOf(id); assert.equal(j.stage, 'done', JSON.stringify(j.history.map(h => h.note))); assert.equal(j.waitingFor, null); assert.equal(j.options.batchAsync, true); }
  const log = readBatchLog();
  const by = o => log.filter(l => l.outcome === o).map(l => l.paperId).sort();
  assert.deepEqual(by('finished'), ids, JSON.stringify(log));
  assert.ok(by('waiting-for-batch').length >= 4, `each paper parks at least twice (reader, checker): ${JSON.stringify(by('waiting-for-batch'))}`);
  assert.equal(by('error').length, 0); assert.equal(by('escalated').length, 0);
  assert.ok(brokerRuns >= 1, 'the checkers went through the broker');
  assert.equal(api.state.posts.length, 1 + brokerRuns, 'every broker pass sent exactly one batch');
  assert.equal(broker.listQueued().length, 0);
  // the spend cap reads the same runs.jsonl the collects append to: four priced calls at the batch rate
  const spent = runsAll().filter(x => ids.includes(x.paperId) && x.ok);
  assert.equal(spent.length, 4); assert.ok(spent.every(x => x.transport === 'batch' && x.costUsd > 0));
});

// ---- reviewer findings (2026-09-17, second pass): orphaned detached requests, one scheduler per machine, in-flight money, corrupt files

test('--batch-async reuses a detached request already queued or submitted for the same work, and stops reusing it once it is collected', async t => {
  preparePaper();
  const api = await fakeApi(t, { idPrefix: 'msgbatch_reuse', results: () => ({ type: 'succeeded', message: message(JSON.stringify(reply()), { input_tokens: 1000, output_tokens: 200 }) }) });
  const q1 = transcribeSync(api.base, ['--batch-async', '--no-broker-check']);
  assert.equal(q1.status, 2, q1.stderr);
  const id = queuedLines(q1)[0].customId;
  const provBefore = provisionalFor().length;
  // the same enqueue again while the request is still queued: the same id, no second queue entry, no second provisional line
  const q2 = transcribeSync(api.base, ['--batch-async', '--no-broker-check']);
  assert.equal(q2.status, 2, q2.stderr);
  const l2 = queuedLines(q2)[0];
  assert.equal(l2.customId, id, 'the queued request is reused'); assert.equal(l2.adopted, true);
  assert.match(q2.stderr, /the same request is already queued as tx-.*reusing it/);
  assert.equal(broker.listQueued().filter(q => q.customId === id).length, 1);
  assert.equal(provisionalFor().length, provBefore, 'a reuse books nothing');
  // submitted (result not yet collected): still reused
  assert.equal((await runBroker(api.base)).status, 0);
  assert.equal(api.state.posts.length, 1);
  assert.equal(lib.batchRequestState(id), 'done');
  const q3 = transcribeSync(api.base, ['--batch-async', '--no-broker-check']);
  assert.equal(q3.status, 2, q3.stderr);
  assert.equal(queuedLines(q3)[0].customId, id, 'a submitted, uncollected request is reused'); assert.match(q3.stderr, /already done as/);
  assert.equal(broker.listQueued().length, 0, 'nothing new queued');
  // a different attempt or ask is other work: the lookup that enqueueDetached uses says so
  const prefix = id.slice(0, -7);
  assert.equal(lib.findDetachedBatchRequest(prefix, { paperId: PAPER, stage: 'reader', window: 'all', attempt: 1, ask: 1 })?.customId, id);
  assert.equal(lib.findDetachedBatchRequest(prefix, { paperId: PAPER, stage: 'reader', window: 'all', attempt: 2, ask: 1 }), null);
  assert.equal(lib.findDetachedBatchRequest(prefix, { paperId: PAPER, stage: 'reader', window: 'all', attempt: 1, ask: 2 }), null);
  assert.equal(lib.findDetachedBatchRequest(prefix, { paperId: PAPER, stage: 'reader', window: 'all', promptSha256: 'f'.repeat(64) }), null, 'another prompt is other work');
  assert.equal(lib.findDetachedBatchRequest(prefix, { paperId: 'other', stage: 'reader', window: 'all' }), null);
  // collected: the sidecar is marked and a new enqueue is a new request
  const c = transcribeSync(api.base, ['--batch-result', id]);
  assert.equal(c.status, 0, c.stderr);
  assert.ok(lib.readBatchMeta(id).collectedAt, 'the collect marks the sidecar');
  assert.equal(lib.findDetachedBatchRequest(prefix, { paperId: PAPER, stage: 'reader', window: 'all' }), null);
  const q4 = transcribeSync(api.base, ['--batch-async', '--no-broker-check']);
  assert.equal(q4.status, 2, q4.stderr);
  const id4 = queuedLines(q4)[0].customId;
  assert.notEqual(id4, id); assert.equal(id4.slice(0, -7), prefix, 'the same work, a fresh custom id'); assert.equal(queuedLines(q4)[0].adopted, undefined);
  assert.equal(provisionalFor().filter(r => r.customId === id4).length, 1, 'a fresh enqueue books its provisional line');
  // a non-detached (sync waiter) entry with the same prefix is never reused
  lib.withdrawQueuedBatchRequest(id4);
  assert.equal(lib.batchRequestState(id4), 'unknown');
  const syncId = `${prefix}-abcdef`;
  lib.enqueueBatchRequest(syncId, requestBody('a sync waiter request'), { paperId: PAPER, stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso(), pid: process.pid });
  assert.equal(lib.findDetachedBatchRequest(prefix, { paperId: PAPER, stage: 'reader', window: 'all' }), null, 'a waiter\'s request is its own');
  lib.withdrawQueuedBatchRequest(syncId);
});

test('run.mjs withdraws the queued requests of a park it abandons (--retry, a changed candidate) and leaves a submitted one unclaimed', { skip: toolsOnPath ? false : 'python3 and rclone are not on PATH (figures.mjs asks for them)' }, async t => {
  const id = 'zz-2099-batch-10';
  const api = await fakeApi(t, { idPrefix: 'msgbatch_abandon', results: pipelineResults });
  const env = envFor(api.base, { TX_BATCH_POLL_MS: '100' });
  preparePaperId(id);
  plantJob(id, { batchAsync: true });
  // 1. the reader parks; a lost park (the job entry loses waitingFor: a crash after the enqueue) is found again on --continue
  const r1 = await runAsync('run.mjs', [id, '--continue'], env);
  assert.equal(r1.status, 2, r1.stderr);
  const readerId = jobOf(id).waitingFor.customIds[0];
  { const all = readJobs(); all.jobs[id].waitingFor = null; fs.writeFileSync(jobsFile, JSON.stringify(all)); }
  const r1b = await runAsync('run.mjs', [id, '--continue'], env);
  assert.equal(r1b.status, 2, r1b.stderr);
  assert.deepEqual(jobOf(id).waitingFor.customIds, [readerId], 'the queued reader request is reused, not queued twice');
  assert.equal(broker.listQueued().filter(q => q.customId === readerId).length, 1);
  assert.equal(provisionalFor(id).length, 1, 'one provisional booking for the one request');
  // 2. the reader is collected; the checker parks (queued, not submitted)
  assert.equal((await runBroker(api.base)).status, 0);
  const r2 = await runAsync('run.mjs', [id, '--continue'], env);
  assert.equal(r2.status, 2, `${r2.stderr}\n${r2.stdout}`);
  const check1 = jobOf(id).waitingFor.customIds[0];
  assert.equal(jobOf(id).waitingFor.stage, 'checker'); assert.equal(lib.batchRequestState(check1), 'queued');
  // 3. --retry re-enters the job: the queued check is withdrawn unpaid (files gone, a withdrawn line releases its provisional), a fresh one is queued
  const r3 = await runAsync('run.mjs', [id, '--continue', '--retry'], env);
  assert.equal(r3.status, 2, `${r3.stderr}\n${r3.stdout}`);
  assert.match(r3.stderr, new RegExp(`batch request ${check1} for the checker withdrawn from the queue \\(not submitted, nothing paid\\)`));
  assert.equal(lib.batchRequestState(check1), 'unknown', 'body and sidecar unlinked');
  assert.ok(!fs.existsSync(lib.batchFiles(check1).body) && !fs.existsSync(lib.batchFiles(check1).meta));
  const withdrawn = runsAll().filter(r => r.paperId === id && r.withdrawn);
  assert.equal(withdrawn.length, 1); assert.equal(withdrawn[0].customId, check1); assert.equal(withdrawn[0].ok, false); assert.equal(withdrawn[0].stage, 'checker'); assert.equal(withdrawn[0].provider, 'anthropic');
  let job = jobOf(id);
  assert.ok(job.history.some(h => h.note.startsWith(`batch request ${check1} (checker) withdrawn unpaid`)), job.history.map(h => h.note).join(' | '));
  assert.ok(job.history.some(h => /^retry after escalation/.test(h.note)));
  const check2 = job.waitingFor.customIds[0];
  assert.notEqual(check2, check1); assert.equal(job.waitingFor.stage, 'checker'); assert.equal(lib.batchRequestState(check2), 'queued');
  assert.equal(broker.listQueued().length, 1);
  // 4. the check is submitted and answered, then the candidate changes under it: the park is abandoned but the request stays (paid), its result unclaimed
  assert.equal((await runBroker(api.base)).status, 0);
  assert.equal(lib.batchRequestState(check2), 'done');
  { const f = path.resolve(repo, jobOf(id).artefacts.candidate); const c = JSON.parse(fs.readFileSync(f, 'utf8')); c.tx.notes = 'edited by hand while the check was out'; fs.writeFileSync(f, JSON.stringify(c, null, 2)); }
  const r4 = await runAsync('run.mjs', [id, '--continue'], env);
  assert.equal(r4.status, 2, `${r4.stderr}\n${r4.stdout}`);
  assert.match(r4.stderr, new RegExp(`batch request ${check2} for the checker is done: it stays in its batch and its result will go unclaimed`));
  assert.ok(fs.existsSync(lib.batchFiles(check2).result), 'the paid result is left where it is');
  assert.ok(fs.existsSync(path.join(BATCH_DIRS.submitted, 'msgbatch_abandon2', `${check2}.meta.json`)));
  assert.equal(runsAll().filter(r => r.paperId === id && r.withdrawn).length, 1, 'no withdrawn line for a submitted request');
  job = jobOf(id);
  assert.ok(job.history.some(h => h.note.startsWith(`batch request ${check2} (checker) left done, result unclaimed`)));
  assert.ok(job.history.some(h => h.note === 'candidate bytes changed while a batch check was queued; that result will be ignored'));
  const check3 = job.waitingFor.customIds[0];
  assert.notEqual(check3, check2); assert.equal(lib.batchRequestState(check3), 'queued');
  // 5. the loop finishes on the fresh check
  assert.equal((await runBroker(api.base)).status, 0);
  const r5 = await runAsync('run.mjs', [id, '--continue'], env);
  assert.equal(r5.status, 0, `${r5.stderr}\n${r5.stdout}`);
  job = jobOf(id);
  assert.equal(job.stage, 'done'); assert.equal(job.waitingFor, null); assert.equal(job.runningPid, undefined, 'runningPid cleared at exit');
});

test('one scheduler per machine (batch-async.lock) and one loop per job (runningPid): the second exits with a clear message; a dead holder is taken over; --in-flight is an absolute bound', { skip: toolsOnPath ? false : 'python3 and rclone are not on PATH (figures.mjs asks for them)' }, async t => {
  const api = await fakeApi(t, { idPrefix: 'msgbatch_lock', results: pipelineResults });
  const env = envFor(api.base, { TX_BATCH_POLL_MS: '100' });
  const lockFile = path.join(root, 'batch-async.lock');
  assert.equal(lib.BATCH_ASYNC_LOCK, lockFile);
  // (a) run.mjs refuses a job whose entry carries a live runningPid, and proceeds past a dead one
  const id = 'zz-2099-batch-11';
  preparePaperId(id);
  plantJob(id, { batchAsync: true });
  { const all = readJobs(); all.jobs[id].runningPid = process.pid; all.jobs[id].runningSince = lib.nowIso(); fs.writeFileSync(jobsFile, JSON.stringify(all)); }
  const refused = await runAsync('run.mjs', [id, '--continue'], env);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, new RegExp(`another run.mjs \\(pid ${process.pid}, since .*\\) is driving ${id} \\(jobs.json runningPid\\); not starting a second loop`));
  assert.equal(jobOf(id).runningPid, process.pid, 'the live holder keeps the job'); assert.equal(jobOf(id).waitingFor, undefined, 'nothing was queued');
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  const deadPid = Number(gone.stdout.trim());
  { const all = readJobs(); all.jobs[id].runningPid = deadPid; fs.writeFileSync(jobsFile, JSON.stringify(all)); }
  const taken = await runAsync('run.mjs', [id, '--continue'], env);
  assert.equal(taken.status, 2, taken.stderr);
  assert.equal(jobOf(id).waitingFor.stage, 'reader');
  assert.equal(jobOf(id).runningPid, undefined, 'cleared at exit'); assert.equal(jobOf(id).runningSince, undefined);
  // (b) a second scheduler exits at once while the holder is alive; the lock is untouched
  const argv = ['--ids', id, '--reader', 'anthropic:claude-opus-5', '--checker', 'anthropic:claude-opus-5', '--allow-same-model', '--no-promote', '--batch-async', '--no-broker-check', '--poll-sec', '1', '--log', path.join(root, 'batch-lock.log')];
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: lib.nowIso() }));
  const second = await runAsync('batch.mjs', argv, env);
  assert.equal(second.status, 1);
  assert.match(second.stderr, new RegExp(`another batch.mjs --batch-async \\(pid ${process.pid}, since .*\\) holds .*batch-async.lock; one scheduler per machine`));
  assert.equal(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid, process.pid);
  assert.equal(api.state.posts.length, 0);
  // (c) a dead holder's lock is taken over: the scheduler runs (the parked reader's result is in), and releases the lock on exit
  fs.writeFileSync(lockFile, JSON.stringify({ pid: deadPid, at: lib.nowIso() }));
  assert.equal((await runBroker(api.base)).status, 0);
  const third = runAsync('batch.mjs', argv, env);
  const pump = (async () => { for (;;) { const done = await Promise.race([third.then(() => true), wait(300).then(() => false)]); if (done) return; if (broker.listQueued().length) assert.equal((await runBroker(api.base)).status, 0); } })();
  const r = await Promise.race([third, wait(60000).then(() => null)]);
  assert.ok(r, 'batch.mjs did not exit'); await pump;
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`taking over .*batch-async.lock from pid ${deadPid}`));
  assert.match(r.stdout, /done: \{"finished":1\}/);
  assert.ok(!fs.existsSync(lockFile), 'released on exit');
  assert.equal(jobOf(id).stage, 'done');
  // (d) --in-flight 1 with two fresh papers: the second does not start while the first is parked, whatever --workers says
  const ids = ['zz-2099-batch-12', 'zz-2099-batch-13'];
  for (const p of ids) { preparePaperId(p); plantJob(p); }
  const logFile = path.join(root, 'batch-inflight.log');
  const child = spawn(process.execPath, [txScript('batch.mjs'), '--ids', ids.join(','), '--reader', 'anthropic:claude-opus-5', '--checker', 'anthropic:claude-opus-5', '--allow-same-model', '--no-promote', '--batch-async', '--no-broker-check', '--poll-sec', '1', '--workers', '2', '--in-flight', '1', '--log', logFile], { env, cwd: repo });
  t.after(() => { try { child.kill(); } catch {} });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const closed = new Promise(res => child.on('close', res));
  await until(() => /running 0 \| parked 1 \| pending 1/.test(out), { timeoutMs: 30000, what: 'one parked, one pending' });
  await wait(2500); // two more polls: the pending paper must stay pending
  assert.match(out, /in-flight cap 1 reached/);
  assert.equal(jobOf(ids[0]).waitingFor?.transport, 'batch');
  assert.equal(jobOf(ids[1])?.waitingFor, undefined, 'the second paper has not started');
  assert.doesNotMatch(out, /parked 2/);
  child.kill(); await closed;
  assert.ok(!lib.pidAlive(child.pid));
});

test('the spend cap counts money committed to the broker: three enqueues over the cap stop the fourth start; collected results replace their provisional lines', { skip: toolsOnPath ? false : 'python3 and rclone are not on PATH (figures.mjs asks for them)' }, async t => {
  const api = await fakeApi(t, { idPrefix: 'msgbatch_spend', results: pipelineResults });
  const env = envFor(api.base, { TX_BATCH_POLL_MS: '100' });
  const ids = ['zz-2099-batch-14', 'zz-2099-batch-15', 'zz-2099-batch-16', 'zz-2099-batch-17'];
  for (const p of ids) { preparePaperId(p); plantJob(p); }
  // the estimate one reader enqueue books: transcribe.mjs's own dry-run figure at the batch price
  const dry = spawnSync(process.execPath, [txScript('transcribe.mjs'), ids[0], '--provider', 'anthropic', '--model', 'claude-opus-5', '--stage', 'reader', '--dry-run', '--batch-async', '--no-broker-check'], { encoding: 'utf8', env });
  assert.equal(dry.status, 0, dry.stderr);
  const est = JSON.parse(dry.stdout).estimatedCostUsd;
  assert.ok(est > 0.01 && est < 1, `estimate ${est}`);
  const cap = +(2.5 * est).toFixed(4); // three enqueues cross it, two do not
  const logFile = path.join(root, 'batch-spend.log');
  const readBatchLog = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const since = new Date(Date.now() - 1000).toISOString();
  const argv = ['--ids', ids.join(','), '--reader', 'anthropic:claude-opus-5', '--checker', 'anthropic:claude-opus-5', '--allow-same-model', '--no-promote', '--batch-async', '--no-broker-check', '--poll-sec', '1', '--workers', '1', '--in-flight', '10', '--max-spend-usd', String(cap), '--spend-since', since, '--log', logFile];
  const child = spawn(process.execPath, [txScript('batch.mjs'), ...argv], { env, cwd: repo });
  t.after(() => { try { child.kill(); } catch {} });
  let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
  const closed = new Promise(res => child.on('close', code => res(code)));
  // three readers park (three provisional lines), the cap trips, the fourth paper never starts — nothing has been billed yet
  await until(() => readBatchLog().some(l => l.outcome === 'spend-cap'), { timeoutMs: 40000, what: 'the spend-cap log line' });
  const capLine = readBatchLog().find(l => l.outcome === 'spend-cap');
  assert.equal(capLine.spentUsd, 0, 'nothing billed yet'); assert.equal(capLine.remaining, 1);
  assert.ok(Math.abs(capLine.provisionalUsd - 3 * est) < 1e-4, `provisional ${capLine.provisionalUsd} = 3 × ${est} (logged to 4 decimals)`); assert.equal(capLine.provisionalRequests, 3);
  assert.ok(capLine.totalUsd >= cap);
  assert.equal(ids.slice(0, 3).filter(p => jobOf(p)?.waitingFor?.transport === 'batch').length, 3);
  { const j4 = jobOf(ids[3]); assert.equal(j4.waitingFor, undefined, 'the fourth paper did not start'); assert.equal(j4.history.length, 0); assert.equal(j4.runningPid, undefined); assert.equal(provisionalFor(ids[3]).length, 0); }
  assert.equal(api.state.posts.length, 0, 'the cap tripped on committed money alone');
  assert.match(out, /spend cap reached: spent \$0\.00 \+ committed \(provisional\) \$[\d.]+ for 3 request\(s\) = \$[\d.]+ of \$/);
  // the broker delivers: each collect books the real (small) cost and its provisional line stops counting; the total falls under the cap
  // and the fourth paper starts; parked jobs were resumed all along (their checkers' provisional lines never gate a resume)
  const pump = (async () => { for (;;) { const done = await Promise.race([closed.then(() => true), wait(300).then(() => false)]); if (done) return; if (broker.listQueued().length) assert.equal((await runBroker(api.base)).status, 0); } })();
  const code = await Promise.race([closed, wait(90000).then(() => null)]);
  assert.notEqual(code, null, `batch.mjs did not exit\n${out}\n${err}`); await pump;
  assert.equal(code, 0, err);
  assert.match(out, /done: \{"finished":4\}/, out);
  for (const p of ids) assert.equal(jobOf(p).stage, 'done', p);
  const cleared = readBatchLog().find(l => l.outcome === 'spend-cap-cleared');
  assert.ok(cleared, 'the cap cleared once the collects replaced the provisional bookings'); assert.ok(cleared.totalUsd < cap && cleared.spentUsd > 0);
  assert.match(out, /spend back under the cap: spent \$/);
  const real = runsAll().filter(r => ids.includes(r.paperId) && r.ok);
  assert.equal(real.length, 8, 'four readers and four checkers billed'); assert.ok(real.every(r => r.costUsd > 0 && r.costUsd < est));
  const provisional = runsAll().filter(r => ids.includes(r.paperId) && r.provisional);
  assert.equal(provisional.length, 8, 'one provisional line per enqueue');
  assert.ok(provisional.every(p => real.some(r => r.customId === p.customId)), 'every provisional line has its real record');
  const spent = real.reduce((a, r) => a + r.costUsd, 0);
  const final = /\[batch\] spend since .*: spent \$([\d.]+) = \$([\d.]+) of \$/.exec(out);
  assert.ok(final, out); assert.equal(final[1], spent.toFixed(2)); assert.equal(final[2], spent.toFixed(2), 'no provisional money left in the total');
  assert.doesNotMatch(out.slice(out.lastIndexOf('[batch] spend since')), /committed/);
});

test('one corrupt JSON file is logged and skipped: broker records and sidecars, lib readers, a queue moved sidecar-first', async t => {
  const api = await fakeApi(t, { idPrefix: 'msgbatch_corrupt' });
  fs.writeFileSync(path.join(BATCH_DIRS.batches, 'corrupt-record.json'), '{"id": "msgbatch_corrupt_x", "customIds": [');
  fs.writeFileSync(path.join(BATCH_DIRS.batches, 'pending-corrupt0001.json'), '{');
  const body = requestBody('sidecar corrupt');
  const id = lib.batchCustomId('c', 'reader', 'all', body);
  const files = lib.enqueueBatchRequest(id, body, { paperId: 'c', stage: 'reader', window: 'all', model: 'claude-opus-5', createdAt: lib.nowIso() });
  fs.writeFileSync(files.meta, '{"paperId": "c", ');
  assert.equal(lib.readJsonSafe(files.meta, 'fallback'), 'fallback');
  assert.equal(lib.readBatchMeta(id), null, 'a corrupt sidecar reads as none');
  assert.equal(lib.readBatchRecord('corrupt-record'), null);
  assert.equal(lib.findDetachedBatchRequest(id.slice(0, -7), { paperId: 'c', stage: 'reader', window: 'all' }), null, 'a corrupt sidecar is never reused');
  const run = await runBroker(api.base);
  assert.equal(run.status, 0, run.stderr);
  const bad = readLog().filter(l => l.action === 'bad-json').map(l => path.basename(l.file));
  assert.ok(bad.includes('corrupt-record.json') && bad.includes('pending-corrupt0001.json'), bad.join(', '));
  assert.equal(api.state.posts.length, 1, 'the pass went on: the request with the corrupt sidecar was submitted');
  assert.ok(api.state.posts[0].body.requests.some(r => r.custom_id === id), 'submitted (next to whatever an earlier test left queued)');
  assert.equal(lib.batchRequestState(id), 'done');
  for (const f of ['corrupt-record.json', 'pending-corrupt0001.json']) fs.unlinkSync(path.join(BATCH_DIRS.batches, f));
  // moveQueued renames the sidecar before the body: when the body cannot move, the sidecar is already across
  const body2 = requestBody('meta first');
  const id2 = lib.batchCustomId('c', 'reader', 'order', body2);
  const f2 = lib.enqueueBatchRequest(id2, body2, { paperId: 'c', stage: 'reader', window: 'order', model: 'claude-opus-5', createdAt: lib.nowIso() });
  const dest = path.join(root, 'move-order');
  fs.mkdirSync(path.join(dest, `${id2}.json`), { recursive: true }); // a directory in the body's place: its rename fails
  assert.throws(() => broker.moveQueued({ customId: id2, file: f2.body, meta: f2.meta }, dest));
  assert.ok(fs.existsSync(path.join(dest, `${id2}.meta.json`)), 'the sidecar moved first');
  assert.ok(fs.existsSync(f2.body), 'the body stayed');
  fs.rmSync(dest, { recursive: true, force: true }); fs.unlinkSync(f2.body);
  // batch.mjs reads jobs.json through the same tolerant reader: a corrupt file is one logged look, not a crash
  const saved = fs.readFileSync(jobsFile, 'utf8');
  try {
    fs.writeFileSync(jobsFile, '{"version": 2, "jobs": {');
    const r = await runAsync('batch.mjs', ['--ids', PAPER, '--reader', 'anthropic:claude-opus-5', '--checker', 'anthropic:claude-opus-5', '--allow-same-model', '--no-promote', '--batch-async', '--no-broker-check', '--poll-sec', '1', '--log', path.join(root, 'batch-corrupt.log')], envFor(api.base));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /jobs\.json is not valid JSON/);
    assert.doesNotMatch(r.stderr, /SyntaxError/);
  } finally { fs.writeFileSync(jobsFile, saved); }
});
