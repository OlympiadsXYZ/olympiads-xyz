# Source-based classification and layout

New transcriptions may carry `problems[].classification`, the version 1 annotation contract from the archive pilot. The controlled vocabulary is `content/problem-taxonomy.json`; accepted IDs and the annotation shape are enforced by `content/problems/schema.json`. Existing papers acquire no inferred metadata automatically.

The classification holds `schemaVersion`, `taxonomyVersion`, `problemId`, `sourceRef`, `conceptIds`, `methodIds`, `mathIds`, `representationIds`, `prerequisiteLevels`, `difficulty`, `provenance` and optional `partAssessments`. Use the source PDF SHA256 for new assessments; the validator checks it against prepared/stamped source hashes. IDs must exist in the vocabulary and part labels must exist. Cross-subject concepts are allowed when supported by the actual problem; the paper's subject remains source metadata.

Difficulty is an object with `level` (1–5 or null), `status` (estimated/unrated/calibrated), `rationale` and `confidence`. Estimates require an actual statement or statement-and-solution assessment and explicit prerequisites. Index records and existing labels cannot support new ratings. No accepted human calibration anchors exist yet, so calibrated ratings are rejected until a reviewed anchor registry is introduced. The legacy `problem.difficulty` string stays separate and unchanged.

The generator adds fields, concept tags, bilingual search terms and an explicitly estimated difficulty label to the production problem metadata. The `/problems` search has separate field and assessed-difficulty filters; legacy difficulty remains its own filter. The full assessment and its evidence remain in canonical JSON. Source-checker views omit assessor identity and evidence notes.

Source ordering uses ordinary canonical text fields:

- `problem.statement` is the common text preceding parts.
- `parts[].statementAfter` is an unlabelled common paragraph following that part and preceding the next part; it appears outside the part's label and points.
- `problem.statementAfterParts` is common text following all parts.
- `problem.sourceLayout.underlines` lists exact underlined passages present in the statement, common paragraphs, parts or solution. The generator supplies markup; raw HTML stays forbidden in source text.
- `paper.documentNotes` is an array of `{title, statement, document, page, position}` for shared instructions or marking rules. Position is `before-problem` or `after-problem`. These render in separate collapsible blocks and are never copied into each problem's official solution. Their prose is checked against the declared source document.

When importing a pilot sidecar, move `layout.statementBeforeParts` into `problem.statement`, `layout.afterParts` into `statementAfterParts`, and the corrected `layout.solution` into `problem.solution.statement`. Remove the displaced text from its old field; do not duplicate it. Move shared notes to the paper and include only underlines that occur in the problem's canonical text. Detailed pixel boxes and audit notes may remain in the source-reading evidence bundle.

These fields are part of the final bytes covered by the publication receipt. Add them before the fresh source check; never attach metadata or formatting after a receipt and reuse that receipt. `buildFinalPaper` preserves the canonical fields while removing working `tx` data. No promotion, review or human-calibration status is conferred just by attaching an annotation.
