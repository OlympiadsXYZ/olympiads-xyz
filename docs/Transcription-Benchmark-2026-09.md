# Transcription reader benchmark — decision memo (2026-09-12)

Closes the benchmark started on 2026-09-06 (`bench/2026-09-06/`, `docs/Transcription-Pipeline.md`, D-P9). Written by
Claude (Fable 5.1) on Margulan's PC after the Mac handoff; the evidence lives in `tmp/bench` and is mirrored in
`bench/2026-09-06/bench/` (`results/summary.md` from `bench-status.mjs`, `results/comparison/report.md` from `bench.mjs`).

## Question

Can a cheap reader — GLM-5.3-Flash through the Z.ai API, or Haiku 4.5 / Sonnet 5 as harness agents — replace Opus/Fable
for verbatim transcription of competition papers, with an independent checker and Fable only for adjudication?

## Evidence

24 fixture papers in 8 families (clean digital, embedded equations, old scans, dense tables, figure-heavy, long, astronomy
observational, special topic), 4 of them held out with no earlier transcription. Every paper was read blind by all three
readers; GLM checked the Haiku and Sonnet candidates, Haiku checked the GLM candidates. Fable-class adjudicators (8 by
Codex on the Mac, 10 here) produced a gold JSON and a per-candidate verdict for **18 of 24 papers**; the remaining six
(`nao-2024-iv-obs`, `nof-2018-iii-10-12`, `nao-2023-iv-nabl`, `nao-2021-iv-st-prak`, `psf-2016-proletno-sp`,
`nof-2025-iii-11-12`) were left unadjudicated on purpose: each adjudication costs 0.15–0.38 M Fable tokens on the
subscription, and the picture had stopped changing.

Readers, over the 18 adjudicated papers (strict contract: any defect fails the paper):

| reader | papers | passed | critical | major | minor | papers with a critical defect |
|---|---:|---:|---:|---:|---:|---:|
| Haiku 4.5 (agent) | 18 | 0 | 212 | 128 | 128 | 18 |
| GLM-5.3-Flash (API) | 18 | 0 | 153 | 93 | 127 | 18 |
| Sonnet 5 (agent) | 18 | 2 | 54 | 51 | 122 | 14 |

What the defects are: Haiku omits tables and whole option lists and fabricates passages on old scans; GLM's text is close
to verbatim (its typical critical defect is a figure box that lands on body text or clips a label — every one of its 18
papers has one; it also drops multiple-choice options and, on long papers, whole solution blocks); Sonnet is the closest on
text and points, and fails mostly on crop edges and silently corrected typos.

Checkers, over the 12 papers with a usable gold (no escalation):

| checker | findings adjudicated | true | false | false passes / passes |
|---|---:|---:|---:|---|
| Haiku 4.5 (agent) | 44 | 27 | 17 | 1 / 1 |
| GLM-5.3-Flash (API) | 129 | 118 | 11 | 8 / 8 |

GLM's findings are 91 % precise but every "pass" it issued was wrong; Haiku's findings are 61 % precise. Neither checker
found the missing tables. Checker paths are unreliable (off by one problem index in several papers) and a checker's
"suggested fix" is sometimes an instruction rather than the text — both bit the repair loop (below).

Cost and time per paper: GLM reader ≈ 1 ¢ and 3.5 min at list price (`tmp/bench/usage.json`: 24 papers, 43 calls,
$0.35); Haiku reader 2.24 M subscription tokens for 24 papers; Sonnet reader 4.15 M for 21; a Fable adjudication
0.15–0.38 M tokens and 10–30 min. The whole Z.ai side of the benchmark cost under a dollar.

## What changed in the pipeline because of this

- **Figure boxes are no longer the reader's job alone.** `scripts/pdfregions.py` lists the graphics a born-digital PDF
  contains (embedded images, clustered vector paths, with nearby short labels folded in and headings/captions kept out);
  `scripts/tx/snap.mjs` moves a reader's box onto the graphic it overlaps, the union of several, or the nearest free one
  when it sits on text, and keeps sub-figures printed side by side apart. Scans are left alone. Against 85 adjudicated gold
  boxes GLM goes from 29 to 64 boxes with IoU ≥ 0.5 (mean 0.42 → 0.68).
- **The repair loop got a second stage.** `repair.mjs` applies only replacements that are plausible (not an instruction,
  sharing enough words with the field they replace); what it cannot apply goes to `transcribe.mjs --stage refix`, which
  shows the reader model the relevant pages and asks for the complete corrected value per path. Schema slips at validate
  time take the same route. A blank crop is a checker finding, not a fatal error. Rotated scans are measured correctly.
- **Windows runs the pipeline** (portability fixes in evidence binding, path printing, page-image caps, path roots).

## Production result so far (2026-09-12, backlog of 41 Bulgarian papers, GLM reader + GLM same-model checker)

Seven passes over the day, each after another fix to the loop: 36 backlog papers promoted with `reviewed` receipts by the
GLM reader, 5 backlog papers still open. The 27 staged Opus transcriptions did far better through `from-final.mjs`
(Opus text, GLM check): 15 promoted, whereas fresh GLM reads of the same papers promoted 0 of 12 before that pass was
stopped. End of day: 51 reviewed papers, 606 papers and 2,197 problems on the site, 16 papers open with 32 remaining
defects (5 critical). Z.ai for the day: $2.97 for 503 calls (287 checks, 60 reads, 156 refix calls).

## Addendum 2026-09-13 — what the same-model check let through, and the mechanical checks that now catch it

Margulan read one `reviewed` page (psf-2006-proletno-8, problem 2, a born-digital PDF) and found: two misread words
("разнозначни" for the printed "разноименни"; "ударят" twice for the printed "удрят"), a whole printed sentence missing
("Приемете, че: …"), raw `\quad` outside math in the solution, and the solution's Фиг. 2 never transcribed. On a scan
(nof-2012-i-8) a graph crop started below its axis label. The GLM checker had passed the paper twice, and its own
suggested fix for the statement contained the same misreadings — the checker re-reads the page with the reader's eyes,
and all three GLM roles (reader, checker, refix) silently "correct" printed typos.

The loop now has three mechanical checks, none of which involve a model (`scripts/tx`, commit 42f507cf3, 28 tests):

- **Text layer** (`textlayer.mjs`, merged into every check by `run.mjs`): for each document whose pdftotext layer covers
  ≥ 80 % of the candidate's own words, a run of ≥ 3 printed words absent from the transcription is an omission (critical
  from 6 words), a single absent word on an otherwise transcribed line is a misreading with a mechanical replacement
  located by its printed neighbours, and words the document prints nowhere are reported per field. A model fix that adds
  unprinted words or drops printed ones is demoted to a note; a minor model finding the refix model has disputed is too.
  Over the 51 reviewed papers this found 231 defects (4 critical, 150 major, 77 minor; 39 with a mechanical fix); 11 papers
  were scans or garbled layers and were skipped.
- **Printed graphics** (`figures.mjs` after snapping): every drawing region no figure box covers becomes a defect on the
  owning problem's figures array (attributed by the printed heading above it, else source spans, else existing figures);
  the refix model adds it or returns the array unchanged, which is remembered in `tx.notFigures`.
- **Scans** (`pdfregions.py` v4): scanned pages get regions from their pixels (OpenCV: letter height, text rows vs. strokes,
  labels folded, bleed-through and big-font headings filtered, fraction bars and underlines dropped), so `snap.mjs` corrects
  a reader's box on a scan as well; a native table is one drawn with rulings only.

Guards the first live run exposed: a refix asked for one field may return the whole problem (statement + parts) — refused
when the fix pastes a sibling field; a duplicated part label and a printed points marker at the end of a part are normalised
away; a merged text-layer defect keeps the "omission fix must be longer" protection. psf-2006-proletno-8 then re-promoted
with all four findings fixed and the Фиг. 2 crop added, after 10 loop rounds in total at about 6 ¢ of Z.ai.

1. Bulk transcription uses **GLM-5.3-Flash as the reader**, boxes snapped to the PDF's own graphics, the mechanical
   repair plus refix loop, and a checker run after every repair. Sonnet 5 is the better cheap reader on quality but it
   is subscription-bound; it is not used for bulk.
2. The checker is **GLM as well, recorded as a same-model check** on the receipt and the page, until a cross-family API
   key (Gemini Flash or Haiku through the API) exists — a cross-family checker should be added first when one does,
   because GLM's own passes are not trustworthy and only the repair loop makes its verdicts useful.
3. **Fable is used only** for papers the loop parks as escalated, and for spot audits; nothing is bulk-adjudicated.
4. A paper ships only with a `pass` receipt; escalated papers wait. Nothing in the benchmark supports publishing GLM
   output unchecked.

## Open

- `nao-1998-iv` is almost certainly the 1998 International Astronomy Olympiad (SAO, Russia) misfiled under NAO IV
  (three readings and two adjudications agree); Margulan decides the canonical id.
- Six fixtures remain unadjudicated (list above); 6 of the 18 adjudicated papers carry escalations and are excluded from
  the aggregates by the strict rule.
- Cross-family checker (needs a key); re-checking the 555 legacy papers and the 27 staged ones through the loop
  (needs `scripts/tx/from-final.mjs`, see the handoff); international competitions (D-P9, on hold).
