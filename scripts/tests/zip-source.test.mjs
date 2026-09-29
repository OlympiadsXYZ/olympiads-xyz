import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectZipEntry, zipCacheValid, validArchiveEntry, ZIP_RENDERER_FINGERPRINT } from '../tx/zip-source.mjs';
import { sourceConversions, sourceConversionProblems } from '../tx/source-conversions.mjs';
import { supplementKeys, supplementarySourceErrors } from '../tx/supplements.mjs';

const hash = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
test('ZIP source retains original archive and exact member, rejects stale files and ambiguous extraction', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src'));
  const archive = path.join(dir, 'src/supplement-1.zip'), pdf = path.join(dir, 'src/supplement-1.pdf'), entry = 'Original source/correction.pdf';
  const r = spawnSync('python3', ['-c', `import zipfile,sys,stat
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('Original source/correction.pdf',b'%PDF-original selected entry')
 z.writestr('another.pdf',b'%PDF-another entry')
 z.writestr('duplicate.pdf',b'%PDF-first');z.writestr('duplicate.pdf',b'%PDF-second')
 i=zipfile.ZipInfo('link.pdf');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,b'%PDF-link')`, archive], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const extracted = inspectZipEntry(archive, entry, pdf);
  const doc = { key: 'original/archive.zip', archiveEntry: entry, file: 'src/supplement-1.pdf', sha256: hash(pdf), pages: 1,
    converted: { from: 'zip-entry', archiveKey: 'original/archive.zip', entry, sourceFile: 'src/supplement-1.zip', sourceSha256: hash(archive), entryFile: 'src/supplement-1.pdf', entrySha256: extracted.entrySha256, pdfSha256: hash(pdf), rendererFingerprint: ZIP_RENDERER_FINGERPRINT } };
  const manifest = { documents: { 'supplement-1': doc } }, recorded = sourceConversions(manifest);
  assert.equal(zipCacheValid(doc, dir), true);
  assert.deepEqual(sourceConversionProblems(manifest, dir, recorded), []);
  const candidate = { paper: { supplementarySources: { 'supplement-1': { archiveKey: doc.key, archiveEntry: entry, pages: [1] } } } };
  assert.deepEqual(supplementarySourceErrors(candidate, manifest), []);
  assert.deepEqual(supplementKeys(candidate.paper.supplementarySources), { 'supplement-1': doc.key });
  for (const invalid of ['../correction.pdf', '/correction.pdf', 'C:/correction.pdf', 'source\\correction.pdf', 'source//correction.pdf', 'macro.docm']) assert.equal(validArchiveEntry(invalid), false);
  for (const invalid of ['missing.pdf', 'duplicate.pdf', 'link.pdf']) assert.throws(() => inspectZipEntry(archive, invalid));
  assert.throws(() => supplementKeys({ 'supplement-1': doc.key }), /explicit archiveEntry/);
  const wrong = structuredClone(doc);wrong.archiveEntry = 'another.pdf';assert.equal(zipCacheValid(wrong, dir), false);
  delete candidate.paper.supplementarySources['supplement-1'].archiveEntry;
  assert.match(supplementarySourceErrors(candidate, manifest)[0].message, /archive entry/);
  const forged = structuredClone(recorded);forged['supplement-1'].entry = 'another.pdf';
  assert.match(sourceConversionProblems(manifest, dir, forged)[0], /provenance mismatch/);
  fs.appendFileSync(pdf, 'changed');assert.equal(zipCacheValid(doc, dir), false);
});
