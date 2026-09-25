// Real local Poppler/PyMuPDF coordinate regression. No source cache or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PAGE_RENDERER, pageRenderArgs, previewGeometryError } from '../tx/page-render.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const python = process.env.OLYMPIADS_TEST_PYTHON || 'python3';
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
};

test('offset CropBox previews and figure crops agree for all page rotations; legacy previews rejected', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cropbox-contract-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('cropbox-contract-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const paperId = 'zz-2099-cropbox';
  const dir = path.join(root, paperId);
  fs.mkdirSync(dir);
  const pdf = path.join(dir, 'source.pdf');
  const sizes = JSON.parse(run(python, ['-c', `import fitz,json,sys
D=fitz.open()
for angle in (0,90,180,270):
 p=D.new_page(width=360,height=300)
 for r,c in [((50,70,150,150),(1,0,0)),((150,70,250,150),(0,1,0)),((50,150,150,230),(0,0,1)),((150,150,250,230),(1,1,0))]:
  p.draw_rect(r,color=c,fill=c)
 p.set_cropbox(fitz.Rect(50,70,250,230))
 p.set_rotation(angle)
D.save(sys.argv[1])
print(json.dumps([{'page':p.number+1,'widthPt':p.rect.width,'heightPt':p.rect.height} for p in D]))`, pdf]));
  assert.equal(PAGE_RENDERER, 'pymupdf-cropbox-v2');
  const prefix = path.join(dir, 'preview');
  run(python, pageRenderArgs(pdf, prefix, 72));
  const files = fs.readdirSync(dir).filter(f => /^preview-\d+\.png$/.test(f)).sort();
  assert.equal(files.length, 4);
  const metadata = run('pdfinfo', ['-f', '1', '-l', '4', pdf]);
  for (const match of metadata.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)) {
    const i = Number(match[1]) - 1;
    const actual = [Number(match[2]), Number(match[3])];
    if (i % 2) actual.reverse();
    assert.deepEqual(actual, [sizes[i].widthPt, sizes[i].heightPt]);
  }
  const cropDir = path.join(dir, 'crops');
  for (let i = 0; i < 4; i++) {
    const size = sizes[i];
    assert.equal(previewGeometryError(path.join(dir, files[i]), size, 72), null);
    const box = `page=${i + 1},x0=${size.widthPt / 4},y0=${size.heightPt / 4},x1=${size.widthPt * 3 / 4},y1=${size.heightPt * 3 / 4},id=crop${i}`;
    run(python, [path.join(repo, 'scripts/pdfcrop.py'), pdf, cropDir, '--dpi', '72', '--preview-dpi', '72', '--box', box]);
    // Compare interior pixels in all four asymmetric quadrants, not just image
    // dimensions: this exposes the wrong origin, rotation, mirroring or clipping.
    run(python, ['-c', `from PIL import Image
import sys
p=Image.open(sys.argv[1]).convert('RGB'); c=Image.open(sys.argv[2]).convert('RGB')
w,h=p.size
assert c.size==(w//2,h//2),(p.size,c.size)
for x in (c.width//4,3*c.width//4):
 for y in (c.height//4,3*c.height//4):
  a=p.getpixel((x+w//4,y+h//4)); b=c.getpixel((x,y))
  assert max(abs(a[i]-b[i]) for i in range(3))<=2,(a,b)
`, path.join(dir, files[i]), path.join(cropDir, `crop${i}.png`)]);
  }
  const legacyPrefix = path.join(dir, 'legacy');
  run('pdftoppm', ['-r', '72', '-f', '1', '-l', '1', '-png', pdf, legacyPrefix]);
  const legacy = fs.readdirSync(dir).find(f => /^legacy-\d+\.png$/.test(f));
  assert.match(previewGeometryError(path.join(dir, legacy), sizes[0], 72), /360x300px does not match displayed CropBox 200x160px/);
  // The production figures command rejects the mismatch before snapping or
  // cropping. No requirement to modify an existing candidate/source to test it.
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ paperId, renderDpi: 72, documents: { problems: { file: 'source.pdf', pageSizes: sizes, pageImages: [legacy] } } }));
  const candidate = path.join(dir, 'candidate.json');
  fs.writeFileSync(candidate, JSON.stringify({ problems: [{ figures: [{ id: 'fig', tx: { document: 'problems', page: 1, bbox: [250, 250, 750, 750] } }] }] }));
  const rejected = spawnSync(process.execPath, [path.join(repo, 'scripts/tx/figures.mjs'), paperId, candidate, '--dry-run'], { encoding: 'utf8', env: { ...process.env, OLYMPIADS_TX_DIR: root } });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Re-prepare this source and rebox/);
  assert.equal(fs.existsSync(path.join(dir, 'candidate.figs.json')), false);
  // Exercise the real prepare cache migration without any remote download.
  // Cached PDF bytes/key/hash are already valid; only the renderer is stale.
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.mkdirSync(path.join(dir, 'candidates'));
  fs.copyFileSync(pdf, path.join(dir, 'src/problems.pdf'));
  run('pdftoppm', ['-r', '160', '-png', pdf, path.join(dir, 'pages/problems')]);
  for (const name of fs.readdirSync(path.join(dir, 'pages'))) {
    fs.renameSync(path.join(dir, 'pages', name), path.join(dir, 'pages', name.replace(/-(\d+)\.png$/, (_, n) => `-${n.padStart(2, '0')}.png`)));
  }
  const key = 'fixture/cropbox-contract.pdf';
  const sha256 = createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ paperId, renderDpi: 160, documents: { problems: { key, sha256, renderDpi: 160 } } }));
  const oldCandidate = path.join(dir, 'candidates/old.json');
  fs.copyFileSync(candidate, oldCandidate);
  const prepare = () => spawnSync(process.execPath, [path.join(repo, 'scripts/tx/prepare.mjs'), paperId, '--problems', key], { encoding: 'utf8', env: { ...process.env, OLYMPIADS_TX_DIR: root } });
  const blocked = prepare();
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Cached candidates may use the old coordinate space/);
  fs.unlinkSync(oldCandidate); // only the temporary fixture candidate
  const migrated = prepare();
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
  const prepared = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(prepared.documents.problems.pageRenderer, PAGE_RENDERER);
  assert.equal(prepared.documents.problems.downloaded, false);
  const page = path.join(dir, prepared.documents.problems.pageImages[0]);
  assert.equal(previewGeometryError(page, sizes[0], 160), null);
  const mtime = fs.statSync(page).mtimeMs;
  const cached = prepare();
  assert.equal(cached.status, 0, cached.stdout + cached.stderr);
  assert.equal(fs.statSync(page).mtimeMs, mtime);
  // Even identical source bytes/geometry must not reuse a prior backend or
  // runtime version. A new render records the precise current fingerprint.
  const fingerprint = prepared.documents.problems.pageRendererInfo.fingerprint;
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  for (const oldRenderer of ['pdftoppm-cropbox-v1', PAGE_RENDERER]) {
    const stale = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    stale.documents.problems.pageRenderer = oldRenderer;
    stale.documents.problems.pageRendererInfo.fingerprint = 'stale-runtime';
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(stale));
    fs.utimesSync(page, new Date(0), new Date(0));
    const migration = prepare();
    assert.equal(migration.status, 0, migration.stdout + migration.stderr);
    const refreshed = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(refreshed.documents.problems.pageRenderer, PAGE_RENDERER);
    assert.equal(refreshed.documents.problems.pageRendererInfo.fingerprint, fingerprint);
    assert.equal(refreshed.documents.problems.sha256, sha256);
    assert.ok(fs.statSync(page).mtimeMs > 0);
  }
});

test('Symbol glyph previews retain every character and equal the actual figure renderer', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-preview-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('symbol-preview-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const pdf = path.join(root, 'symbol.pdf');
  run(python, ['-c', `import fitz,sys
D=fitz.open();p=D.new_page(width=400,height=120)
# PDF's unembedded standard Symbol font: exercise actual Greek/math glyphs,
# not Latin lookalikes or a raster image containing pre-rendered characters.
for i,ch in enumerate('\u03b1\u03b8\u03c6\u03c0\u03bb\u0394\u2248\u2212'):
 p.insert_text((20+45*i,70),ch,fontname='symb',fontsize=30)
D.save(sys.argv[1])`, pdf]);
  run(python, pageRenderArgs(pdf, path.join(root, 'preview'), 144));
  run(python, [path.join(repo, 'scripts/pdfcrop.py'), pdf, path.join(root, 'crop'), '--dpi', '144', '--preview-dpi', '144', '--box', 'page=1,x0=0,y0=0,x1=800,y1=240,id=whole']);
  run(python, ['-c', `from PIL import Image,ImageChops
import sys
p=Image.open(sys.argv[1]).convert('RGB');c=Image.open(sys.argv[2]).convert('RGB')
assert p.size==(800,240)
assert ImageChops.difference(p,c).getbbox() is None,'preview/crop rendering diverged'
for i in range(8):
 box=p.crop((40+90*i,70,120+90*i,145)).convert('L')
 assert sum(v<128 for v in box.getdata())>25,('missing Symbol glyph',i)
`, path.join(root, 'preview-01.png'), path.join(root, 'crop/whole.png')]);
});
