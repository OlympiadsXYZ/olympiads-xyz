// Snap a reader's figure proposals onto graphics the PDF itself contains.
// Cheap readers place boxes on the right page but often on body text next to
// the drawing, or clip its labels. Born-digital PDFs carry the truth: embedded
// images and clustered vector paths (scripts/pdfregions.py, in permille of the
// displayed page, with nearby short text folded in). A scanned page has no such
// structure and is left alone. Every change is recorded on the figure's tx
// block (bboxProposed, snapped) so checkers, receipts and the benchmark can
// tell a snapped box from a proposed one. Pure functions; figures.mjs calls
// them once per candidate, before cropping, and never on a box that already
// went through here (a repair after that is the checker's fix and stays).
import fs from 'node:fs';
import path from 'node:path';
import { run, paperDir, readJson, writeJson, sha256File, ROOT } from './lib.mjs';

const PDFREGIONS = path.join(ROOT, 'scripts', 'pdfregions.py');
const PAD = 6;            // permille added around a snapped region
const MIN_IOU = 0.2;      // overlap that ties a proposal to a region
const MIN_CORE_IN = 0.5;  // or: this much of the region's drawing lies inside the proposal
const MAX_GROW = 3;       // never replace a box by a region more than 3x its area (a merged group of figures)
const MAX_NEAREST = 350;  // permille (centre distance) for rescuing a box that overlaps no graphic

const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inter = (a, b) => { const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]); return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0; };
export const iou = (a, b) => { const i = inter(a, b); return i ? i / (area(a) + area(b) - i) : 0; };
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const centre = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = b => b.map(v => Math.round(Math.min(1000, Math.max(0, v))));
const pad = b => clamp([b[0] - PAD, b[1] - PAD, b[2] + PAD, b[3] + PAD]);

// Regions for one document, cached next to the pages and keyed by the PDF hash.
export function regionsFor(paperId, manifest, doc) {
  const d = manifest.documents[doc];
  if (!d) return null;
  const pdf = path.join(paperDir(paperId), d.file);
  if (!fs.existsSync(pdf)) return null;
  const cacheFile = path.join(paperDir(paperId), 'regions', `${doc}.json`);
  const cached = readJson(cacheFile, null);
  if (cached && cached.sha256 === d.sha256) return cached;
  const r = run('python3', [PDFREGIONS, pdf], { allowFail: true });
  if (r.status !== 0) return null;
  const data = { sha256: d.sha256, at: new Date().toISOString(), ...JSON.parse(r.stdout) };
  writeJson(cacheFile, data);
  return data;
}

// Decide one box. Returns { bbox, reason, region } or null when the proposal stays.
export function snapBox(bbox, pageRegions, { taken = [] } = {}) {
  if (!pageRegions || pageRegions.scanned || !pageRegions.regions?.length) return null;
  const regions = pageRegions.regions;
  const scored = regions.map((g, i) => ({ i, g, iou: iou(bbox, g.bbox), coreIn: area(g.core) ? inter(bbox, g.core) / area(g.core) : 0 }));
  const hits = scored.filter(s => s.iou >= MIN_IOU || s.coreIn >= MIN_CORE_IN);
  if (hits.length === 1) {
    const g = hits[0].g;
    if (area(g.bbox) > MAX_GROW * area(bbox)) return null; // one region for a whole group of figures: keep the reader's choice
    const snapped = pad(g.bbox);
    return iou(snapped, bbox) > 0.98 ? null : { bbox: snapped, reason: 'region', region: hits[0].i };
  }
  if (hits.length > 1) {
    const u = hits.map(s => s.g.bbox).reduce(union);
    if (area(u) > 2 * area(bbox)) return null;
    return { bbox: pad(u), reason: 'union', region: hits.map(s => s.i) };
  }
  // no graphic under the box at all: it sits on text. Move it to the nearest free graphic when one is close.
  const c = centre(bbox);
  const free = scored.filter(s => !taken.includes(s.i) && area(s.g.bbox) <= MAX_GROW * area(bbox)).map(s => ({ ...s, d: dist(c, centre(s.g.bbox)) })).sort((a, b) => a.d - b.d);
  if (free.length && free[0].d <= MAX_NEAREST) return { bbox: pad(free[0].g.bbox), reason: 'nearest', region: free[0].i, distance: Math.round(free[0].d) };
  return null;
}

// Apply to every figure proposal of a candidate (mutates the figure tx blocks). Returns a summary.
export function snapCandidate(candidate, manifest, paperId, allFigures) {
  const summary = { snapped: 0, kept: 0, skipped: 0, scannedPages: 0, details: [] };
  const cache = new Map();
  const takenByPage = new Map();
  for (const { fig, path: p } of allFigures(candidate)) {
    const t = fig.tx;
    if (!t?.bbox || !t.document || !t.page) continue;
    if (t.snapped || t.bboxProposed) { summary.skipped++; continue; }
    if (!cache.has(t.document)) cache.set(t.document, regionsFor(paperId, manifest, t.document));
    const regs = cache.get(t.document)?.pages?.find(pg => pg.page === t.page) || null;
    if (regs?.scanned) summary.scannedPages++;
    const key = `${t.document}#${t.page}`;
    const taken = takenByPage.get(key) || [];
    const r = snapBox(t.bbox, regs, { taken });
    if (!r) { summary.kept++; continue; }
    t.bboxProposed = t.bbox;
    t.bbox = r.bbox;
    t.snapped = { reason: r.reason, region: r.region, ...(r.distance != null ? { distance: r.distance } : {}) };
    for (const i of [].concat(r.region)) taken.push(i);
    takenByPage.set(key, taken);
    summary.snapped++;
    summary.details.push({ id: fig.id, path: p, from: t.bboxProposed, to: t.bbox, reason: r.reason });
  }
  return summary;
}
