#!/usr/bin/env node
// prepare.mjs <paperId> [--problems <key>] [--solutions <key>] [--force] [--gc]
// Downloads the source PDFs once, records hashes/page geometry, renders pages at
// 160 dpi and dumps the text layer. Idempotent by content hash: a second run
// with the same keys and unchanged bytes does no network and no rendering; a
// changed key, a hash mismatch or --force re-downloads and re-renders.
//   --gc   remove src/ and pages/ (large, reproducible) but keep manifest.json,
//          text/ and candidates/.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, fail, run, resolvePaper, paperDir, manifestFile, readManifest, writeJson,
  sha256File, nowIso, RENDER_DPI, R2_REMOTE, which,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['force', 'gc', 'json'] });
const paperId = args._[0];
if (!paperId) fail('usage: prepare.mjs <paperId> [--problems <key>] [--solutions <key>] [--force] [--gc]');

const dir = paperDir(paperId);
if (args.gc) {
  for (const sub of ['src', 'pages', 'figs']) fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  const m = readManifest(paperId);
  if (m) { m.gcAt = nowIso(); writeJson(manifestFile(paperId), m); }
  console.log(`gc: removed src/, pages/, figs/ under ${path.relative(process.cwd(), dir)}`);
  process.exit(0);
}
for (const tool of ['rclone', 'pdftoppm', 'pdftotext', 'pdfinfo']) if (!which(tool)) fail(`${tool} not found on PATH`);

const { meta, keys, origin } = resolvePaper(paperId, { problems: args.problems, solutions: args.solutions });
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
fs.mkdirSync(path.join(dir, 'text'), { recursive: true });
fs.mkdirSync(path.join(dir, 'candidates'), { recursive: true });

const previous = readManifest(paperId); // --force re-downloads and re-renders regardless of it
const manifest = {
  paperId, meta, origin, renderDpi: RENDER_DPI,
  documents: {},
  preparedAt: nowIso(),
};

function pdfInfo(file) {
  const out = run('pdfinfo', ['-f', '1', '-l', '10000', file]).stdout;
  const pages = Number(/^Pages:\s+(\d+)/m.exec(out)?.[1]);
  const pageSizes = [];
  for (const m of out.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)) pageSizes[Number(m[1]) - 1] = { page: Number(m[1]), widthPt: Number(m[2]), heightPt: Number(m[3]) };
  // pdfinfo reports the unrotated media box, but pdftoppm renders the page as
  // displayed (/Rotate applied) and every box a reader proposes is relative to
  // that image; pdfcrop.py's page.rect is rotated too. Record the displayed size.
  for (const m of out.matchAll(/^Page\s+(\d+) rot:\s+(\d+)/gm)) {
    const s = pageSizes[Number(m[1]) - 1], rot = Number(m[2]) % 360;
    if (!s || !rot) continue;
    s.rotation = rot;
    if (rot === 90 || rot === 270) [s.widthPt, s.heightPt] = [s.heightPt, s.widthPt];
  }
  if (!pages || pageSizes.length !== pages) throw new Error(`pdfinfo could not read page geometry of ${file}`);
  return { pages, pageSizes, producer: /^Producer:\s+(.*)$/m.exec(out)?.[1] || null };
}

function renderedPages(doc, expected) {
  const files = fs.readdirSync(path.join(dir, 'pages')).filter(f => f.startsWith(`${doc}-`) && f.endsWith('.png')).sort();
  return files.length === expected ? files.map(f => `pages/${f}`) : null;
}

for (const doc of ['problems', 'solutions']) {
  const key = keys[doc];
  if (!key) continue;
  const file = path.join(dir, 'src', `${doc}.pdf`);
  const prev = previous?.documents?.[doc];
  let downloaded = false;
  // Re-download when there is no file, when --force was given, when the archive
  // key differs from the one the cached file came from, or when the cached bytes
  // no longer match the manifest (a partial or tampered file).
  const stale = !fs.existsSync(file) || args.force || !prev || prev.key !== key || sha256File(file) !== prev.sha256;
  if (stale) {
    fs.rmSync(file, { force: true });
    run('rclone', ['copyto', `${R2_REMOTE}/${key}`, file]);
    downloaded = true;
  }
  const sha256 = sha256File(file);
  const bytes = fs.statSync(file).size;
  const info = pdfInfo(file);
  // Render only when the cached pages do not correspond to these exact bytes.
  let pageImages = !args.force && prev && prev.sha256 === sha256 && prev.renderDpi === RENDER_DPI ? renderedPages(doc, info.pages) : null;
  if (!pageImages) {
    for (const f of fs.readdirSync(path.join(dir, 'pages'))) if (f.startsWith(`${doc}-`)) fs.rmSync(path.join(dir, 'pages', f));
    run('pdftoppm', ['-r', String(RENDER_DPI), '-png', file, path.join(dir, 'pages', doc)]);
    // pdftoppm pads page numbers to the width of the page count; normalise to two digits.
    for (const f of fs.readdirSync(path.join(dir, 'pages'))) {
      const m = new RegExp(`^${doc}-(\\d+)\\.png$`).exec(f);
      if (!m) continue;
      const target = `${doc}-${String(Number(m[1])).padStart(2, '0')}.png`;
      if (target !== f) fs.renameSync(path.join(dir, 'pages', f), path.join(dir, 'pages', target));
    }
    pageImages = renderedPages(doc, info.pages);
    if (!pageImages) throw new Error(`rendering ${doc} produced an unexpected page count`);
  }
  const textFile = path.join(dir, 'text', `${doc}.txt`);
  // The text layer belongs to these exact bytes: regenerate after any download or hash change.
  if (!fs.existsSync(textFile) || downloaded || prev?.sha256 !== sha256) { fs.rmSync(textFile, { force: true }); run('pdftotext', ['-layout', file, textFile], { allowFail: true }); }
  const text = fs.existsSync(textFile) ? fs.readFileSync(textFile, 'utf8') : '';
  manifest.documents[doc] = {
    key, file: `src/${doc}.pdf`, sha256, bytes, pages: info.pages, pageSizes: info.pageSizes, producer: info.producer,
    renderDpi: RENDER_DPI, pageImages, text: `text/${doc}.txt`,
    textChars: text.trim().length, textDigits: (text.match(/\d/g) || []).length,
    downloaded,
  };
}
if (!manifest.documents.problems) fail('no problems document resolved');
if (previous?.preparedAt && Object.values(manifest.documents).every(d => !d.downloaded)) manifest.firstPreparedAt = previous.firstPreparedAt || previous.preparedAt;
else manifest.firstPreparedAt = previous?.firstPreparedAt || manifest.preparedAt;
writeJson(manifestFile(paperId), manifest);

if (args.json) console.log(JSON.stringify(manifest, null, 2));
else {
  console.log(`prepared ${paperId} (${origin}) -> ${path.relative(process.cwd(), dir)}`);
  for (const [doc, d] of Object.entries(manifest.documents)) console.log(`  ${doc}: ${d.pages} page(s), ${(d.bytes / 1024).toFixed(0)} KB, sha256 ${d.sha256.slice(0, 12)}…, text ${d.textChars} chars/${d.textDigits} digits${d.downloaded ? '' : ' (cached)'}`);
}
