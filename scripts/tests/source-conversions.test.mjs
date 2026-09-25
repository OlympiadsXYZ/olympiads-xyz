import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sourceConversions, sourceConversionProblems } from '../tx/source-conversions.mjs';
import { XLSX_RENDERER, XLSX_RENDERER_FINGERPRINT } from '../tx/xlsx-source.mjs';
import { IMAGE_RENDERER_FINGERPRINT, imageCacheValid } from '../tx/image-source.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conversion-evidence-'));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('conversion-evidence-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(directory, 'src'));
  const source = path.join(directory, 'src/solutions.xlsx');
  const pdf = path.join(directory, 'src/solutions.pdf');
  fs.writeFileSync(source, 'PK fixture workbook');
  fs.writeFileSync(pdf, '%PDF- fixture pages');
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const converted = { from: 'xlsx', renderer: XLSX_RENDERER, rendererFingerprint: XLSX_RENDERER_FINGERPRINT,
    sourceFile: 'src/solutions.xlsx', sourceSha256: hash(source), pdfSha256: hash(pdf), nativePrintPages: 3,
    chartAppendices: [{ firstPage: 4, lastPage: 4, sheet: 'Answers', chart: 'Chart 1' }] };
  return { directory, source, pdf, manifest: { documents: { solutions: { file: 'src/solutions.pdf', sha256: hash(pdf), converted } } } };
}

test('portable conversion evidence preserves original/derived hashes and chart page mapping', t => {
  const f = fixture(t), evidence = sourceConversions(f.manifest);
  assert.notEqual(evidence.solutions, f.manifest.documents.solutions.converted);
  assert.deepEqual(sourceConversionProblems(f.manifest, f.directory, evidence), []);
  assert.notEqual(evidence.solutions.sourceSha256, evidence.solutions.pdfSha256);
  assert.equal(evidence.solutions.chartAppendices[0].firstPage, 4);
});

test('promotion refuses missing or altered conversion provenance even when PDF hash matches', t => {
  const f = fixture(t), evidence = sourceConversions(f.manifest);
  assert.match(sourceConversionProblems(f.manifest, f.directory, {})[0], /provenance mismatch/);
  evidence.solutions.chartAppendices[0].sheet = 'Another source';
  assert.match(sourceConversionProblems(f.manifest, f.directory, evidence)[0], /provenance mismatch/);
});

test('receipt and promotion both reject modified original bytes or derived pages', t => {
  const f = fixture(t), evidence = sourceConversions(f.manifest);
  const original = fs.readFileSync(f.source);
  fs.writeFileSync(f.source, 'changed workbook');
  assert.match(sourceConversionProblems(f.manifest, f.directory)[0], /no longer matches/);
  fs.writeFileSync(f.source, original);
  fs.appendFileSync(f.pdf, 'changed PDF');
  assert.match(sourceConversionProblems(f.manifest, f.directory, evidence)[0], /no longer matches/);
});

test('image sheets retain EXIF orientation, all frames and original-byte provenance', t => {
  const f = fixture(t);
  const helper = fileURLToPath(new URL('../tx/image-to-pdf.py', import.meta.url));
  const run = args => {
    const result = spawnSync(process.env.OLYMPIADS_TEST_PYTHON || 'python3', args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  const source = path.join(f.directory, 'src/supplement-1.jpg');
  const pdf = path.join(f.directory, 'src/supplement-1.pdf');
  run(['-c', `from PIL import Image
import sys
im=Image.new('RGB',(30,60),'red'); exif=Image.Exif(); exif[274]=6
im.save(sys.argv[1],exif=exif)
Image.new('RGB',(40,20),'red').save(sys.argv[2],save_all=True,append_images=[Image.new('RGB',(40,20),'blue')],duration=100,loop=0)
`, source, path.join(f.directory, 'frames.gif')]);
  const originalHash = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const converted = JSON.parse(run([helper, source, pdf]));
  assert.equal(converted.sourceSha256, originalHash);
  assert.deepEqual(converted.pages, [{ page: 1, sourceFrame: 0, widthPx: 60, heightPx: 30 }]);
  converted.sourceFile = 'src/supplement-1.jpg';
  converted.rendererFingerprint = IMAGE_RENDERER_FINGERPRINT;
  const doc = { key: 'archive/sheet.jpg', file: 'src/supplement-1.pdf', sha256: converted.pdfSha256, converted };
  const manifest = { documents: { 'supplement-1': doc } };
  const evidence = sourceConversions(manifest);
  assert.deepEqual(sourceConversionProblems(manifest, f.directory, evidence), []);
  assert.equal(imageCacheValid({ ...doc, converted: null }, pdf, source), false, 'legacy image PDFs require verified original-byte provenance');
  assert.match(sourceConversionProblems({ documents: { 'supplement-1': { ...doc, converted: null } } }, f.directory).join(), /missing original image conversion provenance/);
  evidence['supplement-1'].pages[0].page = 2;
  assert.match(sourceConversionProblems(manifest, f.directory, evidence).join(), /provenance mismatch/);
  fs.appendFileSync(source, 'altered original');
  assert.equal(imageCacheValid(doc, pdf, source), false);
  assert.match(sourceConversionProblems(manifest, f.directory).join(), /original image.*no longer matches/);
  const framesPdf = path.join(f.directory, 'frames.pdf');
  const frames = JSON.parse(run([helper, path.join(f.directory, 'frames.gif'), framesPdf]));
  assert.equal(frames.pages.length, 2);
  run(['-c', `import fitz,sys
with fitz.open(sys.argv[1]) as doc:
 assert len(doc)==2
 for page,expected in zip(doc,[(255,0,0),(0,0,255)]):
  image=page.get_pixmap(dpi=150)
  assert (image.width,image.height)==(40,20)
  assert image.pixel(20,10)==expected
`, framesPdf]);
});
