#!/usr/bin/env node
// On which page of the original PDF each problem (and its official solution) is printed, for the papers whose problems
// carry no sourceSpans page (the legacy NAO/NOF/ESF/PSF transcriptions: their "Оригинал" link opened page 1 of a
// multi-page PDF). Mechanical, no model: the PDF's text layer only.
//
//   node scripts/backfill-source-pages.mjs [--paper <id>] [--cache-root DIR] [--download] [--verbose] [--root DIR]
//
// Writes content/problem-source-pages.json (an overlay: published paper JSON is hash-bound to its receipt):
//
//   { version: 1, problems: { <problemId>: { problems?: { page, via }, solutions?: { page, via } } } }
//
// scripts/problems-to-site.mjs reads it after the problem's own sourceSpans and before a figure's page. Per document
// the page comes from
//   'text'     the first words of the problem's printed text (statement, else its first part; for the solutions
//              document the solution's), letters only, found in the text layer after the previous problem's
//   'heading'  the problem's printed heading ("Задача 3", "3 задача", "Problem 3", "Task 3") after the previous one's
// When both are found they must agree (the heading on the page of the text or the one before it: the heading wins);
// a page before one of the problem's own figures, a page outside the paper's pages, or two methods that disagree
// leave the problem out. Nothing is guessed: a problem the text layer does not place keeps its link without a page.
//
// Text layers, in this order: <cache-root>/tx/<paperId>/text/<document>.txt (pdftotext -layout, pages split by form
// feeds, from the transcription cache; used only when its manifest names the paper's archive key) and
// <cache-root>/figure-anchors/<paperId>/<document>.tsv (pdftotext -tsv, scripts/figure-anchors.mjs). With --download a
// paper with neither is read from the archive bucket (pdftotext -tsv, cached like figure-anchors.mjs does).
// Re-running recomputes the papers it reads and keeps every other entry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SOURCE_PAGES_FILE = 'content/problem-source-pages.json';

// ------------------------------------------------------------------ text layer -> pages
// pdftotext -layout: one form feed after every page
export function pagesFromLayout(text) {
  const pages = String(text).split('\f');
  if (pages.length > 1 && !pages[pages.length - 1].trim()) pages.pop();
  return pages;
}
// pdftotext -tsv: level 1 = page, 4 = line, 5 = word (text in the 12th column)
export function pagesFromTsv(tsv) {
  const pages = [];
  let line = null;
  for (const row of String(tsv).split('\n')) {
    const c = row.split('\t');
    if (c.length < 12 || !/^\d+$/.test(c[0])) continue;
    const level = Number(c[0]), page = Number(c[1]);
    while (pages.length < page) pages.push([]);
    if (level === 4) pages[page - 1].push(line = { top: Number(c[7]), text: '' });
    else if (level === 5 && line) line.text += (line.text ? ' ' : '') + c.slice(11).join('\t').replace(/\r$/, '');
  }
  return pages.map(lines => lines.filter(l => l.text.trim()).sort((a, b) => a.top - b.top).map(l => l.text).join('\n'));
}

// ------------------------------------------------------------------ comparison form
// Letters only (digits and formulas are often missing from a Word export's text layer), lower case, with the Cyrillic
// letters that print like Latin ones folded together (old PDFs mix the two alphabets inside a word).
const FOLD = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's' };
export function letters(text) {
  return String(text ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}]+/gu, '').replace(/./gu, ch => FOLD[ch] ?? ch);
}

// The problem's printed prose, without figures, markup and math: the runs of plain words a text layer can hold.
function proseRuns(markdown) {
  return String(markdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '\u0000')
    .replace(/<[^>]+>/g, '\u0000')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, '\u0000')
    .replace(/^\s*\|.*$/gm, '\u0000') // table rows: pdftotext interleaves their cells
    .split('\u0000');
}
const KEY_MIN = 12, KEY_LEN = 30;
// the first run of plain words long enough to be found once (the opening words of the text, where they are plain)
export function textKey(markdown) {
  for (const run of proseRuns(markdown)) {
    const key = letters(run.replace(/^[\s*_#>-]*(?:(?:задача|problem|task)\s*№?\s*\d+\s*[.:)]?|\d+\s*[.)])/iu, '')).slice(0, KEY_LEN);
    if (key.length >= KEY_MIN) return key;
  }
  return null;
}

// ------------------------------------------------------------------ locating
function joinPages(pages) {
  const starts = [];
  let joined = '';
  for (const text of pages) { starts.push(joined.length); joined += letters(text); }
  const pageAt = offset => { let p = 0; while (p + 1 < starts.length && starts[p + 1] <= offset) p++; return p + 1; };
  return { joined, pageAt };
}
const headingPattern = number => new RegExp(
  `^\\s*[*_#]*\\s*(?:(?:задача|задание|problem|task|зад\\.)\\s*№?\\s*${number}(?![\\d.,]\\d)(?!\\d)|${number}\\s*(?:-?(?:ва|ра|та|ма))?\\.?\\s*задача)`, 'iu');
function headingPages(pages, number) {
  const re = headingPattern(String(number).replace(/[^\dA-Za-z]/g, ''));
  const out = [];
  pages.forEach((text, i) => { for (const line of text.split('\n')) if (re.test(line)) { out.push(i + 1); break; } });
  return out;
}

// items: [{ id, number, text, figurePages: [] }] in printed order; allowed: the paper's pages (or null)
// -> Map id -> { page, via }
export function locate(pages, items, allowed = null) {
  const { joined, pageAt } = joinPages(pages);
  const out = new Map();
  let cursor = 0, lastPage = 1;
  for (const item of items) {
    let textPage = null;
    const key = textKey(item.text);
    if (key) {
      let at = joined.indexOf(key, cursor);
      // out of printed order: only a place the key has once in the whole document
      if (at < 0) { const first = joined.indexOf(key); if (first >= 0 && joined.indexOf(key, first + 1) < 0) at = first; }
      if (at >= 0) { textPage = pageAt(at); if (at >= cursor) cursor = at + key.length; }
    }
    const headings = item.number != null ? headingPages(pages, item.number) : [];
    // the heading at or after the previous problem's page (a number repeats: "Задача 1" of the solutions part)
    const heading = headings.find(p => p >= lastPage && (textPage == null || p <= textPage)) ?? null;
    let page = null, via = null;
    if (textPage != null && heading != null) {
      if (textPage - heading <= 1) { page = heading; via = heading === textPage ? 'text' : 'heading'; }
    } else if (textPage != null) { page = textPage; via = 'text'; }
    else if (heading != null && headings.filter(p => p >= lastPage).length === 1) { page = heading; via = 'heading'; }
    if (page == null) continue;
    if (item.figurePages?.some(f => f < page)) continue; // the problem's own figure is printed before it
    if (allowed?.length && !allowed.includes(page)) continue;
    out.set(item.id, { page, via });
    lastPage = page;
  }
  return out;
}

// ------------------------------------------------------------------ papers
const hasSpan = (problem, doc) => (problem.sourceSpans || []).some(s => s.document === doc && Number.isInteger(s.page) && s.page > 0);
const figureDoc = fig => fig?.source?.document || fig?.tx?.document || 'problems';
const figurePage = fig => Number.isInteger(fig?.source?.page) ? fig.source.page : Number.isInteger(fig?.tx?.page) ? fig.tx.page : null;
function statementFigures(problem) {
  return [...(problem.figures || []), ...(problem.parts || []).flatMap(p => p.figures || [])];
}
export function problemText(problem, doc) {
  if (doc === 'solutions') return problem.solution?.statement || '';
  const parts = problem.parts || [];
  return [problem.statement, ...parts.map(p => p.statement), problem.statementAfterParts, problem.title].filter(Boolean).join('\n\n');
}
// paper data -> { problems: Map, solutions: Map } for the documents it has text layers for
export function paperPages(paper, problems, layers, numbers = {}) {
  const result = {};
  for (const doc of ['problems', 'solutions']) {
    const source = doc === 'problems' ? paper.source : paper.solutionSource;
    const pages = layers[doc];
    if (!pages?.length || !source?.archiveKey || !/\.pdf$/i.test(source.archiveKey)) continue;
    const items = problems.filter(p => !hasSpan(p, doc) && (doc === 'problems' || p.solution?.statement)).map(p => ({
      id: p.id,
      number: numbers[p.id] ?? p.number,
      text: problemText(p, doc),
      figurePages: (doc === 'problems' ? statementFigures(p) : p.solution?.figures || []).filter(f => figureDoc(f) === doc).map(figurePage).filter(n => n != null),
    }));
    // a problem that has its span still moves the cursor: locate() sees every problem, only unplaced ones are kept
    const all = problems.map(p => items.find(i => i.id === p.id) ?? { id: p.id, number: numbers[p.id] ?? p.number, text: problemText(p, doc), figurePages: [] });
    const found = locate(pages, all, Array.isArray(source.pages) ? source.pages : null);
    result[doc] = new Map([...found].filter(([id]) => items.some(i => i.id === id)));
  }
  return result;
}

// ------------------------------------------------------------------ main
function pdftotext() {
  const found = (process.platform === 'win32' ? spawnSync('where.exe', ['pdftotext'], { encoding: 'utf8' }).stdout : spawnSync('which', ['-a', 'pdftotext'], { encoding: 'utf8' }).stdout) || '';
  const candidates = ['pdftotext', ...found.split(/\r?\n/).map(s => s.trim()).filter(Boolean)];
  return candidates.find(bin => /poppler/i.test(spawnSync(bin, ['-v'], { encoding: 'utf8' }).stderr || '')) || 'pdftotext';
}
function readLayers(paper, cacheRoot) {
  const layers = {};
  const manifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(cacheRoot, 'tx', paper.id, 'manifest.json'), 'utf8')); } catch { return null; } })();
  for (const doc of ['problems', 'solutions']) {
    const key = doc === 'problems' ? paper.source?.archiveKey : paper.solutionSource?.archiveKey;
    if (!key) continue;
    const layout = path.join(cacheRoot, 'tx', paper.id, 'text', `${doc}.txt`);
    if (fs.existsSync(layout) && manifest?.documents?.[doc]?.key === key) { layers[doc] = pagesFromLayout(fs.readFileSync(layout, 'utf8')); continue; }
    const tsv = path.join(cacheRoot, 'figure-anchors', paper.id, `${doc}.tsv`);
    if (fs.existsSync(tsv)) layers[doc] = pagesFromTsv(fs.readFileSync(tsv, 'utf8'));
  }
  return layers;
}
async function downloadLayer(paper, doc, cacheRoot) {
  const key = doc === 'problems' ? paper.source?.archiveKey : paper.solutionSource?.archiveKey;
  if (!key || !/\.pdf$/i.test(key)) return null;
  const { R2_PUBLIC } = await import('./tx/lib.mjs');
  const res = await fetch(`${R2_PUBLIC}/${key.normalize('NFC').split('/').map(encodeURIComponent).join('/')}`);
  if (!res.ok) return null;
  const pdf = path.join(os.tmpdir(), `source-pages-${paper.id}-${doc}.pdf`);
  fs.writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  try {
    const r = spawnSync(pdftotext(), ['-q', '-tsv', pdf, '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) return null;
    const dir = path.join(cacheRoot, 'figure-anchors', paper.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${doc}.tsv`), r.stdout);
    return pagesFromTsv(r.stdout);
  } finally { fs.rmSync(pdf, { force: true }); }
}

async function main() {
  const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const ROOT = arg('--root') ? path.resolve(arg('--root')) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cacheRoot = path.resolve(arg('--cache-root') || path.join(ROOT, 'tmp'));
  const only = arg('--paper'), verbose = process.argv.includes('--verbose'), download = process.argv.includes('--download');
  const { readPapers, jsonText } = await import('./lib/problem-data.mjs');
  const { loadNavigation } = await import('./lib/navigation.mjs');
  const numbers = loadNavigation(ROOT).numbers?.problems ?? {};
  const file = path.join(ROOT, SOURCE_PAGES_FILE);
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, problems: {} };
  const entries = { ...prior.problems };
  const stats = { papers: 0, missing: 0, noLayer: 0, placed: 0, via: {}, byCompetition: {} };
  for (const record of readPapers(ROOT)) {
    const { paper, problems } = record.data;
    if (only && paper.id !== only) continue;
    const wanted = problems.filter(p => !hasSpan(p, 'problems'));
    if (!wanted.length || !/\.pdf$/i.test(paper.source?.archiveKey || '')) continue;
    stats.papers++;
    stats.missing += wanted.length;
    const layers = readLayers(paper, cacheRoot);
    if (!layers.problems && download) layers.problems = await downloadLayer(paper, 'problems', cacheRoot);
    if (!layers.solutions && download && paper.solutionSource) layers.solutions = await downloadLayer(paper, 'solutions', cacheRoot);
    for (const p of problems) delete entries[p.id];
    if (!layers.problems) { stats.noLayer += wanted.length; if (verbose) console.log(`${paper.id}: no text layer`); continue; }
    const found = paperPages(paper, problems, layers, numbers);
    const c = (stats.byCompetition[paper.competition] ??= { missing: 0, placed: 0 });
    c.missing += wanted.length;
    for (const p of problems) {
      const entry = {};
      for (const doc of ['problems', 'solutions']) { const hit = found[doc]?.get(p.id); if (hit) entry[doc] = hit; }
      if (!Object.keys(entry).length) continue;
      entries[p.id] = entry;
      if (entry.problems) { stats.placed++; c.placed++; stats.via[entry.problems.via] = (stats.via[entry.problems.via] || 0) + 1; }
    }
    if (verbose) console.log(`${paper.id}: ${wanted.filter(p => entries[p.id]?.problems).length}/${wanted.length} ${wanted.map(p => entries[p.id]?.problems?.page ?? '-').join(' ')}`);
  }
  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file, jsonText({ version: 1, problems: sorted }));
  console.log(`${stats.papers} papers, ${stats.missing} problems without a page: ${stats.placed} placed (${Object.entries(stats.via).map(([k, v]) => `${k} ${v}`).join(', ')}), ${stats.noLayer} without a text layer, ${stats.missing - stats.placed - stats.noLayer} not placed`);
  for (const [comp, c] of Object.entries(stats.byCompetition).sort()) console.log(`  ${comp}: ${c.placed}/${c.missing}`);
}
const invokedAsScript = (() => { try { return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invokedAsScript) main().catch(e => { console.error(e); process.exit(1); });
