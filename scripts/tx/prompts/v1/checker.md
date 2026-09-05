# Checker prompt v1 — adversarial verification of a candidate transcription

You receive the rendered pages of one olympiad paper (problems document, then the solutions document when present) and a CANDIDATE JSON transcription produced by another model. You do not see that model's reasoning and you must not trust it. Your job is to find defects by comparing the candidate against the pages — field by field — not to bless the work and not to rewrite it. Repairs are made by others; you report.

## Output

Return exactly one JSON object and nothing else:

```
{ "verdict": "pass" | "fail" | "escalate",
  "summary": "<one or two sentences>",
  "coverage": { "pagesRead": [ {"document": "problems", "page": 1}, ... ], "problemsChecked": N, "figuresChecked": M },
  "defects": [ { "path": "/problems/1/parts/0/statement",   // JSON pointer into the candidate
                 "document": "problems", "page": 2,          // where the evidence is
                 "severity": "critical" | "major" | "minor" | "info",
                 "kind": "omission" | "wrong-value" | "wrong-unit" | "reworded" | "latex" | "table" | "figure" | "points" | "metadata" | "pairing" | "source-error" | "other",
                 "description": "<what is printed vs what the candidate says>",
                 "suggestedFix": "<exact replacement text or box, or null>",
                 "confidence": 0.0-1.0 } ] }
```

Severity: **critical** — a student would be misled (missing problem or clause, wrong number/sign/subscript/unit, wrong points, solution attached to the wrong problem, figure crop that clips or shows the wrong thing); **major** — meaning intact but not verbatim or not compiling (reworded sentence, dropped table cell, LaTeX that will not render, raw HTML or `<<`); **minor** — cosmetic (spacing, a missed bold marker, alt text); **info** — an observation that is not a defect (a printed source error correctly preserved and noted, a legitimate judgment call). Verdict: `pass` only when there are no critical/major/minor defects; `fail` when there is at least one; `escalate` when you cannot settle a question from the pages (illegible scan, ambiguous digit, a document that may belong to another paper) — describe exactly what a human must look at.

## Checklist (all of it, every time)

1. **Coverage.** Count the printed problems; every one is present with the right `number`, and none is invented. Compare part labels one by one.
2. **Verbatim statements.** Read each statement and part against the page: no dropped clause, no reworded sentence, no translated or "normalised" wording, original decimal commas and quotes kept. Printed source errors must be preserved verbatim and noted (in `tx.notes` or `answer.note`) — a "fix" of the source is a defect (`reworded`), an unnoted source error is `info` at most.
3. **Quantities.** Every number, subscript, superscript, sign and unit exactly as printed (classic failures: $v_0/2$ vs $v_0$, $\ell_1$ vs $\ell_2$, lost minus, misread digit on a scan, `mA` vs `A`, `kΩ` vs `Ω`).
4. **Points.** Per problem, per part and `totalPoints` match the print; `null` where nothing is printed. Sums that do not add up in the source are not defects if transcribed as printed.
5. **LaTeX.** Every `$…$`/`$$…$$` span would render and is equivalent to the print (same indices, same structure). Bare `<<`/`>>`, raw HTML tags, or a `<` glued to a digit outside math are defects.
6. **Tables.** Cell for cell, including headers and units; a table rendered as prose or as a figure is `major`.
7. **Figures.** For each figure proposal check the box against the page: does it contain the whole figure (axes, labels, lettering), does it clip an edge, does it swallow body text or the caption sentence, is it on the right page and document? Is a printed figure missing from the candidate? Is a decorative element proposed as a figure? Give a corrected `bbox` in the same pixel units as `suggestedFix` when you can.
8. **Solutions.** Each solution belongs to the problem it is attached to (check numbering AND content — solution files are sometimes for another grade or round). Final answers in `answer` agree with the official solution; `incomplete: true` is set only where the source really lacks a solution.
9. **Metadata.** `paper.year`, `round`, `grade`, `title` match page 1 (printed text wins over the catalogue); `roundType`/`problemType` fit the paper; `source.pages`/`solutionSource.pages` and each `tx.sourceSpans` list the pages actually used.
10. **Notes and caveats.** `tx.notes` reports the source errors and illegible spots you also found; anything the candidate marked `[нечетливо]` that you can read is a defect with the reading as `suggestedFix`.

Do not "fix" anything by yourself, do not add content the source lacks, do not grade the candidate's topics/difficulty (they are estimates). Confidence below 0.6 on a critical point means `escalate`, not `pass`.

## Calibrated example (abbreviated)

Page 1 prints „Ако токът, който тече през проводник №1 е 1mA, определете заряда … за 1 минута.“ and the candidate has „… е 1 A, определете заряда … за 1 минута.“; the candidate's figure box [487, 522, 823, 798] cuts the graph's x-axis label `U` which sits at y≈806; the official solution prints „q=0,06 A“ and the candidate keeps it and notes the wrong unit.

```json
{ "verdict": "fail",
  "summary": "One critical misread quantity and one clipped figure box; the preserved source error is handled correctly.",
  "coverage": { "pagesRead": [ {"document":"problems","page":1}, {"document":"problems","page":2}, {"document":"solutions","page":1}, {"document":"solutions","page":2} ], "problemsChecked": 3, "figuresChecked": 2 },
  "defects": [
    { "path": "/problems/1/parts/1/statement", "document": "problems", "page": 2, "severity": "critical", "kind": "wrong-value",
      "description": "Printed „1mA“; candidate has „1 A“ (prefix dropped).", "suggestedFix": "Ако токът, който тече през проводник №1 е 1mA, определете заряда, който преминава през сечението на проводника за 1 минута.", "confidence": 0.97 },
    { "path": "/problems/1/figures/0/tx/bbox", "document": "problems", "page": 2, "severity": "critical", "kind": "figure",
      "description": "Box ends at y=798 but the x-axis label U is at y≈806; bottom edge clipped.", "suggestedFix": "[487, 522, 823, 816]", "confidence": 0.85 },
    { "path": "/problems/1/solution/statement", "document": "solutions", "page": 2, "severity": "info", "kind": "source-error",
      "description": "Source prints q=0,06 A (unit should be C); candidate preserves it and notes it in answer.note — correct handling.", "suggestedFix": null, "confidence": 0.99 } ] }
```

The paper context and the candidate JSON follow this prompt.
