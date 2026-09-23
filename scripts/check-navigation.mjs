#!/usr/bin/env node
// Gate: the problems navigation (sidebar tree, page titles) is consistent across every paper.
//
//   node scripts/check-navigation.mjs [--root DIR]
//
// Builds the sidebar with the real src/problems/tree.ts over every paper in content/problems and the two overlays
// (content/round-labels.json, content/question-numbers.json), and exits 1 with one line per failure on
//   - a paper whose (competition, raw round, roundType) has no label in round-labels.json (and no per-paper label),
//   - a paper whose node label comes out empty (a '' round label on a paper without a grade),
//   - two problems with the same display number inside one sidebar node,
//   - a one-problem paper whose display number contradicts the Q/T/E/Problem/Задача number printed in paper.title,
//   - a paper the sidebar (tree.ts) and the page generator (scripts/lib/navigation.mjs) would name differently.
// Warnings (stale overlay entries, nodes the tree could only tell apart by paper id) go to stderr and do not fail.
// Fix a failure in the overlays, never in the paper JSON (hash-bound to its publication receipt).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPapers } from './lib/problem-data.mjs';
import { loadNavigation, roundKey, paperNodeLabel, displayNumber, printedQuestionNumber } from './lib/navigation.mjs';
import { loadTreeModule } from './lib/load-tree.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function checkNavigation(records, nav, tree = loadTreeModule(REPO)) {
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
    for (const p of problems) {
      if (String(tree.displayNumber(p, nav.numbers)) !== String(displayNumber(p, nav.numbers))) failures.push(`${p.id}: sidebar and page display numbers differ`);
    }
    if (problems.length === 1) {
      const printed = printedQuestionNumber(paper.title);
      const shown = displayNumber(problems[0], nav.numbers);
      if (printed != null && String(shown) !== String(printed)) failures.push(`${problems[0].id}: shown as ${shown} but paper.title prints question ${printed} (${String(paper.title).replace(/\s+/g, ' ').slice(0, 80)})`);
    }
  }
  // the sidebar itself: every problem gets a URL, so every paper is placed
  const urls = new Map([...problemIds].map(id => [id, `/problems/${id}/solution`]));
  const data = tree.assembleProblemsTree(files, urls, undefined, nav);
  let nodes = 0;
  for (const s of data.subjects) for (const c of s.competitions) for (const y of c.years) for (const node of y.papers) {
    nodes++;
    const seen = new Map();
    for (const p of node.problems) {
      const key = String(p.number);
      if (seen.has(key)) failures.push(`${c.code} ${y.year} '${node.label}': Задача ${key} twice (${seen.get(key)}, ${p.id})`);
      else seen.set(key, p.id);
    }
    if (/\([a-z0-9]+(?:-[a-z0-9]+)*\)$/.test(node.label)) warnings.push(`${c.code} ${y.year} '${node.label}': told apart only by its paper id; give it a suffix in content/round-labels.json`);
  }
  for (const id of Object.keys(nav.numbers?.problems ?? {})) if (!problemIds.has(id)) warnings.push(`content/question-numbers.json: ${id} is not a problem of any paper`);
  for (const section of ['papers', 'suffixes']) for (const id of Object.keys(nav.labels?.[section] ?? {})) if (!paperIds.has(id)) warnings.push(`content/round-labels.json ${section}: ${id} is not a paper (yet)`);
  return { failures, warnings, papers: files.length, nodes };
}

function main() {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : REPO;
  const { failures, warnings, papers, nodes } = checkNavigation(readPapers(root), loadNavigation(root));
  for (const w of warnings) console.error(`warning: ${w}`);
  for (const f of failures) console.log(f);
  console.log(`check-navigation: ${papers} papers, ${nodes} sidebar nodes, ${failures.length} failure(s), ${warnings.length} warning(s).`);
  if (failures.length) process.exitCode = 1;
}
const invokedAsScript = (() => { try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invokedAsScript) main();
