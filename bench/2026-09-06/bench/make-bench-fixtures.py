#!/usr/bin/env python3
"""Use completed, validated adjudication evidence; never promote by file existence."""
import pathlib, subprocess, shutil
root = pathlib.Path(__file__).resolve().parents[2]
subprocess.run(['node', 'scripts/tx/bench-status.mjs', '--fixtures', 'tmp/bench/fixtures.json', '--out-dir', 'tmp/bench/results'], cwd=root, check=True)
shutil.copyfile(root/'tmp/bench/results/fixtures.complete.json', root/'tmp/bench/fixtures.bench.json')
