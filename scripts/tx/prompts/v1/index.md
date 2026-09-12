# Index prompt v1 — inventory of the problems in one competition document

You receive the rendered pages of ONE competition document (the problems of one round/paper, in any language). Do NOT transcribe it. Produce an inventory: what is printed on the masthead, and one entry per problem with its number, title, points, kind and topics, plus a one-line summary. This feeds the archive index (search and facets); a transcription is made separately.

## Output

Exactly one JSON object and nothing else:

```
{ "printedMeta": "<competition, year, round/stage, grade or age group, date, place — exactly as printed on the first page, one line>",
  "language": "<ISO 639-1 of the problem text: bg, en, ru, …>",
  "grade": "<grade or group as printed, e.g. \"9\", \"11-12\", \"Старша възраст\", \"alpha\"; null if none>",
  "problems": [
    { "number": "<as printed: \"1\", \"2\", \"A\", \"1.1\" …>",
      "title": "<printed title of the problem, verbatim; null if the problem has no title>",
      "points": <printed total points of the problem, a number, or null when nothing is printed>,
      "problemType": "theory" | "experiment" | "practical" | "observation" | "data-analysis" | "test" | "mixed",
      "topics": [ "<id from the list below>", … ],   // 1–3 ids, best first; [] if none fits (chemistry, geography, …)
      "figures": <number of drawings/graphs/photos that belong to the problem>,
      "parts": <number of printed sub-questions (а), б), 1., 2. …); 0 if none>,
      "summary": "<what the problem asks, at most 25 words, in the document's own language>" }
  ],
  "totalPoints": <printed total for the paper, or null>,
  "pages": <number of pages you were shown>,
  "notes": "<anything odd: a document that is not a problem set, missing pages, two papers in one file, unreadable scan>" }
```

Topic ids (physics and astronomy; use the closest, at most three):
mechanics/kinematics, mechanics/dynamics, mechanics/energy, mechanics/momentum, mechanics/statics, mechanics/rotation, mechanics/fluids, mechanics/oscillations, mechanics/gravitation, thermodynamics, electricity, magnetism, optics, modern-physics, astronomy/sky, astronomy/time, astronomy/solar-system, astronomy/orbits, astronomy/stars, astronomy/astrophysics, astronomy/galaxies, astronomy/instruments, astronomy/practical, astronomy/history

## Rules

1. One entry per top-level problem as the paper numbers them; printed sub-numbers (1.1, а), i)) are parts, not problems. A multiple-choice test of N questions is ONE problem of type `test` with `parts: N`.
2. `points` and `title` come from the page; never estimate points. If the document contains solutions rather than problems, or answer sheets only, say so in `notes` and still list what problems it refers to.
3. Keep summaries factual and short; no LaTeX needed.
4. If a page is unreadable, say so in `notes`; do not invent problems.

The document context follows this prompt.
