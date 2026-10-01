import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleFile =
  process.env.FIGURE_SIZE_MODULE ||
  path.resolve(import.meta.dirname, '..', 'problems-to-site.mjs');
const { figureSize } = await import(pathToFileURL(moduleFile));
const figure = rotation => ({
  width: 1000,
  height: 400,
  source: { pdfRect: [10, 20, 110, 260], dpi: 300, rotation },
});

for (const rotation of [0, 180])
  test(`rotation${rotation} keeps the original horizontal extent`, () => {
    assert.deepEqual(figureSize(figure(rotation)), {
      widthPct: 20.8,
      maxPx: 320,
    });
  });
for (const rotation of [90, 270])
  test(`rotation${rotation} uses the original vertical extent as displayed width`, () => {
    assert.deepEqual(figureSize(figure(rotation)), {
      widthPct: 50,
      maxPx: 320,
    });
  });
test('source rotation takes precedence over transaction rotation', () => {
  const f = figure(0);
  f.tx = { rotation: 270 };
  assert.deepEqual(figureSize(f), { widthPct: 20.8, maxPx: 320 });
});
test('transaction rotation is used when source has no rotation', () => {
  const f = figure(undefined);
  f.tx = { rotation: 270 };
  assert.deepEqual(figureSize(f), { widthPct: 50, maxPx: 320 });
});
test('pixel/dpi sizing remains the fallback without a source rectangle', () => {
  assert.deepEqual(
    figureSize({
      width: 1000,
      height: 400,
      source: { dpi: 300, rotation: 270 },
    }),
    { widthPct: 50, maxPx: 320 }
  );
});
test('zero rotated extent falls back to actual crop pixels', () => {
  const f = figure(90);
  f.source.pdfRect = [10, 20, 110, 20];
  assert.deepEqual(figureSize(f), { widthPct: 50, maxPx: 320 });
});
test('actual paraffin rotated summary-table geometry is readable without changing its native crop', () => {
  const f = {
    width: 916,
    height: 159,
    source: {
      pdfRect: [171.36, 517.01, 209.43, 736.74],
      dpi: 300,
      rotation: 270,
    },
  };
  assert.deepEqual(figureSize(f), { widthPct: 45.8, maxPx: 293 });
});
