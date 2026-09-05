#!/usr/bin/env node
// figures.mjs <paperId> <candidate.json> [--dry-run] [--out <file>]
// Executes the reader's figure proposals mechanically: crop with pdfcrop.py
// from the right document, reject trivial/blank crops, upload to R2 only when
// the key is absent (never overwrite), verify the public URL, and write a copy
// of the candidate (<name>.figs.json) with url/width/height/source filled in.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, fail, readJson, writeJson, readManifest, paperDir, allFigures, run, which,
  PDFCROP, RENDER_DPI, FIGURE_DPI, R2_REMOTE, figureUrl, nowIso,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['dry-run'] });
const [paperId, candFile] = args._;
if (!paperId || !candFile) fail('usage: figures.mjs <paperId> <candidate.json> [--dry-run] [--out <file>]');
const dry = !!args['dry-run'];
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}; run prepare.mjs first`);
const data = readJson(path.resolve(candFile));
if (!data) fail(`candidate not readable: ${candFile}`);
const outFile = path.resolve(args.out || candFile.replace(/\.json$/, '') + '.figs.json');
const figDir = path.join(paperDir(paperId), 'figs');
fs.mkdirSync(figDir, { recursive: true });
if (!which('python3')) fail('python3 not found');

const proposals = allFigures(data).filter(f => f.fig.tx?.bbox);
const report = { paperId, dryRun: dry, at: nowIso(), figures: [], errors: [] };
const MIN_PX = 40, MIN_BYTES = 1500;

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
  const boxes = list.flatMap(p => ['--box', `page=${p.fig.tx.page},x0=${p.fig.tx.bbox[0]},y0=${p.fig.tx.bbox[1]},x1=${p.fig.tx.bbox[2]},y1=${p.fig.tx.bbox[3]},id=${p.fig.id}`]);
  const outDir = path.join(figDir, doc);
  run('python3', [PDFCROP, pdf, outDir, '--dpi', String(FIGURE_DPI), '--preview-dpi', String(manifest.renderDpi || RENDER_DPI), ...boxes]);
  for (const m of readJson(path.join(outDir, 'figures.json'), [])) cropInfo.set(m.id, m);
}

// 2. sanity: size, bytes, not blank (PIL stddev on the grayscale image)
function inspect(file) {
  const py = `import sys,json\nfrom PIL import Image, ImageStat\nim=Image.open(sys.argv[1]).convert('L')\nst=ImageStat.Stat(im)\nprint(json.dumps({'w':im.width,'h':im.height,'std':st.stddev[0],'mean':st.mean[0]}))`;
  const r = run('python3', ['-c', py, file], { allowFail: true });
  if (r.status !== 0) return null;
  return JSON.parse(r.stdout);
}

// 3. upload (never overwrite) and verify
const lsfCache = new Map();
function remoteListing() {
  if (lsfCache.has(paperId)) return lsfCache.get(paperId);
  const r = run('rclone', ['lsf', '--format', 'ps', `${R2_REMOTE}/problems/${paperId}/`], { allowFail: true });
  const map = new Map();
  if (r.status === 0) for (const line of r.stdout.split('\n').filter(Boolean)) { const [name, size] = line.split(';'); map.set(name, Number(size)); }
  lsfCache.set(paperId, map);
  return map;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function headOk(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.status === 200; } catch { return false; }
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
  // choose the remote key: reuse an identical-size existing object, otherwise a free -vN suffix
  let key = fig.id;
  if (!dry) {
    const listing = remoteListing();
    for (let v = 1; v <= 6; v++) {
      const name = v === 1 ? `${fig.id}.png` : `${fig.id}-v${v}.png`;
      if (!listing.has(name)) { key = name.replace(/\.png$/, ''); entry.upload = 'new'; break; }
      if (listing.get(name) === info.bytes) { key = name.replace(/\.png$/, ''); entry.upload = 'reused-existing-identical-size'; break; }
      if (v === 6) { entry.error = 'six versions of this figure already exist remotely; refusing to add more'; }
    }
    if (entry.error) { report.errors.push({ id: fig.id, message: entry.error }); results.push(entry); continue; }
    if (entry.upload === 'new') run('rclone', ['copyto', info.file, `${R2_REMOTE}/problems/${paperId}/${key}.png`]);
  } else entry.upload = 'skipped (dry-run)';
  entry.remoteKey = `problems/${paperId}/${key}.png`;
  entry.url = figureUrl(paperId, key);
  results.push(entry);
}
// verify public URLs: at most 2 in flight, 150 ms spacing
if (!dry) {
  const pending = results.filter(r => r.url && !r.error);
  for (let i = 0; i < pending.length; i += 2) {
    const batch = pending.slice(i, i + 2);
    const ok = await Promise.all(batch.map(r => headOk(r.url)));
    batch.forEach((r, j) => { r.public200 = ok[j]; if (!ok[j]) { r.error = 'public URL did not return 200'; report.errors.push({ id: r.id, message: r.error }); } });
    if (i + 2 < pending.length) await sleep(150);
  }
}
// 4. write the enriched copy
for (const r of results) {
  if (r.error) continue;
  const f = allFigures(data).find(x => x.path === r.path).fig;
  f.url = r.url; f.width = r.px[0]; f.height = r.px[1];
  f.source = { page: r.page, pdfRect: r.pdfRect, dpi: FIGURE_DPI, ...(r.document === 'solutions' ? { document: 'solutions' } : {}) };
  f.tx = { ...f.tx, remoteKey: r.remoteKey, upload: r.upload, cropped: true, dryRun: dry };
}
report.figures = results;
report.ok = report.errors.length === 0 && results.length === proposals.length;
if (report.ok || dry) writeJson(outFile, data);
report.out = report.ok || dry ? outFile : null;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
