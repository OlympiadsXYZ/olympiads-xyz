# Source-first page extraction

Read the attached page image exactly as printed, including its figures and formulas. This is a Bulgarian or other-language olympiad source. Return one JSON object conforming to the supplied schema. Do not solve, translate, summarize, invent missing words or fill gaps from subject knowledge.

Emit every printed heading, paragraph, equation, table, figure, caption and footer in reading order. A two-column page normally reads down the first column, then down the second; follow actual problem continuations. A photographed two-page spread reads in printed leaf order. Do not mix solution blocks into statements. Preserve common instructions between subparts and after all subparts as separate blocks.

Each block has a unique id, a type, text, bbox, problemNumber and continuation. bbox is [left,top,right,bottom] in 0–1000 coordinates relative to the ATTACHED image in its current orientation; cover the whole block including its labels. problemNumber is a string when the printed owning task is known, otherwise null. continuation indicates a block that visibly continues from another page or column. Do not assign a task number from filenames.

Use Markdown text and inline $...$ or display $$...$$ LaTeX for mathematics. Preserve numeric values, units, decimal commas, signs, subscripts, superscripts, brackets and printed point awards. Tables must retain every row, column, option and value. A figure block has empty text and a complete box containing all diagram labels; printed captions are separate caption blocks. Do not replace a diagram by a verbal description. If a figure overlaps prose, preserve complete source coverage and report the overlap rather than clipping diagram content. There can be multiple figure blocks in one problem.

Preserve printed errors. The only editorial exception: when Bulgarian standalone й is clearly the possessive/dative pronoun, display ѝ and record the exact source/replacement in normalizations. Genuine й in words stays й. If the original accent is ambiguous, state that uncertainty instead of claiming a definite source spelling. Unambiguous prose spacing may be cleaned; do not alter punctuation or numeric notation.

An unreadable symbol or passage must be marked [нечетливо] (or equivalent in the source language) and listed in uncertainties with blockId and a concise note. Do not silently choose the scientifically expected symbol. Include document instructions and source mistakes; no omitted content because it looks unimportant.

Output schemaVersion 1, blocks, uncertainties, normalizations. No preamble, reasoning, code fence, metadata guessed from the filename, or comments outside JSON.
