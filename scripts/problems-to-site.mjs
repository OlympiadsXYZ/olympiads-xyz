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
  return `<figure>\n<img src="${fig.url}" alt="${alt}" />${cap}\n</figure>`;
}

// Some transcriptions place a figure inline in the text (![…](url)) AND list it
// in figures[]; emitting both rendered the figure twice. Only emit the block
// for figures the surrounding text does not already show.
function figuresNotInline(figs, ...texts) {
  const joined = texts.filter(Boolean).join('\n');
  return (figs ?? []).filter(f => !(f.url && joined.includes(f.url)));
}

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
function movedSolutionFigures(misplaced, solution) {
  const shown = [...(solution?.figures || [])];
  const text = solution?.statement || '';
  const out = [];
  for (const { fig } of misplaced) {
    if (fig.url && text.includes(fig.url)) continue;
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
const FIGURE_ID = /p\d+(?:-sol)?-fig\d+[a-z]?/;
function problemFigures(problem) {
  return [...(problem.figures || []), ...(problem.parts || []).flatMap(p => p.figures || []), ...(problem.solution?.figures || [])].filter(f => f?.id && f.url);
}
export function resolveFigurePlaceholders(text, problem) {
  if (!text) return text;
  const byId = new Map(problemFigures(problem).map(f => [f.id, f]));
  const image = (alt, fig) => `![${String(alt || fig.alt || fig.caption || '').replace(/\s*\n\s*/g, ' ').replace(/[[\]]/g, '').trim()}](${fig.url})`;
  return String(text)
    .replace(/!\[([^\]\n]*)\]\((?!https?:|\/)([^)\s]*)\)/g, (m, alt, target) => {
      const fig = byId.get((target.match(FIGURE_ID) || [])[0]);
      if (fig) return image(alt, fig);
      return alt.trim() ? `*[${alt.trim()}]*` : '';
    })
    .replace(/\[\[figure:?\s*(p\d+(?:-sol)?-fig\d+[a-z]?)\s*\]\]|\[(?:figure|фигура)\s*:\s*(p\d+(?:-sol)?-fig\d+[a-z]?)\s*\]/giu, (m, a, b) => {
      const fig = byId.get(a || b);
      return fig ? image('', fig) : m;
    });
}
function sourceText(text, problem) {
  let rendered = demoteHeadings(mdText(resolveFigurePlaceholders(text, problem)));
  // Wrappers are generated from exact source passages; raw HTML remains forbidden in content.
  for (const passage of [...(problem.sourceLayout?.underlines || [])].sort((a, b) => b.length - a.length)) {
    const needle = mdText(passage);
    if (needle) rendered = rendered.split(needle).join(`<u>${needle}</u>`);
  }
  return rendered;
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
const { competitionShort: COMPETITION_SHORT, roundLabels: ROUND_LABELS } = readArchiveLabels();
// The archive's I/II/III labels are the Bulgarian stages ("III кръг (национален)"); elsewhere a Roman round is only a
// number (SPbA, Samara and BelPhO use them too), so it stays as printed.
const BULGARIAN_COMPETITIONS = new Set(['NOF', 'NAO', 'ESF', 'PSF', 'NOH', 'HOOS']);
function roundLabel(round, competition) {
  if (!round) return null;
  if (/^(?:I|II|III|IV)$/.test(round) && !BULGARIAN_COMPETITIONS.has(competition)) return round;
  return ROUND_LABELS[round] ?? round;
}
const MONTHS_BG = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

// "9" -> "9. клас", "9-10 клас" -> "9–10 клас"; group codes get their names
// (physics ST/SP = the special-theme group; astronomy ML/ST = age groups);
// anything else is left as printed.
const GROUP_NAMES = {
  physics: { ST: 'Специална тема', SP: 'Специална тема' },
  astronomy: { ML: 'Младша възраст', ST: 'Старша възраст' },
};
// IAO's age groups are written both ways across papers ("alpha", "α"); the page shows the letter.
const GREEK_GROUPS = { alpha: 'α', beta: 'β', gamma: 'γ' };
function gradeLabel(grade, subject) {
  if (!grade) return null;
  const g = String(grade).replace(/\s*клас\.?$/u, '').trim().replace(/\s*-\s*/g, '–');
  if (/^\d+$/.test(g)) return `${g}. клас`;
  if (/^\d+–\d+$/.test(g)) return `${g} клас`;
  const named = GROUP_NAMES[subject]?.[g.toUpperCase()] ?? GREEK_GROUPS[g.toLowerCase()];
  return named ?? String(grade);
}

function dateBg(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS_BG[Number(m[2]) - 1]} ${m[1]} г.`;
}

// "НОА 2026, II кръг (областен), 9–10 клас" — what the page heading leads with.
function paperDescriptor(paper) {
  return [
    `${COMPETITION_SHORT[paper.competition] ?? paper.competition} ${paper.year}`,
    roundLabel(paper.round, paper.competition),
    gradeLabel(paper.grade, paper.subject),
  ].filter(Boolean).join(', ');
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

function problemMdx(paper, problem, state, sourceFile) {
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
  if (state.quality === 'reviewed') lines.push(`verifier: ${yamlStr(state.mechanical ? 'mechanical' : state.cropAudit ? 'crop-audit' : state.independent === false ? 'same-model' : 'independent')}`);
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
  lines.push(sourceText(problem.statement, problem).trimEnd());
  lines.push('');
  const shown = t => resolveFigurePlaceholders(t, problem); // a placeholder shows its figure in place
  const partTexts = (problem.parts ?? []).flatMap(p => [p.statement, p.statementAfter]).map(shown);
  const misplaced = misplacedSolutionFigures(paper, problem);
  const inStatement = fig => !misplaced.some(m => m.fig === fig);
  for (const fig of figuresNotInline(problem.figures, shown(problem.statement), shown(problem.statementAfterParts), ...partTexts).filter(inStatement)) lines.push(figureMarkdown(fig), '');
  if (problem.parts?.length) {
    for (const part of problem.parts) {
      const text = part.points != null ? String(part.statement).replace(/\s*(\*\*)?\[\s*\d+(?:[.,]\d+)?\s*т\.?\s*\](\*\*)?\s*$/u, '') : part.statement;
      // the statement may already print its points at its end, marked up: "**2 т.**", "*2 точки;*", "(1 point)",
      // "**[2.5 points]**" — never bare prose ("Тяло с маса 3 т." is a mass of 3 tonnes)
      const printedPoints = /(?:\*{1,2}[(\[]?|[(\[])\s*(\d+(?:[.,]\d+)?)\s*(?:т\.?|точк[аи]\.?|точки|pts?\.?|points?|marks?|бал(?:л|ла|лов|а)?\.?)(?![\p{L}])\s*[.;:]?\s*(?:[)\]]\**|\*{1,2})\s*[.;:]?\s*$/iu.exec(String(text).trimEnd());
      const alreadyPrinted = printedPoints && Number(printedPoints[1].replace(',', '.')) === part.points;
      const pts = part.points != null && !alreadyPrinted ? ` **[${String(part.points).replace('.', ',')}\u00A0т.]**` : '';
      // a reader that left the printed "[3 т.]" in the text would show the points twice; the points field is canonical
      // a statement that opens with a table or a heading keeps the label on a line of its own (glued, the block does not
      // start), and one that ends with a table row gets its points after the table (in the row, GFM drops the extra cell)
      const body = sourceText(text, problem), label = part.label && part.label !== '*' ? `**${part.label}**` : ''; // an unlabelled printed part has an empty label
      const opensBlock = /^\s*(?:\||#{1,6}[ \t])/.test(body), endsInRow = /(?:^|\n)[ \t]*\|[^\n]*$/.test(body.trimEnd());
      lines.push(`${label ? label + (opensBlock ? '\n\n' : ' ') : ''}${body}${pts && endsInRow ? '\n\n' + pts.trim() : pts}`);
      lines.push('');
      for (const fig of figuresNotInline(part.figures, shown(part.statement), shown(part.statementAfter)).filter(inStatement)) lines.push(figureMarkdown(fig), '');
      if (part.statementAfter) lines.push(sourceText(part.statementAfter, problem), '');
    }
  }
  if (problem.statementAfterParts) lines.push(sourceText(problem.statementAfterParts, problem), '');
  const answers = [
    ...(problem.answer ? [{ label: '', answer: problem.answer }] : []),
    ...(problem.parts ?? []).filter(p => p.answer),
  ].map(p => ({ label: p.label, shown: renderAnswer(p.answer) })).filter(p => p.shown);
  if (answers.length) {
    lines.push('## Отговори', '');
    lines.push('<Spoiler title="Покажи отговорите">', '');
    for (const p of answers) {
      lines.push(`- ${p.label ? `**${p.label}** ` : ''}${p.shown}`);
    }
    lines.push('', '</Spoiler>', '');
  }
  const sol = problem.solution;
  // solution figures found in the statement follow the solution's own figures, inside the same spoiler; without
  // solution text (an incomplete solution, or none at all) the figures still stay behind a spoiler
  const solutionFigures = [...figuresNotInline(sol?.figures, shown(sol?.statement)), ...movedSolutionFigures(misplaced, sol && { ...sol, statement: shown(sol.statement) })];
  if (sol?.statement || sol?.incomplete || solutionFigures.length) {
    lines.push('## Решение', '');
    if (sol?.incomplete) {
      lines.push('<Warning title="Непълно решение">', visitorNote(sol.incompleteReason) || (sol.statement ? 'Официалното решение е непълно.' : 'В архива няма официално решение на тази задача.'), '</Warning>', '');
    }
    if (sol?.statement) lines.push('<Spoiler title="Покажи официалното решение">', '', sourceText(sol.statement, problem), '');
    else if (solutionFigures.length) lines.push('<Spoiler title="Покажи фигурите от официалното решение">', '');
    for (const fig of solutionFigures) lines.push(figureMarkdown(fig), '');
    if (sol?.statement || solutionFigures.length) lines.push('', '</Spoiler>', '');
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

// "Задача 3. Title"; a title that already starts with "Задача" is used as is,
// and a non-numeric number ("Практически 1") is used as the label itself.
function problemName(problem) {
  if (problem.title && /^Задача\b/u.test(problem.title)) return problem.title;
  const label = Number.isInteger(problem.number) ? `Задача ${problem.number}` : String(problem.number);
  return `${label}${problem.title ? '. ' + problem.title : ''}`;
}

function problemInfo(paper, problem) {
  const grade = gradeLabel(paper.grade, paper.subject);
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
    source: `${paper.competition} ${paper.year}${paper.round ? ' ' + shortRound(paper.round) : ''}${paper.grade ? ' ' + paper.grade : ''}`,
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
  return answer.note ? mdText(answer.note) : '';
}

// Run as a script only: validate.mjs and the tests import misplacedSolutionFigures from this file.
let taxonomy;
function main() {
  const records = readPapers(ROOT);
  const ledger = readJson(path.join(ROOT, 'content/problem-publication.json'), { papers: {} });
  taxonomy = readJson(path.join(ROOT, 'content/problem-topics.json'), { topics: [] });
  const curation = readJson(path.join(ROOT, 'content/problem-curation.json'), { modules: {} });
  const manifestFile = path.join(ROOT, 'content/problem-generated.json');
  const prior = readJson(manifestFile, { version: 1, files: {}, problemIds: [], moduleTables: [] });
  const extra = readJson(EXTRA, { EXTRA_PROBLEMS: [] });
  const routesFile = path.join(ROOT, 'content/problem-routes.json');
  const routes = readJson(routesFile, {});
  const allIds = new Set(records.flatMap(r => r.data.problems.map(p => p.id)));
  const owned = new Set(prior.problemIds);
  const planned = new Map(), generated = new Map(), excluded = [];

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
  for (const record of records) {
    const metadataErrors = problemMetadataErrors(record.data);
    if (metadataErrors.length) throw new Error(`${record.relativePath}: ${metadataErrors.map(e => `${e.path}: ${e.message}`).join('; ')}`);
    const state = publicationState(record, ledger);
    if (!state.eligible) { excluded.push(`${record.data.paper.id}: ${state.reason}`); continue; }
    const { paper, problems } = record.data;
    for (const problem of problems) {
      const relative = `solutions/${paper.subject}/${paper.id}/${problem.id}.mdx`;
      planned.set(relative, problemMdx(paper, problem, state, record.relativePath));
      generated.set(problem.id, problemInfo(paper, problem));
      // D-P5: ids that were live before the route freeze keep their slug URL
      // (content/problem-routes.json, bootstrapped from production); any id not
      // in the frozen map is new and gets a stable id-based route.
      if (!routes[problem.id]) routes[problem.id] = `/problems/${problem.id}`;
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
  planned.set('content/problem-routes.json', jsonText(Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)))));
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
  if (check && (changed || stale)) process.exitCode = 1;
}
const invokedAsScript = (() => { try { return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invokedAsScript) main();
