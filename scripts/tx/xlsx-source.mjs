import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const XLSX_RENDERER = 'excel-fixed-format-v1';
const directory = path.dirname(fileURLToPath(import.meta.url));
export const XLSX_RENDERER_FINGERPRINT = createHash('sha256')
  .update(fs.readFileSync(path.join(directory, 'xlsx-to-pdf.py')))
  .update(fs.readFileSync(path.join(directory, 'excel2pdf.ps1')))
  .digest('hex');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// A historical src/solutions.pdf may actually contain XLSX bytes. Never treat it
// as a valid converted PDF, even if an old manifest happens to hash those bytes.
export function xlsxCacheValid(previous, pdf, source) {
  const conversion = previous?.converted;
  if (conversion?.renderer !== XLSX_RENDERER || conversion.rendererFingerprint !== XLSX_RENDERER_FINGERPRINT) return false;
  if (!fs.existsSync(pdf) || !fs.existsSync(source)) return false;
  return fs.readFileSync(pdf).subarray(0, 5).toString() === '%PDF-'
    && digest(source) === conversion.sourceSha256
    && digest(pdf) === conversion.pdfSha256
    && conversion.pdfSha256 === previous.sha256;
}
