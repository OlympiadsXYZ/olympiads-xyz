#!/usr/bin/env node
// crops.mjs [<paperId> ...] [--force]
// Regenerates the crop PNGs figures.mjs produced for every existing candidate
// (<name>.figs.json) from the source PDFs and the boxes the candidate carries,
// WITHOUT rewriting the candidate: its bytes are hash-bound to checker outputs,
// receipts and adjudications. The benchmark bundle in bench/ ships candidates
// but not crops (reproducible), and checkers/adjudicators must judge the crops,
// not the box numbers. Existing files are kept unless --force is given.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, fail, readJson, readManifest, paperDir, allFigures, run, which,
  PDFCROP, RENDER_DPI, FIGURE_DPI, TX_DIR, bboxToPreviewPx,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['force'] });
if (!which('python3')) fail('python3 not found');
const ids = args._.length ? args._ : fs.readdirSync(TX_DIR).filter(d => fs.existsSync(path.join(TX_DIR, d, 'manifest.json'))).sort();

let made = 0, kept = 0, skipped = 0;
for (const paperId of ids) {
  const manifest = readManifest(paperId);
  const dpi = manifest.renderDpi || RENDER_DPI;
  const candDir = path.join(paperDir(paperId), 'candidates');
  if (!fs.existsSync(candDir)) continue;
  for (const name of fs.readdirSync(candDir).filter(f => f.endsWith('.figs.json')).sort()) {
    const cand = readJson(path.join(candDir, name), null);
    if (!cand) continue;
    // one pdfcrop invocation per (document, output folder); a figure shared by two problems is cut once
    const groups = new Map();
    const seen = new Set();
    for (const { fig } of allFigures(cand)) {
      const t = fig.tx;
      if (!t?.file || !t.document || !t.page || !Array.isArray(t.bbox)) continue;
      const file = path.isAbsolute(t.file) ? t.file : path.join(paperDir(paperId), t.file);
      if (seen.has(file)) continue;
      seen.add(file);
      if (fs.existsSync(file) && !args.force) { kept++; continue; }
      const doc = manifest.documents[t.document];
      const size = doc?.pageSizes?.[t.page - 1];
      if (!doc || !size) { skipped++; continue; }
      const outDir = path.dirname(file);
      const key = `${t.document}\n${outDir}`;
      if (!groups.has(key)) groups.set(key, { doc: t.document, outDir, boxes: [] });
      const px = bboxToPreviewPx(t.bbox, size, dpi);
      groups.get(key).boxes.push('--box', `page=${t.page},x0=${px[0]},y0=${px[1]},x1=${px[2]},y1=${px[3]},id=${path.basename(file, '.png')}`);
    }
    for (const { doc, outDir, boxes } of groups.values()) {
      const pdf = path.join(paperDir(paperId), manifest.documents[doc].file);
      if (!fs.existsSync(pdf)) fail(`source PDF missing (${pdf}); re-run prepare.mjs`);
      fs.mkdirSync(outDir, { recursive: true });
      run('python3', [PDFCROP, pdf, outDir, '--dpi', String(FIGURE_DPI), '--preview-dpi', String(dpi), ...boxes]);
      made += boxes.length / 2;
    }
  }
}
console.log(`crops: ${made} regenerated, ${kept} already present, ${skipped} without page geometry (${ids.length} papers)`);
