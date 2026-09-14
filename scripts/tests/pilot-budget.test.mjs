// Budget correctness using temporary files and real competing Node processes.
// No source documents, API requests, credentials, uploads or publication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openBudgetLedger, usdToMicroUsd, PILOT_HARD_CAP_MICRO_USD } from '../tx/pilot-budget.mjs';

const moduleUrl = new URL('../tx/pilot-budget.mjs', import.meta.url).href;
async function fixture(t, capMicroUsd = PILOT_HARD_CAP_MICRO_USD) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-budget-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('pilot-budget-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const ledgerPath = path.join(root, 'budget.json');
  return { root, ledgerPath, ledger: await openBudgetLedger({ ledgerPath, capMicroUsd }) };
}
const request = (requestId, maxCostMicroUsd, fingerprint = `hash:${requestId}`) => ({ requestId, maxCostMicroUsd, fingerprint });
function child(code, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', s => { stdout += s; }); p.stderr.on('data', s => { stderr += s; });
    p.on('error', reject);
    p.on('close', exitCode => exitCode === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`Child exited ${exitCode}: ${stderr}`)));
  });
}

test('decimal prices round up without floating-point budget undercount', () => {
  assert.equal(usdToMicroUsd('0.0000001'), 1);
  assert.equal(usdToMicroUsd(1e-7), 1);
  assert.equal(usdToMicroUsd('0.010001'), 10001);
  assert.equal(usdToMicroUsd('1.9999991'), 2000000);
  assert.equal(usdToMicroUsd('10.00'), 10_000_000);
  assert.equal(usdToMicroUsd(0), 0);
  for (const bad of [-1, NaN, Infinity, null, '', '1e1000', '0.1 USD']) assert.throws(() => usdToMicroUsd(bad), { code: 'PILOT_BUDGET_INVALID' });
});

test('reserves before send, settles once, and preserves request identity across reopen', async t => {
  const { ledger, ledgerPath } = await fixture(t);
  const r = await ledger.reserve(request('attempt-1', 4_000_000));
  assert.equal(r.maySend, true);
  assert.equal(r.totals.reservedMicroUsd, 4_000_000);
  assert.equal(await fs.stat(ledger.lockPath).then(() => true, e => e.code !== 'ENOENT'), false, 'No lock remains while caller performs API work');
  const reopened = await openBudgetLedger({ ledgerPath });
  const duplicate = await reopened.reserve(request('attempt-1', 4_000_000));
  assert.equal(duplicate.created, false); assert.equal(duplicate.maySend, false);
  await assert.rejects(reopened.reserve(request('attempt-1', 4_000_000, 'other-request')), { code: 'PILOT_BUDGET_CONFLICT' });
  await assert.rejects(reopened.reserve(request('attempt-1', 3_000_000)), { code: 'PILOT_BUDGET_CONFLICT' });
  const args = { requestId: 'attempt-1', actualCostMicroUsd: 1_250_001, providerRequestId: 'provider-1', usage: { inputTokens: 250, outputTokens: 50 } };
  assert.equal((await reopened.settle(args)).changed, true);
  assert.equal((await reopened.settle(args)).changed, false);
  assert.equal((await reopened.reserve(request('attempt-1', 4_000_000))).maySend, false);
  const snapshot = await ledger.snapshot();
  assert.equal(snapshot.totals.spentMicroUsd, 1_250_001);
  assert.equal(snapshot.totals.reservedMicroUsd, 0);
  assert.equal(snapshot.entries['attempt-1'].usage.inputTokens, 250);
  await assert.rejects(ledger.settle({ ...args, actualCostMicroUsd: 1 }), { code: 'PILOT_BUDGET_CONFLICT' });
  await assert.rejects(ledger.settle({ ...args, providerRequestId: 'provider-other' }), { code: 'PILOT_BUDGET_CONFLICT' });
});

test('unknown charged attempts retain funds across restart and retry needs a new reservation', async t => {
  const { ledger, ledgerPath } = await fixture(t);
  await ledger.reserve(request('timed-out', 6_000_000));
  await ledger.markUnknown({ requestId: 'timed-out', reason: 'Response timed out after provider accepted request', providerRequestId: 'remote-timeout' });
  const restarted = await openBudgetLedger({ ledgerPath });
  assert.equal((await restarted.reserve(request('timed-out', 6_000_000))).maySend, false);
  let snapshot = await restarted.snapshot();
  assert.equal(snapshot.totals.unknownMicroUsd, 6_000_000);
  assert.equal(snapshot.totals.remainingMicroUsd, 4_000_000);
  await assert.rejects(restarted.reserve(request('retry', 6_000_000)), { code: 'PILOT_BUDGET_EXCEEDED' });
  await restarted.reserve(request('different-attempt', 4_000_000));
  await assert.rejects(restarted.reserve(request('one-more', 1)), { code: 'PILOT_BUDGET_EXCEEDED' });
  await restarted.settle({ requestId: 'timed-out', actualCostMicroUsd: 2_000_000, providerRequestId: 'remote-timeout' });
  snapshot = await restarted.snapshot();
  assert.equal(snapshot.totals.spentMicroUsd, 2_000_000);
  assert.equal(snapshot.totals.reservedMicroUsd, 4_000_000);
  assert.equal(snapshot.totals.unknownMicroUsd, 0);
  assert.equal((await restarted.markUnknown({ requestId: 'timed-out', reason: 'late timeout handler' })).changed, false);
  assert.equal((await restarted.snapshot()).entries['timed-out'].status, 'settled');
});

test('parallel processes cannot reserve beyond the cap or send the same attempt twice', async t => {
  const { ledger, ledgerPath } = await fixture(t);
  const code = `import { openBudgetLedger } from ${JSON.stringify(moduleUrl)};
    const ledger = await openBudgetLedger({ ledgerPath: process.argv[1] });
    try { const r = await ledger.reserve({ requestId: process.argv[2], fingerprint: process.argv[2], maxCostMicroUsd: 2_000_000 }); console.log(JSON.stringify({ ok: true, maySend: r.maySend })); }
    catch (e) { if (e.code !== 'PILOT_BUDGET_EXCEEDED') throw e; console.log(JSON.stringify({ ok: false, code: e.code })); }`;
  const duplicate = await Promise.all(Array.from({ length: 6 }, () => child(code, [ledgerPath, 'same-attempt'])));
  assert.equal(duplicate.filter(r => r.maySend).length, 1);
  const competing = await Promise.all(Array.from({ length: 10 }, (_, i) => child(code, [ledgerPath, `distinct-${i}`])));
  assert.equal(competing.filter(r => r.maySend).length, 4);
  assert.equal(competing.filter(r => !r.ok).length, 6);
  const snapshot = await ledger.snapshot();
  assert.equal(snapshot.totals.committedMicroUsd, 10_000_000);
  assert.equal(snapshot.totals.remainingMicroUsd, 0);
  assert.equal(Object.keys(snapshot.entries).length, 5);
  // Separate processes also converge on one settlement, releasing the unused
  // reservation exactly once rather than increasing the budget twice.
  const settleCode = `import { openBudgetLedger } from ${JSON.stringify(moduleUrl)};
    const ledger = await openBudgetLedger({ ledgerPath: process.argv[1] });
    console.log(JSON.stringify(await ledger.settle({ requestId: 'same-attempt', actualCostMicroUsd: 500_000, providerRequestId: 'p-1' })));`;
  const settled = await Promise.all(Array.from({ length: 5 }, () => child(settleCode, [ledgerPath])));
  assert.equal(settled.filter(r => r.changed).length, 1);
  const after = await ledger.snapshot();
  assert.equal(after.totals.spentMicroUsd, 500_000);
  assert.equal(after.totals.reservedMicroUsd, 8_000_000);
  assert.equal(after.totals.remainingMicroUsd, 1_500_000);
});

test('stale locks and corrupt ledgers fail closed without deleting evidence', async t => {
  const { ledger, ledgerPath } = await fixture(t);
  const original = await fs.readFile(ledgerPath, 'utf8');
  const lockText = JSON.stringify({ token: 'old-owner', pid: 99999999, acquiredAt: '2000-01-01T00:00:00Z' });
  await fs.writeFile(ledger.lockPath, lockText);
  await assert.rejects(openBudgetLedger({ ledgerPath, lockTimeoutMs: 30, lockPollMs: 5 }), { code: 'PILOT_BUDGET_LOCKED' });
  assert.equal(await fs.readFile(ledger.lockPath, 'utf8'), lockText);
  assert.equal(await fs.readFile(ledgerPath, 'utf8'), original);
  await fs.unlink(ledger.lockPath); // Explicit recovery in this isolated test.
  await fs.writeFile(ledgerPath, '{truncated');
  await assert.rejects(openBudgetLedger({ ledgerPath }), { code: 'PILOT_BUDGET_CORRUPT' });
  assert.equal(await fs.readFile(ledgerPath, 'utf8'), '{truncated');
});

test('cap cannot be raised and real underestimated charges halt new dispatch', async t => {
  const { ledgerPath, ledger } = await fixture(t);
  await assert.rejects(openBudgetLedger({ ledgerPath, capMicroUsd: 10_000_001 }), { code: 'PILOT_BUDGET_INVALID' });
  await assert.rejects(openBudgetLedger({ ledgerPath, capMicroUsd: 9_000_000 }), { code: 'PILOT_BUDGET_CONFLICT' });
  await assert.rejects(ledger.settle({ requestId: 'not-reserved', actualCostMicroUsd: 1 }), { code: 'PILOT_BUDGET_NOT_FOUND' });
  await assert.rejects(ledger.reserve(request('invalid', 0.5)), { code: 'PILOT_BUDGET_INVALID' });
  await ledger.reserve(request('underestimated', 1_000_000));
  const result = await ledger.settle({ requestId: 'underestimated', actualCostMicroUsd: 1_000_001 });
  assert.equal(result.totals.halted, true);
  assert.equal(result.totals.spentMicroUsd, 1_000_001);
  await assert.rejects(ledger.reserve(request('blocked', 1)), { code: 'PILOT_BUDGET_HALTED' });
  assert.equal((await openBudgetLedger({ ledgerPath }).then(l => l.snapshot())).totals.halted, true);
});
