# Transcription pipeline (`scripts/tx`)

How an archive PDF becomes a reviewed `content/problems/**/<paperId>.json` with a
publication receipt — as a scripted pipeline with cheap vision readers, not as
a swarm of interactive agents.

## Why this replaced the agent workflows

The 2026-09 transcription push ran two Opus agents per paper (a transcriber and
an adversarial verifier) that each downloaded, rendered, read, cropped,
uploaded and wrote content by hand from a long prose brief
(`workflows/scripts/transcribe-shard.js`, `verify-staged.js`). The Codex review
of 2026-09-05 (`outputs/olympiads-xyz-review.md`, section "Change the execution
model") found the approach correct in its principles — visual grounding,
verbatim wording, original figures, source-error preservation, a second check —
and wasteful in its execution: every agent re-derived the mechanics (shell
commands, bucket listings, crop retries), verification evidence was a
model-written label with a fixed date, nothing recorded provider identity,
token usage, source hashes or the content hash actually reviewed, and the
workflow's fast path treated an existing file as proof of review. Its
recommendations, adopted as decisions D-P1…D-P9
(`docs/Problems-Decisions-2026-09.md`), are implemented here:

1. prepare documents once, cache by hash, share the same page images between readers;
2. narrow model requests with a compact schema and calibrated examples;
3. scripts do the mechanical work (crop, bounds, upload, validate, compile math, check URLs);
4. an independent checker (preferably another model family) that sees pages + candidate, never the reader's rationale, and returns field-level defects;
5. publish only completed revisions, bound to source and content hashes, through a sole publisher.

Opus/Fable-class models are reserved for adjudication and escalations.
International competitions stay on hold pending Margulan's go (D-P9).

## Architecture

```
tmp/shards/all.json ──► prepare.mjs ──► tmp/tx/<paperId>/{manifest.json, src/, pages/, text/}
                                             │
                    ┌────────────────────────┴───────────────────────┐
                    ▼ API reader (transcribe.mjs --stage reader)      ▼ agent reader (task.mjs → harness → Read pages)
                    └──────────────► candidates/<provider>__<model>.json ◄──────────────┘
                                             │ validate.mjs   (schema, ids, points, KaTeX, boxes, spans)
                                             │ figures.mjs    (pdfcrop → sanity → R2 upload if absent → HEAD 200) → *.figs.json
                                             │ checker        (transcribe.mjs --stage checker | task.mjs --stage checker) → checks/<provider>__<model>.json
                                             │ receipt.mjs    → receipt.json {verdict, contentHash, sourceHashes, reviewer, defects[]}
                                             ▼ promote.mjs    → content/problems/…/<paperId>.json + content/problem-receipts/<paperId>.json
                                                                → node scripts/normalise-papers.mjs
                                                                → node scripts/publication.mjs approve  (ledger entry, kind "reviewed")
run.mjs drives the chain with resumable state in tmp/tx/jobs.json; bench.mjs scores candidates.
```

Everything under `tmp/` is disposable and git-ignored; `prepare.mjs --gc`
drops the large `src/` and `pages/` and keeps the manifest, text layer and
candidates. Durable outputs are the paper JSON, the receipt and the ledger entry.

## Stage contracts

| stage | command | input | output | fails when |
|---|---|---|---|---|
| prepare | `prepare.mjs <paperId> [--problems k] [--solutions k]` | archive keys (from `all.json`, an existing paper, or flags) | `manifest.json` {paperId, meta, documents{key, sha256, bytes, pages, pageSizes[pt], pageImages, text}, renderDpi 160, preparedAt}; `pages/<doc>-NN.png`; `text/<doc>.txt` | rclone/poppler missing, key unknown |
| reader | `transcribe.mjs … --stage reader` or `task.mjs --stage reader` | pages + `prompts/v1/reader.md` + context block | one JSON object conforming to `schema.json`, tx-only data under `tx` (paper: printedMeta, catalogDisagrees, notes, reader provenance; problem: sourceSpans; figure: document/page/bbox in 160-dpi pixels) | HTTP error, no JSON in reply |
| validate | `validate.mjs cand.json --paper-id X --manifest m` | candidate (+manifest) | JSON report {ok, errors[], warnings[], stats}; exit 1 on errors | schema, id scoping, non-contiguous numbering, implausible points, raw HTML / `<<`, KaTeX parse error, box outside page, span page missing |
| figures | `figures.mjs <paperId> cand.json [--dry-run]` | candidate with `tx.bbox` proposals | `<name>.figs.json` with url/width/height/source filled; report on stdout | crop tiny/blank, upload/HEAD failure |
| checker | `transcribe.mjs … --stage checker --candidate f` / `task.mjs --stage checker` | pages + candidate + `prompts/v1/checker.md` | {verdict pass/fail/escalate, summary, coverage, defects[{path, document, page, severity, kind, description, suggestedFix, confidence}]} | — |
| receipt | `receipt.mjs <paperId> --candidate f --defects c.json --reviewer p:m:reqId --prompt-version v1` | figs-candidate + checker output | `receipt.json` {verdict, contentHash (sha256 of the exact bytes promote writes), sourceHashes, reviewer, checkedAt, promptVersion, defects[]}; exit 0 pass / 3 escalate / 1 fail | — |
| promote | `promote.mjs <paperId> --candidate f --receipt r` | receipt with verdict pass | paper JSON (status `review`, `transcription` provenance), stored receipt, ledger approval | verdict ≠ pass, candidate/source/content hash mismatch, target exists (without `--replace`), normalise changes bytes, `publication.mjs` missing |

`receipt.mjs` and `promote.mjs` build the final bytes with the same function
(`lib.mjs: buildFinalPaper`), which strips `tx`, hoists `sourceSpans` when the
schema has them, stamps `paper.transcription`, sets `status: review` and applies
the `normalise-papers.mjs` canonicalisation — so the hash in the receipt is the
hash of the file on disk, and `publication.mjs approve` accepts it.

### Paper ids

`<comp>-<printed year>-<round token>-<grade token>`: `psf-2026-proletno-12`,
`nao-2016-iii-11-12`, `esf-2013-esenno-9`, `nof-2014-ii-7`,
`nao-2024-iv-praktml`. `lib.mjs: derivePaperId` reproduces this from a backlog
entry; `resolvePaper` first honours an existing `content/problems` file with the
same id (its own `source.archiveKey`), then the backlog, then explicit
`--problems/--solutions` keys. For ESF the backlog year is already the printed
calendar year (folders are academic years).

### Verification quality on the page

Papers promoted here carry `status: review` and a `reviewed` ledger entry; the
page shows „Проверена срещу оригинала на <date> от независим модел“ (D-P7).
`published` remains a human decision and is never set by the pipeline.

## Provider setup

Create `~/.config/olympiads-xyz/providers.env` yourself (mode 600, never in the
repo):

```
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
ZAI_API_KEY=...
```

`transcribe.mjs` reads only the key its provider needs and never prints values.
Without keys, `--dry-run` still validates the configuration, builds the exact
payload and writes `candidates/<provider>__<model>.dryrun.json` with sizes and a
cost estimate. Endpoints: Anthropic Messages API (`x-api-key`,
`anthropic-version: 2023-06-01`, base64 PNG image blocks), Gemini
`generateContent` (`inline_data`, `responseMimeType: application/json`), Z.ai
OpenAI-compatible chat completions (`image_url` data URIs,
`response_format: json_object`). The scripts use `fetch` directly because the
repo does not take new npm dependencies; if an official SDK is ever added, the
adapters in `transcribe.mjs` are the only place to change.

### Claude-tier readers without keys

`task.mjs <paperId> --stage reader --out <candidate path> --model sonnet`
prints a complete task (prompt, the PNG paths to Read in order, the output path
and the validate command). A harness agent executes it and writes the JSON;
`run.mjs --continue` resumes. The agent must set `tx.reader` so the receipt can
record who transcribed. Agent runs have no token accounting in `runs.jsonl`
unless the harness appends a record.

## Cost model

`prices.json` holds **unverified list prices** (USD per MTok in/out, 2026-09):
gemini-3.8-flash 0.75/3.75, glm-5.3-flash 0.15/0.50, glm-4.6v 0.30/0.90,
glm-ocr 0.03/0.03, claude-haiku-4-5 1/5, claude-sonnet-5 3/15, claude-opus-5
15/75. Every API call appends `{paperId, stage, provider, model, inputTokens,
outputTokens, costUsd, seconds, requestId, at}` to `tmp/tx/runs.jsonl`;
`bench.mjs` joins these per candidate. Measure dollars **per accepted paper**
(reader + checker + retries), not per request. Illustration from the review:
300 papers × 2 calls × (20k in + 6k out) ≈ $22.50 on Gemini 3.8 Flash list,
≈ $3.60 on GLM-5.3-Flash — hypothetical, to be replaced by measured numbers.

## Escalation policy

- `validate` errors → the reader is re-run (or the harness fixes the candidate); nothing goes further.
- checker `fail` → the candidate is repaired **by a separate step**, and the checker re-checks the changed regions; a checker that completes a missing solution has become its author and disqualifies itself (Codex §4).
- checker `escalate` (illegible scan, ambiguous digit, document may belong to another paper, confidence < 0.6 on a critical point) → the paper is parked (`jobs.json` stage `escalated`) for an Opus/Fable adjudication pass with the same pages; the adjudication writes the repaired candidate and a fresh checker run produces the receipt.
- promote refuses anything without a `pass` receipt for the exact bytes; `--replace` on an existing paper requires a new approval because the content hash changes.
- Legacy content keeps `kind: legacy`; the pipeline never upgrades it — a paper is re-verified only by running it through the chain.

## Running the benchmark

1. Choose ~24 representative papers (clean exports, embedded-equation PDFs, old scans, dense tables, multi-page problems, NAO practical/observational). Write `tmp/bench/fixtures.json`: `[{"paperId": "...", "reference": "tmp/bench/truth/<id>.json"?}]` — with a human-adjudicated reference when one exists; otherwise the existing Opus JSON is used and labelled as *not gold*.
2. `node scripts/tx/prepare.mjs <id>` for each; then one reader per provider/model: `node scripts/tx/transcribe.mjs <id> --provider gemini --model gemini-3.8-flash --stage reader` (and zai/glm-5.3-flash, …).
3. `node scripts/tx/bench.mjs --fixtures tmp/bench/fixtures.json --candidates 'tmp/tx/*/candidates/*.json'` → `tmp/bench/report.md` / `report.json`: problems missing/extra, statement similarity (normalised token LCS ratio), numeric+unit token mismatches, LaTeX span delta, table-cell diffs, figure-count delta, answer and points mismatches, cost/time from `runs.jsonl`.
4. Decide the route on measured defects **and** cost per accepted paper; keep held-out papers away from prompt tuning; bump `prompts/v2/…` rather than editing `v1` once results exist against it.

## Smoke test (2026-09-06)

`psf-2004-proletno-7`: prepare (2 PDFs, 4 pages), `validate.mjs` on the
existing content JSON (mode final), `figures.mjs --dry-run` against the same
JSON re-expressed as box proposals, `bench.mjs` comparing the existing JSON
with itself (zero diffs expected), `task.mjs` output, `--gc`.
