#!/usr/bin/env node
// Canonicalise the metadata fields of transcribed papers (content/problems/**.json)
// so that headings, facets and counts line up:
//   grade: digits only — "9", "9-10", "11-12"; special groups keep their code (SP, ST, ML, junior)
//   round: the archive vocabulary — "I кръг (общински)", "II кръг (областен)", "III кръг (национален)", "IV кръг"
// Run with --check to only report.  Never touches statements or solutions.
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIR = path.join(ROOT, 'content', 'problems');
const check = process.argv.includes('--check');

const ROUND_MAP = [
  [/^(I|1)\b.*(общин)/iu, 'I кръг (общински)'],
  [/^(II|2)\b.*(областен|regional|обл)/iu, 'II кръг (областен)'],
  [/^(III|3)\b.*(национал|national|нац)/iu, 'III кръг (национален)'],
  [/^(IV|4)\b/u, 'IV кръг'],
  [/^I кръг$/u, 'I кръг (общински)'], [/^II кръг$/u, 'II кръг (областен)'], [/^III кръг$/u, 'III кръг (национален)'],
  // no numeral printed — the stage name alone identifies it
  [/^общински/iu, 'I кръг (общински)'], [/^областен/iu, 'II кръг (областен)'], [/^национален/iu, 'III кръг (национален)'], [/^(финал|финален)/iu, 'IV кръг'],
];
function canonRound(r) {
  if (r == null) return r;
  const s = String(r).trim();
  for (const [re, out] of ROUND_MAP) if (re.test(s)) return out;
  return s;
}
function canonGrade(g) {
  if (g == null) return g;
  let s = String(g).trim().replace(/\s*(клас|кл\.?|class)\s*$/iu, '').replace(/\s*[–—-]\s*/g, '-').replace(/\.$/, '');
  return s;
}
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : (e.name.endsWith('.json') && e.name !== 'schema.json' ? [path.join(d, e.name)] : [])); }
// Problem ids must be paper-prefixed ("<paperId>-p<N>"); a bare "p1" would collide
// with the next paper that does the same (uniqueId is global across the site).
const SAFE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function canonProblemIds(d) {
  const pid = d.paper.id; let renamed = 0;
  (d.problems ?? []).forEach((pr, i) => {
    const id = typeof pr.id === 'string' ? pr.id : '';
    if (id.startsWith(`${pid}-`) && SAFE.test(id)) return;
    // keep an existing safe suffix ("prakt-1" -> "<pid>-prakt-1"); otherwise number the problem
    let suffix;
    if (SAFE.test(id) && !id.startsWith(pid)) suffix = id;
    else if (Number.isInteger(pr.number)) suffix = `p${pr.number}`;
    else suffix = `p${i + 1}`;
    pr.id = `${pid}-${suffix}`; renamed++;
  });
  return renamed;
}

let changed = 0;
for (const f of walk(DIR)) {
  const raw = fs.readFileSync(f, 'utf8'); const d = JSON.parse(raw); const p = d.paper; const before = JSON.stringify([p.grade, p.round, (d.problems ?? []).map(x => x.id)]);
  p.grade = canonGrade(p.grade); p.round = canonRound(p.round); const renamed = canonProblemIds(d);
  if (renamed) console.log(`${path.relative(ROOT, f)}: ${renamed} problem id(s) prefixed with ${p.id}-`);
  if (JSON.stringify([p.grade, p.round, (d.problems ?? []).map(x => x.id)]) !== before) {
    changed++; console.log(`${path.relative(ROOT, f)}: ${before} -> ${JSON.stringify([p.grade, p.round])}`);
    if (!check) fs.writeFileSync(f, JSON.stringify(d, null, 1) + '\n');
  }
}
console.log(`${changed} paper(s) ${check ? 'would change' : 'normalised'}`);
