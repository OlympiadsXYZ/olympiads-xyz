# Source-first page extraction, version 2

Read the attached page image exactly as printed, including its figures and formulas. Return one JSON object conforming to the supplied schema. Do not solve, translate, summarize, invent missing words or fill gaps from subject knowledge.

Emit every printed heading, paragraph, equation, table, figure, caption and footer in reading order. A two-column page normally reads down the first column, then down the second; follow actual problem continuations. A photographed two-page spread reads in printed leaf order. Do not mix solution blocks into statements. Preserve common instructions between subparts and after all subparts as separate blocks.

Each block has a unique id, a type, text, bbox, problemNumber and continuation. bbox is [left,top,right,bottom] in 0–1000 coordinates relative to the ATTACHED image in its current orientation. Use positive width and height, covering the whole block including labels. problemNumber is a string when the printed owning task is known, otherwise null. continuation indicates a block that visibly continues from another page or column. Do not assign a task number from filenames.

Use Markdown text and inline $...$ or display $$...$$ LaTeX for mathematics. Preserve numeric values, units, decimal commas, signs, indices, brackets and printed point awards. Distinguish Latin a from Greek alpha, and printed subscript digits from scientifically expected ones. Tables retain every row, column, option and value. Keep each point award outside the formula it scores.

A figure block has empty text and a complete box containing all diagram labels. Printed captions are separate caption blocks. Preserve small handwritten circuit symbols as source figures as well as larger diagrams. Do not replace a drawing with a verbal description. If a figure overlaps prose, preserve complete source coverage and report the overlap rather than clipping diagram content. There can be multiple figure blocks in one problem.

Preserve printed errors. The only editorial spelling exception is a clearly printed Bulgarian standalone possessive/dative pronoun й: display ѝ and record its exact source/replacement. Genuine й in words stays й. If the original accent is ambiguous, record uncertainty instead of claiming a definite source spelling. Unambiguous prose spacing may be cleaned; do not alter punctuation or numeric notation.

The normalizations array records ONLY actual permitted changes. Its source and replacement strings must differ, and the replacement must occur in the named block. Never record unchanged text, a check you performed, a preserved source typo, or ordinary LaTeX conversion as a normalization. Use an empty array when no permitted text change occurred.

Mark an unreadable symbol or passage [нечетливо] (or equivalent in the source language) and list it in uncertainties with blockId and a concise note. Do not silently choose the scientifically expected symbol. Preserve document instructions and source mistakes even when they look unimportant.

Output schemaVersion 1, blocks, uncertainties, normalizations. No preamble, reasoning, code fence, guessed metadata, or comments outside JSON.
