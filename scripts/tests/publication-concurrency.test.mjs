// Local disposable fixtures only. Never approves or modifies repository content.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { sha256, jsonText } from '../lib/problem-data.mjs';
import { withFileLockSync } from '../lib/file-lock.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publication-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('publication-test-'));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const write = (name, data) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : jsonText(data));
    return file;
  };
  for (const name of ['scripts/publication.mjs', 'scripts/lib/problem-data.mjs', 'scripts/lib/file-lock.mjs']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.copyFileSync(path.join(repo, name), path.join(root, name));
  }
  const ledger = path.join(root, 'content/problem-publication.json');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  const paper = (id, status = 'review') => {
    const file = write(`content/problems/${id}.json`, { paper: { id, subject: 'physics', status }, problems: [{ id: `${id}-p1`, statement: 'Fixture question.' }] });
    return sha256(fs.readFileSync(file));
  };
  const receipt = (id, contentHash, extra = {}) => write(`${id}.receipt.json`, {
    verdict: 'pass', contentHash, reviewer: { provider: 'test', model: 'checker', requestId: id },
    checkedAt: '2026-09-25T00:00:00Z', sourceHashes: { problems: 'f'.repeat(64) }, defects: [], blockers: [],
    independence: { independent: true }, ...extra,
  });
  const children = new Set();
  t.after(() => { for (const child of children) child.kill(); });
  const start = (args, env = {}) => {
    const preload = env.PUBLICATION_TEST_GATE ? ['--import', pathToFileURL(path.join(root, 'preload.mjs')).href] : [];
    const child = spawn(process.execPath, [...preload, path.join(root, 'scripts/publication.mjs'), ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    const done = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`Publication fixture timed out: ${args.join(' ')}`)); }, 15_000);
      child.once('error', e => { clearTimeout(timeout); children.delete(child); reject(e); });
      child.once('close', code => { clearTimeout(timeout); children.delete(child); resolve({ code, stdout, stderr }); });
    });
    return { child, done };
  };
  return { root, write, ledger, paper, receipt, start };
}
async function waitFor(predicate) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test process barrier');
    await delay(10);
  }
}

test('concurrent approvals, evidence writes and legacy adoption preserve each other; status stays read-only', { timeout: 20_000 }, async t => {
  const f = fixture(t);
  const adoptedHash = f.paper('legacy-adopt');
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=disabled-hooks', ...args], { cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '--quiet']);
  git(['add', 'content/problems/legacy-adopt.json']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
  const commit = git(['rev-parse', 'HEAD']).trim();
  const aHash = f.paper('approve-a'), bHash = f.paper('approve-b');
  const legacy = id => ({ kind: 'legacy', contentHash: f.paper(id), sourceCommit: commit, recordedAt: '2026-09-25T00:00:00Z' });
  const initial = { version: 1, papers: { 'legacy-one': legacy('legacy-one'), 'legacy-two': legacy('legacy-two') } };
  f.write('content/problem-publication.json', initial);
  const aReceipt = f.receipt('approve-a', aHash), bReceipt = f.receipt('approve-b', bHash);
  const evidenceOne = f.write('evidence-one.json', { 'legacy-one': { note: 'first evidence', transcriber: { model: 'fixture', jsonFile: 'local-only' } } });
  const evidenceTwo = f.write('evidence-two.json', { 'legacy-two': { note: 'second evidence' } });
  const gate = path.join(f.root, 'barrier');
  fs.mkdirSync(gate);
  // Stall the first actual CLI process immediately after it reads the ledger.
  // Other processes report either a lock attempt or a ledger read. This makes
  // the old stale-read race deterministic without a production-only test hook.
  f.write('preload.mjs', `import fs from 'node:fs';
import path from 'node:path';
const gate = process.env.PUBLICATION_TEST_GATE;
const ledger = path.resolve('content/problem-publication.json');
const read = fs.readFileSync, open = fs.openSync;
const mark = kind => fs.writeFileSync(path.join(gate, process.pid + '.' + kind), '');
fs.openSync = function(file, flags, ...args) {
  if (typeof file === 'string' && path.resolve(file) === ledger + '.lock' && flags === 'wx') mark('attempt');
  return open.call(this, file, flags, ...args);
};
fs.readFileSync = function(file, ...args) {
  const value = read.call(this, file, ...args);
  if (typeof file === 'string' && path.resolve(file) === ledger) {
    mark('read');
    if (process.env.PUBLICATION_TEST_BLOCK_READ) {
      const deadline = Date.now() + 10000;
      while (!fs.existsSync(path.join(gate, 'release'))) {
        if (Date.now() >= deadline) throw new Error('Barrier not released');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  }
  return value;
};
`);
  const first = f.start(['approve', '--paper', 'approve-a', '--receipt', aReceipt], { PUBLICATION_TEST_GATE: gate, PUBLICATION_TEST_BLOCK_READ: '1' });
  const others = [];
  let earlyReads;
  try {
    await waitFor(() => fs.existsSync(path.join(gate, `${first.child.pid}.read`)));
    // A read-only status command must finish while the writer is still blocked.
    const status = await f.start(['status']).done;
    assert.equal(status.code, 0, status.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.ledger)), initial);
    for (const args of [
      ['approve', '--paper', 'approve-b', '--receipt', bReceipt],
      ['attach-evidence', '--file', evidenceOne],
      ['attach-evidence', '--file', evidenceTwo],
      ['adopt-legacy', '--source-ref', commit],
    ]) others.push(f.start(args, { PUBLICATION_TEST_GATE: gate }));
    await waitFor(() => others.every(p => ['attempt', 'read'].some(kind => fs.existsSync(path.join(gate, `${p.child.pid}.${kind}`)))));
    earlyReads = others.filter(p => fs.existsSync(path.join(gate, `${p.child.pid}.read`))).map(p => p.child.pid);
  } finally {
    fs.writeFileSync(path.join(gate, 'release'), '');
    const results = await Promise.all([first, ...others].map(p => p.done));
    for (const r of results) assert.equal(r.code, 0, r.stderr);
  }
  assert.deepEqual(earlyReads, [], 'writers must acquire the lock before reading the ledger');
  const ledger = JSON.parse(fs.readFileSync(f.ledger));
  assert.deepEqual(Object.keys(ledger.papers).sort(), ['approve-a', 'approve-b', 'legacy-adopt', 'legacy-one', 'legacy-two']);
  for (const [id, hash] of [['approve-a', aHash], ['approve-b', bHash]]) {
    assert.equal(ledger.papers[id].kind, 'reviewed');
    assert.equal(ledger.papers[id].contentHash, hash);
  }
  assert.equal(ledger.papers['legacy-adopt'].contentHash, adoptedHash);
  assert.equal(ledger.papers['legacy-adopt'].sourceCommit, commit);
  assert.equal(ledger.papers['legacy-one'].evidence.note, 'first evidence');
  assert.equal(ledger.papers['legacy-two'].evidence.note, 'second evidence');
  assert.equal(ledger.papers['legacy-one'].evidence.transcriber.jsonFile, undefined);
  assert.equal(ledger.papers['legacy-one'].contentHash, initial.papers['legacy-one'].contentHash);
  assert.equal(fs.existsSync(`${f.ledger}.lock`), false);
});

test('rejected approvals preserve the ledger and release the lock', async t => {
  const f = fixture(t), original = { version: 1, papers: {} };
  f.write('content/problem-publication.json', original);
  const invalid = f.receipt('bad-review', f.paper('bad-review'), { defects: [{ severity: 'major' }] });
  const draft = f.receipt('draft-paper', f.paper('draft-paper', 'draft'));
  for (const [id, receipt] of [['bad-review', invalid], ['draft-paper', draft]]) {
    const result = await f.start(['approve', '--paper', id, '--receipt', receipt]).done;
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Receipt must pass for these exact bytes/);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.ledger)), original);
    assert.equal(fs.existsSync(`${f.ledger}.lock`), false);
  }
});

test('lock wait is bounded and never automatically takes over an old owner', t => {
  const f = fixture(t), lock = `${f.ledger}.lock`, owner = { pid: 999999, token: 'other-owner', createdAt: '2000-01-01T00:00:00Z' };
  fs.writeFileSync(lock, jsonText(owner));
  let ran = false;
  const started = Date.now();
  assert.throws(() => withFileLockSync(lock, () => { ran = true; }, { timeoutMs: 30, pollMs: 5 }), /No automatic stale-lock takeover/);
  assert.ok(Date.now() - started < 2_000);
  assert.equal(ran, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(lock)), owner);
});

test('action failure releases our lock; replaced ownership is never unlinked', t => {
  const f = fixture(t), lock = `${f.ledger}.lock`;
  assert.throws(() => withFileLockSync(lock, () => { throw new Error('action failed'); }), /action failed/);
  assert.equal(fs.existsSync(lock), false);
  const replacement = { token: 'replacement-owner' };
  assert.throws(() => withFileLockSync(lock, () => fs.writeFileSync(lock, jsonText(replacement))), /ownership changed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(lock)), replacement);
});

test('Windows delete-pending acquisition and release errors are retried', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t), lock = `${f.ledger}.lock`;
  const open = fs.openSync, unlink = fs.unlinkSync;
  const acquisitionErrors = ['EPERM', 'EACCES'], releaseErrors = ['EPERM', 'EACCES', 'EBUSY'];
  t.mock.method(fs, 'openSync', function(file, ...args) {
    if (file === lock && acquisitionErrors.length) throw Object.assign(new Error('delete pending'), { code: acquisitionErrors.shift() });
    return open.call(this, file, ...args);
  });
  t.mock.method(fs, 'unlinkSync', function(file, ...args) {
    if (file === lock && releaseErrors.length) throw Object.assign(new Error('busy handle'), { code: releaseErrors.shift() });
    return unlink.call(this, file, ...args);
  });
  assert.equal(withFileLockSync(lock, () => 42, { timeoutMs: 500, pollMs: 1 }), 42);
  assert.deepEqual(acquisitionErrors, []);
  assert.deepEqual(releaseErrors, []);
  assert.equal(fs.existsSync(lock), false);
});
