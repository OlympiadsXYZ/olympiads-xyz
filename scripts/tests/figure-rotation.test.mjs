// Real local cropping only: no jobs, network, upload, source cache or publication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256File } from '../tx/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const python = process.env.OLYMPIADS_TEST_PYTHON || 'python3';
test('pdfcrop preserves coordinates and every pixel under all quarter turns', () => {
  const r = spawnSync(python, [path.join(repo, 'scripts/tests/pdfcrop_test.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('figures dry-run hashes upright crops; crops regenerates identical bytes using persisted rotation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figure-rotation-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('figure-rotation-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const paperId = 'zz-2099-rotation';
  const dir = path.join(root, paperId);
  const candDir = path.join(dir, 'candidates');
  fs.mkdirSync(candDir, { recursive: true });
  const pdf = path.join(dir, 'source.pdf');
  const fixture = `import fitz,sys\nd=fitz.open()\nd.new_page(width=200,height=300)\np=d.new_page(width=200,height=300)\nfor i in range(80):\n p.draw_line((20+i*2,60),(180-i,180),color=(i/80,0.2,1-i/80),width=0.6)\np.insert_text((30,85),'UPRIGHT SOURCE',fontsize=13)\nd.save(sys.argv[1])`;
  const generated = spawnSync(python, ['-c', fixture, pdf], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const manifest = { paperId, renderDpi: 160, documents: { problems: { file: 'source.pdf', pages: 2, pageSizes: [{ widthPt: 200, heightPt: 300 }, { widthPt: 200, heightPt: 300 }] } } };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const run = (name, args) => spawnSync(process.execPath, [path.join(repo, 'scripts/tx', name), ...args], { encoding: 'utf8', env: { ...process.env, OLYMPIADS_TX_DIR: root } });
  const expected = [];
  for (const rotation of [0, 90, 180, 270]) {
    const file = path.join(candDir, `angle-${rotation}.json`);
    const candidate = { paper: { id: paperId }, problems: [{ number: 1, figures: [{ id: 'p1-fig1', alt: 'Asymmetric source', tx: { document: 'problems', page: 2, bbox: [100, 200, 900, 600], ...(rotation ? { rotation } : {}) } }] }] };
    fs.writeFileSync(file, JSON.stringify(candidate));
    const r = run('figures.mjs', [paperId, file, '--dry-run', '--no-snap']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    const entry = report.figures[0];
    assert.equal(entry.rotation, rotation);
    assert.equal(entry.page, 2);
    // Same source coordinates despite swapped upright dimensions.
    assert.deepEqual(entry.pdfRect, [19.98, 59.99, 180, 180]);
    assert.equal(entry.sha256, sha256File(entry.file));
    assert.equal(entry.upload, 'skipped (dry-run)');
    const enriched = JSON.parse(fs.readFileSync(report.out, 'utf8'));
    const figure = enriched.problems[0].figures[0];
    assert.equal(figure.url, undefined);
    assert.equal(figure.tx.dryRun, true);
    // Simulate the source provenance of an enriched figure, then remove the
    // optional working rotation to exercise regeneration from persisted data.
    figure.source = { page: entry.page, pdfRect: entry.pdfRect, dpi: 300, ...(rotation ? { rotation } : {}) };
    delete figure.tx.rotation;
    fs.writeFileSync(report.out, JSON.stringify(enriched));
    expected.push({ file: entry.file, hash: entry.sha256, candidate: report.out, candidateHash: sha256File(report.out), px: entry.px });
  }
  assert.deepEqual(expected[1].px, [...expected[0].px].reverse());
  assert.deepEqual(expected[2].px, expected[0].px);
  assert.deepEqual(expected[3].px, [...expected[0].px].reverse());
  assert.equal(new Set(expected.map(e => e.hash)).size, 4);
  const replay = run('crops.mjs', [paperId, '--force']);
  assert.equal(replay.status, 0, replay.stdout + replay.stderr);
  for (const e of expected) {
    assert.equal(sha256File(e.file), e.hash);
    assert.equal(sha256File(e.candidate), e.candidateHash);
  }
  const invalid = path.join(candDir, 'invalid.json');
  fs.writeFileSync(invalid, JSON.stringify({ problems: [{ figures: [{ id: 'p1-fig1', tx: { document: 'problems', page: 2, bbox: [100, 200, 900, 600], rotation: 45 } }] }] }));
  const rejected = run('figures.mjs', [paperId, invalid, '--dry-run', '--no-snap']);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /rotation must be/);
});
