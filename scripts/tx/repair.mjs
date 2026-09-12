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
import { plausibleReplacement, spliceFragment, looksLikeInstruction, duplicatesSiblings } from './fixes.mjs';

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
  if (Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number')) return v[2] > v[0] && v[3] > v[1] ? v : null;
  if (typeof v !== 'string') return null;
  // only a string that IS a box, never four numbers fished out of a sentence ("page 2, fig 1 … 4 … 1" once became [2,1,4,1])
  const m = /^\s*\[?\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*\]?\s*$/.exec(v);
  if (!m) return null;
  const box = m.slice(1, 5).map(Number);
  return box[2] > box[0] && box[3] > box[1] ? box : null;
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
    fig.tx = { ...(fig.tx || {}), bbox: box, boxFrom: 'checker' }; // a judged box: snap.mjs leaves it alone
    touchedFigures.add(figMatch[1]);
    applied.push({ ...entry, from: pointerGet(candidate, figMatch[1] + '/tx/bbox'), to: box });
    continue;
  }
  const current = pointerGet(candidate, p);
  if (typeof current === 'string' && typeof d.suggestedFix === 'string') {
    if (current === d.suggestedFix) { skipped.push({ ...entry, reason: 'already identical' }); continue; }
    // A checker sometimes "fixes" an omission with a pointer ("full text per pp. 2–3, starting …")
    // instead of the text; restoring an omission can only make the field longer.
    if (d.kind === 'omission' && d.suggestedFix.length <= current.length) { skipped.push({ ...entry, reason: 'omission fix is not longer than the current text (not a replacement)' }); continue; }
    if (looksLikeInstruction(d.suggestedFix)) { skipped.push({ ...entry, reason: 'suggestedFix is an instruction, not a replacement' }); continue; }
    const dup = duplicatesSiblings(candidate, p, d.suggestedFix, current);
    if (dup) { skipped.push({ ...entry, reason: `suggestedFix pastes the text of ${dup} into this field` }); continue; }
    // a quoted sentence replaces the passage it corrects, not the whole field
    const spliced = spliceFragment(current, d.suggestedFix);
    if (spliced) { pointerSet(candidate, p, spliced); applied.push({ ...entry, from: current, to: spliced, spliced: d.suggestedFix }); continue; }
    if (!plausibleReplacement(current, d.suggestedFix, d.kind)) { skipped.push({ ...entry, reason: 'suggestedFix is an instruction or does not resemble the field it replaces (wrong path?)' }); continue; }
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
  fig.tx = { document: fig.tx.document, page: fig.tx.page, bbox: fig.tx.bbox, ...(fig.tx.boxFrom ? { boxFrom: fig.tx.boxFrom } : {}) };
}
candidate.tx = { ...(candidate.tx || {}), repairs: [...(candidate.tx?.repairs || []), ...applied.map(a => ({ round, at: nowIso(), by, receipt: path.relative(process.cwd(), path.resolve(args.receipt)), ...a }))] };
const out = path.resolve(args.out);
writeJson(out, candidate);
const report = { paperId, round, out, applied: applied.length, skipped: skipped.length, changes: applied, unapplied: skipped, figuresToRedo: [...touchedFigures] };
console.log(JSON.stringify(report, null, 2));
process.exit(skipped.length ? 3 : 0);
