#!/usr/bin/env node
// figures.mjs <paperId> <candidate.json> [--dry-run] [--out <file>]
// Executes the reader's figure proposals mechanically: convert the permille box
// to preview pixels of the right page, crop with pdfcrop.py from the right
// document, reject trivial/blank crops, upload to R2 only when no object with
// the same content exists (never overwrite; a different object under the same
// name gets a -vN suffix), verify the public URL, and write a copy of the
// candidate (<name>.figs.json) with url/width/height/source filled in.
// --dry-run crops and inspects but assigns NO url (so the result can never be
// mistaken for uploaded figures); it is for looking at crops before spending.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, fail, readJson, writeJson, readManifest, paperDir, allFigures, run, which, md5, headStatuses,
  PDFCROP, RENDER_DPI, FIGURE_DPI, R2_REMOTE, figureUrl, nowIso, bboxToPreviewPx, sha256File,
} from './lib.mjs';
import { snapCandidate, regionsFor, coverFrac, iou } from './snap.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['dry-run', 'no-snap'] });
const [paperId, candFile] = args._;
if (!paperId || !candFile) fail('usage: figures.mjs <paperId> <candidate.json> [--dry-run] [--out <file>]');
const dry = !!args['dry-run'];
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}; run prepare.mjs first`);
const data = readJson(path.resolve(candFile));
if (!data) fail(`candidate not readable: ${candFile}`);
const outFile = path.resolve(args.out || candFile.replace(/\.json$/, '') + '.figs.json');
// One crop folder per candidate: several readers write into the same paper dir.
const figDir = path.join(paperDir(paperId), 'figs', path.basename(candFile).replace(/\.json$/, ''));
fs.mkdirSync(figDir, { recursive: true });
if (!which('python3')) fail('python3 not found');
if (!dry && !which('rclone')) fail('rclone not found');

const proposals = allFigures(data).filter(f => f.fig.tx?.bbox);
// Snap the proposals onto graphics the PDF itself contains (born-digital pages
// only; scans are left alone). Recorded per figure as tx.bboxProposed/tx.snapped;
// --no-snap keeps the reader's boxes (benchmarking raw reader quality).
const snap = args['no-snap'] ? null : snapCandidate(data, manifest, paperId, allFigures);
const report = { paperId, dryRun: dry, at: nowIso(), snap, figures: [], errors: [], unplaced: args['no-snap'] ? [] : unplacedGraphics(data, manifest, paperId) };

// Graphics the PDF prints that no figure box covers: a drawing the reader left
// out (the solution's "Фиг. 2" with the force arrows). Each becomes a checker-shaped
// defect on the owning problem's figures array (run.mjs merges them into the
// check); one the refix model has judged not to be a figure is remembered in
// tx.notFigures and never raised again. Attribution: the last printed problem
// heading above the graphic (native text), else the only problem whose source
// spans include the page, else the only problem with a figure on that page.
function unplacedGraphics(candidate, manifest, paperId) {
  const out = [];
  const problems = candidate.problems || [];
  const key = n => { const s = String(n ?? '').trim().toLowerCase(); const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 }; return String(roman[s] || Number(s) || s); };
  const byNumber = new Map(problems.map((p, i) => [key(p.number), i]));
  const figs = allFigures(candidate);
  const notFigures = candidate.tx?.notFigures || [];
  for (const doc of Object.keys(manifest.documents)) {
    const regs = regionsFor(paperId, manifest, doc);
    if (!regs?.pages) continue;
    let lastHeading = null; // carried across pages of the document
    for (const pg of regs.pages) {
      const heads = (pg.headings || []).slice().sort((a, b) => a.y - b.y);
      for (const g of pg.regions || []) {
        const above = heads.filter(h => h.y <= g.bbox[1]).at(-1) || null;
        const heading = above || lastHeading;
        if (!g.kind || g.kind === 'drawing') {
          // a symbol or a small equation image; on a scan (pixel regions) also handwritten marks, so the bar is higher there
          if (g.areaFrac < (g.raster ? 0.015 : 0.004)) continue;
          if (g.bbox[3] <= 100 || g.bbox[1] >= 930) continue; // header/footer band: logos, stamps, page numbers
          if (figs.some(f => f.fig.tx?.document === doc && f.fig.tx?.page === pg.page && f.fig.tx?.bbox && coverFrac(g.core, f.fig.tx.bbox) >= 0.5)) continue;
          if (notFigures.some(x => x.document === doc && x.page === pg.page && iou(x.bbox, g.bbox) >= 0.5)) continue;
          let idx = heading ? byNumber.get(key(heading.number)) : undefined;
          if (idx === undefined) { const spanning = problems.map((p, i) => (p.tx?.sourceSpans || []).some(s => s.document === doc && s.page === pg.page) ? i : -1).filter(i => i >= 0); if (spanning.length === 1) idx = spanning[0]; }
          if (idx === undefined) { const withFig = [...new Set(figs.filter(f => f.fig.tx?.document === doc && f.fig.tx?.page === pg.page).map(f => problems.indexOf(f.problem)))]; if (withFig.length === 1) idx = withFig[0]; }
          const solutionSide = doc === 'solutions';
          const parentOk = idx !== undefined && (!solutionSide || (problems[idx].solution && typeof problems[idx].solution === 'object'));
          const path = parentOk ? `/problems/${idx}/${solutionSide ? 'solution/' : ''}figures` : null;
          const pct = Math.round(g.areaFrac * 1000) / 10;
          out.push({ document: doc, page: pg.page, bbox: g.bbox, areaFrac: g.areaFrac, raster: !!g.raster, problemIndex: idx ?? null, path,
            defect: path ? { path, document: doc, page: pg.page, severity: 'major', kind: 'figure', source: 'regions', confidence: 0.6, region: { document: doc, page: pg.page, bbox: g.bbox },
              description: `Region check: the ${doc} document prints a graphic on p.${pg.page} at [${g.bbox.map(Math.round).join(', ')}] (permille; ≈${pct}% of the page) that no figure of problem ${problems[idx].number} covers. If a student needs it, return the complete figures array with it added (a new id, the printed caption if any, an alt line, tx box = that region); if it is a formula, a table or decoration, return the array unchanged and say so in the note.`, suggestedFix: null } : null });
        }
      }
      if (heads.length) lastHeading = heads.at(-1);
    }
  }
  return out;
}
const MIN_PX = 40, MIN_BYTES = 1500;
const dpi = manifest.renderDpi || RENDER_DPI;

// 1. crop, grouped per document (one pdfcrop invocation per document)
const byDoc = new Map();
for (const p of proposals) {
  const d = p.fig.tx.document;
  if (!manifest.documents[d]) { report.errors.push({ id: p.fig.id, message: `document ${d} not prepared` }); continue; }
  if (!byDoc.has(d)) byDoc.set(d, []);
  byDoc.get(d).push(p);
}
const cropInfo = new Map();
for (const [doc, list] of byDoc) {
  const pdf = path.join(paperDir(paperId), manifest.documents[doc].file);
  if (!fs.existsSync(pdf)) fail(`source PDF missing (${pdf}); re-run prepare.mjs`);
  const boxes = list.flatMap(p => {
    const size = manifest.documents[doc].pageSizes[p.fig.tx.page - 1];
    if (!size) return [];
    const px = bboxToPreviewPx(p.fig.tx.bbox, size, dpi);
    return ['--box', `page=${p.fig.tx.page},x0=${px[0]},y0=${px[1]},x1=${px[2]},y1=${px[3]},id=${p.fig.id}`];
  });
  if (!boxes.length) continue;
  const outDir = path.join(figDir, doc);
  run('python3', [PDFCROP, pdf, outDir, '--dpi', String(FIGURE_DPI), '--preview-dpi', String(dpi), ...boxes]);
  for (const m of readJson(path.join(outDir, 'figures.json'), [])) cropInfo.set(m.id, m);
}

// 2. sanity: size, bytes, not blank (PIL stddev on the grayscale image)
function inspect(file) {
  const py = `import sys,json\nfrom PIL import Image, ImageStat\nim=Image.open(sys.argv[1]).convert('L')\nst=ImageStat.Stat(im)\nprint(json.dumps({'w':im.width,'h':im.height,'std':st.stddev[0],'mean':st.mean[0]}))`;
  const r = run('python3', ['-c', py, file], { allowFail: true });
  if (r.status !== 0) return null;
  return JSON.parse(r.stdout);
}

// 3. upload (never overwrite) and verify. The listing MUST succeed: an auth or
// network failure is not "nothing there" — it would turn every figure into a
// fresh upload over whatever exists.
let listingCache = null;
function remoteListing() {
  if (listingCache) return listingCache;
  const r = run('rclone', ['lsf', '--format', 'psh', '--hash', 'MD5', `${R2_REMOTE}/problems/${paperId}/`], { allowFail: true });
  if (r.status !== 0) fail(`rclone lsf failed (exit ${r.status}) — refusing to upload without a trustworthy listing: ${(r.stderr || '').slice(0, 300)}`);
  const map = new Map();
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [name, size, hash] = line.split(';');
    map.set(name, { size: Number(size), md5: (hash || '').trim() || null });
  }
  listingCache = map;
  return map;
}

const results = [];
for (const p of proposals) {
  const fig = p.fig, info = cropInfo.get(fig.id);
  const entry = { id: fig.id, path: p.path, document: fig.tx.document, page: fig.tx.page, bbox: fig.tx.bbox };
  if (!info) { entry.error = 'crop did not run'; report.errors.push({ id: fig.id, message: entry.error }); results.push(entry); continue; }
  const st = inspect(info.file);
  entry.file = info.file; entry.px = info.px; entry.bytes = info.bytes; entry.pdfRect = info.pdfRect;
  if (!st) entry.error = 'could not inspect PNG (PIL missing?)';
  else if (st.w < MIN_PX || st.h < MIN_PX) entry.error = `crop too small (${st.w}x${st.h} px)`;
  else if (info.bytes < MIN_BYTES) entry.error = `crop nearly empty (${info.bytes} bytes)`;
  else if (st.std < 4) entry.error = `crop looks blank (stddev ${st.std.toFixed(1)})`;
  if (entry.error) { report.errors.push({ id: fig.id, message: entry.error }); results.push(entry); continue; }
  entry.stddev = +st.std.toFixed(1);
  const bytes = fs.readFileSync(info.file);
  entry.md5 = md5(bytes); entry.sha256 = sha256File(info.file);
  entry.relFile = path.relative(paperDir(paperId), info.file).split(path.sep).join('/'); // stored in the candidate: keep it portable
  if (dry) { entry.upload = 'skipped (dry-run)'; results.push(entry); continue; }
  // choose the remote key: reuse an object with identical content (MD5), otherwise a free -vN suffix
  const listing = remoteListing();
  let key = null;
  for (let v = 1; v <= 6; v++) {
    const name = v === 1 ? `${fig.id}.png` : `${fig.id}-v${v}.png`;
    const remote = listing.get(name);
    if (!remote) { key = name.replace(/\.png$/, ''); entry.upload = 'new'; break; }
    if (remote.md5 && remote.md5 === entry.md5) { key = name.replace(/\.png$/, ''); entry.upload = 'reused-identical-md5'; break; }
    if (v === 6) entry.error = 'six versions of this figure already exist remotely; refusing to add more';
  }
  if (entry.error) { report.errors.push({ id: fig.id, message: entry.error }); results.push(entry); continue; }
  if (entry.upload === 'new') run('rclone', ['copyto', '--ignore-existing', info.file, `${R2_REMOTE}/problems/${paperId}/${key}.png`]);
  entry.remoteKey = `problems/${paperId}/${key}.png`;
  entry.url = figureUrl(paperId, key);
  results.push(entry);
}
// verify public URLs (throttled)
if (!dry) {
  const pending = results.filter(r => r.url && !r.error);
  const statuses = await headStatuses(pending.map(r => r.url));
  for (const r of pending) {
    r.public200 = statuses.get(r.url) === 200;
    if (!r.public200) { r.error = `public URL returned ${statuses.get(r.url) || 'no response'}`; report.errors.push({ id: r.id, message: r.error }); }
  }
}
// 4. write the enriched copy. Dry runs keep url/width/height empty on purpose.
// A crop that is blank, tiny or missing is the reader's box being wrong — that is
// a finding for the checker (the figure keeps its box and carries tx.cropError,
// no file, no url), not a reason to abandon the paper. Upload, listing and
// public-URL failures are infrastructure and stay fatal.
const SOFT = /^(crop too small|crop nearly empty|crop looks blank|crop did not run|could not inspect PNG)/;
for (const r of results) {
  if (r.error) {
    if (SOFT.test(r.error)) { const f = allFigures(data).find(x => x.path === r.path).fig; delete f.url; delete f.width; delete f.height; delete f.source; f.tx = { document: f.tx.document, page: f.tx.page, bbox: f.tx.bbox, ...(f.tx.bboxProposed ? { bboxProposed: f.tx.bboxProposed, snapped: f.tx.snapped } : {}), cropError: r.error }; }
    continue;
  }
  const f = allFigures(data).find(x => x.path === r.path).fig;
  if (dry) { f.tx = { ...f.tx, file: r.relFile, cropped: true, dryRun: true, upload: r.upload, px: r.px, pdfRect: r.pdfRect }; continue; }
  f.url = r.url; f.width = r.px[0]; f.height = r.px[1];
  f.source = { page: r.page, pdfRect: r.pdfRect, dpi: FIGURE_DPI, ...(r.document === 'solutions' ? { document: 'solutions' } : {}) };
  f.tx = { ...f.tx, file: r.relFile, remoteKey: r.remoteKey, upload: r.upload, cropped: true, dryRun: false, public200: r.public200 === true, md5: r.md5, sha256: r.sha256 };
}
report.figures = results;
report.softErrors = report.errors.filter(e => SOFT.test(e.message));
report.ok = report.errors.length === report.softErrors.length && results.length === proposals.length;
if (report.ok || dry) writeJson(outFile, data);
report.out = report.ok || dry ? outFile : null;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
