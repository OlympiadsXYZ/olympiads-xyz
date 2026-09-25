import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { originalImageInfo, originalImageEvidenceError } from '../tx/original-image-figure.mjs';
import { IMAGE_RENDERER_FINGERPRINT } from '../tx/image-source.mjs';
import { sha256File, figureEvidenceProblems } from '../tx/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('native JPEG/PNG extraction retains exact bytes, rejects non-full geometry, replays and enforces evidence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'original-image-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paperId = 'zz-2099-native', directory = path.join(root, paperId);
  fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'candidates'));
  const python = args => {
    const r = spawnSync('python3', args, { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
  };
  const run = (script, args) => spawnSync(process.execPath, [path.join(repo, 'scripts/tx', script), ...args], { encoding: 'utf8', env: { ...process.env, OLYMPIADS_TX_DIR: root } });
  for (const extension of ['.jpg', '.png']) {
    const source = path.join(directory, `src/problems${extension}`), pdf = path.join(directory, 'src/problems.pdf');
    python(['-c', "from PIL import Image\nimport sys\nim=Image.effect_noise((320,240),70).convert('RGB');im.save(sys.argv[1])", source]);
    const converted = JSON.parse(python([path.join(repo, 'scripts/tx/image-to-pdf.py'), source, pdf]));
    Object.assign(converted, { sourceFile: `src/problems${extension}`, rendererFingerprint: IMAGE_RENDERER_FINGERPRINT });
    const doc = { key: `archive/original${extension}`, file: 'src/problems.pdf', sha256: sha256File(pdf), pages: 1,
      pageSizes: [{ widthPt: 153.6, heightPt: 115.2 }], converted };
    const manifest = { paperId, documents: { problems: doc } };
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    const fig = { id: 'whole', tx: { document: 'problems', page: 1, bbox: [0, 0, 1000, 1000], extraction: 'original-image' } };
    const info = originalImageInfo(fig, manifest, directory);
    assert.deepEqual(info.px, [320, 240]);
    for (const tx of [{ bbox: [0, 0, 999, 1000] }, { page: 2 }, { rotation: 90 }]) {
      assert.throws(() => originalImageInfo({ ...fig, tx: { ...fig.tx, ...tx } }, manifest, directory), /requires page 1/);
    }
    const bad = structuredClone(manifest); bad.documents.problems.converted.from = 'xlsx';
    assert.throws(() => originalImageInfo(fig, bad, directory), /original JPEG or PNG/);
    bad.documents.problems = structuredClone(doc); bad.documents.problems.converted.pages.push(converted.pages[0]);
    assert.throws(() => originalImageInfo(fig, bad, directory), /single-frame/);
    bad.documents.problems = structuredClone(doc); bad.documents.problems.pageSizes[0].widthPt--;
    assert.throws(() => originalImageInfo(fig, bad, directory), /geometry/);
    const originalPdf = fs.readFileSync(pdf);
    python(['-c', "import fitz,sys\nd=fitz.open(sys.argv[1]);d[0].set_cropbox(fitz.Rect(1,1,150,110));d.saveIncr()", pdf]);
    bad.documents.problems = structuredClone(doc);
    bad.documents.problems.sha256 = bad.documents.problems.converted.pdfSha256 = sha256File(pdf);
    assert.throws(() => originalImageInfo(fig, bad, directory), /geometry/);
    assert.throws(() => originalImageInfo(fig, manifest, directory), /hash\/fingerprint mismatch/);
    fs.writeFileSync(pdf, originalPdf);
    const file = path.join(directory, 'candidates', 'native.json');
    fs.writeFileSync(file, JSON.stringify({ paper: { id: paperId }, problems: [{ figures: [fig] }] }));
    const snapRejected = run('figures.mjs', [paperId, file, '--dry-run']);
    assert.notEqual(snapRejected.status, 0);
    assert.match(snapRejected.stderr, /requires --no-snap/);
    const result = run('figures.mjs', [paperId, file, '--dry-run', '--no-snap']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout), entry = report.figures[0];
    assert.equal(path.extname(entry.file), extension);
    assert.equal(entry.sha256, converted.sourceSha256);
    assert.deepEqual(entry.px, [320, 240]);
    assert.equal(entry.bytes, fs.statSync(source).size);
    const enriched = JSON.parse(fs.readFileSync(report.out));
    assert.ok(figureEvidenceProblems(enriched, manifest, directory).some(e => /dry-run/.test(e.message)));
    const candidateHash = sha256File(report.out);
    fs.writeFileSync(entry.file, 'damaged output');
    const replay = run('crops.mjs', [paperId, '--force']);
    assert.equal(replay.status, 0, replay.stdout + replay.stderr);
    assert.equal(sha256File(entry.file), converted.sourceSha256);
    assert.equal(sha256File(report.out), candidateHash);
    const published = enriched.problems[0].figures[0];
    Object.assign(published, { width: 320, height: 240, url: `https://example.test/problems/${paperId}/whole${extension}`,
      source: { page: 1, pdfRect: info.pdfRect, dpi: 150, originalImage: info.originalImage } });
    Object.assign(published.tx, { dryRun: false, public200: true, sha256: converted.sourceSha256, remoteKey: `problems/${paperId}/whole${extension}` });
    assert.equal(originalImageEvidenceError(published, manifest, directory), null);
    assert.deepEqual(figureEvidenceProblems(enriched, manifest, directory), []);
    published.source.originalImage.sha256 = '0'.repeat(64);
    assert.match(originalImageEvidenceError(published, manifest, directory), /provenance mismatch/);
    fs.appendFileSync(source, 'modified');
    assert.throws(() => originalImageInfo(fig, manifest, directory), /hash\/fingerprint mismatch/);
  }
});
