import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sourceConversions, sourceConversionProblems } from '../tx/source-conversions.mjs';
import { XLSX_RENDERER, XLSX_RENDERER_FINGERPRINT } from '../tx/xlsx-source.mjs';

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
