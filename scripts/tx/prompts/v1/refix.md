# Refix prompt v1 — supply exact replacement values for listed defects

You receive the rendered page images of ONE olympiad paper (only the pages that matter for the defects below), and a list of DEFECTS an independent checker found in a JSON transcription of that paper. For each defect you are given its JSON path, what is wrong, and the CURRENT value of that field. Your only job is to return, for each path, the COMPLETE corrected value read from the page — not a comment, not the missing fragment alone, not an improvement.

## Output

Exactly one JSON object and nothing else:

```
{ "fixes": [ { "path": "<the defect's JSON path, copied verbatim>", "value": <replacement>, "note": "<one line: what you read and where>" } ] }
```

One entry per defect, in the order given. `value` is:

- for a text field (statement, solution, caption, alt, title, label…): the ENTIRE corrected string — the current text with the omission restored in its printed place, or the wrong words replaced — following the reader conventions: verbatim Bulgarian as printed (decimal comma, „ “ quotes, printed typos and source errors kept), inline math as `$…$`, display math as `$$…$$`, units in `\mathrm{}` inside math, tables as Markdown tables cell for cell, bold point markers as `**[2 т.]**`; no raw HTML, no `<<`/`>>`;
- for `points` / `totalPoints`: the printed number (or `null` when nothing is printed);
- for a figure box (`…/figures/N/tx/bbox`, `…/figures/N/tx`, `…/figures/N`): `[x0, y0, x1, y1]` in PERMILLE of the page (0–1000 across the width and across the height, origin top-left) enclosing the whole drawing with its labels and a small margin, excluding body text and the caption sentence;
- for an `answer` object: the complete object (`kind`, `value`/`latex`, `unit`, `tolerance`, `note` as applicable);
- for a figure entry (`…/figures/N`) that should not exist — its crop shows body text, a formula, a logo, or a duplicate of another figure: `{ "remove": true }`;
- for a `figures` array (a drawing the transcription lacks): the COMPLETE array — the current figures unchanged plus the new one as `{ "id": "pN-figM" or "pN-sol-figM", "caption": "<printed caption, if any>", "alt": "<one line describing the drawing>", "tx": { "document": "problems"|"solutions", "page": <n>, "bbox": [x0, y0, x1, y1] } }`; when the graphic is a formula, a table or decoration and not a figure, return the current array unchanged and say so in `note`;
- for a `caption` or `title` that the page does not print at all (the transcription made one up): `""` (the field is dropped) — a caption is the printed caption line ("Фиг. 2"), never a description of the drawing;
- `null` when the page does not let you settle it (unreadable, or the defect is not actually on the page) — say why in `note`. Never guess and never invent text the page does not print.

Some defects come from a mechanical comparison with the PDF's own text layer ("Text-layer check: …"). The quoted printed words are authoritative for spelling and wording — including printed typos, which must be kept — but the text layer knows nothing about formulas, so read those from the image.

## Rules

1. The pages are the only truth. Re-read every number, sign, subscript and unit against the image before writing it.
2. Keep everything in the current value that the page confirms; change only what the defect names, plus anything on the same field the page contradicts. Never drop a printed sentence from a field because it "belongs elsewhere": a paragraph printed after the last part (assumptions, data for all parts) stays where the transcription has it, or goes to the end of the problem's `statement` as its own paragraph — moving text is allowed only when the destination field is also listed and you return both.
3. A printed source error stays as printed (the transcription reports it elsewhere).
4. Do not touch paths that are not listed and do not add fields.

The paper context, the page list, and the defects with their current values follow this prompt.
