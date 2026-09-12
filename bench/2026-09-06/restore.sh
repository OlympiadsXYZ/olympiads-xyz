#!/usr/bin/env bash
# Restore the September 2026 transcription-benchmark state into the gitignored tmp/ tree
# that scripts/tx/* expect. Run from anywhere: bash bench/2026-09-06/restore.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
B=bench/2026-09-06
mkdir -p tmp/tx tmp/bench tmp/shards tmp/staging
rsync -a "$B/tx/" tmp/tx/
rsync -a "$B/bench/" tmp/bench/
rsync -a "$B/shards/" tmp/shards/
rsync -a "$B/staging/" tmp/staging/
cp "$B/verification-evidence.json" "$B/tx-provider-notes.md" tmp/
echo "restored candidates, checks, adjudications, fixtures, shards, staging and run logs into tmp/"
echo "Page images and source PDFs are NOT in the bundle (reproducible). To re-render the 24 fixtures"
echo "(needs the rclone remote 'r2', poppler-utils, python3 with PyMuPDF + Pillow; runs sequentially, 15-25 min):"
echo "  bash bench/2026-09-06/re-render.sh"
