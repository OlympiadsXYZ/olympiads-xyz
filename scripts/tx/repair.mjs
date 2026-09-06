#!/usr/bin/env node
// repair.mjs <paperId> --candidate <f> --receipt <r> --out <f> [--by <label>] [--round N]
// The separate repair step the checker is forbidden to be (Codex §4): applies
// the checker's `suggestedFix` values mechanically to the candidate — exact
// replacement text for string fields, a corrected box for figure proposals, a
// number for points — and records every change under tx.repairs. Nothing is
// invented: a defect without a usable suggestedFix is left for the adjudicator.
// Figures whose box changed lose url/width/height/source so figures.mjs must
// crop and upload them again; run.mjs then re-validates, re-runs figures and a
// fresh checker before a new receipt. Exit 0 all applied, 3 some skipped, 1 error.
import path from 'node:path';
import { parseArgs, fail, readJson, writeJson, pointerGet, pointerSet, allFigures, nowIso, sha256File } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const paperId = args._[0];
if (!paperId || !args.candidate || !args.receipt || !args.out) fail('usage: repair.mjs <paperId> --candidate <f> --receipt <r> --out <f> [--by label] [--round N]');
const candFile = path.resolve(args.candidate);
const candidate = readJson(candFile, null);
const receipt = readJson(path.resolve(args.receipt), null);
if (!candidate || !receipt) fail('candidate or receipt not readable');
if (candidate.paper?.id !== paperId || receipt.paperId !== paperId) fail('paper id mismatch');
if (receipt.candidateSha256 && receipt.candidateSha256 !== sha256File(candFile)) fail('the receipt was written for different candidate bytes');
const by = args.by || 'repair.mjs';
const round = Number(args.round || ((candidate.tx?.repairs || []).reduce((m, r) => Math.max(m, r.round || 0), 0) + 1));

const parseBox = v => {
  if (Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number')) return v;
  if (typeof v !== 'string') return null;
  const m = v.match(/-?\d+(?:\.\d+)?/g);
  return m && m.length === 4 ? m.map(Number) : null;
};
const applied = [], skipped = [];
const touchedFigures = new Set();
for (const d of receipt.defects || []) {
  const entry = { path: d.path, kind: d.kind, severity: d.severity, description: d.description };
  if (d.suggestedFix == null || d.suggestedFix === '') { skipped.push({ ...entry, reason: 'no suggestedFix' }); continue; }
  const p = String(d.path || '');
  if (!p.startsWith('/')) { skipped.push({ ...entry, reason: 'path is not a JSON pointer' }); continue; }
  // figure boxes: /…/figures/N/tx/bbox, /…/figures/N/tx, /…/figures/N
  const figMatch = /^(.*\/figures\/\d+)(?:\/tx(?:\/bbox)?)?$/.exec(p);
  if (figMatch && (d.kind === 'figure' || /bbox$/.test(p))) {
    const box = parseBox(d.suggestedFix);
    const fig = pointerGet(candidate, figMatch[1]);
    if (!box || !fig || typeof fig !== 'object') { skipped.push({ ...entry, reason: 'suggestedFix is not a 4-number box or figure path unknown' }); continue; }
    fig.tx = { ...(fig.tx || {}), bbox: box };
    touchedFigures.add(figMatch[1]);
    applied.push({ ...entry, from: pointerGet(candidate, figMatch[1] + '/tx/bbox'), to: box });
    continue;
  }
  const current = pointerGet(candidate, p);
  if (typeof current === 'string' && typeof d.suggestedFix === 'string') {
    if (current === d.suggestedFix) { skipped.push({ ...entry, reason: 'already identical' }); continue; }
    pointerSet(candidate, p, d.suggestedFix);
    applied.push({ ...entry, from: current, to: d.suggestedFix });
    continue;
  }
  if (typeof current === 'number' || (current == null && /\/points$/.test(p))) {
    const n = typeof d.suggestedFix === 'number' ? d.suggestedFix : Number(String(d.suggestedFix).replace(',', '.'));
    if (!Number.isFinite(n)) { skipped.push({ ...entry, reason: 'suggestedFix is not a number' }); continue; }
    pointerSet(candidate, p, n);
    applied.push({ ...entry, from: current ?? null, to: n });
    continue;
  }
  skipped.push({ ...entry, reason: `cannot apply a ${typeof d.suggestedFix} fix to a ${current === undefined ? 'missing' : typeof current} field` });
}
// a changed box invalidates the crop, upload and public-URL evidence of that figure
for (const { fig, path: p } of allFigures(candidate)) {
  if (!touchedFigures.has(p)) continue;
  delete fig.url; delete fig.width; delete fig.height; delete fig.source;
  fig.tx = { document: fig.tx.document, page: fig.tx.page, bbox: fig.tx.bbox };
}
candidate.tx = { ...(candidate.tx || {}), repairs: [...(candidate.tx?.repairs || []), ...applied.map(a => ({ round, at: nowIso(), by, receipt: path.relative(process.cwd(), path.resolve(args.receipt)), ...a }))] };
const out = path.resolve(args.out);
writeJson(out, candidate);
const report = { paperId, round, out, applied: applied.length, skipped: skipped.length, changes: applied, unapplied: skipped, figuresToRedo: [...touchedFigures] };
console.log(JSON.stringify(report, null, 2));
process.exit(skipped.length ? 3 : 0);
