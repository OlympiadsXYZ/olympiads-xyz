#!/usr/bin/env node
// Turn transcribed papers (content/problems/**/<paper>.json) into the two
// artefacts the site already knows how to render:
//   1. solutions/<subject>/<paper-id>/<problem-id>.mdx  — statement, figures,
//      parts and the official solution, rendered by solutionTemplate.tsx
//   2. entries in content/extraProblems.json            — ProblemInfo nodes, so
//      the problems appear in the existing lists and can be pulled into a
//      module with <Problems problems="…" />
//
// Nothing new is rendered: this only produces input for the inherited UI.
//
//   node scripts/problems-to-site.mjs [--check] [--root DIR]
//
// Publication gate (docs/Problems-Decisions-2026-09.md, D-P1): a paper is
// emitted only when content/problem-publication.json holds an entry for its
// exact content hash. Everything the generator writes is listed in
// content/problem-generated.json, so withdrawn/quarantined papers lose their
// pages and index entries on the next run. --check exits 1 on any drift.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { readPapers, readJson, publicationState, atomicWrite, jsonText, sha256, controlledTopics, walkJson } from './lib/problem-data.mjs';
import { classificationSearch, problemMetadataErrors } from './lib/problem-classification.mjs';
import { readArchiveLabels } from './lib/labels.mjs';
import { loadNavigation, roundLabel as navRoundLabel, gradeLabel as navGradeLabel, paperSuffix } from './lib/navigation.mjs';
import { loadTreeModule } from './lib/load-tree.mjs';

const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBLEMS_DIR = path.join(ROOT, 'content', 'problems');
const SOLUTIONS_DIR = path.join(ROOT, 'solutions');
const EXTRA = path.join(ROOT, 'content', 'extraProblems.json');
// the canonical host (SITE_URL in the deploy workflow): its /archive/<science>/* rewrite serves the bucket's PDFs.
// Problem links used the vercel.app alias, so every PDF opened on a second origin. Absolute on purpose:
// getProblemInfo (src/models/problem.ts) refuses a problem url that does not start with http.
const ARCHIVE_BASE = 'https://www.olympiads.xyz/archive';
const check = process.argv.includes('--check');

const SCIENCE_PREFIX = {
  physics: 'Физика/',
  astronomy: 'Астрономия/',
  chemistry: 'Химия/',
  geography: 'География/',
  mathematics: 'Математика/',
  informatics: 'Информатика/',
};

// archive bucket key -> the site URL that proxies it
function archiveUrl(subject, key) {
  const prefix = SCIENCE_PREFIX[subject];
  const rest = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
  return `${ARCHIVE_BASE}/${subject}/${rest.split('/').map(encodeURIComponent).join('/')}`;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && e.name.endsWith('.json') && e.name !== 'schema.json' ? [p] : [];
  });
}

function figureMarkdown(fig) {
  // a caption or alt with a paragraph break inside (a page footer read into the caption: nao-2022-iii-7-8) would leave
  // the <figcaption> JSX tag open across paragraphs; both are one line of text
  const oneLine = t => String(t || '').replace(/\s*\n\s*/g, ' ').trim();
  // inside the JSX <figure>: a bare "<" in a caption ("0°<ℓ<90°", nao-2026-iv-26-pr) is read as a tag and kills the
  // build — the caption goes through mdText (math kept, "<" escaped as in every other prose field); the alt attribute
  // is plain text, so a "<" that would start a tag (a letter follows) becomes the full-width "＜"
  const alt = oneLine(fig.alt || fig.caption || '').replace(/"/g, "'").replace(/<(?=[\p{L}$_])/gu, '＜');
  const cap = fig.caption ? `\n<figcaption>${mdText(oneLine(fig.caption))}</figcaption>` : '';
  // the display width follows the printed width (figureSize); the styles live in src/styles/generalStyles.css
  // (.problem-figure); width/height let the browser reserve the box before the crop loads
  const size = figureSize(fig);
  const attrs = size
    ? ` className="problem-figure problem-figure--sized" style={{'--fig-w': '${size.widthPct}%', '--fig-max': '${size.maxPx}px'}}`
    : ' className="problem-figure"';
  const dims = Number.isInteger(fig.width) && Number.isInteger(fig.height) && fig.width > 0 && fig.height > 0 ? ` width="${fig.width}" height="${fig.height}"` : '';
  return `<figure${attrs}>\n<img src="${fig.url}" alt="${alt}"${dims} loading="lazy" decoding="async" />${cap}\n</figure>`;
}

// A figure is shown at the width it was printed: its printed width (source.pdfRect, points) relative to a printed
// text column (FIGURE_COLUMN_PT) becomes a share of the site's content column, and the crop is never upscaled past
// its natural size (a 300 dpi crop of W px is W / (300/96) CSS px — the printed size on screen). A diagram printed
// small stays small; one printed across the page fills the column.
const FIGURE_COLUMN_PT = 480;
export function figureSize(fig) {
  const rect = fig?.source?.pdfRect;
  const dpi = Number(fig?.source?.dpi ?? fig?.tx?.dpi) || null;
  const px = Number.isFinite(fig?.width) && fig.width > 0 ? fig.width : null;
  const printedPt = Array.isArray(rect) && rect.length === 4 && rect[2] > rect[0] ? rect[2] - rect[0] : px && dpi ? px / dpi * 72 : null;
  const naturalPx = px && dpi ? px / (dpi / 96) : printedPt ? printedPt * 96 / 72 : null;
  if (!printedPt || !naturalPx) return null;
  return { widthPct: Math.min(100, Math.round(printedPt / FIGURE_COLUMN_PT * 1000) / 10), maxPx: Math.max(1, Math.round(naturalPx)) };
}

// Consecutive figures anchored with the same `row` sit side by side (.problem-figure-row stacks them on phones).
function figureGroupLines(items) {
  const out = [];
  for (let i = 0; i < items.length;) {
    let j = i + 1;
    if (items[i].row) while (j < items.length && items[j].row === items[i].row) j++;
    const blocks = items.slice(i, j).map(x => figureMarkdown(x.fig));
    out.push(blocks.length > 1 ? `<div className="problem-figure-row">\n${blocks.join('\n')}\n</div>` : blocks[0], '');
    i = j;
  }
  return out;
}

// Some transcriptions place a figure inline in the text (![…](url)) AND list it
// in figures[]; emitting both rendered the figure twice. Only emit the block
// for figures the surrounding text does not already show.
// `candidates`: the figures the texts' placeholders may name (resolveFigureTarget).
function figuresNotInline(figs, texts, candidates = figs) {
  const joined = texts.filter(Boolean).join('\n');
  return (figs ?? []).filter(f => !figureShownInline(f, joined, candidates ?? []));
}

// A figure re-cropped after transcription is stored as "<crop>-v2.png" while the text may still inline the first
// crop "<crop>.png" (the legacy НОА papers: 428 figures in 208 problems). It is the same picture: the page shows it
// once, inline where the text puts it (figureShownInline), with the newest crop (newestInlineCrops).
const INLINE_IMAGE = /(!\[[^\]]*\]\(\s*<?)([^)\s>]+)/g;
const cropKey = url => String(url ?? '').replace(/[?#].*$/, '').replace(/-v\d+(\.[A-Za-z0-9]+)$/, '$1');
const cropVersion = url => Number(/-v(\d+)\.[A-Za-z0-9]+(?:[?#].*)?$/.exec(String(url ?? ''))?.[1] ?? 1);
const isUrl = target => /^(?:https?:)?\/\//i.test(String(target ?? ''));
// The figure an inline image of the text stands for, among `figs`: a crop URL (any crop version of the figure), or a
// placeholder the transcriber wrote where the figure is printed — the figure id ("p2-sol-fig1"), "#p1-sol-fig2", or
// the id qualified by its problem or paper id ("ipho-2024-experiment-q4-p1-sol-fig1"). null when none matches ("#",
// "figure:solutions-p4-…", an id the problem does not have).
export function resolveFigureTarget(target, figs) {
  target = String(target ?? '').trim();
  const list = (figs || []).filter(f => f?.url);
  if (!target) return null;
  if (isUrl(target)) {
    const key = cropKey(target);
    const same = list.filter(f => cropKey(f.url) === key);
    return same.sort((a, b) => cropVersion(b.url) - cropVersion(a.url))[0] ?? null;
  }
  const id = target.replace(/^#/, '');
  if (!id) return null;
  const exact = list.find(f => f.id === id);
  if (exact) return exact;
  // "<problem or paper id>-<figure id>": the qualifier has at least two words (a bare "p2-fig1" never matches "fig1")
  return list.find(f => f.id && id.endsWith(`-${f.id}`) && id.slice(0, -f.id.length - 1).split('-').length >= 2) ?? null;
}
export function figureShownInline(fig, text, figs = [fig]) {
  if (!fig?.url) return false;
  text = String(text ?? '');
  if (text.includes(fig.url)) return true;
  const key = cropKey(fig.url);
  for (const m of text.matchAll(INLINE_IMAGE)) {
    if (isUrl(m[2]) ? cropKey(m[2]) === key : resolveFigureTarget(m[2], figs) === fig) return true;
  }
  return false;
}
export function newestInlineCrops(text, figs) {
  const newest = new Map();
  for (const f of figs) if (f?.url) {
    const k = cropKey(f.url), cur = newest.get(k);
    if (!cur || cropVersion(f.url) > cropVersion(cur)) newest.set(k, f.url);
  }
  if (!newest.size || text == null) return text;
  return String(text).replace(INLINE_IMAGE, (m, pre, url) => {
    const n = newest.get(cropKey(url));
    return n && cropVersion(n) > cropVersion(url) ? pre + n : m;
  });
}

// ---- figures the text itself places (inline images) ----
// A transcription that puts a figure in its text as markdown (![alt](crop url), or a placeholder naming the figure)
// marks the exact spot the figure is printed. A bare ![](url) renders at the crop's natural pixel width (a 300 dpi crop
// is ~3x its printed size, capped at the column) and several of them on one line stack as full-width blocks. So:
//   - a line that holds nothing but images, each of them one of the problem's figures, becomes that figure's sized
//     <figure> block (figureMarkdown: printed width, reviewed alt, width/height, lazy loading) — several on one line
//     sit side by side in a .problem-figure-row, as printed;
//   - an image inside a line of text (or an indented one) becomes a sized inline <img> (.problem-inline-figure);
//   - a placeholder that names no figure ("#", "figure:…", an id the problem does not have) is dropped: it would be a
//     broken relative <img>;
//   - an image in a table row, or one whose crop is not among the figures, stays markdown (with the newest crop).
// The JSX goes in after mdText (which escapes braces) through private-use tokens.
const IMAGE_MD = /!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g;
const FIG_TOKEN = /(\d+)/g;
const token = i => `${i}`;
const plainWords = t => String(t ?? '').toLowerCase().replace(/[*_`$\\]/g, '').replace(/\s+/g, ' ').trim();
function inlineFigureJsx(fig) {
  const alt = String(fig.alt || fig.caption || '').replace(/\s*\n\s*/g, ' ').trim().replace(/"/g, "'").replace(/<(?=[\p{L}$_])/gu, '＜');
  const size = figureSize(fig);
  const style = size ? ` style={{'--fig-w': '${size.widthPct}%', '--fig-max': '${size.maxPx}px'}}` : '';
  const dims = Number.isInteger(fig.width) && Number.isInteger(fig.height) && fig.width > 0 && fig.height > 0 ? ` width="${fig.width}" height="${fig.height}"` : '';
  return `<img className="problem-inline-figure${size ? ' problem-inline-figure--sized' : ''}" src="${fig.url}" alt="${alt}"${dims} loading="lazy" decoding="async"${style} />`;
}
// text -> { text with tokens, jsx: [] }; `resolve(target)` -> figure or null
export function placeInlineFigures(text, resolve) {
  if (text == null) return { text, jsx: [] };
  const jsx = [];
  const lines = String(text).split('\n');
  const out = [];
  let fence = null, math = false, blankNext = false;
  const whole = plainWords(text);
  for (const line of lines) {
    const inside = !!fence || math;
    let emitted = line;
    if (!inside && line.includes('![')) {
      const images = [...line.matchAll(IMAGE_MD)];
      const bare = images.length && !line.replace(IMAGE_MD, '').trim();
      if (bare && !/^[ \t]/.test(line)) {
        // a line of figures: blocks (a row when printed side by side), plus any image that is not a figure
        const figs = [], keep = [];
        for (const m of images) {
          const fig = resolve(m[2]);
          if (fig) figs.push(fig); else if (isUrl(m[2])) keep.push(m[0]);
        }
        const parts = [];
        if (figs.length) {
          // the text's own caption line ("*Фиг. 1*") already names the figure: no second caption under it
          const blocks = figs.map(f => figureMarkdown(f.caption && whole.includes(plainWords(f.caption)) ? { ...f, caption: null } : f));
          jsx.push(blocks.length > 1 ? `<div className="problem-figure-row">\n${blocks.join('\n')}\n</div>` : blocks[0]);
          parts.push(token(jsx.length - 1));
        }
        if (keep.length) parts.push(keep.join(' '));
        if (!parts.length) { emitted = null; }
        else {
          // a block always opens its own paragraph (also at the start: a part's label is prepended to the text)
          if (!out.length || out[out.length - 1].trim()) out.push('');
          parts.forEach((p, i) => { if (i) out.push(''); out.push(p); });
          blankNext = true;
          emitted = undefined;
        }
      } else if (!/^\s*\|/.test(line)) {
        emitted = line.replace(IMAGE_MD, (m, alt, target) => {
          const fig = resolve(target);
          if (fig) { jsx.push(inlineFigureJsx(fig)); return token(jsx.length - 1); }
          return isUrl(target) ? m : '';
        });
      } else {
        // a table row: markdown stays (JSX in a cell is not safe); a placeholder becomes the figure's crop
        emitted = line.replace(IMAGE_MD, (m, alt, target) => {
          if (isUrl(target)) return m;
          const fig = resolve(target);
          return fig ? `![${alt}](${fig.url})` : '';
        });
      }
    }
    if (emitted !== undefined && emitted !== null) {
      if (blankNext && emitted.trim()) out.push('');
      if (emitted.trim()) blankNext = false;
      out.push(emitted);
    }
    // fences and $$ blocks, as paragraphSpans reads them
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; }
    else if (f) fence = f[1];
    else if ((line.replace(/\\\$/g, '').match(/\$\$/g) || []).length % 2) math = !math;
  }
  return { text: out.join('\n'), jsx };
}
const restoreFigures = (rendered, jsx) => rendered == null ? rendered : String(rendered).replace(FIG_TOKEN, (m, i) => jsx[Number(i)] ?? '');

const problemFigures = problem => [
  ...(problem.figures || []), ...(problem.parts || []).flatMap(p => p.figures || []), ...sectionFigures(problem.sections), ...(problem.solution?.figures || []), ...sectionFigures(problem.solution?.sections),
];

// Solution figures stored in the statement (problem.figures / parts[].figures) would be shown under «Условие», outside
// the solution spoiler — a leaked answer (nao-2000-ii-7-9 p3, spba-2023-ii-11-pract p1, ioaa-2016-theory-qp p12 …).
// Published JSON is hash-bound to its receipts, so the page moves them instead of the data. A statement figure belongs
// to the official solution when
//   'id'       its id (or its crop's file name) is a solution crop: "-sol-" / "sol-fig" (p3-sol-fig1),
//   'document' it was cropped from the solutions document (source.document / tx.document === 'solutions'),
//   'position' the paper is one combined problems+solutions PDF (the SPbA "решения" pattern: no separate solutions
//              document) and the figure lies at or after the first figure of the problem's own solution (same page
//              and a lower or equal top edge, or a later page) — the statement is printed before its solution.
//   'listed'   SOLUTION_FIGURES below names it: a combined-PDF solution drawing whose solution has no figure of its own,
//              so nothing anchors the 'position' rule.
// Solution figures that repeat a statement figure's url are the statement figure reused (esf-2014, psf-2019) and
// never mark where the solution starts.
const SOLUTION_CROP = /-sol-|sol-fig/i;
// problem id -> statement figure ids that are the official solution's drawing. Each one confirmed against the PDF
// (2026-09-22): the crop lies below the printed «Решение:» heading of its own problem in the combined SPbA PDF.
// Content JSON is hash-bound to its receipt, so the page moves them. validate.mjs --manifest finds new cases
// mechanically (figuresBelowSolutionHeading) before they are published.
export const SOLUTION_FIGURES = {
  'spba-2025-ii-5-6-theo-p1': ['p1-fig1'],
  'spba-2025-ii-5-6-theo-p3': ['p3-fig1'],
  'spba-2025-ii-7-8-theo-p4': ['p4-fig1'],
  'spba-2025-ii-10-theo-p3': ['p3-fig1'],
  'spba-2026-ii-9-9theo-p4': ['p4-fig1'],
  'spba-2026-ii-10-10theo-p5': ['p5-fig1'],
};
export function figureDocument(fig) { return fig?.source?.document || fig?.tx?.document || 'problems'; }
function figurePlace(fig) {
  if (Array.isArray(fig?.source?.pdfRect) && Number.isInteger(fig.source.page)) return { doc: figureDocument(fig), page: fig.source.page, scheme: 'pdf', rect: fig.source.pdfRect };
  if (Array.isArray(fig?.tx?.bbox) && Number.isInteger(fig.tx.page)) return { doc: figureDocument(fig), page: fig.tx.page, scheme: 'bbox', rect: fig.tx.bbox };
  return null;
}
const samePlace = (a, b) => !!a && !!b && a.doc === b.doc && a.page === b.page && a.scheme === b.scheme && a.rect.join() === b.rect.join();
const notBefore = (a, b) => a.page > b.page || (a.page === b.page && a.rect[1] >= b.rect[1]);
const BBOX_SCALE = 1000; // tx.bbox units per page side (scripts/tx/lib.mjs)
const cropName = url => String(url || '').split('/').pop();
function statementFigures(problem) {
  return [
    ...(problem.figures || []).map((fig, j) => ({ fig, where: 'statement', path: `figures/${j}` })),
    ...(problem.parts || []).flatMap((part, k) => (part.figures || []).map((fig, j) => ({ fig, where: `part ${part.label ?? k}`, path: `parts/${k}/figures/${j}` }))),
  ];
}
// the solutions are printed in their own document (the 'position' rule and figuresBelowSolutionHeading do not apply)
export function hasSeparateSolutions(paper, problem) {
  return !!((paper?.solutionSource?.archiveKey && paper.solutionSource.archiveKey !== paper?.source?.archiveKey)
    || [...(problem.solution?.figures || []), ...statementFigures(problem).map(x => x.fig)].some(f => figureDocument(f) === 'solutions')
    || (problem.sourceSpans || problem.tx?.sourceSpans || []).some(s => s.document === 'solutions'));
}
export function misplacedSolutionFigures(paper, problem) {
  const inStatement = statementFigures(problem);
  if (!inStatement.length) return [];
  const solutionFigures = problem.solution?.figures || [];
  const statementUrls = new Set(inStatement.map(x => x.fig.url).filter(Boolean));
  const listed = new Set(SOLUTION_FIGURES[problem.id] || []);
  const anchors = hasSeparateSolutions(paper, problem) ? [] : solutionFigures
    .filter(f => !(f.url && statementUrls.has(f.url)))
    .map(figurePlace).filter(p => p && p.doc === 'problems');
  const out = [];
  for (const item of inStatement) {
    const { fig } = item, place = figurePlace(fig);
    const reason = SOLUTION_CROP.test(fig.id || '') || SOLUTION_CROP.test(cropName(fig.url)) ? 'id'
      : figureDocument(fig) === 'solutions' ? 'document'
      : listed.has(fig.id) ? 'listed'
      : place && anchors.some(a => a.scheme === place.scheme && a.doc === place.doc && notBefore(place, a)) ? 'position'
      : null;
    if (reason) out.push({ ...item, reason });
  }
  return out;
}
// A combined problems+solutions PDF prints each solution under a heading ("Решение:", "11.3. Возможное решение.",
// "Solution"). A statement figure lying below its own problem's heading is most likely the solution's drawing — the
// case the 'position' rule cannot see when the solution has no figure of its own (spba-2025-ii-7-8-theo p4). Given
// data sheets are sometimes printed after the solution too (spba-2023-ii-7-8-pract p1), so this only feeds a
// validate.mjs warning, never the page. `layer` is the problems PDF's text layer: { lines: [{ page, top, text }]
// in page/top order, heights: { page: points } } (textLayerLines parses pdftotext -tsv into it).
// a heading starts its line with a capital ("…в начало своего\nрешения." is a wrapped statement word, vserusiyska-2022-regional-7-e2)
const SOLUTION_HEADING = /^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?:(?:Возможное|Примерное|Авторское)\s+решени[ея]|Решени[ея]|РЕШЕНИ[ЕЯ]|Solution|SOLUTION)(?![\p{L}\p{N}])/u;
const letters = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function figuresBelowSolutionHeading(paper, problem, layer) {
  if (!layer?.lines?.length || hasSeparateSolutions(paper, problem)) return [];
  // where the problem starts: the first plain words of its statement (before any math, markup or printed number)
  const plain = String(problem.statement || '').split('$')[0].replace(/^[\s*_#]*(?:\d+\s*[.)]|задача\s*№?\s*\d+[.:]?)?/iu, '');
  const key = letters(plain).slice(0, 20);
  if (key.length < 8) return [];
  let joined = '', owner = [];
  layer.lines.forEach((line, i) => { const t = letters(line.text); joined += t; owner.push(...Array(t.length).fill(i)); });
  const at = joined.indexOf(key);
  if (at < 0) return [];
  const heading = layer.lines.findIndex((line, i) => i > owner[at] && SOLUTION_HEADING.test(line.text));
  if (heading < 0) return [];
  const { page, top } = layer.lines[heading];
  const misplaced = new Set(misplacedSolutionFigures(paper, problem).map(m => m.fig));
  const out = [];
  for (const item of statementFigures(problem)) {
    const place = figurePlace(item.fig);
    if (!place || place.doc !== 'problems' || misplaced.has(item.fig)) continue;
    const figTop = place.scheme === 'pdf' ? place.rect[1] : layer.heights?.[place.page] ? place.rect[1] / BBOX_SCALE * layer.heights[place.page] : null;
    if (figTop == null) continue;
    if (place.page > page || (place.page === page && figTop >= top)) out.push({ ...item, heading: { page, text: layer.lines[heading].text.trim().slice(0, 40) } });
  }
  return out;
}
// pdftotext -tsv output -> the layer figuresBelowSolutionHeading reads (-bbox-layout aborts on some PDFs' metadata:
// poppler 26 throws out_of_range writing <title> for spba-2025-ii-7-8-theo)
export function textLayerLines(tsv) {
  const lines = [], heights = {};
  let line = null;
  for (const row of String(tsv).split('\n')) {
    const c = row.split('\t');
    if (c.length < 12 || !/^\d+$/.test(c[0])) continue;
    const level = Number(c[0]), page = Number(c[1]), top = Number(c[7]);
    if (level === 1) heights[page] = Number(c[9]) || null;
    else if (level === 4) lines.push(line = { page, top, text: '' });
    else if (level === 5 && line) line.text += (line.text ? ' ' : '') + c.slice(11).join('\t');
  }
  const out = lines.filter(l => l.text.trim()).sort((a, b) => a.page - b.page || a.top - b.top);
  return { lines: out, heights };
}
// the moved figures the solution does not already show (same crop url, or the same box on the same page)
function movedSolutionFigures(misplaced, solution, candidates) {
  const shown = [...(solution?.figures || [])];
  const text = solution?.statement || '';
  const out = [];
  for (const { fig } of misplaced) {
    if (figureShownInline(fig, text, candidates ?? [fig])) continue;
    if (shown.some(s => (fig.url && s.url === fig.url) || samePlace(figurePlace(s), figurePlace(fig)))) continue;
    shown.push(fig); out.push(fig);
  }
  return out;
}

// a transcribed "# Part I" / "## Solutions" would compete with the page's "## Условие" / "## Решение" (and enter the
// table of contents): the text's top heading level becomes h3, deeper ones keep their distance
function demoteHeadings(md) {
  const levels = [...String(md).matchAll(/^(#{1,6})[ \t]/gm)].map(m => m[1].length);
  const shift = levels.length ? Math.max(0, 3 - Math.min(...levels)) : 0;
  return shift ? md.replace(/^(#{1,6})(?=[ \t])/gm, h => '#'.repeat(Math.min(6, h.length + shift))) : md;
}
// Placeholders a reader left where a figure is printed: "![alt](p2-sol-fig1)", "![alt](#p1-sol-fig2)",
// "[[figure p2-sol-fig1]]", "[Figure: p1-sol-fig1]". The site read the image ones as relative URLs: 45 broken images on
// 9 pages, the real figure shown elsewhere (rmph-2011-experiment-exp p2, apho-2023-theory-t1). Each now shows its
// figure in place (figuresNotInline then leaves it out of the blocks); one whose figure does not exist keeps only its
// description. A written description of an uncropped figure ("[Фигура: хоризонтална схема…]") is left as it is.
export function resolveFigurePlaceholders(text, problem, resolve = target => resolveFigureTarget(target, problemFigures(problem))) {
  if (!text) return text;
  const image = (alt, fig) => `![${String(alt || fig.alt || fig.caption || '').replace(/\s*\n\s*/g, ' ').replace(/[[\]]/g, '').trim()}](${fig.url})`;
  return String(text)
    .replace(/!\[([^\]\n]*)\]\((?!https?:|\/)([^)\s]*)\)/g, (m, alt, target) => {
      const fig = resolve(target);
      if (fig) return image(alt, fig);
      return alt.trim() ? `*[${alt.trim()}]*` : '';
    })
    .replace(/\[\[figure:?\s*(p\d+(?:-sol)?-fig\d+[a-z]?)\s*\]\]|\[(?:figure|фигура)\s*:\s*(p\d+(?:-sol)?-fig\d+[a-z]?)\s*\]/giu, (m, a, b) => {
      const fig = resolve(a || b);
      return fig ? image('', fig) : m;
    });
}
// ---- figures inside the text (content/figure-anchors.json) ----
// The data lists figures apart from the text; an overlay says where each one is printed:
//   { version: 1, problems: { <problemId>: { <figure id>: { field, after, row?, method } } } }
// field is the text field it is printed in ("statement", "statementAfterParts", "parts/<k>/statement",
// "parts/<k>/statementAfter", "solution/statement"); the figure goes in at the first paragraph break at or after the
// end of the first occurrence of `after` in that field (after: null — before the first paragraph). The data stays
// hash-bound to its receipt; the page only moves figures. A figure keeps today's place when it has no anchor, when
// `after` is not in the field (counted, never fatal), and when the anchor would cross the spoiler: a solution figure
// (own or moved out of the statement by misplacedSolutionFigures) may only be anchored in solution/statement, a
// statement figure never there.
export const FIGURE_ANCHORS_FILE = 'content/figure-anchors.json';
const ANCHOR_FIELD = /^(?:statement|statementAfterParts|solution\/statement|parts\/(\d+)\/(?:statement|statementAfter))$/;
export function readFigureAnchors(root) {
  const file = path.join(root, FIGURE_ANCHORS_FILE);
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data?.version !== 1 || typeof data.problems !== 'object' || !data.problems) throw new Error(`${FIGURE_ANCHORS_FILE}: expected { version: 1, problems: {…} }`);
  return data.problems;
}
export function newFigureStats() { return { anchored: 0, placed: 0, notFound: [], refused: [], unused: [] }; }

// Paragraphs of a text field: blank lines split them, except inside $$…$$ display math and ``` / ~~~ fences; in a
// list, an indented line after a blank line continues the item (its second paragraph). Returns [{ start, end }]
// offsets into the text (end exclusive, the paragraph's last line included). scripts/figure-anchors.mjs computes its
// anchors with this same function, so both sides agree on every boundary.
export function paragraphSpans(text) {
  const spans = [];
  let open = null, gap = false, fence = null, math = false, list = false, pos = 0;
  for (const line of String(text ?? '').split('\n')) {
    const start = pos;
    pos += line.length + 1;
    const inside = !!fence || math;
    if (!inside && /^\s*$/.test(line)) { if (open) gap = true; continue; }
    if (open && gap && list && /^[ \t]/.test(line)) gap = false;
    if (!open || gap) { open = { start, end: start + line.length }; spans.push(open); gap = false; list = false; }
    else open.end = start + line.length;
    if (!inside && /^\s*(?:[-*+]|\d+[.)])\s/.test(line)) list = true;
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; }
    else if (f) fence = f[1];
    else if ((line.replace(/\\\$/g, '').match(/\$\$/g) || []).length % 2) math = !math;
  }
  return spans;
}

// end offset of the first occurrence of `after` (exact; else with runs of whitespace compared as one space)
function afterEnd(text, after) {
  const at = text.indexOf(after);
  if (at >= 0) return at + after.length;
  const needle = after.replace(/\s+/g, ' ').trim();
  if (!needle) return null;
  let flat = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) { if (flat.endsWith(' ')) continue; flat += ' '; } else flat += text[i];
    map.push(i);
  }
  const k = flat.indexOf(needle);
  return k < 0 ? null : map[k + needle.length - 1] + 1;
}

// A paragraph break that falls inside a sentence: the paragraph before it ends in "," ";" or ":" and the one after it
// goes on in lower case, with a sub-item ("а)", "- "), or with the formula the colon announces. A figure is never put
// there (the photo between "at midday time:" and "in winter, in spring…"): it moves to the next break that ends a
// sentence or an enumeration — the text a float figure is printed beside stays together.
const OPEN_SENTENCE = /[,;:]$/;
const GOES_ON = /^(?:\p{Ll}|\$|\**\s*[а-яa-z]\)|[-*+]\s|\d+[.)]\s)/u;
export function splitsSentence(text, before, after) {
  const end = String(text).slice(before.start, before.end).trimEnd().replace(/[*_\s]+$/, '');
  const next = String(text).slice(after.start, after.end).trimStart();
  return OPEN_SENTENCE.test(end) && GOES_ON.test(next);
}
const MAX_SENTENCE_MOVES = 8;

// the paragraph slot a figure goes into: the number of paragraphs of the field printed before it
export function anchorSlot(text, after, reviewed = false) {
  const spans = paragraphSpans(text);
  if (after == null) return 0;
  const end = afterEnd(String(text ?? ''), String(after));
  if (end == null) return null;
  const i = spans.findIndex(s => s.end >= end);
  let slot = i < 0 ? spans.length : i + 1;
  for (let moved = 0; !reviewed && moved < MAX_SENTENCE_MOVES && slot > 0 && slot < spans.length && splitsSentence(text, spans[slot - 1], spans[slot]); moved++) slot++;
  return slot;
}

// Decide where each rendered figure block goes. groups: [{ figs, solution }] in page order (statement figures,
// then each part's, then the solution's). fields: field name -> the text the page prints for it (undefined when
// the field does not exist). Returns { slots: Map<field, [{ fig, slot, row }]>, anchored: Set<fig> }.
function planFigureAnchors(problemId, groups, fields, anchors, stats) {
  const slots = new Map(), anchored = new Set();
  const own = anchors?.[problemId];
  if (!own || typeof own !== 'object') return { slots, anchored };
  const rendered = new Set();
  for (const { figs, solution } of groups) for (const fig of figs) {
    if (!fig.id || rendered.has(fig.id)) continue;
    rendered.add(fig.id);
    const a = own[fig.id];
    if (!a) continue;
    if (stats) stats.anchored++;
    const where = `${problemId} ${fig.id}`;
    const field = typeof a.field === 'string' && ANCHOR_FIELD.test(a.field) ? a.field : null;
    const why = !field ? 'unknown field'
      : a.after != null && typeof a.after !== 'string' ? '"after" is not a string'
      : field === 'solution/statement' && !solution ? 'a statement figure never goes into the solution'
      : field !== 'solution/statement' && solution ? 'a solution figure stays in the solution spoiler'
      : null;
    if (why) { if (stats) stats.refused.push(`${where}: ${a.field ?? '(no field)'} (${why})`); continue; }
    const text = fields[field];
    const slot = text === undefined ? null : anchorSlot(text, a.after, !!a.reviewed);
    if (slot == null) { if (stats) stats.notFound.push(`${where}: ${field}${text === undefined ? ' (no such field)' : ` "${String(a.after).slice(0, 40)}"`}`); continue; }
    if (!slots.has(field)) slots.set(field, []);
    slots.get(field).push({ fig, slot, row: typeof a.row === 'string' && a.row ? a.row : null });
    anchored.add(fig);
    if (stats) stats.placed++;
  }
  if (stats) for (const id of Object.keys(own)) if (!rendered.has(id)) stats.unused.push(`${problemId} ${id}`);
  for (const list of slots.values()) list.sort((a, b) => a.slot - b.slot); // stable: page order within a slot
  return { slots, anchored };
}

// A field's text cut at its figure slots: [{ text }] and [{ figures: lines }] in page order. Cuts fall only on
// paragraph breaks, so $$…$$ and fences are never split; the first and last pieces keep the field's own ends.
function splitAtFigures(text, placed) {
  text = String(text ?? '');
  const spans = paragraphSpans(text);
  const bySlot = new Map();
  for (const p of placed) { if (!bySlot.has(p.slot)) bySlot.set(p.slot, []); bySlot.get(p.slot).push(p); }
  const cuts = [...new Set([0, ...bySlot.keys(), spans.length])].sort((a, b) => a - b);
  const out = [];
  cuts.forEach((slot, i) => {
    if (bySlot.has(slot)) out.push({ figures: figureGroupLines(bySlot.get(slot)) });
    const next = cuts[i + 1];
    if (next != null && next > slot) {
      const from = slot === 0 ? 0 : spans[slot].start, to = next === spans.length ? text.length : spans[next - 1].end;
      out.push({ text: text.slice(from, to) });
    }
  });
  return out;
}

function sourceText(text, problem, resolve = () => null) {
  const placed = placeInlineFigures(newestInlineCrops(resolveFigurePlaceholders(text, problem, resolve), problemFigures(problem)), resolve);
  let rendered = demoteHeadings(mdText(placed.text));
  // Wrappers are generated from exact source passages; raw HTML remains forbidden in content.
  for (const passage of [...(problem.sourceLayout?.underlines || [])].sort((a, b) => b.length - a.length)) {
    const needle = mdText(passage);
    if (needle) rendered = rendered.split(needle).join(`<u>${needle}</u>`);
  }
  return restoreFigures(rendered, placed.jsx);
}

// page furniture read into a note ("1 / 4", "v3", a note that only repeats its title) is not shown; a bracketed
// transcriber label ("[Бележка от източника]") loses its brackets
const plainNote = t => String(t || '').replace(/[*_]/g, '').replace(/[.:]\s*$/, '').trim();
const JUNK_NOTE = /^(?:(?:стр\.?|страница|page|p\.)\s*)?\d{1,3}\s*(?:\/|от|of|из)\s*\d{1,3}$|^-?\s*\d{1,3}\s*-?$|^v\d+(?:\.\d+)*$/i;
// The transcriber's own generic labels are in English ("Note", "Epigraph"); the page shows them in Bulgarian. A heading
// the paper prints ("Instructions (Please Read Carefully)") is not one of these and stays as printed.
const NOTE_TITLES = {
  note: 'Бележка', notes: 'Бележки', 'general note': 'Бележка', 'source note': 'Бележка от източника',
  'source footer': 'Бележка от източника', epigraph: 'Епиграф', authors: 'Автори', authorship: 'Автори',
  instructions: 'Указания', constants: 'Константи', introduction: 'Увод', cover: 'Корица',
};
const noteTitle = t => {
  const title = String(t).replace(/^\[(.+)\]$/, '$1');
  return NOTE_TITLES[title.trim().replace(/[.:]$/, '').toLowerCase()] ?? title;
};
function documentNoteLines(paper, position) {
  return (paper.documentNotes || []).filter(n => n.position === position)
    .filter(n => !JUNK_NOTE.test(plainNote(n.statement)) && plainNote(n.statement) !== plainNote(n.title))
    .flatMap(note => [
      `<details>`, `<summary>${mdText(noteTitle(note.title))}</summary>`, '', mdText(note.statement), '', `</details>`, '',
    ]);
}

// caveat / incompleteReason are the transcriber's notes; one written about the transcription run ("not in this window",
// "supplied source", "per rules") is not shown to visitors (the page has a standard line). A plain English note stays:
// many papers are English.
// A note that only mentions the transcription ("indices restored from context", "not transcribed from an official
// solutions file") is an honest quality remark and stays.
const PIPELINE_NOTE = /\b(?:window|assembl\w*|placeholders?|supplied source|per rules|mid-document)\b|прозор\w*|предоставен\w*|подготвения източник|сдвоен/i;
const visitorNote = t => t && !PIPELINE_NOTE.test(t) ? mdText(t) : null;

// Short Bulgarian names and round labels: the archive's own (src/archive/labels.ts), so a page heading reads
// "ВсОА 1994, Творчески тур" like the archive does, not "VsOA-ru 1994, creative".
const { roundLabels: ROUND_LABELS } = readArchiveLabels();
// The archive's I/II/III labels are the Bulgarian stages ("III кръг (национален)"); elsewhere a Roman round is only a
// number (SPbA, Samara and BelPhO use them too), so it stays as printed.
const BULGARIAN_COMPETITIONS = new Set(['NOF', 'NAO', 'ESF', 'PSF', 'NOH', 'HOOS']);
function archiveRoundLabel(round, competition) {
  if (!round) return null;
  if (/^(?:I|II|III|IV)$/.test(round) && !BULGARIAN_COMPETITIONS.has(competition)) return round;
  return ROUND_LABELS[round] ?? round;
}
// The sidebar's own code (src/problems/tree.ts, transpiled on first use): the page title and the source line use the
// same functions as the sidebar row and the competition node, so the two cannot drift apart.
let treeModule = null;
const tree = () => treeModule || (treeModule = loadTreeModule());
const MONTHS_BG = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

// Names on the page come from the navigation overlays, the same ones the sidebar uses (scripts/lib/navigation.mjs):
// content/round-labels.json (canonical round label, grade names) and content/question-numbers.json (the printed
// question number where the stored one differs). Loaded in main(); empty overlays mean raw round and stored number.
let nav = { labels: {}, numbers: {} };
// "9" -> "9. клас", "9-10 клас" -> "9–10 клас"; group codes get their names (a competition's own ones first)
const gradeLabel = (grade, subject, competition) => navGradeLabel(grade, subject, competition, nav.labels);
// the canonical round label; the raw round only for a paper the overlay does not label (check-navigation.mjs fails)
const pageRound = paper => navRoundLabel(paper, nav.labels) ?? archiveRoundLabel(paper.round, paper.competition) ?? TOUR_LABELS[paper.roundType] ?? null;

function dateBg(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS_BG[Number(m[2]) - 1]} ${m[1]} г.`;
}

// "НОА 2026, II кръг (областен), 9–10 клас" — what the page heading leads with.
function paperDescriptor(paper) {
  return [
    `${tree().competitionShortName(paper.competition)} ${paper.year}`,
    pageRound(paper) || null,
    gradeLabel(paper.grade, paper.subject, paper.competition),
    paperSuffix(paper, nav.labels),
    paperQualifiers.get(paper.id),
  ].filter(Boolean).join(', ');
}

// Papers whose pages would carry the same heading ("IOAA 2015, Теоретичен тур — Задача 2" from the short and the long
// problems, in Bulgarian and in English) get just enough to tell them apart, in this order: the language, the paper's
// own (short) title, and as a last resort its file ("файл 02-III-910.doc", a .doc and a .pdf of the same paper).
// Papers whose problems are all named differently keep the plain descriptor. Filled by qualifyPapers().
let paperQualifiers = new Map();
const TOUR_LABELS = { theory: 'Теоретичен тур', experiment: 'Експериментален тур', practical: 'Практически тур', observation: 'Наблюдателен тур', test: 'Тест' };
const LANGUAGE_NAMES = { bg: 'български', en: 'английски', ru: 'руски', mk: 'македонски', kk: 'казахски', ro: 'румънски', cs: 'чешки', fr: 'френски', sr: 'сръбски' };
const shortTitle = t => {
  const title = String(t || '').replace(/\s+/g, ' ').trim();
  if (!title || title.length > 60) return null;
  // an all-capitals heading ("SHORT PROBLEMS") is shown in sentence case
  return title === title.toUpperCase() && /\p{Lu}{3}/u.test(title) ? title[0] + title.slice(1).toLowerCase() : title;
};
const fileLabel = paper => `файл ${path.basename(paper.source?.archiveKey || paper.id).trim()}`;
const QUALIFIER_STEPS = [paper => LANGUAGE_NAMES[paper.lang] ?? paper.lang ?? null, paper => shortTitle(paper.title), fileLabel];

// records: [{ paper, problems }] of the published papers
export function qualifyPapers(records) {
  const titles = new Map(records.map(({ paper, problems }) => [paper.id, new Set(problems.map(p => problemName(p)))]));
  const collides = group => {
    const seen = new Set();
    for (const paper of group) for (const t of titles.get(paper.id)) { if (seen.has(t)) return true; seen.add(t); }
    return false;
  };
  const byDescriptor = papers => {
    const groups = new Map();
    for (const paper of papers) {
      const key = paperDescriptor(paper);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(paper);
    }
    return [...groups.values()];
  };
  const qualifiers = new Map(records.map(({ paper }) => [paper.id, []]));
  const split = (group, steps) => {
    if (group.length < 2 || !steps.length || !collides(group)) return;
    const values = group.map(steps[0]);
    if (new Set(values).size < 2) return split(group, steps.slice(1));
    const parts = new Map();
    group.forEach((paper, i) => {
      if (values[i]) qualifiers.get(paper.id).push(values[i]);
      if (!parts.has(values[i])) parts.set(values[i], []);
      parts.get(values[i]).push(paper);
    });
    for (const part of parts.values()) split(part, steps.slice(1));
  };
  const saved = paperQualifiers, papers = records.map(r => r.paper);
  paperQualifiers = new Map();
  for (const group of byDescriptor(papers)) split(group, QUALIFIER_STEPS);
  paperQualifiers = new Map([...qualifiers].filter(([, q]) => q.length).map(([id, q]) => [id, q.join(', ')]));
  // a qualified descriptor that happens to equal another paper's ("X 2013, английски") takes the file too
  for (const group of byDescriptor(papers)) {
    if (group.length < 2 || !collides(group)) continue;
    for (const paper of group) paperQualifiers.set(paper.id, [paperQualifiers.get(paper.id), fileLabel(paper)].filter(Boolean).join(', '));
  }
  const result = paperQualifiers;
  paperQualifiers = saved;
  return result;
}

function yamlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// Prose inequalities like "φ<90-|δ|<68º" make MDX try to parse a JSX tag and
// the build fails ("Unexpected character `9` before name"). A `<` directly
// followed by a digit or a minus is escaped as `\<` — but only outside
// $…$ / $$…$$ math, where KaTeX needs the bare character. ("a < b" with a
// space is already plain text to MDX and is left alone.)
// Braces outside math are JSX expressions to MDX: "(23^{h}56^{m})" compiled
// fine and then crashed the static build with "h is not defined". They are
// escaped as \{ \} so the page shows the text as written; validate.mjs rejects
// them upstream so the pipeline puts such LaTeX into $…$ instead.
// named HTML entities crash the Gatsby build ("document is not defined"); already-published papers may carry them
// ("&nbsp;&nbsp;&nbsp;", nof-2024-iii-11-12-exp2) — the page shows the character, the source bytes stay as approved
const HTML_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", deg: '°', times: '×', minus: '−', middot: '·', ndash: '–', mdash: '—', laquo: '«', raquo: '»', hellip: '…', plusmn: '±', micro: 'µ', ohm: 'Ω', Omega: 'Ω', alpha: 'α', beta: 'β', gamma: 'γ', lambda: 'λ', pi: 'π', rho: 'ρ', theta: 'θ', omega: 'ω', bull: '•', frac12: '½', sup2: '²', sup3: '³', le: '≤', ge: '≥', ne: '≠', asymp: '≈', infin: '∞', rarr: '→', larr: '←', prime: '′' };
const decodeEntities = t => String(t).replace(/&(#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]{1,7}));/gi, (m, _a, dec, hex, name) => dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (HTML_ENTITIES[name] ?? m));
// "[2 т.]", "(0,5 т)", "3 точки", "2 points": the number and its unit stay on one line (on a phone 40% of pages with
// point markers broke one as "[2" / "т.]")
const POINTS_SPACE = /(\d)[ \t]+(?=(?:т\.?|точк[аи]|точки|бала?|балла|points?|pts?\.?|marks?)(?![\p{L}\p{N}]))/gu;
function mdText(s) {
  if (s == null) return s;
  if (/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,7});/i.test(s)) s = decodeEntities(s);
  // a "|" inside inline math on a table row splits the cell (eupho-2023-experiment-x: "$|\alpha| = 65^{\circ}$" left
  // "{\circ}" for MDX to parse as an expression); KaTeX draws \vert the same way
  // a "$$" frame around a table ("$$| 2a [mm] |…|$$", eupho-2026-experiment-x) opens an expression MDX never closes;
  // the normaliser strips it from new candidates, the page does the same for the published ones
  // (only a table row — a line that starts with "|" — counts: "\left|\delta\right|$$" closes an equation)
  const framed = String(s).replace(/\$\$[ \t]*\n?[ \t]*(?=\|[^\n]*\|[ \t]*\n[ \t]*\|)/g, '').replace(/(\n[ \t]*\|[^\n]*\|)[ \t]*\n?[ \t]*\$\$(?=[ \t]*(?:\n|$))/g, '$1');
  const tables = framed.split('\n').map(line => /^\s*\|/.test(line) ? line.replace(/\$[^$\n]*?\$/g, m => m.replace(/(?<!\\)\|/g, '\\vert ')) : line).join('\n');
  const parts = tables.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/);
  return emphasisFlanking(parts
    // prose never carries HTML (validate.mjs refuses tags), so any "<" glued to what follows is text: '<', <=, <1
    // (MDX would read <' or <a as the start of a JSX tag and the build would die)
    // inside math: KaTeX in the site pipeline has no \nicefrac and rejects \tag outside a display environment
    // (IPhO 2023 Q1 rendered its numbered equations raw); the printed equation number becomes "\qquad (n)"
    // A lone trailing prose space is invisible; preserve Markdown's two-space breaks and all math.
    .map((seg, i) => (i % 2 ? displayFences(seg, parts[i - 1]).replace(/\\nicefrac\b/g, '\\frac').replace(/\\tag\*?\{([^{}]*)\}/g, '\\qquad ($1)') : seg.replace(/(?<![\\ \t]) (?=\n)/g, '').replace(/<(?=\S)/g, '\\<').replace(/(?<!\\)[{}]/g, m => '\\' + m).replace(POINTS_SPACE, '$1\u00A0')))
    .join(''));
}
// Markdown pairs "*"/"**" only when the marker is flanked right: a closing one after punctuation and before a letter
// ("(*фиг.*3)", "**11.**вода") or an opening one after a letter and before punctuation ("0,5*(0,2;0)*") stays a
// literal asterisk on the page (72 on 25 pages). On a line whose markers of one length pair up in order, a narrow
// no-break space goes on the outside of such a marker ("фиг. 3", "11. вода"), where the print has its space. Math,
// code and escaped "\*" are masked; a line with a run of three or more ("***Б)***", "*****" marks) or an odd count
// of markers of a length ("M*", "δ*min") is left exactly as it is.
const NNBSP = '\u202F';
export function emphasisFlanking(text) {
  if (!text || !String(text).includes('*')) return text;
  const punct = c => c !== undefined && /[\p{P}\p{S}]/u.test(c), space = c => c === undefined || /\s/u.test(c);
  const word = c => !space(c) && !punct(c);
  return String(text).split('\n').map(line => {
    const masked = line.replace(/\$\$[^$]*\$\$|\$[^$\n]*\$|`[^`]*`|\\\*/g, m => '#'.repeat(m.length));
    const runs = [...masked.matchAll(/\*+/g)].filter(m => !(m.index === 0 && /^\*\s/.test(masked))); // a list bullet
    if (runs.some(m => m[0].length > 2)) return line;
    const fixes = [];
    for (const len of [1, 2]) {
      const rs = runs.filter(m => m[0].length === len);
      if (!rs.length || rs.length % 2) continue;
      const found = [];
      const ok = rs.every((m, k) => {
        const before = line[m.index - 1], after = line[m.index + len];
        if (k % 2 === 0) { // opener: left-flanking, or stuck after a letter before punctuation
          if (!space(after) && (!punct(after) || space(before) || punct(before))) return true;
          if (word(before) && punct(after)) return found.push(m.index), true;
        } else { // closer: right-flanking, or stuck after punctuation before a letter
          if (!space(before) && (!punct(before) || space(after) || punct(after))) return true;
          if (punct(before) && word(after)) return found.push(m.index + len), true;
        }
        return false;
      });
      if (ok) fixes.push(...found);
    }
    for (const at of fixes.sort((a, b) => b - a)) line = line.slice(0, at) + NNBSP + line.slice(at);
    return line;
  }).join('\n');
}
// A display block written with its fences glued to the content ("$$\begin{aligned}" … "\end{aligned}$$") is not a
// math block to remark-math: the closing line is not a lone "$$", so the block runs on to the end of its container and
// swallows the rest of the page — inside a <details> note it swallows </details> and the page no longer compiles
// (samara-2021-iii-7-9; esf-2001-esenno-8 and ipho-2022-experiment-exam-q2-english rendered their tail as math).
// A block that starts a line gets its fences on lines of their own.
function displayFences(seg, before) {
  if (!seg.startsWith('$$') || !seg.includes('\n') || !/(^|\n)[ \t]*$/.test(before ?? '')) return seg;
  const inner = seg.slice(2, -2);
  if (/^[ \t]*\n/.test(inner) && /\n[ \t]*$/.test(inner)) return seg;
  return `$$\n${inner.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '')}\n$$`;
}
// A one-line "$$…$$" is display math by the reader conventions, but remark-math reads it as text math: the site set
// 30,291 equations on 3,423 pages as small inline formulas, run into the neighbouring lines when no blank line
// separates them (esf-2001-esenno-8). Only a "$$" fence on a line of its own opens a display block, so a line that
// starts with a one-line "$$…$$" gets its fences on lines of their own, at the line's indentation (a list item keeps
// it). Text printed after the formula on the same line (the points it scores, "**[2 т.]**") follows on the next line.
// Left as they are: a formula after text on its line, a table row, a line whose rest is only punctuation or would
// open a block of its own (a list item, heading, quote, fence, tag or another "$$", whose first line a fence would
// drop as its meta), and every line inside a display block, a code fence or the frontmatter.
const ONE_LINE_DISPLAY = /^([ \t]{0,3})\$\$((?:(?!\$\$)[^\n])+?)\$\$[ \t]*(.*)$/;
const MID_DISPLAY = /^(.*?\S)[ \t]*\$\$((?:(?!\$\$)[^\n])+?)\$\$[ \t]*(.*)$/;
const OPENS_BLOCK = /^(?:[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|[>|<{]|=+[ \t]*$|`{3}|~{3}|\$\$)/;
// Runs after displayMathLines in problemMdx: a single newline between two prose lines
// becomes a Markdown hard break ("  \n") unless the first line is a wrapped sentence (ends in a lowercase letter, comma
// or hyphen and the next line continues in lowercase, not with an "а)" item). Lines that open or belong to other blocks
// (table rows, list items, headings, quotes, fences, JSX tags, "$$" blocks, frontmatter) are left alone.
export function lineBreaks(mdx) {
  const lines = String(mdx).split('\n');
  let frontmatter = lines[0] === '---', code = false, block = false;
  const BLOCK = /^\s*(?:\||[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|>|<|`{3}|~{3}|\$\$|=+\s*$|-{3,}\s*$|\{\/\*)/;
  const prose = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontmatter) { if (i > 0 && line === '---') frontmatter = false; prose.push(false); continue; }
    if (block) { if (/^[ \t]*\$\$[ \t]*$/.test(line)) block = false; prose.push(false); continue; }
    if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(line)) { code = !code; prose.push(false); continue; }
    if (code) { prose.push(false); continue; }
    if (/^[ \t]*\$\$[^$]*$/.test(line)) { block = !/^[ \t]*\$\$.*\$\$[ \t]*$/.test(line); prose.push(false); continue; }
    prose.push(line.trim() !== '' && !BLOCK.test(line));
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!prose[i] || !prose[i + 1]) continue;
    const a = lines[i], b = lines[i + 1];
    if (/(?: {2,}|\\)$/.test(a) || /^· /.test(b)) continue; // the footer's "· официални решения" stays on its line
    const item = /^\s*(?:\*\*|\*)?[\p{L}\d]{1,2}\s?[).](?:\*\*|\*)?\s/u.test(b);
    const wrap = !item && /[\p{Ll},\-–(]$/u.test(a.trimEnd()) && /^\s*[\p{Ll}(]/u.test(b);
    if (wrap) continue;
    lines[i] = a.replace(/[ \t]*$/, '  ');
  }
  return lines.join('\n');
}

export function displayMathLines(mdx) {
  const lines = String(mdx).split('\n'), out = [];
  // block: inside a "$$" fence, which only a "$$" line of its own closes; span: text math that runs on to a later line
  let frontmatter = lines[0] === '---', code = false, block = false, span = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontmatter) { out.push(line); if (i > 0 && line === '---') frontmatter = false; continue; }
    if (block) { if (/^[ \t]*\$\$[ \t]*$/.test(line)) block = false; out.push(line); continue; }
    if (!span && /^[ \t]{0,3}(?:`{3,}|~{3,})/.test(line)) { code = !code; out.push(line); continue; }
    if (code) { out.push(line); continue; }
    // a quoted line ("> $$E_1 = kq/l^2,$$", nof-2020-ii-11-12) is read without its quote marks and every line it
    // becomes gets them back, so the display stays in the quote
    const quote = span ? null : /^((?:[ \t]{0,3}>[ \t]?)+)(.*\$\$.*)$/.exec(line);
    if (quote && quote[2] !== '---' && !((quote[2].match(/(?<!\\)\$\$/g) || []).length % 2)) {
      const inner = displayMathLines(quote[2]);
      if (inner !== quote[2]) { const q = quote[1].replace(/[ \t]*$/, ' '); out.push(...inner.split('\n').map(l => q + l)); continue; }
    }
    const m = span ? null : ONE_LINE_DISPLAY.exec(line);
    // leader dots after a formula ("$$h_2 = … = 1{,}25\ \mathrm{cm}$$ ….."), which ran to a points column the page does
    // not have, go
    if (m && /^(?=.*…|\.{2})[.…]+$/.test(m[3])) m[3] = '';
    // a sentence mark after the formula ("$$m = 0.52$$.") goes inside the display, as typeset
    if (m && /^[.,;:]$/.test(m[3])) { m[2] = `${m[2].trimEnd()}${m[3]}`; m[3] = ''; }
    const rest = m?.[3] ?? '';
    if (m && m[2].trim() && (rest === '' || (!/^[\p{P}\s]*$/u.test(rest) && !OPENS_BLOCK.test(rest)))) {
      // a block drops its lines' trailing space, so a closing control space ("…\sin\alpha.\ ", psf-2002-proletno-sp)
      // would leave a lone "\" that KaTeX refuses; at the end of a display it shows nothing and goes
      const body = m[2].trim().replace(/(?<!\\)((?:\\\\)*)\\$/, '$1');
      out.push(`${m[1]}$$`, `${m[1]}${body}`, `${m[1]}$$`);
      if (rest) lines.splice(i + 1, 0, m[1] + rest); // the rest is a line of its own, read like any other
      continue;
    }
    // text before the formula on its line ("Chain rule $$…$$", "**а)** $$…$$", "- величина $$f = …$$"): the text
    // keeps its line and the formula becomes a block after it, indented under a list item's text so it stays in the
    // item; the rest of the line follows as a line of its own. Not in a table row, heading, quote or tag.
    const mid = span ? null : MID_DISPLAY.exec(line);
    if (mid && /^[.,;:]$/.test(mid[3])) { mid[2] = `${mid[2].trimEnd()}${mid[3]}`; mid[3] = ''; }
    if (mid && !/^[ \t]*[|#>]|^[ \t]*</.test(line) && mid[2].trim() && !/\$\$/.test(mid[1])
      && ((mid[1].replace(/\\\$/g, '').match(/\$/g) || []).length % 2 === 0) && !/\\$/.test(mid[1])
      && (mid[3] === '' || (!/^[\p{P}\s]*$/u.test(mid[3]) && !OPENS_BLOCK.test(mid[3])))) {
      const item = /^([ \t]*)(?:[-+*]|\d{1,9}[.)])([ \t]+|$)/.exec(mid[1]);
      const ind = item ? ' '.repeat(item[0].length + (item[2] ? 0 : 1)) : /^[ \t]{0,3}/.exec(line)[0];
      const body = mid[2].trim().replace(/(?<!\\)((?:\\\\)*)\\$/, '$1');
      out.push(mid[1].trimEnd(), `${ind}$$`, `${ind}${body}`, `${ind}$$`);
      if (mid[3]) lines.splice(i + 1, 0, ind + mid[3]);
      continue;
    }
    if (!span && /^[ \t]{0,3}\$\$[^$]*$/.test(line)) block = true;
    else if ((line.match(/(?<!\\)\$\$/g) || []).length % 2) span = !span;
    out.push(line);
  }
  return out.join('\n');
}

// Frozen routes are the problem base; the actual solution page lives below /solution.
export function problemAliases(problem, routes, allIds = new Set()) {
  const aliases = {};
  const target = routes[problem.id] || `/problems/${problem.id}`;
  for (const alias of problem.aliases || []) {
    if (allIds.has(alias.id) || !problem.sections?.some(s => s.id === alias.sectionId)) throw new Error(`Invalid alias ${alias.id} on ${problem.id}`);
    const to = `${target}/solution#${alias.sectionId}`;
    for (const from of new Set([routes[alias.id], `/problems/${alias.id}`].filter(Boolean))) {
      aliases[from] = to;
      aliases[`${from}/solution`] = to;
    }
  }
  return aliases;
}

// A source section is a semantic unit of one problem, never a second page.
function sectionFigures(sections) {
  return (sections || []).flatMap(s => [...(s.figures || []), ...(s.parts || []).flatMap(p => p.figures || [])]);
}
function sectionTexts(sections) {
  return (sections || []).flatMap(s => [s.statement, s.statementAfterParts, ...(s.parts || []).flatMap(p => [p.statement, p.statementAfter])]);
}
export function sectionLines(sections, problem, resolve, solution = false) {
  const out = [];
  for (const section of sections || []) {
    const anchor = `${solution ? 'solution-' : ''}${section.id}`;
    const points = section.points == null ? '' : ` (${String(section.points).replace('.', ',')} т.)`;
    out.push(`<ProblemSection id="${anchor}">`, '', `### ${mdText(section.title)}${points}`, '');
    if (section.statement) out.push(sourceText(section.statement, problem, resolve), '');
    const texts = sectionTexts([section]);
    const candidates = sectionFigures([section]);
    for (const fig of figuresNotInline(section.figures, texts, candidates)) out.push(figureMarkdown(fig), '');
    for (const part of section.parts || []) {
      const pts = part.points == null ? '' : ` **[${String(part.points).replace('.', ',')} т.]**`;
      const text = sourceText(part.statement, problem, resolve);
      out.push(`**${mdText(part.label)}** ${text}${pts}`, '');
      for (const fig of figuresNotInline(part.figures, texts, candidates)) out.push(figureMarkdown(fig), '');
      if (part.statementAfter) out.push(sourceText(part.statementAfter, problem, resolve), '');
    }
    if (section.statementAfterParts) out.push(sourceText(section.statementAfterParts, problem, resolve), '');
    out.push('</ProblemSection>', '');
  }
  return out;
}

export function problemMdx(paper, problem, state, sourceFile, figureOpts = {}) {
  const lines = [];
  lines.push('---');
  lines.push(`id: ${problem.id}`);
  lines.push(`source: ${yamlStr(paperDescriptor(paper))}`);
  lines.push(`title: ${yamlStr(problemName(problem))}`);
  lines.push(`author: 'Olympiads XYZ · транскрипция на официалните материали'`);
  lines.push(`canonicalSource: ${yamlStr(String(sourceFile).split(path.sep).join('/'))}`); // repo-relative with forward slashes on every OS
  lines.push(`verification: ${yamlStr(state.quality)}`);
  if (state.quality === 'reviewed' && state.verifiedAt) lines.push(`verifiedAt: ${yamlStr(state.verifiedAt)}`);
  // the page must not claim an independent model when the receipt records a same-model check (D-P7, D-P10)
  // a mechanical-only receipt (D-P21: no second model) is named as such, never as an independent model
  if (state.quality === 'reviewed') lines.push(`verifier: ${yamlStr(state.singlePass ? 'single-pass' : state.mechanical ? 'mechanical' : state.cropAudit ? 'crop-audit' : state.independent === false ? 'same-model' : 'independent')}`);
  lines.push('---');
  lines.push('');
  // Lead line: the paper's printed masthead (ground truth), the date and the points.
  // the printed masthead is often several lines (201 papers), some with blank lines that split the italic lead into
  // paragraphs with a literal "*" at each end: one line, escaped like every other prose field
  const masthead = paper.title ? mdText(String(paper.title).split(/\s*\n\s*/).filter(Boolean).join(' · ').replace(/[ \t]{2,}/g, ' ')) : null;
  const lead = [
    masthead,
    paper.held?.from ? dateBg(paper.held.from) : null,
    problem.points != null ? `${String(problem.points).replace('.', ',')}\u00A0т.` : null,
  ].filter(Boolean);
  if (lead.length) lines.push(`*${lead.join(' · ')}*`, '');
  if (visitorNote(paper.caveat)) lines.push('<Warning title="Бележка към темата">', visitorNote(paper.caveat), '</Warning>', '');
  lines.push(...documentNoteLines(paper, 'before-problem'));
  lines.push(`## Условие`);
  lines.push('');
  const partTexts = (problem.parts ?? []).flatMap(p => [p.statement, p.statementAfter]);
  const misplaced = misplacedSolutionFigures(paper, problem);
  const inStatement = fig => !misplaced.some(m => m.fig === fig);
  const sol = problem.solution;
  // the figure blocks the page shows (figures the text already shows inline are not repeated), and where the anchor
  // overlay puts them; an unanchored figure keeps its place: statement figures after the statement, a part's after
  // the part, solution figures (and the ones moved out of the statement) at the end of the solution spoiler
  // the figures a text may show inline (placeInlineFigures): the statement side only its own figures (a solution
  // figure named there stays out of the statement: the spoiler), the solution side its own, the moved ones and the
  // statement's
  const statementCandidates = [...(problem.figures || []), ...(problem.parts || []).flatMap(p => p.figures || []), ...sectionFigures(problem.sections)].filter(inStatement);
  // a25-I-56.pdf pp.5–6 repeats the question's six animal photos before its solution.
  // The first combined solution crop actually covers the previous problem's text.
  // Keep the six reviewed individual statement crops; neither repeated row adds information.
  const duplicatePhotos = problem.id === 'nao-2025-i-5-6-p4'
    && [1, 2, 3, 4, 5, 6].every(n => statementCandidates.some(f => f.id === `p4-fig${n}`));
  const uniqueSolutionFigures = (sol?.figures || []).filter(f => !duplicatePhotos || !['p4-sol-fig1', 'p4-sol-fig2'].includes(f.id));
  const solutionCandidates = [...sectionFigures(sol?.sections), ...uniqueSolutionFigures, ...misplaced.map(m => m.fig), ...statementCandidates];
  const resolveStatement = target => resolveFigureTarget(target, statementCandidates);
  const resolveSolution = target => resolveFigureTarget(target, solutionCandidates);
  const shown = (text, resolve) => resolveFigurePlaceholders(text, problem, resolve);
  const statementTexts = [problem.statement, problem.statementAfterParts, ...partTexts, ...sectionTexts(problem.sections)].map(t => shown(t, resolveStatement));
  const solutionShown = shown(sol?.statement, resolveSolution);
  const statementFigs = figuresNotInline(problem.figures, statementTexts, statementCandidates).filter(inStatement);
  const partFigs = (problem.parts ?? []).map(part => figuresNotInline(part.figures, statementTexts, statementCandidates).filter(inStatement));
  const solutionFigures = [...figuresNotInline(uniqueSolutionFigures, [solutionShown], solutionCandidates), ...movedSolutionFigures(misplaced, sol && { ...sol, statement: solutionShown }, solutionCandidates)];
  // a reader that left the printed "[3 т.]" in the text would show the points twice; the points field is canonical
  const partText = part => part.points != null ? String(part.statement).replace(/\s*(\*\*)?\[\s*\d+(?:[.,]\d+)?\s*т\.?\s*\](\*\*)?\s*$/u, '') : part.statement;
  const fields = { statement: problem.statement, statementAfterParts: problem.statementAfterParts ?? '', 'solution/statement': sol?.statement ?? '' };
  (problem.parts ?? []).forEach((part, k) => { fields[`parts/${k}/statement`] = String(partText(part) ?? ''); fields[`parts/${k}/statementAfter`] = part.statementAfter ?? ''; });
  const plan = planFigureAnchors(problem.id, [
    { figs: statementFigs, solution: false }, ...partFigs.map(figs => ({ figs, solution: false })), { figs: solutionFigures, solution: true },
  ], fields, figureOpts.anchors, figureOpts.stats);
  const unanchored = figs => figs.filter(fig => !plan.anchored.has(fig));
  // a text field with its anchored figures in place (without any, exactly the field as before)
  const fieldLines = (field, text, render, always = false) => plan.slots.has(field)
    ? splitAtFigures(text, plan.slots.get(field)).flatMap(piece => piece.figures ?? [render(piece.text), ''])
    : text || always ? [render(text), ''] : [];
  if (problem.sections?.length) {
    lines.push('<nav className="problem-sections-toc" aria-label="Части на задачата">', '', '**В тази задача**', '');
    for (const section of problem.sections) lines.push(`- [${mdText(section.title)}](#${section.id})`);
    lines.push('', '</nav>', '');
  }
  lines.push(...fieldLines('statement', problem.statement, t => sourceText(t, problem, resolveStatement).trimEnd(), true));
  for (const fig of unanchored(statementFigs)) lines.push(figureMarkdown(fig), '');
  if (problem.parts?.length) {
    problem.parts.forEach((part, k) => {
      const text = part.points != null ? String(part.statement).replace(/\s*(\*\*)?\[\s*\d+(?:[.,]\d+)?\s*т\.?\s*\](\*\*)?\s*$/u, '') : part.statement;
      // the statement may already print its points at its end, marked up: "**2 т.**", "*2 точки;*", "(1 point)",
      // "**[2.5 points]**" — never bare prose ("Тяло с маса 3 т." is a mass of 3 tonnes)
      const printedPoints = /(?:\*{1,2}[(\[]?|[(\[])\s*(\d+(?:[.,]\d+)?)\s*(?:т\.?|точк[аи]\.?|точки|pts?\.?|points?|marks?|бал(?:л|ла|лов|а)?\.?)(?![\p{L}])\s*[.;:]?\s*(?:[)\]]\**|\*{1,2})\s*[.;:]?\s*$/iu.exec(String(text).trimEnd());
      const alreadyPrinted = printedPoints && Number(printedPoints[1].replace(',', '.')) === part.points;
      const pts = part.points != null && !alreadyPrinted ? ` **[${String(part.points).replace('.', ',')}\u00A0т.]**` : '';
      const label = part.label && part.label !== '*' ? `**${part.label}**` : '';
      const renderPart = (value, prefix, suffix) => {
        const body = sourceText(value, problem, resolveStatement);
        const opensBlock = /^\s*(?:\||#{1,6}[ \t]|<figure|<div)/.test(body);
        const endsInRow = /(?:^|\n)[ \t]*\|[^\n]*$/.test(body.trimEnd()) || /<\/(?:figure|div)>\s*$/.test(body);
        return `${prefix ? prefix + (opensBlock ? '\n\n' : ' ') : ''}${body}${suffix && endsInRow ? '\n\n' + suffix.trim() : suffix}`;
      };
      const placed = plan.slots.get(`parts/${k}/statement`);
      if (!placed) lines.push(renderPart(text, label, pts), '');
      else {
        const pieces = splitAtFigures(text, placed);
        if (!pieces.some(p => p.text != null)) pieces.unshift({ text: '' });
        const first = pieces.findIndex(p => p.text != null), last = pieces.map(p => p.text != null).lastIndexOf(true);
        pieces.forEach((piece, i) => lines.push(...(piece.figures ?? [renderPart(piece.text, i === first ? label : '', i === last ? pts : ''), ''])));
      }
      for (const fig of unanchored(partFigs[k])) lines.push(figureMarkdown(fig), '');
      lines.push(...fieldLines(`parts/${k}/statementAfter`, part.statementAfter, t => sourceText(t, problem, resolveStatement)));
    });
  }
  lines.push(...sectionLines(problem.sections, problem, resolveStatement));
  lines.push(...fieldLines('statementAfterParts', problem.statementAfterParts, t => sourceText(t, problem, resolveStatement)));
  const answers = [
    ...(problem.answer ? [{ label: '', answer: problem.answer }] : []),
    ...(problem.parts ?? []).filter(p => p.answer),
    ...(problem.sections ?? []).flatMap(section => (section.parts ?? []).filter(part => part.answer).map(part => ({ label: `${section.title}, ${part.label}`, answer: part.answer }))),
  ].map(p => ({ label: p.label, shown: renderAnswer(p.answer) })).filter(p => p.shown);
  if (answers.length) {
    lines.push('## Отговори', '');
    lines.push('<Spoiler title="Покажи отговорите">', '');
    for (const p of answers) {
      lines.push(`- ${p.label ? `**${p.label}** ` : ''}${p.shown}`);
    }
    lines.push('', '</Spoiler>', '');
  }
  // solution figures found in the statement follow the solution's own figures, inside the same spoiler; without
  // solution text (an incomplete solution, or none at all) the figures still stay behind a spoiler
  if (sol?.statement || sol?.sections?.length || sol?.incomplete || solutionFigures.length) {
    lines.push('## Решение', '');
    if (sol?.incomplete) {
      lines.push('<Warning title="Непълно решение">', visitorNote(sol.incompleteReason) || (sol.statement ? 'Официалното решение е непълно.' : 'В архива няма официално решение на тази задача.'), '</Warning>', '');
    }
    if (sol?.statement || sol?.sections?.length) lines.push('<Spoiler title="Покажи официалното решение">', '');
    else if (solutionFigures.length) lines.push('<Spoiler title="Покажи фигурите от официалното решение">', '');
    if (sol?.statement || solutionFigures.length) lines.push(...fieldLines('solution/statement', sol?.statement, t => sourceText(t, problem, resolveSolution)));
    lines.push(...sectionLines(sol?.sections, problem, resolveSolution, true));
    for (const fig of unanchored(solutionFigures)) lines.push(figureMarkdown(fig), '');
    if (sol?.statement || sol?.sections?.length || solutionFigures.length) lines.push('', '</Spoiler>', '');
  }
  lines.push(...documentNoteLines(paper, 'after-problem'));
  const classification = classificationSearch(problem.classification);
  if (classification) {
    lines.push('<details>', '<summary>Теми и трудност</summary>', '',
      `${classification.assessmentLabel}.`, '',
      classification.tags.map(tag => mdText(tag)).join(' · '), '');
    if (classification.prerequisiteLabels.length) lines.push(
      `Предпоставки: ${classification.prerequisiteLabels.map(x => mdText(x)).join(', ')}`, '');
    lines.push('</details>', '');
  }
  const src = paper.source?.archiveKey;
  if (src) {
    lines.push('---', '');
    lines.push(`Оригинал в Архива: [${src.split('/').pop()}](${archiveUrl(paper.subject, src)})`);
    if (paper.solutionSource?.archiveKey) {
      const s = paper.solutionSource.archiveKey;
      lines.push(`· официални решения: [${s.split('/').pop()}](${archiveUrl(paper.subject, s)})`);
    }
    for (const supplement of Object.values(paper.supplementarySources || {})) {
      const s = supplement.archiveKey;
      lines.push(`· допълнителни данни: [${s.split('/').pop()}](${archiveUrl(paper.subject, s)})`);
    }
    lines.push('');
  }
  return lineBreaks(displayMathLines(lines.join('\n')));
}

// "III Национален кръг" -> "III"; keeps the slug short while staying unique
// across the rounds and grades of one competition-year.
function shortRound(round) {
  const m = String(round).match(/^(I{1,3}V?|IV|\d+)/);
  return m ? m[1] : String(round).split(' ')[0];
}

// "Задача 3. Title" with the display number (question-numbers.json: the printed Q2 of a one-question file stored as
// 1, or "2A" for a question's part) — exactly the sidebar row (tree.ts problemDisplayName): the display number always
// leads, a title that repeats it ("2A. Optical properties", "10-1 «Сифон»") drops the repeat, a title that prints
// another number keeps it after the display number, and a non-numeric number ("Практически 1") is the label itself.
export function problemName(problem, numbers = nav.numbers) {
  return tree().problemDisplayName(problem, numbers);
}

function problemInfo(paper, problem) {
  const grade = gradeLabel(paper.grade, paper.subject, paper.competition);
  const classification = classificationSearch(problem.classification);
  return {
    uniqueId: problem.id,
    // Kept short on purpose: getProblemURL() slugifies source + name, so a
    // verbose name produces an unreadable URL. Round and grade live in tags.
    name: problemName(problem),
    url: withPage(archiveUrl(paper.subject, paper.source.archiveKey), problem.sourceSpans?.find(s => s.document === 'problems')?.page),
    // The official solutions PDF, when the paper has one; the problem page's
    // compare panel offers it next to the problems PDF.
    ...(paper.solutionSource?.archiveKey
      ? { solutionUrl: withPage(archiveUrl(paper.subject, paper.solutionSource.archiveKey), problem.sourceSpans?.find(s => s.document === 'solutions')?.page) }
      : {}),
    source: `${paper.competition} ${paper.year}${pageRound(paper) ? ' ' + shortRound(pageRound(paper)) : ''}${paper.grade ? ' ' + paper.grade : ''}`,
    difficulty: problem.difficulty ?? 'N/A',
    isStarred: (problem.importance ?? 0) >= 3,
    tags: [...new Set([...controlledTopics(problem.topics, taxonomy).map(id => taxonomy.topics.find(t => t.id === id).label), ...(classification?.tags || []), ...(grade ? [grade] : []), paper.roundType].filter(Boolean))],
    ...(classification ? { assessmentLabel: classification.assessmentLabel, fields: classification.fields, conceptIds: classification.conceptIds, classificationTerms: classification.classificationTerms } : {}),
    solutionMetadata: { kind: 'internal' },
  };
}

function withPage(url, page) { return Number.isInteger(page) && page > 0 ? `${url}#page=${page}` : url; }
// 2e+30 -> 2 \times 10^{30}, 10000000000 -> 1 \times 10^{10}; any other number prints as the data holds it (the decimal
// separator is the paper's language's business, and English papers use a point)
function texNumber(v) {
  const s = Math.abs(v) >= 1e6 || (v !== 0 && Math.abs(v) < 1e-4) ? v.toExponential().replace(/\.?0+e/, 'e') : String(Number(v.toPrecision(12)));
  const [m, e] = s.split('e');
  return e ? `${m} \\times 10^{${Number(e)}}` : m;
}
// plain-text values print "10^9", "km s^-1", "M_gas": exponents become superscripts, subscripts <sub>
const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '−': '⁻', '+': '⁺', '.': '·' };
const plainScripts = t => t.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/).map((seg, i) => i % 2 ? seg : seg
  .replace(/\^(?:\\?\{)?([-−+]?\d+(?:\.\d+)?)(?:\\?\})?/g, (_, d) => [...d].map(c => SUP[c] ?? c).join('')) // mdText has escaped the braces
  .replace(/(?<=[\p{L}\d)])_(?:\\?\{)?([\p{L}\d]{1,8})(?:\\?\})?(?![\p{L}\d])/gu, '<sub>$1</sub>')).join('');
// the formula shows the value when its leading digits appear in it ("\approx 36.76\ \text{km/s}")
const showsValue = (latex, v) => latex.replace(/\{,\}|[{}\\ ,.]/g, '').includes(Math.abs(v).toExponential(6).split('e')[0].replace('.', '').replace(/0+$/, '').slice(0, 2) || '0');
function renderAnswer(answer) {
  const unit = answer.unit ? ` ${plainScripts(mdText(String(answer.unit)))}` : '';
  if (answer.latex) return `$${answer.latex}$` + (typeof answer.value === 'number' && !showsValue(answer.latex, answer.value) ? ` ≈ $${texNumber(answer.value)}$${unit}` : '');
  if (typeof answer.value === 'number') return /e/i.test(String(answer.value)) || Math.abs(answer.value) >= 1e6 ? `$${texNumber(answer.value)}$${unit}` : mdText(String(answer.value)) + unit;
  if (answer.value != null) return plainScripts(mdText(String(answer.value))) + unit;
  // An integer choice index is zero-based only when the source explicitly
  // includes the choices array; otherwise preserve the printed identifier.
  if (answer.kind === 'choice' && answer.correct != null) {
    const choice = Number.isInteger(answer.correct) && answer.choices?.[answer.correct] != null ? answer.choices[answer.correct] : answer.correct;
    return mdText(String(choice));
  }
  return answer.note ? mdText(answerNotes[answer.note] ?? answer.note) : '';
}

// Run as a script only: validate.mjs and the tests import misplacedSolutionFigures from this file.
let taxonomy;
let answerNotes = {};
function main() {
  const records = readPapers(ROOT);
  const ledger = readJson(path.join(ROOT, 'content/problem-publication.json'), { papers: {} });
  taxonomy = readJson(path.join(ROOT, 'content/problem-topics.json'), { topics: [] });
  nav = loadNavigation(ROOT);
  answerNotes = readJson(path.join(ROOT, 'content/answer-note-formatting.json'), { notes: {} }).notes;
  const curation = readJson(path.join(ROOT, 'content/problem-curation.json'), { modules: {} });
  const manifestFile = path.join(ROOT, 'content/problem-generated.json');
  const prior = readJson(manifestFile, { version: 1, files: {}, problemIds: [], moduleTables: [] });
  const extra = readJson(EXTRA, { EXTRA_PROBLEMS: [] });
  const routesFile = path.join(ROOT, 'content/problem-routes.json');
  const routes = readJson(routesFile, {});
  const allIds = new Set(records.flatMap(r => r.data.problems.map(p => p.id)));
  const owned = new Set(prior.problemIds);
  const planned = new Map(), generated = new Map(), excluded = [];
  const aliases = {};
  const figureOpts = { anchors: readFigureAnchors(ROOT), stats: newFigureStats() };

  // Bootstrap ownership only from the exact generator signature. Never sweep
  // arbitrary authored solutions merely because they live under solutions/.
  if (!fs.existsSync(manifestFile)) {
    const scan = dir => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, e.name);
        if (e.isDirectory()) scan(file);
        else if (e.name.endsWith('.mdx')) {
          const bytes = fs.readFileSync(file), text = bytes.toString('utf8');
          const id = /^id: ([^\n]+)$/m.exec(text)?.[1];
          if (id && text.includes("author: 'Olympiads XYZ · транскрипция на официалните материали'")) {
            prior.files[path.relative(ROOT, file)] = sha256(bytes);
            owned.add(id);
          }
        }
      }
    };
    scan(SOLUTIONS_DIR);
  }
  const oldMetadata = new Map(extra.EXTRA_PROBLEMS.map(p => [p.uniqueId, p]));
  const moduleFiles = walkJson(path.join(ROOT, 'content')).filter(f => f.endsWith('.problems.json'));
  const modules = moduleFiles.map(file => ({ file, data: readJson(file) }));
  for (const { data } of modules) for (const [key, entries] of Object.entries(data)) if (key !== 'MODULE_ID' && Array.isArray(entries)) for (const p of entries) oldMetadata.set(p.uniqueId, p);
  paperQualifiers = qualifyPapers(records.filter(r => publicationState(r, ledger).eligible).map(r => r.data));
  for (const record of records) {
    const metadataErrors = problemMetadataErrors(record.data);
    if (metadataErrors.length) throw new Error(`${record.relativePath}: ${metadataErrors.map(e => `${e.path}: ${e.message}`).join('; ')}`);
    const state = publicationState(record, ledger);
    if (!state.eligible) { excluded.push(`${record.data.paper.id}: ${state.reason}`); continue; }
    const { paper, problems } = record.data;
    for (const problem of problems) {
      const relative = `solutions/${paper.subject}/${paper.id}/${problem.id}.mdx`;
      planned.set(relative, problemMdx(paper, problem, state, record.relativePath, figureOpts));
      generated.set(problem.id, problemInfo(paper, problem));
      // D-P5: ids that were live before the route freeze keep their slug URL
      // (content/problem-routes.json, bootstrapped from production); any id not
      // in the frozen map is new and gets a stable id-based route.
      if (!routes[problem.id]) routes[problem.id] = `/problems/${problem.id}`;
      for (const [from, to] of Object.entries(problemAliases(problem, routes, allIds))) {
        if (aliases[from] && aliases[from] !== to) throw new Error(`Alias collision: ${from}`);
        aliases[from] = to;
      }
    }
  }
  // Keep routes reserved after withdrawal, so a title edit or later restoration
  // cannot change bookmarks or accidentally give an old route to another ID.
  const routeOwners = new Map();
  for (const [id, route] of Object.entries(routes)) {
    if (!route.startsWith('/problems/') || route.includes('..')) throw new Error(`Invalid route for ${id}`);
    if (routeOwners.has(route) && routeOwners.get(route) !== id) throw new Error(`Route collision: ${id}, ${routeOwners.get(route)}`);
    routeOwners.set(route, id);
  }
  const inModules = new Set(), moduleTables = [];
  for (const { file, data } of modules) {
    const selected = curation.modules[data.MODULE_ID];
    if (selected || prior.moduleTables.includes(path.relative(ROOT, file))) {
      data.archivePractice = (selected || []).filter(item => generated.has(item.problemId)).map(item => generated.get(item.problemId));
      moduleTables.push(path.relative(ROOT, file));
      planned.set(path.relative(ROOT, file), jsonText(data));
    }
    for (const [key, entries] of Object.entries(data)) if (key !== 'MODULE_ID' && Array.isArray(entries)) for (const item of entries) {
      if (allIds.has(item.uniqueId) && !generated.has(item.uniqueId)) throw new Error(`Ineligible paper referenced by authored module table: ${file}:${item.uniqueId}`);
      inModules.add(item.uniqueId);
    }
  }
  const unmanaged = extra.EXTRA_PROBLEMS.filter(p => !owned.has(p.uniqueId) && !allIds.has(p.uniqueId));
  const metadata = [...unmanaged, ...[...generated.values()].filter(p => !inModules.has(p.uniqueId))].sort((a, b) => a.uniqueId.localeCompare(b.uniqueId));
  planned.set('content/extraProblems.json', jsonText({ ...extra, EXTRA_PROBLEMS: metadata }));
  const sortedRoutes = Object.entries(routes).sort(([a], [b]) => a.localeCompare(b));
  planned.set('content/problem-aliases.json', jsonText(aliases));
  planned.set('content/problem-routes.json', jsonText(Object.fromEntries(sortedRoutes)));
  // What the browser needs (src/models/problem.ts): only the routes that are not "/problems/<id>", which getProblemURL
  // gives any id it does not find. Three quarters of the ledger are such entries; every problem page loaded them.
  planned.set('content/problem-routes.client.json', jsonText(Object.fromEntries(sortedRoutes.filter(([id, route]) => route !== `/problems/${id}`))));
  const manifest = { version: 1, files: Object.fromEntries([...planned].filter(([p]) => p.startsWith('solutions/')).map(([p, text]) => [p, sha256(text)])), problemIds: [...generated.keys()].sort(), moduleTables };
  planned.set('content/problem-generated.json', jsonText(manifest));
  let stale = 0;
  for (const [relative, digest] of Object.entries(prior.files)) {
    if (planned.has(relative)) continue;
    if (!relative.startsWith('solutions/') || relative.includes('..') || path.isAbsolute(relative)) throw new Error('Unsafe owned path: ' + relative);
    const file = path.join(ROOT, relative);
    if (!fs.existsSync(file)) continue;
    stale++;
    if (!check) {
      if (sha256(fs.readFileSync(file)) !== digest) throw new Error(`Refusing to remove edited generated file: ${relative}; move the edit to canonical JSON first.`);
      fs.unlinkSync(file);
    }
  }
  let changed = 0;
  for (const [relative, text] of planned) {
    const file = path.join(ROOT, relative);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
      changed++;
      if (!check) atomicWrite(file, text);
    }
  }
  console.log(`${records.length} papers; ${generated.size} eligible problems; ${excluded.length} excluded papers; ${changed} ${check ? 'stale' : 'updated'} artifacts; ${stale} obsolete pages${check ? '' : ' removed'}.`);
  if (excluded.length) console.log(excluded.join('\n'));
  if (figureOpts.anchors) {
    // an anchor that does not apply leaves its figure where it was (never fatal): the summary says how many
    const s = figureOpts.stats;
    console.log(`figure anchors: ${s.placed}/${s.anchored} placed in the text; ${s.notFound.length} kept in place ("after" not in the field); ${s.refused.length} refused (field not allowed); ${s.unused.length} for no figure block on the page`);
    for (const [label, list] of [['not found', s.notFound], ['refused', s.refused], ['unused', s.unused]]) {
      if (list.length) console.log(`  ${label}: ${list.slice(0, 10).join('; ')}${list.length > 10 ? `; … ${list.length - 10} more` : ''}`);
    }
  }
  if (check && (changed || stale)) process.exitCode = 1;
}
const invokedAsScript = (() => { try { return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invokedAsScript) main();
