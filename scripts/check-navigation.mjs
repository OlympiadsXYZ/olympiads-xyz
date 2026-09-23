#!/usr/bin/env node
// Gate: the problems navigation (sidebar tree, page titles) is consistent across every paper.
//
//   node scripts/check-navigation.mjs [--root DIR]
//
// Builds the sidebar with the real src/problems/tree.ts over every paper in content/problems and the two overlays
// (content/round-labels.json, content/question-numbers.json), and exits 1 with one line per failure on
//   - a paper whose (competition, raw round, roundType) has no label in round-labels.json (and no per-paper label),
//   - a paper whose node label comes out empty (a '' round label on a paper without a grade),
//   - a label (round, per-paper, suffix or the node's) that is, or holds, the paper's raw paper.title,
//   - a node label with Latin words outside LATIN_ALLOWED (labels are Bulgarian; names and codes are listed there),
//   - a competition the sidebar has no Bulgarian name for (src/archive/labels.ts COMPETITION_META; a legacy code
//     joins its canonical competition through COMPETITION_ALIASES),
//   - a sidebar node the tree could tell apart only by its paper id ("Теория (ipho-2016-theory-1)": the papers of one
//     exam whose numbers collide — a one-question file without its display number in question-numbers.json),
//   - one-question papers of one round, grade and language that a suffix splits into several nodes although their
//     numbers do not collide (Q1 and Q2 of one exam in different nodes),
//   - two problems with the same display number inside one sidebar node,
//   - a row whose visible label does not lead with its display number, or that the page titles differently,
//   - a problem title that opens with a grade-problem code ("10-1 «Сифон»", "11 класс. Задача 2") the display number
//     contradicts (an all-grade file numbered straight through),
//   - a one-problem paper whose display number contradicts the Q/T/E/Problem/Задача number printed in paper.title,
//   - a paper the sidebar (tree.ts) and the page generator (scripts/lib/navigation.mjs) would name differently.
// Warnings (stale overlay entries) go to stderr and do not fail.
// Fix a failure in the overlays, never in the paper JSON (hash-bound to its publication receipt).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPapers } from './lib/problem-data.mjs';
import { loadNavigation, roundKey, paperNodeLabel, displayNumber, printedQuestionNumber } from './lib/navigation.mjs';
import { loadTreeModule } from './lib/load-tree.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Latin words a node label may hold: Roman round numerals, the olympiads' own codes and proper names.
export const LATIN_ALLOWED = new Set(['GeCAA', 'IAO', 'IOAA', 'IPhO', 'NAO', 'OM', 'OP', 'OT', 'Road', 'to', 'Invent', 'Yourself']);
const ROMAN = /^(?:I{1,3}|IV|VI{0,3}|IX|X{1,3}|XI{1,2})$/;
const latinWords = label => (String(label).match(/[A-Za-z]{2,}/g) || []).filter(w => !ROMAN.test(w) && !LATIN_ALLOWED.has(w));
const flat = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
// the label holds the raw masthead: an English, dashed or long title ("IPhO 2016 — Theory Q1 — Two Problems in
// Mechanics (10 points)", "МОН, XLVI НАЦИОНАЛНА ОЛИМПИАДА …"). A title that is itself a short Bulgarian round name
// ("Анализ на данни", "Отборен тур") is a fine label; a title of a few characters proves nothing.
const holdsTitle = (label, title) => {
  const t = flat(title);
  if (t.length < 6 || !flat(label).includes(t)) return false;
  return t.length > 40 || /[—–]/.test(t) || latinWords(title).length > 0;
};

export function checkNavigation(records, nav, tree = loadTreeModule(REPO), { pageName } = {}) {
  const failures = [], warnings = [];
  const files = records.map(r => r.data);
  const problemIds = new Set(), paperIds = new Set();
  for (const { paper, problems } of files) {
    paperIds.add(paper.id);
    for (const p of problems) problemIds.add(p.id);
    const label = paperNodeLabel(paper, nav.labels);
    if (label == null) {
      failures.push(`${paper.id}: no round label for ${paper.competition} '${roundKey(paper)}' in content/round-labels.json`);
      continue;
    }
    if (!label) failures.push(`${paper.id}: empty sidebar label (round label '' and no grade)`);
    const sidebar = tree.paperLabel(paper, nav.labels);
    if (label && sidebar !== label) failures.push(`${paper.id}: sidebar label '${sidebar}' differs from page label '${label}'`);
    const parts = { 'round label': tree.roundLabel(paper, nav.labels), suffix: nav.labels?.suffixes?.[paper.id], 'node label': label };
    for (const [what, text] of Object.entries(parts)) if (text && holdsTitle(text, paper.title)) failures.push(`${paper.id}: the ${what} '${text}' is the raw paper.title; name the round in content/round-labels.json`);
    if (!tree.hasCompetitionName(paper.competition)) failures.push(`${paper.id}: competition ${paper.competition} has no entry in src/archive/labels.ts COMPETITION_META (nor an alias in COMPETITION_ALIASES): the sidebar would show the raw code`);
    for (const p of problems) {
      const shown = displayNumber(p, nav.numbers);
      if (String(tree.displayNumber(p, nav.numbers)) !== String(shown)) failures.push(`${p.id}: sidebar and page display numbers differ`);
      const code = tree.gradeCode(p.title);
      if (code && String(shown) !== code.n && !tree.numberNamesCode(shown, code)) failures.push(`${p.id}: title prints ${code.grade}-${code.n} ('${String(p.title).slice(0, 40)}') but the problem is shown as ${shown}; give it '${code.grade}.${code.n}' (or the paper's own form) in content/question-numbers.json`);
    }
    if (problems.length === 1) {
      const printed = printedQuestionNumber(paper.title);
      const shown = displayNumber(problems[0], nav.numbers);
      if (printed != null && String(shown) !== String(printed)) failures.push(`${problems[0].id}: shown as ${shown} but paper.title prints question ${printed} (${String(paper.title).replace(/\s+/g, ' ').slice(0, 80)})`);
    }
  }
  // one exam split by a suffix: one-question papers of one round, grade and language in several nodes, no collision
  const exams = new Map();
  for (const { paper, problems } of files) {
    const base = [tree.paperCompetition(paper), paper.year, tree.roundLabel(paper, nav.labels), tree.gradeLabel(paper.grade, paper.subject, paper.competition, nav.labels), paper.lang ?? ''].join('|');
    if (!exams.has(base)) exams.set(base, []);
    exams.get(base).push({ paper, problems });
  }
  for (const [base, list] of exams) {
    const suffixes = new Set(list.map(x => nav.labels?.suffixes?.[x.paper.id] || ''));
    if (suffixes.size < 2 || !list.every(x => x.problems.length === 1)) continue;
    const numbers = list.map(x => String(displayNumber(x.problems[0], nav.numbers)));
    if (new Set(numbers).size === numbers.length) failures.push(`${base.split('|').slice(0, 3).join(' ')}: the one-question papers ${list.map(x => x.paper.id).join(', ')} (questions ${numbers.join(', ')}) are one exam split into several nodes by content/round-labels.json suffixes`);
  }
  // the sidebar itself: every problem gets a URL, so every paper is placed
  const urls = new Map([...problemIds].map(id => [id, `/problems/${id}/solution`]));
  const data = tree.assembleProblemsTree(files, urls, undefined, nav);
  const problemById = new Map(files.flatMap(f => f.problems.map(p => [p.id, p])));
  let nodes = 0;
  for (const s of data.subjects) for (const c of s.competitions) for (const y of c.years) for (const node of y.papers) {
    nodes++;
    const seen = new Map();
    for (const p of node.problems) {
      const key = String(p.number);
      if (seen.has(key)) failures.push(`${c.code} ${y.year} '${node.label}': Задача ${key} twice (${seen.get(key)}, ${p.id})`);
      else seen.set(key, p.id);
      const row = tree.problemLabel(p);
      if (!tree.labelLeadsWithNumber(row, p.number)) failures.push(`${p.id}: row '${row.slice(0, 60)}' does not lead with its number ${p.number}`);
      if (pageName) {
        const page = pageName(problemById.get(p.id), nav.numbers);
        if (page !== row) failures.push(`${p.id}: page title '${page.slice(0, 60)}' differs from the sidebar row '${row.slice(0, 60)}'`);
      }
    }
    if (/\([a-z0-9]+(?:-[a-z0-9]+)*\)$/.test(node.label)) failures.push(`${c.code} ${y.year} '${node.label}': told apart only by its paper id; give it a display number in content/question-numbers.json or a suffix in content/round-labels.json`);
    const latin = latinWords(node.label);
    if (latin.length) failures.push(`${c.code} ${y.year} '${node.label}': Latin text '${latin.join(' ')}' in a node label (translate it, or add a proper name to LATIN_ALLOWED)`);
  }
  for (const id of Object.keys(nav.numbers?.problems ?? {})) if (!problemIds.has(id)) warnings.push(`content/question-numbers.json: ${id} is not a problem of any paper`);
  for (const section of ['papers', 'suffixes']) for (const id of Object.keys(nav.labels?.[section] ?? {})) if (!paperIds.has(id)) warnings.push(`content/round-labels.json ${section}: ${id} is not a paper (yet)`);
  return { failures, warnings, papers: files.length, nodes };
}

async function main() {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : REPO;
  const { problemName } = await import('./problems-to-site.mjs');
  const { failures, warnings, papers, nodes } = checkNavigation(readPapers(root), loadNavigation(root), undefined, { pageName: problemName });
  for (const w of warnings) console.error(`warning: ${w}`);
  for (const f of failures) console.log(f);
  console.log(`check-navigation: ${papers} papers, ${nodes} sidebar nodes, ${failures.length} failure(s), ${warnings.length} warning(s).`);
  if (failures.length) process.exitCode = 1;
}
const invokedAsScript = (() => { try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invokedAsScript) main();
