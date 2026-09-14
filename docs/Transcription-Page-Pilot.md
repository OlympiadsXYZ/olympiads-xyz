# Experimental page transcription pilot

`scripts/tx/pilot-page.mjs` reads one prepared source image per request or checks
one frozen page draft against that image. Outputs are isolated, unreviewed
experiment artifacts. It does not assemble or publish papers, upload figures,
issue publication receipts, or update canonical content. A small fixture result
does not establish an archive-wide accuracy rate.

## Frozen inputs

Supply a JSON plan with an `items` array. Each item records:

| Field | Meaning |
|---|---|
| `id`, `paperId`, `documentRole` | Unique plan item, canonical paper identity, and `problems` or `solutions` document role |
| `sourcePdfPath`, `sourcePdfSha256` | Local original PDF and SHA-256 of its exact bytes |
| `pdfPage` | One-based page within that PDF |
| `imagePath`, `imageSha256` | Local prepared PNG and SHA-256 of its exact bytes |
| `viewTransform` | `original`, or the explicitly recorded preparation transform |
| `readingOrderHint` | Optional source preparation note, for example the order of two rotated leaves |

Use absolute paths. Source and image hashes are checked before dispatch; the
captured image bytes used to build each request are checked again against the
frozen image hash. The PDF itself is **not sent**. Image binding is therefore
the primary binding to what the model actually sees. A matching hash does not
prove that the image depicts the claimed PDF page or that its transformation is
correct: verify that relationship during preparation. Coordinates in pilot
outputs are permille of the supplied image, so rotated views need an explicit
mapping back to original PDF coordinates before production use.

For `--check`, each item additionally records `candidatePath` and
`candidateSha256`, the exact saved reader artifact and its SHA-256. The checker
requires matching item, paper, document role, PDF/image hashes, page and view
transform, with unique nonempty candidate block IDs. It receives the original
image plus only `candidate.page`, marked as untrusted candidate JSON; reader
rationale and provenance are not supplied as instructions.

## Run from the repository root

Dry-run is the default. It validates/prepares requests and writes a summary,
but makes no provider calls and does not open the ledger:

```powershell
node scripts/tx/pilot-page.mjs --plan C:/pilot/pages.json --out C:/pilot/read --ledger C:/pilot/budget.json --providers openai --workers 1
```

After reviewing the plan and dry-run, add `--execute` to send the bounded
requests. Credentials come from `OPENAI_API_KEY` or `ZAI_API_KEY`, falling back
to the existing local provider configuration. Do not include credentials in
plans or command arguments.

```powershell
node scripts/tx/pilot-page.mjs --plan C:/pilot/pages.json --out C:/pilot/read --ledger C:/pilot/budget.json --providers openai --workers 1 --execute
node scripts/tx/pilot-page.mjs --plan C:/pilot/check-pages.json --out C:/pilot/check --ledger C:/pilot/budget.json --providers openai-terra --reasoning low --workers 1 --check --execute
```

Enabled provider IDs are `openai` (GPT-5.6 Luna), `openai-terra` (GPT-5.6 Terra),
and `zai-vision` (GLM-4.6V). Select providers explicitly: the default is
`openai,zai-vision`. OpenAI permits `--reasoning none` (default) or `low`; Z.ai
permits `none`. Requests have a 16,000-token output ceiling. GLM-OCR layout
parsing is not enabled for paid dispatch because its adapter lacks a documented
enforceable cost bound. Model, price and limit assumptions are recorded in
`pilot-providers.mjs` as checked on 2026-09-14.

## Spending and retry rules

All executions in this pilot must use the **same ledger file**. It caps total
settled spending plus outstanding reservations at **$10**, using integer
microUSD. Creating a different ledger creates separate accounting and must not
be used to bypass that cap. Reserve the full conservative per-request bound
before dispatch; no lock is held while a network request runs. Multiple local
workers/processes sharing that ledger cannot reserve the same budget twice.

The current bounds include the entire documented input ceiling, image input,
requested output ceiling and, for OpenAI, long-context and cache-write rates.
They deliberately exceed typical page costs. Use one worker for Terra: its
current $5.538 reservation does not allow two simultaneous requests inside the
$10 cap. Once complete usage is available, settlement releases the difference
between the reservation and the calculated conservative cost. This is a
published-rate estimate from usage, not a provider invoice; missing cache
breakdown is charged conservatively.

Request IDs bind the provider, captured request contents and explicit attempt
number. Repeating the same request ID never authorizes a resend, even after a
crash. There are no automatic retries. A reviewed new `--attempt 2` authorizes
a distinct attempt requiring its own reservation; it does not erase or release
the first attempt. HTTP 401/403/408/429, server errors, unreadable responses and
transport failures pause that provider for the current execution. Already sent
sibling requests remain billable attempts. A later invocation is a new process;
resolve provider access/quota problems before starting another attempt.

Missing billing usage or a timeout leaves the full reservation outstanding.
An HTTP error, including 429, is not evidence of a zero charge. Reconcile unknown
attempts against provider evidence before releasing funds. There is no automatic
stale-lock takeover: after a crash, inspect the recorded lock owner and reconcile
accounting before manual recovery. An observed charge above its reservation is
recorded truthfully and halts further reservations.

## Interpreting artifacts

Each captured response records source identity, request identity, usage/cost,
validation findings and review status. The summary reports failed, incomplete,
unknown, paused and already-attempted work separately. Inspect those statuses;
an already-attempted item does not establish that the earlier artifact passed
review. The runner never logs credentials or raw provider error messages.

`draft` means a complete response passed local structural checks. It does not
mean complete transcription or correct figures. A checker verdict of
`no-material-defect-found` may still contain minor findings; claimed block
inspection is model-reported coverage, not independent proof of source coverage.
These source-bound experiment artifacts are **not publication receipts**.

After offline paper assembly and any repairs, reuse the existing production
pipeline in [Transcription-Pipeline.md](Transcription-Pipeline.md): schema,
source-span and math validation; verified source figure crops; a fresh independent
check of the final candidate; hash-bound receipt; then the sole promotion and
publication gates. Production receipts require zero outstanding defects,
including minor ones. Never convert a pilot checker verdict directly into an
approval or reuse a check after changing its candidate.
