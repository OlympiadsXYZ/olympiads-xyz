import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const IMAGE_SOURCE_EXTENSION = /\.(jpe?g|png|gif)$/i;
export const IMAGE_RENDERER = 'image-pages-v1';
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const IMAGE_RENDERER_FINGERPRINT = digest(path.join(path.dirname(fileURLToPath(import.meta.url)), 'image-to-pdf.py'));

export function imageCacheValid(previous, pdf, source) {
  const conversion = previous?.converted;
  if (conversion?.from !== 'image' || conversion.renderer !== IMAGE_RENDERER || conversion.rendererFingerprint !== IMAGE_RENDERER_FINGERPRINT) return false;
  if (!fs.existsSync(pdf) || !fs.existsSync(source)) return false;
  return fs.readFileSync(pdf).subarray(0, 5).toString() === '%PDF-'
    && digest(source) === conversion.sourceSha256
    && digest(pdf) === conversion.pdfSha256
    && conversion.pdfSha256 === previous.sha256;
}
