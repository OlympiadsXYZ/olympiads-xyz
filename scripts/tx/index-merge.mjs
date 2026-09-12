#!/usr/bin/env node
// index-merge.mjs [--out content/archive-index.json] [--report tmp/index/summary.md]
// Joins the archive-wide inventory: every catalogue "problems" document becomes
// one row — from the transcribed paper JSON when the document is transcribed
// (problem numbers, titles, points, types, topics from content/problems), else
// from the GLM index row in tmp/index/docs/, else "not indexed yet". Writes a
// single JSON (one row per document, one entry per problem) and a Markdown
// summary by subject/competition with counts of documents, problems, coverage.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJson, writeJson, listContentFiles, ROOT, nowIso } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const outFile = path.resolve(args.out || path.join(ROOT, 'content', 'archive-index.json'));
const reportFile = path.resolve(args.report || path.join(ROOT, 'tmp', 'index', 'summary.md'));

let catalogue = [];
for (const f of fs.readdirSync(path.join(ROOT, 'archive-catalog')).filter(f => f.endsWith('.json') && f !== 'schema.json')) {
  const j = readJson(path.join(ROOT, 'archive-catalog', f), []);
  if (Array.isArray(j)) catalogue = catalogue.concat(j);
}
const docs = catalogue.filter(e => e.kind === 'competition' && e.type === 'problems' && !e.hidden);
const solutionsFor = new Map(); // problems file -> sibling solutions files (same competition/year/round/group/lang)
const bucket = e => [e.subject, e.competition, e.year, e.round ?? '', e.group ?? '', e.lang].join('|');
const sols = new Map();
for (const e of catalogue) if (e.kind === 'competition' && e.type === 'solutions' && !e.hidden) { const k = bucket(e); if (!sols.has(k)) sols.set(k, []); sols.get(k).push(e.file); }
for (const e of docs) solutionsFor.set(e.file, sols.get(bucket(e)) || []);

// transcribed papers by problems archive key
const byKey = new Map();
for (const f of listContentFiles()) {
  let p; try { p = readJson(f); } catch { continue; }
  const key = p?.paper?.source?.archiveKey;
  if (key) byKey.set(key, { file: path.relative(ROOT, f).split(path.sep).join('/'), paper: p });
}
const indexDir = path.join(ROOT, 'tmp', 'index', 'docs');
const rows = [];
const stats = {};
const bump = (k, field, n = 1) => { const s = stats[k] || (stats[k] = { documents: 0, transcribed: 0, indexed: 0, pending: 0, problems: 0 }); s[field] += n; };
for (const e of docs) {
  const k = `${e.subject}/${e.competition}`;
  bump(k, 'documents');
  const row = { id: e.id, subject: e.subject, competition: e.competition, year: e.year, round: e.round ?? null, group: e.group ?? null, lang: e.lang, title: e.title, file: e.file, solutions: solutionsFor.get(e.file), status: 'pending', problems: [] };
  const t = byKey.get(e.file);
  const ix = readJson(path.join(indexDir, `${e.id}.json`), null);
  if (t) {
    const p = t.paper;
    row.status = 'transcribed'; row.paperId = p.paper.id; row.paperFile = t.file; row.grade = p.paper.grade ?? null; row.printedMeta = p.paper.title || null;
    row.problems = p.problems.map(pr => ({ number: pr.number, title: pr.title ?? null, points: pr.points ?? null, problemType: pr.problemType ?? null, topics: pr.topics ?? [], parts: (pr.parts || []).length, figures: (pr.figures || []).length + ((pr.parts || []).reduce((a, x) => a + (x.figures || []).length, 0)), solution: !!(pr.solution && !pr.solution.incomplete), url: `/problems/${pr.id}` }));
    bump(k, 'transcribed');
  } else if (ix?.index) {
    row.status = 'indexed'; row.grade = ix.index.grade ?? null; row.printedMeta = ix.index.printedMeta ?? null; row.language = ix.index.language ?? null; row.pages = ix.pageCount; row.notes = ix.index.notes || null;
    row.problems = (ix.index.problems || []).map(pr => ({ number: pr.number, title: pr.title ?? null, points: pr.points ?? null, problemType: pr.problemType ?? null, topics: pr.topics ?? [], parts: pr.parts ?? null, figures: pr.figures ?? null, summary: pr.summary ?? null }));
    bump(k, 'indexed');
  } else bump(k, 'pending');
  bump(k, 'problems', row.problems.length);
  rows.push(row);
}
rows.sort((a, b) => a.subject.localeCompare(b.subject) || a.competition.localeCompare(b.competition) || (a.year || 0) - (b.year || 0) || String(a.round).localeCompare(String(b.round)) || String(a.group).localeCompare(String(b.group)));
const totals = Object.values(stats).reduce((a, s) => { for (const k of Object.keys(s)) a[k] = (a[k] || 0) + s[k]; return a; }, {});
writeJson(outFile, { generatedAt: nowIso(), documents: rows.length, totals, rows });

const md = [`# Archive problem inventory — ${nowIso()}`, '', `${rows.length} problems documents in the catalogue (all competitions, years, groups, languages): ${totals.transcribed} transcribed on the site, ${totals.indexed} indexed by GLM, ${totals.pending} not indexed yet; ${totals.problems} problems listed.`, '', '| subject/competition | documents | transcribed | indexed | pending | problems |', '|---|---:|---:|---:|---:|---:|'];
for (const [k, s] of Object.entries(stats).sort((a, b) => b[1].documents - a[1].documents)) md.push(`| ${k} | ${s.documents} | ${s.transcribed} | ${s.indexed} | ${s.pending} | ${s.problems} |`);
const topics = {};
for (const r of rows) for (const p of r.problems) for (const t of p.topics || []) topics[t] = (topics[t] || 0) + 1;
md.push('', '## Problems by topic (controlled vocabulary)', '', '| topic | problems |', '|---|---:|');
for (const [t, n] of Object.entries(topics).sort((a, b) => b[1] - a[1])) md.push(`| ${t} | ${n} |`);
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, md.join('\n') + '\n');
console.log(md.slice(0, 4).join('\n'));
console.log(`wrote ${path.relative(ROOT, outFile)} and ${path.relative(ROOT, reportFile)}`);
