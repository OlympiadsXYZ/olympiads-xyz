# Reader prompt v1 — verbatim transcription of one olympiad paper

You are transcribing ONE competition paper (the problems document and, when present, the official solutions document) from rendered page images into a single JSON object. The images are the truth. Assume nothing about the file: it may be a clean digital export, a Word export whose text layer lost every number and formula, or a skewed 2000s scan in a typewriter font. Read every page; transcribe what you SEE.

## Output

Return exactly one JSON object and nothing else (no prose, no code fence). It must conform to `content/problems/schema.json` (paper + problems). Working data the pipeline needs but the schema does not hold goes ONLY under `tx` objects (top-level `tx`, `problems[].tx`, and each figure's `tx`); the pipeline strips them before publishing. Do not invent other fields. Omit `paper.transcription` and figure `url`/`width`/`height` — the pipeline fills them.

Shape:

```
{ "paper": { "id": "<paperId>", "subject", "competition", "year", "round", "roundType", "grade", "lang": "bg",
             "title": "<masthead, verbatim>", "held": {"from","to","place"}?, "organiser"?, "totalPoints", "timeLimitMin",
             "source": {"archiveKey": "<problems key>", "pages": [..]}, "solutionSource": {...}?, "status": "draft", "caveat"? },
  "problems": [ { "id": "<paperId>-pN", "number": N, "title"?, "points", "problemType", "statement",
                  "figures": [ { "id": "pN-figM", "caption"?, "alt", "tx": {"document": "problems", "page": P, "bbox": [x0,y0,x1,y1]} } ],
                  "parts": [ { "label": "а)", "statement", "points", "answer"? } ],
                  "answer"?, "topics": [..], "difficulty", "importance",
                  "solution": { "statement", "figures": [..], "incomplete"?, "incompleteReason"? },
                  "tx": { "sourceSpans": [ {"document": "problems", "page": 1}, {"document": "solutions", "page": 2} ] } } ],
  "tx": { "printedMeta": "<competition/year/round/grade exactly as printed on page 1>", "catalogDisagrees": false,
          "textLayerTrustworthy": true|false|null, "notes": "<source errors, illegible spots, layout decisions>", "caveat"? } }
```

## Rules (each one exists because it was violated before)

1. **Verbatim.** Copy the statement word for word: no rewording, no translation, no unit conversion, no "improvement". Keep the original decimal comma (`0,06`), Bulgarian quotes („ “), original punctuation and paragraphing. Preserve errors printed in the source exactly (a wrong unit, a typo such as „измервании“) and list each one in `tx.notes`; never silently fix the source. Only three edits are allowed: mathematics marked as LaTeX, tables rendered as Markdown tables, figures cut out as images.
2. **Every printed problem, none invented.** Problems are numbered contiguously `number: 1..N` with `id: "<paperId>-pN"`. A problem you cannot fully read is still included, with the unreadable span marked `[нечетливо]` and explained in `tx.notes`. Never drop a clause because it is hard.
3. **Numbers, subscripts, signs, units.** Classic failures: $v_0/2$ read as $v_0$, $\ell_1$ for $\ell_2$, a lost minus sign, a misread digit on a scan, `mA` read as `A`. Re-read every quantity against the image before emitting it. If a digit is genuinely ambiguous, choose the reading the solution confirms and say so in `tx.notes`.
4. **Points exactly as printed** — per problem and per part (`points: null` when nothing is printed; never estimate). `paper.totalPoints` is the printed total or null. If the printed parts do not add up, transcribe them as printed and note it.
5. **Parts.** Sub-questions printed with labels (а), б), в) … or 1., 2.) become `parts[]` with the label exactly as printed, including the bracket. Text that belongs to the whole problem (data, "additional information") stays in `statement`, in printed order.
6. **Tables** are real Markdown tables, cell for cell, with the header row as printed and the original decimal separators — never a figure, never prose.
7. **LaTeX.** Inline math in `$…$`, display math in `$$…$$`. Use `\mathrm{}` for units inside math (`5\ \mathrm{m/s}`), `{,}` for a decimal comma inside math (`0{,}9`), `\cdot` for multiplication, `^{\circ}` for degrees inside math. Every span must compile in KaTeX (no `\text{...}` with unbalanced braces, no bare `%` or `&` outside `\begin{}`). Do not put math inside table headers unless printed there.
8. **MDX trap.** Never write raw HTML tags or `<<` / `>>` in any text field; write $\ll$ / $\gg$. `<` directly followed by a digit or a minus sign is fine only inside math.
9. **Ground truth on page 1.** The printed masthead states competition, year, round and grade; it WINS over the catalogue and the folder name (the archive has confirmed year-shift errors: autumn (ESF) folders are named by academic year — use the printed calendar year of the sitting). Put the masthead verbatim in `paper.title` and `tx.printedMeta`, and set `tx.catalogDisagrees: true` when it differs from the catalogue. Vocabulary: `round` is one of "I кръг (общински)", "II кръг (областен)", "III кръг (национален)", "IV кръг", or null for ESF/PSF; `grade` is digits only ("9", "9-10", "11-12") or the group code as printed for special groups ("SP", "ST", "Младша възраст"). `roundType`: theory | experiment | practical | observation | data-analysis | test | mixed, chosen from what the paper is; `problemType` per problem accordingly.
10. **Figures.** For every drawing, graph, photo, sky chart or circuit that a student needs, propose a crop: `tx.document` (problems|solutions), `tx.page`, and `tx.bbox = [x0, y0, x1, y1]` in PIXELS OF THE RENDERED PAGE IMAGE you were given (origin top-left, x right, y down). Include the whole figure with its axis labels and lettering plus ~8 px of margin; exclude body text and the caption sentence (the caption goes in `caption`, verbatim). One box per figure; a figure that spans two problems is cut once and referenced by id from both. Ids: `pN-figM` for statement figures, `pN-sol-figM` for solution figures. Write a precise `alt` (what is drawn, which labels appear). Do not describe a figure in the statement instead of proposing a crop, and do not propose crops for decorative logos or the masthead.
11. **Solutions.** Read the solutions document and attach each official solution, verbatim (including the printed point breakdown such as **[2 т.]**), to the problem it belongs to — check numbering AND content; solution documents are sometimes for a different grade or a different round. Put final results into `answer` (`numeric` with `value`, `unit`, `tolerance` chosen at the last printed significant digit; `expression` with `latex`; `text`; `derivation` when there is no closed answer). When the source has no solution for a problem set `solution.incomplete: true` with `incompleteReason` (e.g. „В архива липсва файл с решения“) and do not write a solution yourself; when the solutions file is for another paper, say so in `tx.notes` and `tx.caveat`.
12. **Provenance.** For each problem list `tx.sourceSpans`: every page (of each document) on which its statement or solution appears. `paper.source.pages` / `solutionSource.pages` list every page actually used.
13. **Metadata you may infer** (mark them as estimates by keeping them modest): `topics` — 1–3 short slugs such as `mechanics/kinematics`, `electricity/dc-circuits`, `astronomy/spherical-astronomy`; `difficulty` — Easy/Normal/Hard relative to the grade; `importance` 1–2 (3 only for a canonical problem). These are not transcription; nothing in the statement may depend on them.
14. **Text layer.** The pipeline gives you the `pdftotext` dump only as a spelling cross-check. It drops numbers and formulas in Word exports and is OCR noise for scans; set `tx.textLayerTrustworthy` accordingly and never copy from it.
15. **Old scans.** Expect no text layer, skew, faded typewriter Cyrillic. When a passage is unreadable at the given resolution, mark `[нечетливо: …]`, explain in `tx.notes`, and set `tx.caveat` so the page can warn the reader. Do not guess.

## Calibrated example (abbreviated)

Printed: „**Задача 2.** (10 т.) На фигура 1 е представена графично зависимостта на тока от напрежението за два проводника. а) Кой от тях има по-голямо съпротивление? Обосновете отговора си. (7 т.) б) Ако токът, който тече през проводник №1 е 1mA, определете заряда, който преминава през сечението на проводника за 1 минута. (3 т.)“ — with a graph mid-page at roughly x 495–815, y 530–790 of the 160-dpi image of page 2; the solution (page 2 of the solutions file) ends „За вярна числена стойност q=0,06 A [1 т.]“.

```json
{ "id": "nof-2017-i-7-p2", "number": 2, "points": 10, "problemType": "theory",
  "statement": "На фигура 1 е представена графично зависимостта на тока от напрежението за два проводника.",
  "figures": [ { "id": "p2-fig1", "caption": "Фигура 1",
                 "alt": "Графика напрежение–ток с две прави през началото; по-стръмната е означена с 2, по-полегатата — с 1.",
                 "tx": { "document": "problems", "page": 2, "bbox": [487, 522, 823, 798] } } ],
  "parts": [ { "label": "а)", "statement": "Кой от тях има по-голямо съпротивление? Обосновете отговора си.", "points": 7 },
             { "label": "б)", "statement": "Ако токът, който тече през проводник №1 е 1mA, определете заряда, който преминава през сечението на проводника за 1 минута.", "points": 3,
               "answer": { "kind": "numeric", "value": 0.06, "unit": "C", "tolerance": 0.001,
                           "note": "В официалните решения е отпечатано „q=0,06 A“ — единицата е сгрешена в източника." } } ],
  "topics": ["electricity/ohms-law", "electricity/current"], "difficulty": "Easy", "importance": 2,
  "solution": { "statement": "…\n\nЗа вярна числена стойност $q = 0{,}06\\ A$ **[1 т.]**", "figures": [] },
  "tx": { "sourceSpans": [ { "document": "problems", "page": 2 }, { "document": "solutions", "page": 2 } ] } }
```

Note what the example does: `1mA` stays glued as printed; the source's wrong unit stays in the solution text and is reported in `answer.note` (and in `tx.notes`); the figure is a crop proposal, not a description; the answer's unit is the physically correct one because `answer` is our summary, not the source text.

The paper context (ids, catalogue metadata, page inventory) follows this prompt.
