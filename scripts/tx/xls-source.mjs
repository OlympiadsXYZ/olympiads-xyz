import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const XLS_RENDERER = 'excel-biff8-values-v1';
const directory = path.dirname(fileURLToPath(import.meta.url));
export const XLS_RENDERER_FINGERPRINT = ['xls-to-pdf.py','xlsx-to-pdf.py','excel2pdf.ps1'].reduce((hash, file) => hash.update(fs.readFileSync(path.join(directory,file))), createHash('sha256')).digest('hex');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function xlsCacheValid(previous, pdf, source) {
  const c = previous?.converted;
  if (c?.from !== 'xls' || c.renderer !== XLS_RENDERER || c.rendererFingerprint !== XLS_RENDERER_FINGERPRINT) return false;
  if (!fs.existsSync(pdf) || !fs.existsSync(source)) return false;
  return fs.readFileSync(source).subarray(0,8).toString('hex') === 'd0cf11e0a1b11ae1'
    && fs.readFileSync(pdf).subarray(0,5).toString() === '%PDF-'
    && digest(source) === c.sourceSha256 && digest(pdf) === c.pdfSha256 && c.pdfSha256 === previous.sha256;
}
