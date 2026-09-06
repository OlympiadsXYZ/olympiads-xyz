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
                    │  [--window-pages N → one request per window,    │
                    │   assemble.mjs merges the parts]                │
                    └──────────────► candidates/<provider>__<model>.json ◄──────────────┘
                                             │ validate.mjs   (schema, ids, points, KaTeX, permille boxes, spans)
                                             │ figures.mjs    (permille→px, pdfcrop → sanity → R2 upload only if no identical MD5 → HEAD 200) → *.figs.json
                                             │ checker        (transcribe.mjs --stage checker | task.mjs --stage checker)
                                             │                 sees checkerView(candidate) + the crop PNGs, never tx.notes / tx.reader → checks/<provider>__<model>.json
                                             │ receipt.mjs    → receipt.json {verdict, contentHash, sourceHashes, reviewer, independence, blockers[], defects[]}
                                             │      fail ──► repair.mjs (applies suggestedFix) ──► validate → figures → FRESH checker → receipt   (≤ --max-rounds)
                                             │      escalate / unrepairable ──► job parked; task.mjs --stage adjudicator (Opus/Fable) → gold JSON → --continue --repaired
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
| prepare | `prepare.mjs <paperId> [--problems k] [--solutions k] [--force]` | archive keys (an existing paper's `source.archiveKey`, the backlog entry for the same PDF, or flags) | `manifest.json` {paperId, meta, documents{key, sha256, bytes, pages, pageSizes[pt], pageImages, text}, renderDpi 160, preparedAt}; `pages/<doc>-NN.png`; `text/<doc>.txt`. Re-downloads when the file is missing, the key changed, the bytes no longer match the manifest, or `--force`; re-renders and re-dumps text whenever the sha256 changes | rclone/poppler missing, key unknown, PDF already transcribed under another id |
| reader | `transcribe.mjs … --stage reader [--window-pages N] [--reasoning low]` or `task.mjs --stage reader` | pages + `prompts/v1/reader.md` + context block (+ window block) | one JSON object conforming to `schema.json`, tx-only data under `tx` (paper: printedMeta, catalogDisagrees, notes, reader provenance incl. tokens/cost/attempts; problem: sourceSpans; figure: document/page/bbox in **permille of the page**, 0–1000 per axis) | HTTP error after 3 attempts, no JSON in reply, payload over the provider cap (use `--window-pages`) |
| validate | `validate.mjs cand.json --paper-id X --manifest m` | candidate (+manifest) | JSON report {ok, errors[], warnings[], stats}; exit 1 on errors | schema, id scoping, non-contiguous numbering, implausible points, raw HTML / `<<`, KaTeX parse error, box outside 0..1000 or under 20 px on the page, span page missing, unresolved window placeholder |
| figures | `figures.mjs <paperId> cand.json [--dry-run]` | candidate with `tx.bbox` proposals | `<name>.figs.json` with url/width/height/source filled and `tx.{file, public200, md5}`; report on stdout. Upload only when no remote object has the same MD5 (`rclone lsf --hash MD5` must succeed — a listing failure aborts, it is never "nothing there"); a different object under the name gets `-vN`. `--dry-run` crops and keeps `tx.file` but assigns NO url and marks `tx.dryRun` | crop tiny/blank, listing/upload/HEAD failure |
| checker | `transcribe.mjs … --stage checker --candidate f` / `task.mjs --stage checker` | pages + **sanitised** candidate (`lib.mjs:checkerView`: content, figure document/page/box/crop file, problem source pages — no `tx.notes`, `tx.reader`, `tx.printedMeta`, flags) + the crop PNGs + `prompts/v1/checker.md` | {candidateSha256, verdict pass/fail/escalate, summary, coverage, defects[{path, document, page, severity, kind, description, suggestedFix, confidence}]}; API checks also carry `checker.{candidateSha256, viewSha256, crops}` | — |
| receipt | `receipt.mjs <paperId> --candidate f --defects c.json --reviewer p:m:reqId [--allow-same-model] [--adjudicator p:m:id]` | figs-candidate + checker output | `receipt.json` {verdict, contentHash (sha256 of the exact bytes promote writes), sourceHashes, reviewer, reader, independence, adjudicator, checkedAt, promptVersion, defects[], blockers[]}; exit 0 pass / 3 escalate / 1 fail | `pass` requires: checker verdict pass, zero critical/major/minor defects (`resolved` flags are ignored — repairs need a fresh check), checker `candidateSha256` equal to the candidate given, every figure uploaded + HEAD-verified (no `--dry-run` leftovers), final bytes schema-valid, reader ≠ checker model unless `--allow-same-model` |
| repair | `repair.mjs <paperId> --candidate f --receipt r --out f` | fail receipt | candidate copy with the checker's `suggestedFix` values applied (strings, permille boxes, points) and `tx.repairs[]`; a figure whose box changed loses url/width/height/source so figures.mjs redoes it | exit 3 when a defect has no usable `suggestedFix` (→ adjudication) |
| adjudicator | `task.mjs <paperId> --stage adjudicator --out gold.json [--candidates a,b] [--checks c,d] [--reference r]` | pages + every candidate (sanitised) + crops + every checker output + optional reference + `prompts/v1/adjudicator.md` | gold JSON (with `tx.adjudicator`) and `adjudication.json` (per-candidate defects, true/false positive per checker finding, escalations); re-enters at validate via `run.mjs --continue --repaired gold.json` | harness agent only (Opus/Fable tier, D-P9) |
| promote | `promote.mjs <paperId> --candidate f --receipt r` | receipt with verdict pass | paper JSON (status `review`, `transcription` provenance with provider/model/promptVersion/promptSha256/requestId/sourceSha256/verifiedBy/verifiedAt as real schema fields), stored receipt (no machine-local paths), ledger approval | verdict ≠ pass, any blocker or defect, same-model check not allowed in the receipt, candidate/source/content hash mismatch, missing figure evidence, target exists (without `--replace`), normalise changes bytes, `publication.mjs` missing |

`receipt.mjs` and `promote.mjs` build the final bytes with the same functions
(`lib.mjs: provenanceFor` + `buildFinalPaper`), which strip `tx`, hoist
`sourceSpans`, stamp `paper.transcription` from real schema fields (the schema
was extended for `provider`, `promptVersion`, `promptSha256`, `requestId`,
`sourceSha256`, method `vision-pages`; nothing is serialised into `notes` and
`buildFinalPaper` throws if a field is missing from the schema), set
`status: review` and apply the `normalise-papers.mjs` canonicalisation — so the
hash in the receipt is the hash of the file on disk, and `publication.mjs
approve` accepts it. `publicationState` additionally requires the receipt to
have no blockers and an independent (or explicitly allowed same-model) check.

### Paper ids

`<comp>-<printed year>-<round token>-<grade token>`: `psf-2026-proletno-12`,
`nao-2016-iii-11-12`, `esf-2013-esenno-st`, `nof-2014-ii-7`,
`nao-2024-iv-ml-prak`. The committed ids are **not fully regular**
(`nao-2023-iv-nabl` vs `nao-2024-iv-obs`, `nof-2015-iii-10-12-d1`,
`nao-2024-iii-11-12-test`, …), so `lib.mjs: derivePaperId` is only a proposal
for papers that do not exist yet (it matches 499 of the 520 backlog entries
already in `content/problems`; the rest are irregular). `paperIdFor`/`resolvePaper`
look the problems archive key up in `content/problems` first — an existing id
always wins — and refuse to prepare a PDF that is already transcribed under a
different id, so the same paper can never be promoted twice. Explicit
`--problems/--solutions` keys override. For ESF the backlog year is already the
printed calendar year (folders are academic years).

### Verification quality on the page

Papers promoted here carry `status: review` and a `reviewed` ledger entry; the
page shows „Проверена срещу оригинала на <date> от независим модел“ (D-P7).
`transcription.verifiedBy` says `independent checker` or, when
`--allow-same-model` was used, `same-model checker`, and names the adjudicator
when one intervened. `published` remains a human decision and is never set by
the pipeline.

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
cost estimate (3,230 prompt tokens per 160-dpi page measured for GLM, 1,600
guessed for the others).

Transport (measured 2026-09-06): Node's default `fetch` killed a 3-page GLM read
at exactly 5 minutes (`UND_ERR_HEADERS_TIMEOUT`), so requests go through an
undici `Agent` with `headersTimeout`/`bodyTimeout` of `--timeout-min` (default
20). A request is retried up to 3 times on 429, 5xx, timeouts and network
errors with 20 s·attempt backoff; every attempt is a line in `runs.jsonl`
(`ok: false, attempt, status/error`), the successful one carries `attempts`.
Per-provider payload caps are checked before sending (Anthropic 5 MB/image,
32 MB/request; Gemini 20 MB inline; Z.ai 20 MB assumed): over the cap the reader
must run with `--window-pages N`.

Z.ai GLM-5.3-Flash specifics: thinking cannot be disabled (`thinking.type:
disabled` → code 1210); the adapter sends top-level `reasoning_effort` (default
`low` — 0 reasoning tokens measured; `--reasoning high|max` for a checker that
disagrees), `temperature: 0`, `response_format: json_object`, and `max_tokens`
65536 by default (accepted range 1..131072).

Long documents (125 of 555 papers have ≥ 10 pages): `--window-pages N` splits
each document into N-page windows overlapping by one page, one request each,
written as `<candidate>.window-<doc>-<from>-<to>.json`; `assemble.mjs` merges
them by problem number (statement from the window where the problem begins,
solution from the window that has it, spans/figures unioned, the
`[извън прозореца]` placeholder replaced) and reports pages no problem claims.
Validation fails on any leftover placeholder or numbering gap. Endpoints: Anthropic Messages API (`x-api-key`,
`anthropic-version: 2023-06-01`, base64 PNG image blocks), Gemini
`generateContent` (`inline_data`, `responseMimeType: application/json`), Z.ai
OpenAI-compatible chat completions (`image_url` data URIs,
`response_format: json_object`). The scripts use `fetch` directly because the
repo does not take new npm dependencies; if an official SDK is ever added, the
adapters in `transcribe.mjs` are the only place to change.

### Claude-tier readers, checkers and adjudicators without keys

`task.mjs <paperId> --stage reader --out <candidate path> --model sonnet`
prints a complete task (prompt, the PNG paths to Read in order, the output path
and the validate command). A harness agent executes it and writes the JSON;
`run.mjs --continue` resumes. The agent must set `tx.reader` so the receipt can
record who transcribed. Agent runs have no token accounting in `runs.jsonl`
unless the harness appends a record.

`--stage checker --candidate f` writes `<f>.view.json` (the sanitised view) and
lists the crop PNGs; the agent must copy the printed `candidateSha256` into its
output. `--stage adjudicator --out gold.json` hands over every candidate view,
every crop, every checker output and an optional reference and asks for the gold
JSON plus `adjudication.json`; `run.mjs <id> --continue --repaired gold.json`
re-enters at validate with `tx.adjudicator` recorded in the receipt.

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

## Escalation and repair policy (as implemented in `run.mjs`)

- `validate` errors → the run stops (exit 3) with the report in `validate.json`; re-run the reader or supply a fixed candidate with `--continue --repaired f` (which re-validates).
- receipt `fail` → `repair.mjs` applies the checker's `suggestedFix` values; the repaired candidate goes back through validate → figures (changed boxes are re-cropped and re-uploaded) → a **fresh** checker run → a new receipt. Any stage that finds the candidate bytes differ from the last validated bytes goes back to validate first. At most `--max-rounds` (default 2) repair rounds; the checker never edits the candidate and a repaired candidate can never reuse an older check (the receipt compares the checker's `candidateSha256`).
- a defect without a usable `suggestedFix`, a receipt blocked without repairable defects, rounds exhausted, or checker `escalate` (illegible scan, ambiguous digit, document may belong to another paper, confidence < 0.6 on a critical point) → the job is parked as `escalated` and the adjudicator task command is printed (Opus/Fable tier, D-P9). The adjudicator writes the gold JSON and `adjudication.json`; `--continue --repaired gold.json` re-enters at validate and the receipt records the adjudicator.
- reader and checker must be different models (`run.mjs` refuses `--reader zai:glm-5.3-flash --checker zai:glm-5.3-flash` without `--allow-same-model`; the receipt and the page say so when it is allowed).
- promote refuses anything without a `pass` receipt for the exact bytes; `--replace` on an existing paper requires a new approval because the content hash changes.
- Legacy content keeps `kind: legacy`; the pipeline never upgrades it — a paper is re-verified only by running it through the chain.

Still manual: creating `providers.env`; choosing the reader/checker pair; the adjudication itself (a harness agent); reviewing `adjudication.json`; deciding `published` (human review, D-P3); anything the archive catalogue gets wrong (fix `all.json` or pass keys explicitly).

## Running the benchmark

1. Choose ~24 representative papers (clean exports, embedded-equation PDFs, old scans, dense tables, multi-page problems, NAO practical/observational). Write `tmp/bench/fixtures.json`: `[{"paperId": "...", "reference": "tmp/bench/truth/<id>.json"?}]` — with a human-adjudicated reference when one exists; otherwise the existing Opus JSON is used and labelled as *not gold*.
2. `node scripts/tx/prepare.mjs <id>` for each; then one reader per provider/model: `node scripts/tx/transcribe.mjs <id> --provider gemini --model gemini-3.8-flash --stage reader` (and zai/glm-5.3-flash, …).
3. `node scripts/tx/bench.mjs --fixtures tmp/bench/fixtures.json --candidates 'tmp/tx/*/candidates/*.json'` → `tmp/bench/report.md` / `report.json`: problems missing/extra, statement similarity (normalised token LCS ratio), numeric+unit token mismatches, **normalised-LaTeX span mismatches** (a wrong subscript, sign or exponent inside `$…$` counts), LaTeX span delta, table-cell diffs, figure-count delta, answer and points mismatches, and acceptance columns — validate ok, checker verdict (the check whose `candidateSha256` matches), receipt verdict, escalated, total $ (reader attempts + every checker run) and $ per accepted paper from `runs.jsonl`. Derived `.figs/.view/.dryrun/.window-*/.rN` copies are skipped so each candidate is scored once. The 24 prepared fixtures under `tmp/tx/` are the benchmark set; do not `--gc` or re-render them.
4. Decide the route on measured defects **and** cost per accepted paper; keep held-out papers away from prompt tuning; bump `prompts/v2/…` rather than editing `v1` once results exist against it.

## Smoke test (2026-09-06)

`psf-2004-proletno-7`: prepare (2 PDFs, 4 pages), `validate.mjs` on the
existing content JSON (mode final), `figures.mjs --dry-run` against the same
JSON re-expressed as box proposals, `bench.mjs` comparing the existing JSON
with itself (zero diffs expected), `task.mjs` output, `--gc`.

`psf-2024-proletno-9` (2026-09-06, after the fix pass): one real GLM-5.3-Flash
reader call over 3 pages with `reasoning_effort: low` — 144 s, 12,956 prompt /
8,564 completion tokens (1,465 of them reasoning despite `low`), $0.0062 at list
price, one attempt, `finish_reason: stop`. `validate.mjs`: 5 problems, 165 math
spans all compile, both figure boxes in range; 4 schema errors on `answer`
(string instead of object, extra `text` key) — the reader prompt now spells out
the `answer` object. The candidate splits 1.1/1.2 and 3.1/3.2 into five problems
where the old Opus JSON has three — a numbering convention the checker/adjudicator
must settle, not a validator matter.
