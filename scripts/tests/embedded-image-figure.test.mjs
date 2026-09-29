import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { embeddedImageInfo, copyEmbeddedImage, embeddedImageEvidenceError } from '../tx/embedded-image-figure.mjs';
import { compileSchema } from '../tx/lib.mjs';

const hash = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
test('embedded DOCX raster preserves hidden pixels and rejects stale or invented provenance', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedded-figure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src'));
  const py = `import sys,zipfile,io,os
from PIL import Image
b=io.BytesIO();Image.effect_noise((120,160),50).convert('RGB').save(b,format='PNG')
open(os.path.join(sys.argv[1],'original.png'),'wb').write(b.getvalue())
with zipfile.ZipFile(os.path.join(sys.argv[1],'src','problems.docx'),'w') as z:
 z.writestr('word/media/image1.png',b.getvalue())
 z.writestr('word/media/unreferenced.png',b.getvalue())
 z.writestr('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>')
 z.writestr('word/document.xml','<document xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:blip r:embed="rId9"/><a:srcRect b="43427"/></document>')`;
  const r = spawnSync('python3', ['-c', py, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  fs.writeFileSync(path.join(dir, 'src/problems.pdf'), 'derived PDF fixture');
  const doc = { key: 'archive/question.docx', file: 'src/problems.pdf', sha256: hash(path.join(dir, 'src/problems.pdf')), pages: 2 };
  const manifest = { documents: { problems: doc } };
  const fig = { id: 'full-example', tx: { document: 'problems', page: 1, bbox: [0, 0, 1000, 1000], extraction: 'embedded-image', entry: 'word/media/image1.png', documentSha256: hash(path.join(dir, 'src/problems.docx')), imageSha256: hash(path.join(dir, 'original.png')) } };
  const info = embeddedImageInfo(fig, manifest, dir);
  assert.deepEqual(info.px, [120, 160]);
  assert.deepEqual(info.embeddedImage.relationshipIds, ['rId9']);
  const file = path.join(dir, 'figs/full-example.png');
  copyEmbeddedImage(fig, manifest, dir, file);
  assert.equal(hash(file), fig.tx.imageSha256);
  const enriched = structuredClone(fig);
  Object.assign(enriched, { width: 120, height: 160, url: 'https://assets.example/problems/test/full-example.png', source: { page: 1, embeddedImage: info.embeddedImage } });
  Object.assign(enriched.tx, { file: 'figs/full-example.png', sha256: fig.tx.imageSha256, remoteKey: 'problems/test/full-example.png' });
  assert.equal(embeddedImageEvidenceError(enriched, manifest, dir), null);
  const { schema } = compileSchema('final');
  const Ajv = createRequire(import.meta.url)('ajv');
  const validateSource = new Ajv({ allErrors: true }).compile(schema.$defs.figure.properties.source);
  assert.equal(validateSource(enriched.source), true);
  assert.equal(validateSource({ ...enriched.source, pdfRect: [0, 0, 100, 100] }), false);
  assert.equal(validateSource({ page: 1 }), false);
  assert.equal(validateSource({ page: 1, pdfRect: [0, 0, 100, 100] }), true);
  for (const tx of [{ bbox: [0, 0, 999, 1000] }, { rotation: 90 }, { page: 3 }, { entry: '../image1.png' }, { entry: 'word/media/unreferenced.png' }, { imageSha256: '0'.repeat(64) }, { documentSha256: '0'.repeat(64) }]) {
    assert.throws(() => embeddedImageInfo({ ...fig, tx: { ...fig.tx, ...tx } }, manifest, dir));
  }
  enriched.source.embeddedImage.entry = 'word/media/other.png';
  assert.match(embeddedImageEvidenceError(enriched, manifest, dir), /provenance mismatch/);
  fs.appendFileSync(path.join(dir, 'src/problems.pdf'), 'changed');
  assert.throws(() => embeddedImageInfo(fig, manifest, dir), /hash mismatch/);
});
