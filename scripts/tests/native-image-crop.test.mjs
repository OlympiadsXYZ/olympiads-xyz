import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { nativeImageCropInfo, writeNativeImageCrop, nativeImageCropEvidenceError } from '../tx/native-image-crop.mjs';
import { IMAGE_RENDERER_FINGERPRINT } from '../tx/image-source.mjs';
import { sha256File, figureEvidenceProblems, compileSchema, stripTx, normaliseCandidate } from '../tx/lib.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const python = args => { const r = spawnSync('python3', args, { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
test('renaming a solution figure retains native crop intent while clearing stale evidence', () => {
  const fig = { id: 'velocity-curve', url: 'https://example.test/old.png', width: 1, height: 1, source: { page: 1 }, tx: { extraction: 'native-image-crop', document: 'supplement-1', page: 1, bbox: [100, 200, 900, 600], rotation: 90, file: 'old.png', sha256: 'stale' } };
  const candidate = { paper: { id: 'zz-2099-native' }, problems: [{ id: 'zz-2099-native-p1', number: 1, statement: 'Question', solution: { statement: 'Answer', figures: [fig] } }] };
  normaliseCandidate(candidate);
  assert.equal(fig.id, 'p1-sol-fig1');
  assert.deepEqual(fig.tx, { extraction: 'native-image-crop', document: 'supplement-1', page: 1, bbox: [100, 200, 900, 600], rotation: 90 });
  for (const key of ['url', 'source', 'width', 'height']) assert.equal(fig[key], undefined);
});
function fixture(t, extension = '.png', mode = 'RGB', orientation = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-crop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'zz-2099-native'); fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
  const source = path.join(directory, `src/problems${extension}`), pdf = path.join(directory, 'src/problems.pdf');
  python(['-c', "from PIL import Image\nimport sys\nim=Image.new(sys.argv[2],(321,239));im.putdata([((x*19)%256,(x*31)%256,(x*43)%256,0 if x%3==0 else 255)[:len(im.getbands())] if len(im.getbands())>1 else x%256 for x in range(321*239)]);im.save(sys.argv[1])", source, mode]);
  if (orientation !== 1) python(['-c', "from PIL import Image\nimport sys\nim=Image.open(sys.argv[1]);e=im.getexif();e[274]=int(sys.argv[2]);im.save(sys.argv[1],exif=e)", source, String(orientation)]);
  const converted = JSON.parse(python([path.join(repo, 'scripts/tx/image-to-pdf.py'), source, pdf]));
  Object.assign(converted, { sourceFile: `src/problems${extension}`, rendererFingerprint: IMAGE_RENDERER_FINGERPRINT });
  const manifest = { paperId: 'zz-2099-native', documents: { problems: { key: `archive/photo${extension}`, file: 'src/problems.pdf', sha256: sha256File(pdf), pages: 1, pageSizes: [{ widthPt: converted.pages[0].widthPx * 72 / 150, heightPt: converted.pages[0].heightPx * 72 / 150 }], converted } } };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  const fig = { id: 'photo', tx: { extraction: 'native-image-crop', document: 'problems', page: 1, bbox: [101, 203, 899, 901], rotation: 90 } };
  return { root, directory, source, pdf, manifest, fig };
}

test('native crop uses outward pixel rounding and exact lossless rotations, including transparent RGB', t => {
  for (const [extension, mode] of [['.jpg', 'RGB'], ['.png', 'RGBA'], ['.png', 'L']]) {
    const { directory, source, manifest, fig } = fixture(t, extension, mode);
    const file = path.join(directory, 'crop.webp');
    for (const rotation of [0, 90, 180, 270]) {
      fig.tx.rotation = rotation;
      const info = writeNativeImageCrop(fig, manifest, directory, file);
      assert.deepEqual(info.nativeImageCrop.pixelBox, [32, 48, 289, 216]);
      assert.deepEqual(info.px, rotation % 180 ? [168, 257] : [257, 168]);
      // Independent pixel comparison, not a self-reported helper hash.
      python(['-c', "from PIL import Image\nimport sys\ns=Image.open(sys.argv[1]);m='RGBA' if s.mode=='RGBA' else 'RGB';s=s.convert(m).crop((32,48,289,216));r=int(sys.argv[3]);s=s.rotate(-r,expand=True) if r else s;o=Image.open(sys.argv[2]);assert o.size==s.size and o.convert(m).tobytes()==s.tobytes()", source, file, String(rotation)]);
      assert.equal(info.dpi, 150);
    }
  }
});

test('EXIF permutations match conversion orientation; unsupported color modes fail closed', t => {
  for (const orientation of [2, 5, 6, 8]) {
    const { directory, source, manifest, fig } = fixture(t, '.jpg', 'RGB', orientation);
    const file = path.join(directory, 'oriented.webp');
    const info = writeNativeImageCrop(fig, manifest, directory, file);
    assert.equal(info.nativeImageCrop.exifOrientation, orientation);
    assert.deepEqual(info.nativeImageCrop.rawSourcePx, [321, 239]);
    python(['-c', "from PIL import Image,ImageOps\nimport json,sys\ns=ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGB').crop(json.loads(sys.argv[3])).transpose(Image.Transpose.ROTATE_270);o=Image.open(sys.argv[2]);assert s.size==o.size and s.tobytes()==o.convert('RGB').tobytes()", source, file, JSON.stringify(info.nativeImageCrop.pixelBox)]);
  }
  const { directory, manifest, fig } = fixture(t, '.jpg', 'CMYK');
  assert.throws(() => nativeImageCropInfo(fig, manifest, directory), /RGB\/RGBA\/L/);
});

test('receipt and schema reject native pixel/byte/provenance tampering and unsupported geometry', t => {
  const { directory, source, manifest, fig } = fixture(t);
  const file = path.join(directory, 'crop.webp'), info = writeNativeImageCrop(fig, manifest, directory, file);
  const enriched = { ...fig, width: info.px[0], height: info.px[1], url: 'https://example.test/problems/zz-2099-native/photo.webp', source: { page: 1, pdfRect: info.pdfRect, dpi: info.dpi, rotation: 90, nativeImageCrop: info.nativeImageCrop }, tx: { ...fig.tx, file: 'crop.webp', sha256: info.sha256, remoteKey: 'problems/zz-2099-native/photo.webp', public200: true, dryRun: false } };
  assert.equal(nativeImageCropEvidenceError(enriched, manifest, directory), null);
  assert.deepEqual(figureEvidenceProblems({ problems: [{ figures: [enriched] }] }, manifest, directory), []);
  for (const [key, value] of [['pixelSha256', '0'.repeat(64)], ['helperSha256', '0'.repeat(64)], ['sha256', '0'.repeat(64)], ['pixelBox', [0, 0, 321, 239]], ['rotation', 0], ['encoding', 'webp-lossy']]) {
    const bad = structuredClone(enriched); bad.source.nativeImageCrop[key] = value;
    assert.match(nativeImageCropEvidenceError(bad, manifest, directory), /mismatch/);
  }
  for (const tx of [{ bbox: [0, 0, 1001, 1000] }, { bbox: [900, 0, 100, 1000] }, { page: 2 }, { rotation: 45 }, { extraction: 'original-image' }]) {
    assert.throws(() => nativeImageCropInfo({ ...fig, tx: { ...fig.tx, ...tx } }, manifest, directory));
  }
  const bad = structuredClone(manifest); bad.documents.problems.pageSizes[0].widthPt--;
  assert.throws(() => nativeImageCropInfo(fig, bad, directory), /geometry/);
  const bytes = fs.readFileSync(file); fs.appendFileSync(file, 'changed');
  assert.match(nativeImageCropEvidenceError(enriched, manifest, directory), /bytes/); fs.writeFileSync(file, bytes);
  const docBytes = fs.readFileSync(source); fs.appendFileSync(source, 'changed');
  assert.throws(() => nativeImageCropInfo(fig, manifest, directory), /hash\/fingerprint/); fs.writeFileSync(source, docBytes);
  const { schema } = compileSchema('final');
  // Compile the actual figure definition without requiring an unrelated full paper.
  const definition = schema.$defs.figure;
  assert.ok(definition.properties.source.properties.nativeImageCrop);
  const Ajv = createRequire(import.meta.url)('ajv');
  const validate = new Ajv({ allErrors: true }).compile(definition.properties.source);
  assert.equal(validate(enriched.source), true);
  assert.equal(validate({ ...enriched.source, originalImage: info.nativeImageCrop }), false);
  const malformed = structuredClone(enriched.source); delete malformed.nativeImageCrop.pixelSha256;
  assert.equal(validate(malformed), false);
  assert.equal(stripTx(enriched).source.nativeImageCrop.encoding, 'webp-lossless');
  const candidate = { paper: { id: 'zz-2099-native', subject: 'physics', competition: 'Test', year: 2099, roundType: 'theory', lang: 'en', source: { archiveKey: manifest.documents.problems.key, pages: [1] }, status: 'draft' }, problems: [{ id: 'zz-2099-native-p1', number: 1, statement: 'Use the photograph.', figures: [enriched] }] };
  const candidateFile = path.join(directory, 'candidate.json');
  const runValidation = () => {
    fs.writeFileSync(candidateFile, JSON.stringify(candidate));
    return spawnSync(process.execPath, [path.join(repo, 'scripts/tx/validate.mjs'), candidateFile, '--manifest', path.join(directory, 'manifest.json')], { encoding: 'utf8' });
  };
  const good = runValidation(); assert.equal(good.status, 0, good.stdout + good.stderr);
  enriched.source.nativeImageCrop.pixelSha256 = '0'.repeat(64);
  const rejected = runValidation(); assert.notEqual(rejected.status, 0); assert.match(rejected.stdout, /provenance mismatch/);
});

test('figures no-snap dry run stays unpublishable and crop replay preserves frozen candidate', t => {
  const { root, directory, manifest, fig } = fixture(t, '.jpg');
  fs.mkdirSync(path.join(directory, 'candidates'));
  const file = path.join(directory, 'candidates', 'new.json'); fs.writeFileSync(file, JSON.stringify({ paper: { id: manifest.paperId }, problems: [{ figures: [fig] }] }));
  const run = (script, args) => spawnSync(process.execPath, [path.join(repo, 'scripts/tx', script), ...args], { encoding: 'utf8', env: { ...process.env, OLYMPIADS_TX_DIR: root } });
  assert.notEqual(run('figures.mjs', [manifest.paperId, file, '--dry-run']).status, 0);
  const r = run('figures.mjs', [manifest.paperId, file, '--dry-run', '--no-snap']); assert.equal(r.status, 0, r.stderr + r.stdout);
  const report = JSON.parse(r.stdout), candidate = JSON.parse(fs.readFileSync(report.out));
  assert.deepEqual(report.figures[0].px, [168, 257]);
  assert.equal(path.extname(report.figures[0].file), '.webp');
  assert.ok(figureEvidenceProblems(candidate, manifest, directory).some(e => /dry-run/.test(e.message)));
  const frozenHash = sha256File(report.out); fs.writeFileSync(report.figures[0].file, 'broken');
  const replay = run('crops.mjs', [manifest.paperId, '--force']); assert.equal(replay.status, 0, replay.stderr + replay.stdout);
  assert.equal(sha256File(report.out), frozenHash);
  assert.equal(sha256File(report.figures[0].file), report.figures[0].sha256);
});
