# Transcription benchmark bundle — 2026-09-06 … 2026-09-08

Everything the September 2026 reader-model benchmark produced, copied out of the
gitignored `tmp/` tree so another machine can resume it. Run `bash bench/2026-09-06/restore.sh`
to put it back under `tmp/` (the layout `scripts/tx/*` expects), then read
`docs/Handoff-2026-09-12.md` for the state of play and the next steps.

| path | what |
|---|---|
| `bench/fixtures.json`, `fixtures.md`, `fixtures.24.json` | the 24 benchmark papers (20 with an Opus reference, 4 held-out) and why each was chosen |
| `tx/<paperId>/manifest.json`, `text/` | prepare.mjs output per paper (document hashes, page sizes, text layer); page PNGs and PDFs are omitted |
| `tx/<paperId>/candidates/` | reader outputs: `zai__glm-5.3-flash.json` (API), `agent__haiku.json`, `agent__sonnet.json` (harness agents), plus `.figs.json` / `.view.json` side files, `.window-*.json` parts, `.raw.txt` raw replies |
| `tx/<paperId>/checks/` | cross-family checker outputs (`zai__glm-5.3-flash__for-agent__*.json`, `agent__haiku__for-zai__glm-5.3-flash.json`) |
| `tx/runs.jsonl` | every API call: tokens, list-price cost, seconds, attempts |
| `bench/truth/`, `bench/adjudication/` | model-adjudicated gold transcriptions and per-candidate verdicts (Fable/Codex); 8 complete, some partial |
| `bench/results/summary.{md,json}`, `fixtures.complete.json` | `bench-status.mjs` inventory of 2026-09-08 (the current verdict) |
| `bench/usage.json`, `glm-validate.json`, `agent-validate.json` | agent token usage per leg; schema validation per candidate |
| `bench/codex-resume/` | Codex's adjudication scripts and checkpoints (Sep 6–8) |
| `shards/` | the Bulgarian backlog work lists (`all.json`, `shard0..8.json`) and `runs.json` (run ids, ships, limit hits) |
| `staging/` | 27 transcribed-but-unverified papers left over from the stopped Opus workflows, plus their verify lists |
| `verification-evidence.json` | journal-mined verifier evidence for the 555 live papers (attached to the publication ledger) |
| `tx-provider-notes.md` | measured Z.ai facts (endpoint, reasoning level, token cost per page, caps) |
| `codex-review-2026-09-05.md` | the Codex review that motivated pipeline v2 |
