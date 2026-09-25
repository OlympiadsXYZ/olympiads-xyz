#!/usr/bin/env node
// Where each figure belongs in the text, from where it is printed in the source PDF.
//
//   node scripts/figure-anchors.mjs [--paper <id>] [--limit N] [--concurrency N] [--tx-dir DIR] [--cache-dir DIR] [--root DIR]
//
// Writes content/figure-anchors.json (merged: the papers this run looks at are recomputed, every other entry is kept).
// problems-to-site.mjs used to stack a problem's figures after its statement / part and all solution figures at the
// end of the solution spoiler; the page now places each anchored figure at the paragraph boundary this file names:
//
//   problems.<problemId>.<figure id> = { field, after, row?, method }
//     field   "statement" | "statementAfterParts" | "parts/<k>/statement" | "parts/<k>/statementAfter" | "solution/statement"
//     after   an exact substring of that field; the figure goes at the first paragraph boundary (a blank line outside
//             $$…$$ and ``` fences, or the end of the field) at or after the end of its FIRST occurrence; null = before
//             the field's first paragraph
//     row     shared by figures printed side by side (same page, overlapping vertical ranges, same anchor)
//     method  "position" (the printed position, aligned to the transcription) | "reference" (the first "Figure N" /
//             "рис. N" in the text: a fallback when the position is ambiguous or unreadable)
//
// Method. Each figure carries source = { document, page, pdfRect: [x0, y0, x1, y1] (PDF points, origin top-left, the
// frame pdftotext -tsv uses), dpi }. The PDF's text layer (poppler pdftotext -tsv) of the figure's page and its two
// neighbours becomes one word stream in reading order, without the words printed inside any figure crop and without
// repeated running heads. The figure is a marker in that stream: after the line directly above it in its column (after
// the first line beside it when it is a float set into the text), or before the first line below it when it tops its
// page or column. The stream is aligned with the problem's transcription (unique word trigrams, longest increasing
// chain, extended word by word; LaTeX and markdown reduced to words, NFKC, homoglyphs and hyphenation undone), and the
// marker lands on the transcription's paragraph boundary between the aligned words before and after it; the unaligned
// words on either side decide between several boundaries. A figure is only anchored when that is unambiguous; a
// numbered caption ("Figure 3", "рис. 3") referred to in the text is the fallback. Everything else keeps the page's
// default position (no entry): scanned pages, figures inline in the text, statement figures the page moves into the
// solution, ids used twice in one problem. Content JSON is hash-bound to its receipt: this is an overlay.
//
// Only the TSV text layers are cached (<cache-dir>/<paperId>/<document>.tsv, gitignored); a PDF that is not in the
// transcription cache (<tx-dir>/<paperId>/src) is downloaded from the archive bucket, checked against the paper's
// recorded sha256 (Word files are converted by scripts/tx/office2pdf.ps1 as when they were transcribed), read and
// deleted. The run writes a per-figure report to <cache-dir>/_report.json and prints a summary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPapers } from './lib/problem-data.mjs';
import { misplacedSolutionFigures, figureDocument, paragraphSpans, figureShownInline } from './problems-to-site.mjs';
import { pdftotextBin, R2_PUBLIC } from './tx/lib.mjs';

// ------------------------------------------------------------------ text -> words
const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'π', rho: 'ρ', varrho: 'ρ', sigma: 'σ',
  varsigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'γ', Delta: 'δ', Theta: 'θ', Lambda: 'λ', Xi: 'ξ', Pi: 'π', Sigma: 'σ', Upsilon: 'υ', Phi: 'φ', Psi: 'ψ', Omega: 'ω',
};
// printed as words by TeX: \sin x prints "sin"
const FUNCTION_WORDS = new Set(['sin', 'cos', 'tan', 'tg', 'ctg', 'cot', 'sec', 'csc', 'log', 'lg', 'ln', 'exp', 'lim', 'max', 'min', 'arcsin', 'arccos', 'arctan', 'arctg', 'sinh', 'cosh', 'tanh', 'sh', 'ch', 'th', 'det', 'deg']);
// Latin letters that print like Cyrillic ones: a word with any Cyrillic letter is read in Cyrillic
const HOMOGLYPH = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };
const CYRILLIC = /\p{Script=Cyrillic}/u;
// soft hyphen and the combining stress accents of Russian texts (built from code points: invisible characters in a
// regex literal do not survive editors)
const INVISIBLE = new RegExp(`[${String.fromCharCode(0xad, 0x300, 0x301)}]`, 'g');
const LINE_END_HYPHEN = new RegExp(String.raw`\p{L}[-` + String.fromCharCode(0xad) + ']$', 'u');

// markdown + LaTeX -> plain words (what the PDF prints)
export function plainText(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                     // inline images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                   // links keep their text
    .replace(/<[^>\n]{1,200}>/g, ' ')                          // stray tags
    .replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] ? ` ${GREEK[name]} ` : FUNCTION_WORDS.has(name) ? ` ${name} ` : ' ')
    .replace(/\\./g, ' ');
}
export function wordsOf(text) {
  const s = String(text || '').normalize('NFKC').toLowerCase().replace(INVISIBLE, '').replace(/ё/g, 'е');
  const out = [];
  for (const run of s.match(/[\p{L}\p{N}]+/gu) || []) {
    // letters and digits are separate words on both sides ("r_1" is "r 1", the PDF prints "𝑟1")
    for (let w of run.match(/\p{L}+|\p{N}+/gu)) {
      if (CYRILLIC.test(w)) w = w.replace(/[a-z]/g, c => HOMOGLYPH[c] || c);
      out.push(w);
    }
  }
  return out;
}
export const textWords = md => wordsOf(plainText(md));

// ------------------------------------------------------------------ paragraphs (the renderer's rule)
// The page's own paragraphs (paragraphSpans in problems-to-site.mjs: a blank line outside $$…$$ display math and
// ``` / ~~~ fences, a list item's indented continuation kept), so an anchor names exactly the boundary the page cuts
// at. Returns [{ start, end }] character ranges of the non-blank paragraphs, trimmed to their first and last
// non-blank characters.
export function splitParagraphs(text) {
  const s = String(text || '');
  const out = [];
  for (const span of paragraphSpans(s)) {
    const body = s.slice(span.start, span.end);
    const start = span.start + (body.length - body.trimStart().length), end = span.start + body.trimEnd().length;
    if (end > start) out.push({ start, end });
  }
  return out;
}

// the text an anchor quotes for "after this paragraph": a word-boundary window (at least 6 words / 24 characters where
// the field has them) that ends inside the paragraph and whose FIRST occurrence in the field ends inside the paragraph
// too. Windows ending at the paragraph's end are preferred; a window may start in an earlier paragraph when the
// paragraph alone repeats earlier text ("**A.6 (cont.)**"). Plain prose (no { } < & | or line break, which the page's
// escaping rewrites, no window that starts or ends inside $…$, and no trailing "[3 т.]" points mark, which the page
// strips) is preferred over the literal tail.
export function pickAfter(field, para) {
  const prefix = field.slice(0, para.end);
  const firstEndsInside = sub => { const o = field.indexOf(sub); return o >= 0 && o + sub.length > para.start && o + sub.length <= para.end; };
  const bounds = [];
  const re = /\S+/g; let m;
  while ((m = re.exec(prefix))) bounds.push([m.index, m.index + m[0].length]);
  const firstInPara = bounds.findIndex(b => b[0] >= para.start);
  if (firstInPara < 0) return null;
  const mark = /\s*(\*\*)?\[\s*\d+(?:[.,]\d+)?\s*т\.?\s*\](\*\*)?\s*$/u.exec(prefix.slice(para.start));
  const textEnd = mark && mark.index > 0 ? para.start + mark.index : para.end;
  let lastWord = bounds.length - 1;
  while (lastWord > firstInPara && bounds[lastWord][1] > textEnd) lastWord--;
  const safe = sub => !/[{}<&|\n]/.test(sub) && !/ {2}/.test(sub);
  const spans = [...prefix.matchAll(/\$\$[\s\S]*?\$\$|\$[^$\n]*?\$/g)].map(x => [x.index, x.index + x[0].length]);
  const splitsMath = at => spans.some(([a, b]) => at > a && at < b);
  const minWords = Math.min(6, lastWord + 1);
  let fallback = null;
  for (let end = lastWord; end >= firstInPara && lastWord - end <= 40; end--) {
    if (splitsMath(bounds[end][1])) continue;
    for (let start = end - minWords + 1; start >= 0; start--) {
      if (splitsMath(bounds[start][0])) continue;
      const sub = prefix.slice(bounds[start][0], bounds[end][1]);
      if (sub.length < 24 && start > 0) continue;
      if (!firstEndsInside(sub)) continue;
      if (safe(sub)) return sub;
      if (!fallback) fallback = sub;
      break; // a longer window from the same end only adds characters
    }
  }
  if (fallback) return fallback;
  const tail = prefix.slice(bounds[firstInPara][0]);
  return firstEndsInside(tail) ? tail : null;
}

// ------------------------------------------------------------------ the PDF text layer
// pdftotext -tsv -> { pages: { [page]: { width, height, lines: [{ x0, y0, x1, y1, words: [{ text, x0, y0, x1, y1 }] }] } } }
export function parseTsv(tsv) {
  const pages = {};
  let line = null, page = null;
  for (const row of String(tsv).split(/\r?\n/)) {
    const c = row.split('\t');
    if (c.length < 12 || !/^\d+$/.test(c[0])) continue;
    const level = Number(c[0]), pg = Number(c[1]);
    const x = Number(c[6]), y = Number(c[7]), w = Number(c[8]), h = Number(c[9]);
    if (level === 1) { page = pages[pg] = { width: w, height: h, lines: [] }; line = null; }
    else if (level === 4 && page) page.lines.push(line = { x0: x, y0: y, x1: x + w, y1: y + h, words: [] });
    else if (level === 5 && line) line.words.push({ text: c.slice(11).join('\t'), x0: x, y0: y, x1: x + w, y1: y + h });
  }
  return { pages };
}

const inside = (w, r) => { const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2; return cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]; };
const xOverlap = (a, r) => Math.min(a.x1, r[2]) - Math.max(a.x0, r[0]);
const lineText = l => l.words.map(w => w.text).join(' ');

// running heads and page numbers: lines in the top 15% / bottom 9% of the page that repeat (digits ignored) on
// another page, or carry nothing but a number
function runningHeads(doc) {
  const seen = new Map();
  const band = (p, l) => { const cy = (l.y0 + l.y1) / 2; return cy < p.height * 0.15 || cy > p.height * 0.91; };
  const key = l => wordsOf(lineText(l)).filter(w => !/^\p{N}+$/u.test(w)).join(' ');
  for (const [pg, p] of Object.entries(doc.pages)) for (const l of p.lines) if (band(p, l)) {
    const k = key(l); if (!k) continue;
    if (!seen.has(k)) seen.set(k, new Set()); seen.get(k).add(pg);
  }
  const heads = new Set();
  for (const p of Object.values(doc.pages)) for (const l of p.lines) if (band(p, l)) {
    const k = key(l);
    if (!k || (seen.get(k)?.size ?? 0) >= 2) heads.add(l);
  }
  return heads;
}

// the word stream of pages [page-1, page+1] and the marker (stream index) of each figure on `page`
export function pageStream(doc, page, figsByPage) {
  const heads = doc._heads || (doc._heads = runningHeads(doc));
  const lines = [];
  for (const pg of [page - 1, page, page + 1]) {
    const p = doc.pages[pg];
    if (!p) continue;
    const figs = figsByPage[pg] || [];
    for (const l of p.lines) {
      if (heads.has(l)) continue;
      const words = l.words.filter(w => !figs.some(f => inside(w, f.rect)));
      if (!words.length) continue;
      lines.push({ page: pg, x0: Math.min(...words.map(w => w.x0)), y0: Math.min(...words.map(w => w.y0)), x1: Math.max(...words.map(w => w.x1)), y1: Math.max(...words.map(w => w.y1)), words });
    }
  }
  // words, with hyphenation at line ends undone ("exam-" + "ple")
  const tokens = [], lineFirstToken = [];
  for (let i = 0; i < lines.length; i++) {
    lineFirstToken.push(tokens.length);
    const ws = lines[i].words.map(w => w.text);
    const next = lines[i + 1];
    if (next && LINE_END_HYPHEN.test(ws[ws.length - 1]) && /^\p{Ll}/u.test(next.words[0].text)) {
      ws[ws.length - 1] = ws[ws.length - 1].slice(0, -1) + next.words[0].text;
      next.words = next.words.slice(1);
      if (!next.words.length) next.words = [{ text: '', x0: next.x0, y0: next.y0, x1: next.x1, y1: next.y1 }];
    }
    tokens.push(...wordsOf(ws.join(' ')));
  }
  lineFirstToken.push(tokens.length);
  const pageLines = lines.map((l, i) => ({ l, i })).filter(x => x.l.page === page);
  return { tokens, lines, lineFirstToken, pageLines };
}

// where a figure sits in the stream: after the lowest line above it in its column (after the first line beside it
// when it is a float in a single column), else before the highest line below it, else before the first line of the
// page below its top (a figure alone in its column)
export function markerOf(stream, rect) {
  const { pageLines, lineFirstToken } = stream;
  const overlapping = pageLines.filter(({ l }) => xOverlap(l, rect) > Math.min(8, (rect[2] - rect[0]) / 4));
  // pieces of one printed line (a caption split around its math) count as one line: the last of them in reading
  // order above the figure, the first of them below it
  const same = (a, b) => Math.abs(a - b) <= 3;
  const aboveAll = overlapping.filter(({ l }) => (l.y0 + l.y1) / 2 < rect[1]);
  const top = Math.max(...aboveAll.map(({ l }) => l.y1));
  const above = aboveAll.filter(({ l }) => same(l.y1, top)).sort((a, b) => b.i - a.i)[0];
  if (above) {
    // a float: text runs beside the figure and the line above spans that text too (one column, the figure set into
    // it). The figure belongs with the text it is printed next to: after the first line beside its top.
    const besideAll = pageLines.filter(({ l }) => { const cy = (l.y0 + l.y1) / 2; return cy > rect[1] && cy < rect[3] && xOverlap(l, rect) <= 0; });
    const extent = list => ({ x0: Math.min(...list.map(({ l }) => l.x0)), x1: Math.max(...list.map(({ l }) => l.x1)), words: list.reduce((n, { l }) => n + l.words.length, 0) });
    const first = Math.min(...besideAll.map(({ l }) => l.y0));
    const besideRow = besideAll.filter(({ l }) => same(l.y0, first));
    if (besideRow.length) {
      // one printed line above runs across the gap between the text and the figure (in two columns the gutter
      // splits every line there)
      const b = extent(besideRow);
      const gap = b.x0 >= rect[2] ? [rect[2], b.x0] : [b.x1, rect[0]];
      const spans = pageLines.some(({ l }) => same(l.y1, top) && l.x0 <= gap[0] + 2 && l.x1 >= gap[1] - 2);
      const beside = besideRow.sort((x, y) => y.i - x.i)[0];
      if (b.words >= 3 && spans) return { token: lineFirstToken[beside.i + 1], how: 'beside-line' };
    }
    return { token: lineFirstToken[above.i + 1], how: 'below-line' };
  }
  const belowAll = overlapping.filter(({ l }) => (l.y0 + l.y1) / 2 > rect[3]);
  const bottom = Math.min(...belowAll.map(({ l }) => l.y0));
  const below = belowAll.filter(({ l }) => same(l.y0, bottom)).sort((a, b) => a.i - b.i)[0];
  if (below) return { token: lineFirstToken[below.i], how: 'above-line' };
  const after = pageLines.find(({ l }) => l.y0 >= rect[1]);
  if (after) return { token: lineFirstToken[after.i], how: 'page-order' };
  if (pageLines.length) return { token: lineFirstToken[pageLines[pageLines.length - 1].i + 1], how: 'page-end' };
  return null;
}

// ------------------------------------------------------------------ alignment
// A[i] = the transcription word PDF word i is, or -1. Unique trigrams in both streams, their longest chain increasing
// in both, extended word by word; runs shorter than 5 words survive only next to another run with a similar offset.
export function alignWords(P, T, k = 3) {
  const A = new Int32Array(P.length).fill(-1);
  if (P.length < k || T.length < k) return A;
  const grams = arr => {
    const m = new Map();
    for (let i = 0; i + k <= arr.length; i++) { const g = arr.slice(i, i + k).join('\u0001'); m.set(g, m.has(g) ? -1 : i); }
    return m;
  };
  const gp = grams(P), gt = grams(T);
  const pairs = [];
  for (const [g, i] of gp) { if (i < 0) continue; const j = gt.get(g); if (j != null && j >= 0) pairs.push([i, j]); }
  pairs.sort((a, b) => a[0] - b[0]);
  // longest increasing subsequence of j
  const tails = [], tailIdx = [], prev = new Int32Array(pairs.length).fill(-1);
  pairs.forEach(([, j], idx) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < j) lo = mid + 1; else hi = mid; }
    tails[lo] = j; tailIdx[lo] = idx; prev[idx] = lo ? tailIdx[lo - 1] : -1;
  });
  const chain = [];
  for (let idx = tails.length ? tailIdx[tails.length - 1] : -1; idx >= 0; idx = prev[idx]) chain.push(pairs[idx]);
  chain.reverse();
  let lastI = -1, lastJ = -1;
  for (const [i, j] of chain) {
    if (i <= lastI || j <= lastJ) continue;
    let bi = i - 1, bj = j - 1;
    while (bi > lastI && bj > lastJ && P[bi] === T[bj]) { A[bi] = bj; bi--; bj--; }
    let q = 0;
    while (i + q < P.length && j + q < T.length && (q < k || P[i + q] === T[j + q])) { A[i + q] = j + q; q++; }
    lastI = i + q - 1; lastJ = j + q - 1;
  }
  // runs
  const runs = [];
  for (let i = 0; i < P.length; i++) {
    if (A[i] < 0) continue;
    const r = runs[runs.length - 1];
    if (r && r.end === i - 1 && A[i] === A[i - 1] + 1) r.end = i; else runs.push({ start: i, end: i });
  }
  const keep = runs.map((r, n) => {
    if (r.end - r.start + 1 >= 5) return true;
    const off = A[r.start] - r.start;
    return [runs[n - 1], runs[n + 1]].some(o => o && Math.min(Math.abs(o.start - r.end), Math.abs(r.start - o.end)) <= 30
      && Math.abs((A[o.start] - o.start) - off) <= 30 && o.end - o.start + 1 >= 3);
  });
  runs.forEach((r, n) => { if (!keep[n]) for (let i = r.start; i <= r.end; i++) A[i] = -1; });
  return A;
}

// ------------------------------------------------------------------ the transcription side
const STATEMENT_FIELDS = problem => [
  ['statement', problem.statement],
  ...(problem.parts || []).flatMap((p, k) => [[`parts/${k}/statement`, p.statement], [`parts/${k}/statementAfter`, p.statementAfter]]),
  ['statementAfterParts', problem.statementAfterParts],
];
const SOLUTION_FIELDS = problem => [['solution/statement', problem.solution?.statement]];

// paragraphs of the fields in page order, with their word ranges in the joined word stream
export function transcriptStream(fields) {
  const paras = [], tokens = [];
  for (const [field, text] of fields) {
    if (typeof text !== 'string' || !text.trim()) continue;
    for (const r of splitParagraphs(text)) {
      const ws = textWords(text.slice(r.start, r.end));
      paras.push({ field, text, start: r.start, end: r.end, tokStart: tokens.length, tokEnd: tokens.length + ws.length });
      tokens.push(...ws);
    }
  }
  return { paras, tokens };
}

// ------------------------------------------------------------------ where the marker lands
const GAP = 80;
// candidate boundaries: -1 = before the first paragraph, n = after paragraph n. Paragraphs without words share their
// predecessor's boundary; the first of them is the candidate (the figure follows the text it was printed under).
function candidates(paras) {
  const out = [{ idx: -1, pos: 0 }];
  for (let n = 0; n < paras.length; n++) {
    const pos = paras[n].tokEnd;
    if (out[out.length - 1].pos === pos && n > 0 && paras[n].tokStart === paras[n].tokEnd) continue;
    if (out[out.length - 1].pos === pos) out[out.length - 1] = { idx: n, pos };
    else out.push({ idx: n, pos });
  }
  return out;
}
const paraOf = (paras, t) => paras.findIndex(p => t >= p.tokStart && t < p.tokEnd);

// A: PDF word -> transcription word (alignWords); marker: the PDF word index the figure is printed before; ts: the
// transcription stream; P: the PDF words. The figure sits between the last aligned word before the marker (tb) and the
// first one after it (ta). The PDF words between them that did not align (the gaps) are what decides which of the
// paragraph boundaries in between is the figure's: a transcription span that is printed in the gap before the marker
// lies before the figure, one printed in the gap after it lies after. Page furniture in a gap (titles, "Problem 4",
// points, headers) matches no span and moves nothing.
export function locate(A, marker, ts, P) {
  const r = locateIn(A, marker, ts, P);
  if (r.fail) delete r.pick;
  return r;
}
// Numbers, single letters and points marks ("2 т.", "[3 p]", compound labels А, Б, В) repeat all over a marking
// scheme: they tell nothing about which side of a figure a paragraph is printed on, so they are no evidence either way
// (a gap full of "2 т" made every "А → Б: 2 т." paragraph look printed before the figure: noh-2019-ii-10-12 p4).
const POINT_WORDS = new Set(['т', 'точка', 'точки', 'точк', 'p', 'pt', 'pts', 'points', 'point', 'б', 'бал', 'балл', 'балла', 'баллов']);
export const noiseWord = w => /^\p{N}+$/u.test(w) || [...w].length === 1 || POINT_WORDS.has(w);
const bagOf = words => { const m = new Map(); for (const w of words) if (!noiseWord(w)) m.set(w, (m.get(w) || 0) + 1); return m; };
// share of the words T[from, to) found in the bag (consumed from a copy); an empty span counts as found, a span of
// nothing but noise words as not found (it cannot be placed on either side)
export function inGap(T, from, to, bag) {
  if (to <= from) return 1;
  const left = new Map(bag);
  let hit = 0, words = 0;
  for (let t = from; t < to; t++) {
    if (noiseWord(T[t])) continue;
    words++;
    const n = left.get(T[t]) || 0;
    if (n > 0) { hit++; left.set(T[t], n - 1); }
  }
  return words ? hit / words : 0;
}
const IN_GAP = 0.6;
const SHORT_TAIL = 12;
// with aligned text on one side only, the figure must sit right against it: at most NEAR unaligned PDF words between
// the figure and that text
const NEAR = 5;
function locateIn(A, marker, ts, P) {
  const { paras, tokens: T } = ts;
  let ib = marker - 1; while (ib >= 0 && A[ib] < 0) ib--;
  let ia = marker; while (ia < A.length && A[ia] < 0) ia++;
  let hasB = ib >= 0 && marker - 1 - ib <= GAP, hasA = ia < A.length && ia - marker <= GAP;
  const tb = hasB ? A[ib] : null, ta = hasA ? A[ia] : null, gb = marker - 1 - ib, ga = ia - marker;
  // nothing of the field is printed above the figure and the first aligned word below it is the field's first word:
  // the figure is printed before the whole field (a solution sheet that reprints the statement, then the solution)
  if (ib < 0 && ia < A.length && A[ia] === 0) return { pick: [{ idx: -1 }], how: 'before-first' };
  if (!hasB && !hasA) return { fail: 'no-aligned-text' };
  if (!hasB && ga > NEAR) return { fail: 'after-only-far' };
  if (!hasA && gb > NEAR) return { fail: 'before-only-far' };
  if (hasB && hasA) {
    if (ta <= tb) {
      if (gb <= 1 && ga > 5) hasA = false; else if (ga <= 1 && gb > 5) hasB = false; else return { fail: 'order' };
    } else if (ta - tb - 1 > 2 * (gb + ga) + 25) {
      if (gb <= 2) hasA = false; else if (ga <= 2) hasB = false; else return { fail: 'gap' };
    }
  }
  const cands = candidates(paras);
  const bagB = hasB ? bagOf(P.slice(ib + 1, marker)) : null, bagA = hasA ? bagOf(P.slice(marker, ia)) : null;
  if (hasB && hasA) {
    const between = cands.filter(c => c.pos > tb && c.pos <= ta);
    if (!between.length) { const n = paraOf(paras, tb); return n < 0 ? { fail: 'para' } : { pick: [{ idx: n }], how: 'mid-paragraph' }; }
    if (between.length === 1) return { pick: between, how: 'between' };
    // every boundary splits the unaligned words (tb, ta) in two; the right one puts the words printed before the
    // figure before it and the words printed after it after it
    const score = c => inGap(T, tb + 1, c.pos, bagB) * (c.pos - tb - 1) + inGap(T, c.pos, ta, bagA) * (ta - c.pos);
    const scored = between.map(c => ({ ...c, score: score(c) })).sort((x, y) => y.score - x.score);
    if (scored[0].score - scored[1].score >= 2) return { pick: [scored[0]], how: 'between-ranked' };
    const tied = scored.filter(c => scored[0].score - c.score < 2).sort((x, y) => x.pos - y.pos);
    // words the gaps do not explain (an equation number, a points mark the PDF prints elsewhere): the figure follows
    // the line directly above it when that line is aligned text, else precedes the aligned line below it
    if (gb <= 3 && gb <= ga) return { pick: [tied[0]], how: 'between-line-above' };
    if (ga <= 3) return { pick: [tied[tied.length - 1]], how: 'between-line-below' };
    return { tied, fail: 'ambiguous' };
  }
  if (hasB) {
    // the paragraph of the line above the figure, then every following paragraph that is printed before the figure
    const after = cands.filter(c => c.pos > tb);
    if (!after.length) return { fail: 'para' };
    let k = 0;
    // the rest of the paragraph of the line above is not printed before the figure: a figure printed inside a long
    // paragraph whose continuation did not align is not placed (a short tail, a points mark or a formula, is)
    if (after[0].pos - tb - 1 > SHORT_TAIL && inGap(T, tb + 1, after[0].pos, bagB) < IN_GAP && gb > 5) return { fail: 'before-only-mid' };
    while (k + 1 < after.length && after[k + 1].pos > after[k].pos && inGap(T, after[k].pos, after[k + 1].pos, bagB) >= IN_GAP
      && inGap(T, tb + 1, after[k + 1].pos, bagB) >= IN_GAP) k++;
    return { pick: [after[k]], how: 'before-only' };
  }
  // the paragraph the first line below the figure belongs to, preceded by every paragraph printed after the figure
  const before = cands.filter(c => c.pos <= ta);
  let k = before.length - 1;
  if (ta - before[k].pos > SHORT_TAIL && inGap(T, before[k].pos, ta, bagA) < IN_GAP) return { fail: 'after-only-mid' };
  while (k > 0 && inGap(T, before[k - 1].pos, before[k].pos, bagA) >= IN_GAP && inGap(T, before[k - 1].pos, ta, bagA) >= IN_GAP) k--;
  return { pick: [before[k]], how: 'after-only' };
}

// "Figure 3" / "Fig. 3" / "рис. 3" / "Рисунок 3" / "Фиг. 3" in a caption, and the paragraphs that refer to it
const FIG_NUMBER = /^\s*\**\s*(?:fig(?:ure)?\.?|рис(?:унок|\.)?|фиг(?:ура|\.)?)\s*(?:№\s*)?(\d+)(?![\d.,]\d)/iu;
export function captionNumber(caption) { const m = FIG_NUMBER.exec(String(caption || '')); return m ? m[1] : null; }
export function referringParagraph(paras, num) {
  const re = new RegExp(`(?:fig(?:ure|s|ures)?\\.?|рис(?:унок|унка|унке|унку|унках|унки|\\.)?|фиг(?:ура|урата|ури|\\.)?)\\s*(?:№\\s*)?(?:\\d+\\s*(?:,|и|and|&)\\s*)*${num}(?![\\d])`, 'iu');
  return paras.findIndex(p => re.test(p.text.slice(p.start, p.end)));
}

// what the marker saw: the PDF words around it and the transcription words they aligned to (the report's debug trail)
function traceOf(A, marker, stream, ts) {
  const m = marker.token, P = stream.tokens;
  let ib = m - 1; while (ib >= 0 && A[ib] < 0) ib--;
  let ia = m; while (ia < A.length && A[ia] < 0) ia++;
  return {
    marker: marker.how, pdfBefore: P.slice(Math.max(0, m - 8), m).join(' '), pdfAfter: P.slice(m, m + 8).join(' '),
    tb: ib >= 0 ? A[ib] : null, gb: m - 1 - ib, ta: ia < A.length ? A[ia] : null, ga: ia - m,
    txBefore: ib >= 0 ? ts.tokens.slice(Math.max(0, A[ib] - 5), A[ib] + 1).join(' ') : null,
    txAfter: ia < A.length ? ts.tokens.slice(A[ia], A[ia] + 6).join(' ') : null,
  };
}
function anchorFor(ts, pick) {
  const { paras } = ts;
  if (pick.idx < 0) return { field: paras[0].field, after: null };
  const p = paras[pick.idx];
  const after = pickAfter(p.text, p);
  return after == null ? null : { field: p.field, after };
}

// ------------------------------------------------------------------ one paper
const figRect = f => f?.source?.pdfRect && Number.isInteger(f.source.page) ? f.source.pdfRect : null;
function allFiguresOf(problem) {
  return [
    ...(problem.figures || []).map(fig => ({ fig, side: 'statement' })),
    ...(problem.parts || []).flatMap(part => (part.figures || []).map(fig => ({ fig, side: 'statement' }))),
    ...(problem.solution?.figures || []).map(fig => ({ fig, side: 'solution' })),
  ];
}
// the document a figure was cropped from: its source.document; a legacy solution figure without one comes from the
// paper's separate solutions PDF when it has one (else from the combined PDF, which is tried second)
export function documentsFor(paper, fig, side) {
  if (fig?.source?.document || fig?.tx?.document) return [figureDocument(fig)];
  const separate = paper?.solutionSource?.archiveKey && paper.solutionSource.archiveKey !== paper?.source?.archiveKey;
  return side === 'solution' && separate ? ['solutions', 'problems'] : ['problems'];
}
// the figures on which no text-layer judgement is possible get a reason instead of an anchor
const WORDS_ON_TEXT_PAGE = 25;

// docs: { problems?: parsedTsv, solutions?: parsedTsv }. Returns { anchors: { problemId: { figId: entry } }, report: [...] }
export function anchorPaper(data, docs) {
  const { paper } = data;
  const anchors = {}, report = [];
  // every figure crop of the paper, per document and page: their words are not text
  const cropRects = {};
  for (const problem of data.problems) for (const { fig, side } of allFiguresOf(problem)) {
    const r = figRect(fig); if (!r) continue;
    const d = documentsFor(paper, fig, side)[0], pg = fig.source.page;
    ((cropRects[d] ||= {})[pg] ||= []).push({ rect: r, caption: fig.caption });
  }
  const streams = {};
  for (const problem of data.problems) {
    const texts = [...STATEMENT_FIELDS(problem), ...SOLUTION_FIELDS(problem)].map(x => x[1]).filter(Boolean).join('\n');
    const misplaced = new Set(misplacedSolutionFigures(paper, problem).map(m => m.fig));
    const tsBySide = { statement: transcriptStream(STATEMENT_FIELDS(problem)), solution: transcriptStream(SOLUTION_FIELDS(problem)) };
    const placed = [];
    for (const { fig, side } of allFiguresOf(problem)) {
      const candidatesDocs = documentsFor(paper, fig, side);
      const base = { problemId: problem.id, figId: fig.id, lang: paper.lang, document: candidatesDocs[0], side };
      const done = (reason, extra = {}) => report.push({ ...base, reason, ...extra });
      if (figureShownInline(fig, texts)) { done('inline'); continue; }
      // the statement figure repeated in the solution under the same id (esf-2014, psf-2019): an entry could not say which
      if (allFiguresOf(problem).filter(x => x.fig.id === fig.id).length > 1) { done('duplicate-id'); continue; }
      if (misplaced.has(fig)) { done('moved-to-solution'); continue; }
      const rect = figRect(fig);
      if (!rect) { done('no-source-rect'); continue; }
      const ts = tsBySide[side];
      if (!ts.paras.length) { done('no-text-field'); continue; }
      const page = fig.source.page;
      // the printed position, in the figure's document (a legacy solution figure: the first document that aligns)
      let found = null;
      for (const doc of candidatesDocs) {
        const layer = docs[doc];
        if (!layer) { found ||= { doc, fail: docs[`${doc}:reason`] || 'no-pdf' }; continue; }
        const pageLayer = layer.pages[page];
        const pageWords = pageLayer ? pageLayer.lines.reduce((n, l) => n + l.words.length, 0) : 0;
        if (pageWords < WORDS_ON_TEXT_PAGE) { found ||= { doc, fail: 'no-text-layer' }; continue; }
        const key = `${doc}:${page}`;
        const stream = streams[key] || (streams[key] = pageStream(layer, page, cropRects[doc] || {}));
        const alignKey = `${problem.id}:${side}:${key}`;
        const A = streams[alignKey] || (streams[alignKey] = alignWords(stream.tokens, ts.tokens));
        const marker = markerOf(stream, rect);
        const res = marker ? locate(A, marker.token, ts, stream.tokens) : { fail: 'no-marker' };
        const attempt = { doc, res, trace: marker ? traceOf(A, marker, stream, ts) : null, textLayer: true, marker: marker?.token ?? null };
        if (res.pick || !found || !found.textLayer || found.res?.fail === 'no-aligned-text') found = attempt;
        if (res.pick) break;
      }
      base.document = found.doc;
      if (!found.textLayer) { done(found.fail); continue; }
      let { res } = found;
      const { trace } = found;
      let method = 'position';
      const num = captionNumber(fig.caption);
      const refIdx = num ? referringParagraph(ts.paras, num) : -1;
      if (res.fail === 'ambiguous' && refIdx >= 0) {
        const hit = res.tied.find(c => c.idx === refIdx);
        if (hit) { res = { pick: [hit], how: 'tie-break' }; method = 'reference'; }
      }
      if (!res.pick && refIdx >= 0 && res.fail !== 'order') { res = { pick: [{ idx: refIdx }], how: `reference after ${res.fail}` }; method = 'reference'; }
      if (!res.pick) { done(res.fail, { trace }); continue; }
      const anchor = anchorFor(ts, res.pick[0]);
      if (!anchor) { done('no-unique-quote'); continue; }
      const entry = { field: anchor.field, after: anchor.after, method };
      placed.push({ fig, entry, page, doc: found.doc, rect });
      done(method, { how: res.how, field: anchor.field, trace });
    }
    // side by side: same page, overlapping vertical ranges, same anchor
    for (const a of placed) {
      if (a.entry.row) continue;
      const mates = placed.filter(b => b !== a && !b.entry.row && b.page === a.page && b.doc === a.doc && b.entry.field === a.entry.field && b.entry.after === a.entry.after
        && Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]) > 0.3 * Math.min(a.rect[3] - a.rect[1], b.rect[3] - b.rect[1]));
      if (mates.length) for (const x of [a, ...mates]) x.entry.row = a.fig.id;
    }
    // Repeated points labels cannot locate three diagrams printed at different heights.
    const clusters = new Map();
    for (const p of placed) {
      if (p.entry.method !== 'position') continue;
      const key = JSON.stringify([p.doc, p.page, p.entry.field, p.entry.after]);
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(p);
    }
    const refused = new Set();
    for (const cluster of clusters.values()) {
      if (new Set(cluster.map(p => p.entry.row || p.fig.id)).size < 3) continue;
      for (const p of cluster) {
        refused.add(p);
        const item = report.find(r => r.problemId === problem.id && r.figId === p.fig.id);
        if (item) item.reason = 'collapsed-position';
      }
    }
    const confident = placed.filter(p => !refused.has(p));
    if (confident.length) {
      anchors[problem.id] = {};
      for (const { fig, entry } of confident) anchors[problem.id][fig.id] = { field: entry.field, after: entry.after, ...(entry.row ? { row: entry.row } : {}), method: entry.method };
    }
  }
  return { anchors, report };
}

// ------------------------------------------------------------------ the contract, checked
// An entry the page could not follow, or would follow to the wrong place: null when it is sound.
const FIELD = /^(statement|statementAfterParts|solution\/statement|parts\/(\d+)\/(statement|statementAfter))$/;
export function fieldText(problem, field) {
  const m = FIELD.exec(field || '');
  if (!m) return undefined;
  if (field === 'statement' || field === 'statementAfterParts') return problem[field];
  if (field === 'solution/statement') return problem.solution?.statement;
  return problem.parts?.[Number(m[2])]?.[m[3]];
}
export function entryError(problem, figId, entry) {
  const same = allFiguresOf(problem).filter(x => x.fig.id === figId);
  if (!same.length) return `no figure ${figId}`;
  if (same.length > 1) return `figure id ${figId} is not unique in the problem`;
  const [found] = same;
  if (!entry || typeof entry !== 'object') return 'not an object';
  const text = fieldText(problem, entry.field);
  if (typeof text !== 'string' || !text.trim()) return `field ${entry.field} is not a text of the problem`;
  if ((found.side === 'solution') !== (entry.field === 'solution/statement')) return `${found.side} figure anchored in ${entry.field}`;
  if (!['position', 'reference'].includes(entry.method)) return `method ${entry.method}`;
  if (entry.row != null && typeof entry.row !== 'string') return 'row is not a string';
  const texts = [...STATEMENT_FIELDS(problem), ...SOLUTION_FIELDS(problem)].map(x => x[1]).filter(Boolean).join('\n');
  if (figureShownInline(found.fig, texts)) return 'figure is inline in the text';
  if (entry.after === null) return null;
  if (typeof entry.after !== 'string' || !entry.after) return 'after is neither null nor text';
  const at = text.indexOf(entry.after);
  if (at < 0) return 'after is not in the field';
  const end = at + entry.after.length;
  if (!splitParagraphs(text).some(p => end > p.start && end <= p.end)) return 'after ends between paragraphs';
  return null;
}

// ------------------------------------------------------------------ sources
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function execFileP(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => err ? reject(new Error(`${cmd} failed: ${(stderr || err.message).slice(0, 300)}`)) : resolve(stdout)));
}
async function download(key, file) {
  const url = `${R2_PUBLIC}/${key.normalize('NFC').split('/').map(encodeURIComponent).join('/')}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      if (attempt >= 3) throw new Error(`download ${key}: ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}
function documentKey(paper, manifest, doc) {
  return manifest?.documents?.[doc]?.key || (doc === 'solutions' ? paper.solutionSource?.archiveKey : paper.source?.archiveKey) || null;
}
// Word files (.doc/.docx/.rtf/.odt) were converted to PDF by Word when they were transcribed (scripts/tx/office2pdf.ps1);
// a conversion's bytes differ from run to run (timestamps) while its layout does not, so for these the recorded
// sha256 cannot be checked and the converted PDF is used as is. Conversions run one at a time (one Word instance).
const OFFICE = /\.(docx?|rtf|odt)$/i;
const OFFICE2PDF = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tx', 'office2pdf.ps1');
let wordQueue = Promise.resolve();
function officeToPdf(input, output) {
  const run = wordQueue.then(() => execFileP('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OFFICE2PDF, '-In', input, '-Out', output]));
  wordQueue = run.catch(() => {});
  return run;
}
// the text layer of one document (cached TSV, or extracted from the transcription cache / a fresh download)
async function textLayer(paper, doc, { txDir, cacheDir, tmpDir }) {
  const dir = path.join(cacheDir, paper.id);
  const tsvFile = path.join(dir, `${doc}.tsv`), metaFile = path.join(dir, `${doc}.json`);
  const want = paper.transcription?.sourceSha256?.[doc] || null;
  const manifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(txDir, paper.id, 'manifest.json'), 'utf8')); } catch { return null; } })();
  const key = documentKey(paper, manifest, doc);
  const office = OFFICE.test(key || '');
  if (fs.existsSync(tsvFile) && fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (!want || meta.sha256 === want || (office && meta.converted)) return { tsv: fs.readFileSync(tsvFile, 'utf8') };
  }
  const temps = [];
  let pdf = null;
  try {
    const cached = manifest?.documents?.[doc]?.file ? path.join(txDir, paper.id, manifest.documents[doc].file) : path.join(txDir, paper.id, 'src', `${doc}.pdf`);
    if (fs.existsSync(cached) && (!want || office || sha256File(cached) === want)) pdf = cached;
    else {
      if (!key) return { reason: 'no-source-key' };
      const file = path.join(tmpDir, `${paper.id}-${doc}${office ? path.extname(key).toLowerCase() : '.pdf'}`);
      temps.push(file);
      try { await download(key, file); } catch (e) { return { reason: 'download-failed', error: e.message }; }
      if (office) {
        pdf = path.join(tmpDir, `${paper.id}-${doc}.pdf`); temps.push(pdf);
        try { await officeToPdf(file, pdf); } catch (e) { return { reason: 'conversion-failed', error: e.message }; }
      } else pdf = file;
    }
    const sha = sha256File(pdf);
    if (want && sha !== want && !office) return { reason: 'source-sha-mismatch' };
    const out = path.join(tmpDir, `${paper.id}-${doc}.tsv`);
    temps.push(out);
    await execFileP(pdftotextBin(), ['-q', '-tsv', pdf, out]);
    const tsv = fs.readFileSync(out, 'utf8');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tsvFile, tsv);
    fs.writeFileSync(metaFile, JSON.stringify({ sha256: sha, ...(office && sha !== want ? { converted: true } : {}), extractedAt: new Date().toISOString() }) + '\n');
    return { tsv };
  } catch (e) {
    return { reason: 'pdftotext-failed', error: e.message };
  } finally {
    for (const f of temps) fs.rmSync(f, { force: true });
  }
}

// ------------------------------------------------------------------ main
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i]; else out[key] = true;
  }
  return out;
}
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}
export const ANCHORS_COMMENT = 'Where each figure belongs in its problem\'s text, computed by scripts/figure-anchors.mjs from where the figure is printed in the source PDF (text layer aligned to the transcription). field + after: the figure goes at the first paragraph boundary (blank line outside $$…$$ and ``` fences, or the end of the field) at or after the end of the first occurrence of "after" in that field; after null = before the field\'s first paragraph. row: figures printed side by side. method: position | reference (first "Figure N" in the text). A figure without an entry keeps its default position. Regenerate with node scripts/figure-anchors.mjs [--paper <id>].';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ROOT = args.root ? path.resolve(args.root) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const txDir = path.resolve(args['tx-dir'] || path.join(ROOT, 'tmp', 'tx'));
  const cacheDir = path.resolve(args['cache-dir'] || path.join(ROOT, 'tmp', 'figure-anchors'));
  const outFile = path.join(ROOT, 'content', 'figure-anchors.json');
  const concurrency = Number(args.concurrency || 8);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'figure-anchors-'));
  let records = readPapers(ROOT).filter(r => r.data.problems.some(p => allFiguresOf(p).length));
  if (args.paper) {
    const ids = new Set(String(args.paper).split(','));
    records = records.filter(r => ids.has(r.data.paper.id));
    if (!records.length) { console.error(`no paper ${args.paper} with figures`); process.exit(1); }
  }
  records.sort((a, b) => a.data.paper.id.localeCompare(b.data.paper.id));
  if (args.limit) records = records.slice(0, Number(args.limit));

  const prior = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { problems: {} };
  const problems = { ...(prior.problems || {}) };
  const report = [];
  let done = 0;
  await pool(records, concurrency, async rec => {
    const { data } = rec;
    const needed = new Set();
    for (const p of data.problems) for (const { fig, side } of allFiguresOf(p)) if (figRect(fig)) for (const d of documentsFor(data.paper, fig, side)) needed.add(d);
    const docs = {};
    for (const doc of needed) {
      const r = await textLayer(data.paper, doc, { txDir, cacheDir, tmpDir });
      if (r.tsv != null) docs[doc] = parseTsv(r.tsv); else { docs[`${doc}:reason`] = r.reason; if (r.error) console.error(`${data.paper.id} ${doc}: ${r.error}`); }
    }
    const res = anchorPaper(data, docs);
    for (const [problemId, figs] of Object.entries(res.anchors)) {
      const problem = data.problems.find(p => p.id === problemId);
      for (const [figId, entry] of Object.entries(figs)) {
        const error = entryError(problem, figId, entry);
        if (error) { console.error(`${problemId} ${figId}: dropped (${error})`); delete figs[figId]; }
      }
      if (!Object.keys(figs).length) delete res.anchors[problemId];
    }
    for (const p of data.problems) delete problems[p.id];
    Object.assign(problems, res.anchors);
    report.push(...res.report.map(x => ({ ...x, paperId: data.paper.id, competition: data.paper.competition })));
    if (++done % 100 === 0) console.error(`${done}/${records.length} papers`);
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const overridesFile = path.join(ROOT, 'content', 'figure-anchor-overrides.json');
  if (fs.existsSync(overridesFile)) {
    const overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
    const all = new Map(readPapers(ROOT).flatMap(r => r.data.problems.map(p => [p.id, p])));
    for (const [id, figs] of Object.entries(overrides.problems || {})) for (const [figId, entry] of Object.entries(figs)) {
      const problem = all.get(id);
      if (!problem) throw new Error('Unknown reviewed problem: ' + id);
      const error = entryError(problem, figId, entry);
      if (error) throw new Error(id + ' ' + figId + ': ' + error);
      (problems[id] ||= {})[figId] = entry;
    }
  }

  const sorted = {};
  for (const id of Object.keys(problems).sort()) sorted[id] = problems[id];
  const out = { _comment: ANCHORS_COMMENT, version: 1, problems: sorted };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, args.paper ? `_report-${String(args.paper).slice(0, 60)}.json` : '_report.json'), JSON.stringify(report, null, 1) + '\n');

  // summary
  const bucket = x => x.reason === 'position' || x.reason === 'reference' ? x.reason : 'unanchored';
  const tally = key => {
    const t = {};
    for (const x of report) { const k = key(x); t[k] ||= { position: 0, reference: 0, unanchored: 0 }; t[k][bucket(x)]++; }
    return t;
  };
  const total = tally(() => 'all').all || { position: 0, reference: 0, unanchored: 0 };
  console.log(`${records.length} papers, ${report.length} figures: position ${total.position}, reference ${total.reference}, unanchored ${total.unanchored}`);
  console.log('by language:'); for (const [k, v] of Object.entries(tally(x => x.lang))) console.log(`  ${k}: position ${v.position}, reference ${v.reference}, unanchored ${v.unanchored}`);
  console.log('by document:'); for (const [k, v] of Object.entries(tally(x => `${x.document} (${x.side} figure)`))) console.log(`  ${k}: position ${v.position}, reference ${v.reference}, unanchored ${v.unanchored}`);
  const reasons = {};
  for (const x of report) if (bucket(x) === 'unanchored') reasons[x.reason] = (reasons[x.reason] || 0) + 1;
  console.log('unanchored because:', Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log(`wrote ${path.relative(ROOT, outFile)} (${Object.keys(sorted).length} problems)`);
}

const invokedAsScript = (() => { try { return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invokedAsScript) main().catch(e => { console.error(e); process.exit(1); });
