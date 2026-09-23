#!/usr/bin/env node
// Proposes display numbers for content/question-numbers.json: the problems whose stored number is not the number
// the paper prints. The one-question-per-file papers (IOAA 2021 tq-1 … tq-15, APhO, IPhO, IEPhO …) were each
// transcribed on their own, so every one of them stores "1"; the printed masthead (paper.title), the paper id and
// the archive file name (Q2, T3, E1, theory-2, exp2, tq-10, "Problem 3", "Задача 2", "Э-10.2" …) say which
// question it is.
//
//   node scripts/derive-question-numbers.mjs [--all] [--draft]
//
// Looks at (a) the papers that share a sidebar node (same competition, year, round label and grade — see
// content/round-labels.json) whose stored numbers collide, and (b) every one-problem paper whose title prints a
// question number other than the one shown. --all lists every one-problem paper with evidence. --draft prints the
// unanimous proposals as JSON. Nothing is written: every proposal is checked by hand against paper.title before it
// goes into content/question-numbers.json (anything that cannot be settled goes under "_unresolved" with the reason).
// Papers for different grades / age groups restart at 1 legitimately and are told apart by their grade label.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPapers } from './lib/problem-data.mjs';
import { loadNavigation, paperNodeLabel, displayNumber, numberEvidence, printedQuestionNumber } from './lib/navigation.mjs';
import { loadTreeModule } from './lib/load-tree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const all = process.argv.includes('--all'), draft = process.argv.includes('--draft');

export function deriveProposals(records, nav, tree = loadTreeModule()) {
  // the sidebar's own grouping (src/problems/tree.ts): a paper still "collides" when the tree could not merge it
  // with the papers of its label, tour and language and had to give it a node of its own labelled with its id
  const byYear = new Map();
  for (const { data } of records) {
    const key = `${data.paper.subject}|${data.paper.competition}|${data.paper.year}`;
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(data);
  }
  const groups = new Map(), colliding = new Set();
  for (const [year, papers] of byYear) {
    const accs = papers.map(d => ({ paper: d.paper, problems: d.problems.map(p => ({ id: p.id, number: tree.displayNumber(p, nav.numbers), title: p.title ?? null, url: '' })) }));
    for (const node of tree.yearNodes(accs, nav.labels)) {
      const ids = new Set(node.problems.map(p => p.id));
      const members = papers.filter(d => d.problems.some(p => ids.has(p.id)));
      for (const d of members) if (node.label.endsWith(`(${d.paper.id})`)) colliding.add(d.paper.id);
    }
    for (const d of papers) {
      const key = `${year}|${paperNodeLabel(d.paper, nav.labels) ?? '(no label)'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }
  }
  const out = [];
  for (const [key, papers] of groups) {
    for (const d of papers) {
      const collides = colliding.has(d.paper.id);
      const printed = d.problems.length === 1 ? printedQuestionNumber(d.paper.title) : null;
      const shown = d.problems.length === 1 ? displayNumber(d.problems[0], nav.numbers) : null;
      const contradicts = printed != null && shown !== printed;
      if (!collides && !contradicts && !all) continue;
      if (all && d.problems.length !== 1 && !collides) continue;
      const evidence = numberEvidence(d.paper, d.problems);
      const values = [...new Set(evidence.map(e => e.n))];
      out.push({
        group: key, paperId: d.paper.id, title: String(d.paper.title ?? '').replace(/\s+/g, ' ').slice(0, 140),
        problems: d.problems.map(p => ({ id: p.id, stored: p.number, shown: displayNumber(p, nav.numbers) })),
        evidence, proposal: d.problems.length === 1 && values.length === 1 ? values[0] : null,
        reason: d.problems.length !== 1 ? 'several problems in the paper' : values.length === 0 ? 'no printed number found' : values.length > 1 ? `sources disagree: ${values.join(' / ')}` : null,
        collides, contradicts,
      });
    }
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.paperId.localeCompare(b.paperId));
}

function main() {
  const records = readPapers(ROOT);
  const nav = loadNavigation(ROOT);
  const proposals = deriveProposals(records, nav);
  if (draft) {
    const problems = {};
    for (const p of proposals) if (p.proposal != null && p.problems[0].shown !== p.proposal) problems[p.problems[0].id] = p.proposal;
    console.log(JSON.stringify(problems, null, 2));
    return;
  }
  let group = null;
  for (const p of proposals) {
    if (p.group !== group) console.log(`\n== ${(group = p.group)}`);
    const nums = p.problems.map(x => x.shown === x.stored ? `${x.stored}` : `${x.stored}->${x.shown}`).join(',');
    const flag = p.proposal == null ? `?? ${p.reason}` : p.proposal === p.problems[0].shown ? 'ok' : `PROPOSE ${p.proposal}`;
    console.log(`  ${p.paperId} [${nums}] ${flag}${p.contradicts ? ' (title contradicts)' : ''}`);
    console.log(`      T: ${p.title}`);
    if (p.evidence.length) console.log(`      E: ${p.evidence.map(e => `${e.source}=${e.n}`).join(' ')}`);
  }
  const open = proposals.filter(p => p.proposal != null && p.proposal !== p.problems[0].shown).length;
  console.log(`\n${proposals.length} paper(s) listed; ${open} proposal(s) differ from what is shown.`);
}
const invokedAsScript = (() => { try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invokedAsScript) main();
