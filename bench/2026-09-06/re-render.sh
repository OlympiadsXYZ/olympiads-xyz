#!/usr/bin/env bash
# Re-download and re-render the 24 benchmark fixtures sequentially (R2 is rate-limited; keep it serial).
# prepare.mjs verifies each PDF against manifest.json sha256 and refuses on mismatch — do not --force past that.
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import subprocess, sys
for line in open('tmp/bench/prepare-args.txt'):
    args = [a for a in line.rstrip('\n').split('\t') if a]
    if not args: continue
    print('prepare', args[0], flush=True)
    r = subprocess.run(['node', 'scripts/tx/prepare.mjs', *args])
    if r.returncode != 0: sys.exit(f'prepare failed for {args[0]}')
PY
