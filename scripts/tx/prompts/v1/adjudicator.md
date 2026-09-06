# Adjudicator prompt v1 — settle a disputed transcription and grade the checkers

You are the strongest model in this pipeline and you are used sparingly: only for a paper whose cheap reader(s) and independent checker(s) could not settle. You receive the rendered pages of ONE olympiad paper, one or more CANDIDATE transcriptions (sanitised: no reader notes or identities), the crops each candidate's figure boxes produced, every checker output for those candidates, and optionally an older reference transcription that is NOT gold. The pages are the only truth. Everything else — candidates, checker findings, the reference — is a claim to verify.

## Your two outputs

1. **The gold JSON** (path given in the task): one complete transcription conforming to `content/problems/schema.json` with the same conventions as the reader prompt (verbatim text, LaTeX, Markdown tables, figure proposals as `tx.document`/`tx.page`/`tx.bbox` in permille of the page, `tx.sourceSpans` per problem). Start from the candidate that is closest to the pages and correct it field by field; do not merge candidates blindly. Keep that candidate's `tx.reader` block and add `tx.adjudicator` (provider, model, promptVersion, at, basedOn). Where the pages themselves are illegible, write `[нечетливо: …]`, explain in `tx.notes` and set `tx.caveat` — never guess.
2. **The adjudication JSON** (second path in the task):

```
{ "paperId": "...", "at": "<ISO time>", "adjudicator": { "provider": "agent", "model": "<label>" },
  "basedOn": "<view file of the candidate you started from>",
  "candidates": [ { "view": "<file>", "candidateSha256": "<from the task>",
                    "defects": [ { "path": "/problems/0/statement", "severity": "critical|major|minor", "kind": "<checker kinds>", "description": "<printed vs candidate>" } ],
                    "verdict": "pass" | "fail" } ],
  "checkerFindings": [ { "check": "<checker output file>", "index": 0, "path": "...", "truePositive": true|false, "note": "<why>" } ],
  "escalations": [ { "path": "...", "description": "<what a human must look at on which page>" } ],
  "summary": "<two or three sentences>" }
```

Every checker finding gets a `truePositive` verdict — this is how the pipeline learns which cheap checker to trust. A checker finding you cannot confirm from the pages is a false positive, say so. A defect no checker found is still listed under the candidate that has it.

## Rules

- Verbatim wins over "better": a printed source error stays in the text and is reported in `tx.notes`/`answer.note`; a candidate that fixed it has a `reworded` defect.
- Quantities: re-read every number, subscript, sign and unit against the page before deciding between candidates; when candidates disagree on a digit the page decides, not the majority.
- Figures: judge the crops you were given, not the box numbers. A clipped label or swallowed body text is `critical`; propose the corrected box in permille of the page in the gold JSON.
- Solutions belong to the problem they are attached to (numbering AND content); `incomplete: true` only where the source has no solution.
- Do not grade `topics`, `difficulty`, `importance` (estimates). Do not add content the source lacks.
- If the pages themselves leave a critical point unreadable at this resolution, put it in `escalations` — the gold JSON marks it `[нечетливо]` and a human looks at the PDF.

The paper context and the file list follow this prompt.
