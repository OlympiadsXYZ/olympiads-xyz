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

const args = parseArgs(process.argv.slice(2), { flags: ['dry-run'] });
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
const report = { paperId, dryRun: dry, at: nowIso(), figures: [], errors: [] };
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
for (const r of results) {
  if (r.error) continue;
  const f = allFigures(data).find(x => x.path === r.path).fig;
  if (dry) { f.tx = { ...f.tx, file: r.relFile, cropped: true, dryRun: true, upload: r.upload, px: r.px, pdfRect: r.pdfRect }; continue; }
  f.url = r.url; f.width = r.px[0]; f.height = r.px[1];
  f.source = { page: r.page, pdfRect: r.pdfRect, dpi: FIGURE_DPI, ...(r.document === 'solutions' ? { document: 'solutions' } : {}) };
  f.tx = { ...f.tx, file: r.relFile, remoteKey: r.remoteKey, upload: r.upload, cropped: true, dryRun: false, public200: r.public200 === true, md5: r.md5, sha256: r.sha256 };
}
report.figures = results;
report.ok = report.errors.length === 0 && results.length === proposals.length;
if (report.ok || dry) writeJson(outFile, data);
report.out = report.ok || dry ? outFile : null;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
