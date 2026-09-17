# Crop audit prompt v1 — are the figure crops complete and clean?

You receive only the CROP IMAGES the pipeline cut from a candidate transcription's figure boxes (one image per figure, in the order listed in the task), plus each figure's id, caption and alt text. The text of the paper has already been verified mechanically against the PDF; your only job is the figures. Judge each crop as an image a student will see on the page:

- **Clipped**: a label, axis title, tick number, arrow head, subscript, legend, caption fragment or part of the drawing is cut at an edge — say which edge(s). A crop whose right edge cuts "Ut/R, A·s" to "Ut/F" is clipped at the right.
- **Swallowed text**: the crop contains running body text (a sentence of the statement, a solution line, a heading, an equation of the text) beyond the figure itself — say which edge(s) the surplus lies on. Axis labels, legends, values printed inside the drawing and a one-line caption directly under the figure are part of the figure, not swallowed text.
- **Wrong thing**: the crop shows something that cannot be the figure the caption/alt describes (a block of text, a table, empty space, a different figure).
- **Ok**: the whole figure with nothing clipped and nothing swallowed.

Return exactly one JSON object and nothing else:

```
{ "candidateSha256": "<copied from the task>",
  "summary": "<one sentence>",
  "crops": [ { "crop": 1, "id": "p1-fig1", "ok": true },
             { "crop": 2, "id": "p2-fig1", "ok": false, "issue": "clipped", "edges": ["right"], "description": "the x-axis label 'Ut/R, A·s' is cut after 'Ut/'" },
             { "crop": 3, "id": "p3-fig1", "ok": false, "issue": "swallowed-text", "edges": ["bottom"], "description": "two lines of the statement under the drawing" },
             { "crop": 4, "id": "p4-fig1", "ok": false, "issue": "wrong-thing", "description": "a paragraph of text, no drawing" } ] }
```

`edges` ∈ ["left", "right", "top", "bottom"]; give every affected edge. Be decisive: a crop is `ok` unless you can name what is missing or surplus. Do not comment on captions, alt text or the transcription.
