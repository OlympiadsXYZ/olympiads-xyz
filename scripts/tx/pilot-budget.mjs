// Local, process-safe accounting for a pilot capped at $10. No provider calls.
// Reserve a TRUE upper bound before each separately billable request attempt.
// Only reserve().maySend === true authorizes that attempt; duplicate IDs never
// authorize a resend. Crashes/timeouts retain the reservation. Settle only with
// known billing (zero is appropriate only for a definitely unbilled attempt).
// The lock is held only while reading/writing this ledger, never across an API.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const MICRO_USD_PER_USD = 1_000_000;
export const PILOT_HARD_CAP_MICRO_USD = 10_000_000;

export class PilotBudgetError extends Error {
  constructor(code, message) { super(message); this.name = 'PilotBudgetError'; this.code = code; }
}
const fail = (code, message) => { throw new PilotBudgetError(code, message); };
const integer = (value, name, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) fail('PILOT_BUDGET_INVALID', `${name} must be a safe integer >= ${minimum}`);
  return value;
};
const identifier = (value, name) => {
  if (typeof value !== 'string' || !value.length || value.length > 512 || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) fail('PILOT_BUDGET_INVALID', `${name} must be a nonempty identifier of at most 512 characters`);
  return value;
};
const jsonCopy = value => JSON.parse(JSON.stringify(value));
function details(value, name) {
  if (value == null) return null;
  let encoded;
  try {
    encoded = JSON.stringify(value, (_key, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('nonfinite number');
      if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof v)) throw new Error('not JSON');
      return v;
    });
  } catch { fail('PILOT_BUDGET_INVALID', `${name} must be finite JSON data`); }
  if (Buffer.byteLength(encoded) > 32_768) fail('PILOT_BUDGET_INVALID', `${name} is too large`);
  return JSON.parse(encoded);
}

// Accept decimal dollars (including numeric scientific notation), round UP to
// whole microUSD using integer arithmetic. Pass price strings for exact inputs.
export function usdToMicroUsd(value) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) fail('PILOT_BUDGET_INVALID', 'USD must be a nonnegative decimal');
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
  if (!m || String(value).length > 128) fail('PILOT_BUDGET_INVALID', 'USD must be a nonnegative decimal');
  const exp = Number(m[3] || 0);
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 128) fail('PILOT_BUDGET_INVALID', 'USD exponent is out of range');
  const digits = BigInt(m[1] + (m[2] || ''));
  const scale = 6 + exp - (m[2] || '').length;
  const divisor = scale < 0 ? 10n ** BigInt(-scale) : 1n;
  const result = scale >= 0 ? digits * 10n ** BigInt(scale) : (digits + divisor - 1n) / divisor;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('PILOT_BUDGET_INVALID', 'USD exceeds the safe accounting range');
  return Number(result);
}
export const microUsdToUsd = value => integer(value, 'microUSD') / MICRO_USD_PER_USD;

function totals(ledger) {
  let spentMicroUsd = 0, reservedMicroUsd = 0, unknownMicroUsd = 0;
  for (const e of Object.values(ledger.entries)) {
    if (e.status === 'settled') spentMicroUsd += e.actualCostMicroUsd;
    else {
      reservedMicroUsd += e.maxCostMicroUsd;
      if (e.status === 'unknown') unknownMicroUsd += e.maxCostMicroUsd;
    }
  }
  integer(spentMicroUsd + reservedMicroUsd, 'total exposure');
  const committedMicroUsd = spentMicroUsd + reservedMicroUsd;
  return {
    capMicroUsd: ledger.capMicroUsd, spentMicroUsd, reservedMicroUsd,
    unknownMicroUsd, committedMicroUsd,
    remainingMicroUsd: Math.max(0, ledger.capMicroUsd - committedMicroUsd),
    overCapMicroUsd: Math.max(0, committedMicroUsd - ledger.capMicroUsd),
    halted: ledger.haltReason !== null,
  };
}

function validateLedger(j) {
  if (!j || j.schemaVersion !== 1 || j.currency !== 'USD' || j.unit !== 'microUSD' || !j.entries || typeof j.entries !== 'object' || Array.isArray(j.entries) || !(j.haltReason === null || typeof j.haltReason === 'string')) fail('PILOT_BUDGET_CORRUPT', 'Ledger schema is invalid; refusing to reset accounting');
  integer(j.capMicroUsd, 'ledger cap', 1);
  if (j.capMicroUsd > PILOT_HARD_CAP_MICRO_USD) fail('PILOT_BUDGET_CORRUPT', 'Ledger exceeds the $10 pilot cap');
  for (const [id, e] of Object.entries(j.entries)) {
    if (!e || e.requestId !== id || !['reserved', 'unknown', 'settled'].includes(e.status)) fail('PILOT_BUDGET_CORRUPT', `Invalid ledger entry ${id}`);
    identifier(id, 'stored requestId'); identifier(e.fingerprint, 'stored fingerprint');
    integer(e.maxCostMicroUsd, 'stored reservation', 1);
    if (e.maxCostMicroUsd > j.capMicroUsd) fail('PILOT_BUDGET_CORRUPT', 'Stored reservation exceeds the cap');
    if (e.status === 'settled') integer(e.actualCostMicroUsd, 'stored actual cost');
    else if (e.actualCostMicroUsd !== null) fail('PILOT_BUDGET_CORRUPT', 'Unsettled attempt has an actual cost');
    if (e.status === 'settled' && e.actualCostMicroUsd > e.maxCostMicroUsd && !j.haltReason) fail('PILOT_BUDGET_CORRUPT', 'Unreported reservation overrun');
  }
  if (totals(j).overCapMicroUsd && !j.haltReason) fail('PILOT_BUDGET_CORRUPT', 'Unreported budget overrun');
  return j;
}

export class PilotBudgetLedger {
  constructor({ ledgerPath, capMicroUsd = PILOT_HARD_CAP_MICRO_USD, lockTimeoutMs = 10_000, lockPollMs = 25 } = {}) {
    if (typeof ledgerPath !== 'string' || !ledgerPath.trim()) fail('PILOT_BUDGET_INVALID', 'ledgerPath is required');
    integer(capMicroUsd, 'capMicroUsd', 1);
    if (capMicroUsd > PILOT_HARD_CAP_MICRO_USD) fail('PILOT_BUDGET_INVALID', 'Pilot cap cannot exceed $10');
    integer(lockTimeoutMs, 'lockTimeoutMs'); integer(lockPollMs, 'lockPollMs', 1);
    if (lockTimeoutMs > 60_000 || lockPollMs > 1_000) fail('PILOT_BUDGET_INVALID', 'Lock wait must be <= 60s; poll <= 1s');
    this.ledgerPath = path.resolve(ledgerPath);
    this.lockPath = `${this.ledgerPath}.lock`;
    this.capMicroUsd = capMicroUsd;
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockPollMs = lockPollMs;
  }

  async _locked(fn) {
    await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
    const token = randomUUID(), started = Date.now();
    let handle;
    for (;;) {
      try { handle = await fs.open(this.lockPath, 'wx', 0o600); break; }
      catch (e) {
        // Windows may report a just-unlinked file as EPERM until its last handle closes.
        const deletingOnWindows = process.platform === 'win32' && ['EPERM', 'EACCES'].includes(e.code);
        if (e.code !== 'EEXIST' && !deletingOnWindows) throw e;
        if (Date.now() - started >= this.lockTimeoutMs) fail('PILOT_BUDGET_LOCKED', `Budget lock exists: ${this.lockPath}. No automatic stale-lock takeover; inspect the owner and reconcile before manual recovery.`);
        await delay(Math.min(this.lockPollMs, Math.max(1, this.lockTimeoutMs - (Date.now() - started))));
      }
    }
    try {
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, host: os.hostname(), acquiredAt: new Date().toISOString() }));
      await handle.sync();
    } catch (e) {
      await handle.close();
      await fs.unlink(this.lockPath);
      throw e;
    }
    await handle.close();
    try { return await fn(); }
    finally {
      // Never unlink someone else's lock after external/manual intervention.
      const owner = JSON.parse(await fs.readFile(this.lockPath, 'utf8'));
      if (owner.token !== token) fail('PILOT_BUDGET_LOCKED', 'Budget lock ownership changed; refusing to remove it');
      await fs.unlink(this.lockPath);
    }
  }

  async _read({ allowMissing = false } = {}) {
    let text;
    try {
      const stat = await fs.lstat(this.ledgerPath);
      if (!stat.isFile() || stat.nlink !== 1) fail('PILOT_BUDGET_INVALID', 'Ledger must be a regular, unlinked file, not a symlink or hard link');
      text = await fs.readFile(this.ledgerPath, 'utf8');
    } catch (e) { if (allowMissing && e.code === 'ENOENT') return null; throw e; }
    let j;
    try { j = JSON.parse(text); }
    catch { fail('PILOT_BUDGET_CORRUPT', 'Ledger JSON is unreadable; refusing to reset accounting'); }
    validateLedger(j);
    if (j.capMicroUsd !== this.capMicroUsd) fail('PILOT_BUDGET_CONFLICT', 'Configured cap differs from the persisted cap; changing budgets requires a separate reviewed pilot');
    return j;
  }

  async _write(j) {
    validateLedger(j);
    const tmp = `${this.ledgerPath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(tmp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(j, null, 2) + '\n');
      await handle.sync(); await handle.close(); handle = null;
      // Same-directory rename replaces atomically on Windows. Do not unlink the
      // old ledger as a fallback: a failed rename must leave it intact.
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(tmp, this.ledgerPath); break; }
        catch (e) {
          if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
          await delay(25 * (attempt + 1));
        }
      }
    } finally {
      if (handle) await handle.close();
      await fs.unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
  }

  async initialize() {
    await this._locked(async () => {
      if (await this._read({ allowMissing: true })) return;
      const at = new Date().toISOString();
      await this._write({ schemaVersion: 1, currency: 'USD', unit: 'microUSD', capMicroUsd: this.capMicroUsd, createdAt: at, updatedAt: at, haltReason: null, entries: {} });
    });
    return this;
  }

  async snapshot() {
    return this._locked(async () => { const j = await this._read(); return { ...j, totals: totals(j) }; });
  }

  async reserve({ requestId, maxCostMicroUsd, fingerprint, metadata = null } = {}) {
    identifier(requestId, 'requestId'); identifier(fingerprint, 'fingerprint'); integer(maxCostMicroUsd, 'maxCostMicroUsd', 1);
    const meta = details(metadata, 'metadata');
    return this._locked(async () => {
      const j = await this._read(), old = Object.hasOwn(j.entries, requestId) ? j.entries[requestId] : null;
      if (old) {
        if (old.fingerprint !== fingerprint || old.maxCostMicroUsd !== maxCostMicroUsd) fail('PILOT_BUDGET_CONFLICT', 'requestId already belongs to a different request or reservation');
        return { created: false, maySend: false, entry: jsonCopy(old), totals: totals(j) };
      }
      if (j.haltReason) fail('PILOT_BUDGET_HALTED', `Pilot halted: ${j.haltReason}`);
      if (maxCostMicroUsd > totals(j).remainingMicroUsd) fail('PILOT_BUDGET_EXCEEDED', 'Reservation would exceed the remaining pilot budget');
      const at = new Date().toISOString();
      const entry = { requestId, fingerprint, maxCostMicroUsd, actualCostMicroUsd: null, status: 'reserved', createdAt: at, updatedAt: at, providerRequestId: null, usage: null, metadata: meta, unknownReason: null };
      Object.defineProperty(j.entries, requestId, { value: entry, enumerable: true, writable: true, configurable: true });
      j.updatedAt = at; await this._write(j);
      return { created: true, maySend: true, entry: jsonCopy(entry), totals: totals(j) };
    });
  }

  async markUnknown({ requestId, reason, providerRequestId = null } = {}) {
    identifier(requestId, 'requestId'); identifier(reason, 'reason');
    if (providerRequestId !== null) identifier(providerRequestId, 'providerRequestId');
    return this._locked(async () => {
      const j = await this._read(), entry = Object.hasOwn(j.entries, requestId) ? j.entries[requestId] : null;
      if (!entry) fail('PILOT_BUDGET_NOT_FOUND', 'Cannot mark an unreserved request unknown');
      if (entry.providerRequestId && providerRequestId && entry.providerRequestId !== providerRequestId) fail('PILOT_BUDGET_CONFLICT', 'Provider request ID differs from the recorded attempt');
      if (entry.status === 'settled') return { changed: false, entry: jsonCopy(entry), totals: totals(j) };
      entry.status = 'unknown'; entry.unknownReason = reason;
      entry.providerRequestId ??= providerRequestId;
      entry.updatedAt = j.updatedAt = new Date().toISOString(); await this._write(j);
      return { changed: true, entry: jsonCopy(entry), totals: totals(j) };
    });
  }

  async settle({ requestId, actualCostMicroUsd, providerRequestId = null, usage = null } = {}) {
    identifier(requestId, 'requestId'); integer(actualCostMicroUsd, 'actualCostMicroUsd');
    if (providerRequestId !== null) identifier(providerRequestId, 'providerRequestId');
    const verifiedUsage = details(usage, 'usage');
    return this._locked(async () => {
      const j = await this._read(), entry = Object.hasOwn(j.entries, requestId) ? j.entries[requestId] : null;
      if (!entry) fail('PILOT_BUDGET_NOT_FOUND', 'Cannot settle an unreserved request');
      if (entry.providerRequestId && providerRequestId && entry.providerRequestId !== providerRequestId) fail('PILOT_BUDGET_CONFLICT', 'Provider request ID differs from the recorded attempt');
      if (entry.status === 'settled') {
        if (entry.actualCostMicroUsd !== actualCostMicroUsd) fail('PILOT_BUDGET_CONFLICT', 'Request was already settled at a different cost');
        return { changed: false, entry: jsonCopy(entry), totals: totals(j) };
      }
      entry.status = 'settled'; entry.actualCostMicroUsd = actualCostMicroUsd;
      entry.providerRequestId ??= providerRequestId; entry.usage = verifiedUsage;
      entry.updatedAt = j.updatedAt = new Date().toISOString();
      // Never hide a real charge behind an underestimated reservation. Persist
      // the charge and halt further dispatch; caller must review this anomaly.
      if (actualCostMicroUsd > entry.maxCostMicroUsd) j.haltReason = `Actual charge exceeded reservation for ${requestId}`;
      await this._write(j);
      return { changed: true, entry: jsonCopy(entry), totals: totals(j) };
    });
  }
}

export const openBudgetLedger = async options => new PilotBudgetLedger(options).initialize();
