// Displayed CropBox coordinates: origin top-left, /Rotate applied. Keep the
// renderer's cache identity independent of source hash and resolution.
import fs from 'node:fs';
export const PAGE_RENDERER = 'pdftoppm-cropbox-v1';
export const pageRenderArgs = (file, prefix, dpi) => ['-cropbox', '-r', String(dpi), '-png', file, prefix];

// Legacy previews used MediaBox while pageSizes used CropBox. Detect this before
// interpreting a reader's boxes or snapping them to PyMuPDF regions. PNG IHDR is
// sufficient; no image decoding dependency. Allow one pixel of raster rounding.
export function previewGeometryError(file, size, dpi) {
  if (!file || !fs.existsSync(file)) return null; // hand-authored/GC'd legacy manifests
  const header = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  if (header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || header.toString('ascii', 12, 16) !== 'IHDR') return `invalid PNG preview: ${file}`;
  if (!size || !(size.widthPt > 0 && size.heightPt > 0 && dpi > 0)) return `missing page geometry for ${file}`;
  const actual = [header.readUInt32BE(16), header.readUInt32BE(20)];
  const expected = [size.widthPt * dpi / 72, size.heightPt * dpi / 72];
  return actual.some((v, i) => Math.abs(v - expected[i]) > 1)
    ? `preview ${actual.join('x')}px does not match displayed CropBox ${expected.map(Math.ceil).join('x')}px: ${file}` : null;
}
