import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const windowsBusy = e => process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(e.code);

// Serialize the entire read-modify-write, not just the final rename. A crashed
// owner leaves its lock for manual recovery: an old timestamp or reused PID is
// not sufficient evidence that it is safe for another process to take over.
export function withFileLockSync(lockPath, action, { timeoutMs = 30_000, pollMs = 25 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000 || !Number.isInteger(pollMs) || pollMs < 1 || pollMs > 1_000) throw new Error('Invalid file lock timeout/poll interval');
  const deadline = Date.now() + timeoutMs;
  let fd;
  for (;;) {
    try { fd = fs.openSync(lockPath, 'wx', 0o600); break; }
    catch (e) {
      // On Windows an unlinked file may remain delete-pending briefly.
      if (e.code !== 'EEXIST' && !windowsBusy(e)) throw e;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for publication lock ${lockPath}. No automatic stale-lock takeover. Inspect its pid/token/timestamp; only after the owner and all writers have stopped, remove the lock and retry.`, { cause: e });
      pause(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  }
  const token = randomUUID();
  // Close our handle before any unlink (important on Windows). If writing the
  // ownership record fails, leave the lock for inspection; never run action.
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }) + '\n'); }
  finally { fs.closeSync(fd); }
  try { return action(); }
  finally {
    const releaseDeadline = Date.now() + 2_000;
    for (;;) {
      try {
        const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (owner.token !== token) throw new Error(`Publication lock ownership changed: ${lockPath}; refusing to remove another owner's lock`);
        fs.unlinkSync(lockPath);
        break;
      } catch (e) {
        if (!windowsBusy(e) || Date.now() >= releaseDeadline) throw e;
        pause(Math.min(pollMs, Math.max(1, releaseDeadline - Date.now())));
      }
    }
  }
}
