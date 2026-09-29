import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PAGED_SOURCE_EXTENSION = /\.(pptx|ppsx|djvu|djv)$/i;
const directory = path.dirname(fileURLToPath(import.meta.url));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const pagedKind = key => /\.(pptx|ppsx)$/i.test(key) ? 'presentation' : 'djvu';
export const pagedFingerprint = key => {
  const files = pagedKind(key) === 'presentation' ? ['presentation-to-pdf.py', 'powerpoint2pdf.ps1'] : ['djvu-to-pdf.py'];
  const digest = createHash('sha256');
  for (const file of files) digest.update(fs.readFileSync(path.join(directory, file)));
  return digest.digest('hex');
};
export function pagedCacheValid(previous, pdf, source) {
  const c = previous?.converted;
  if (!PAGED_SOURCE_EXTENSION.test(previous?.key || '') || c?.from !== pagedKind(previous.key)
    || c.rendererFingerprint !== pagedFingerprint(previous.key)) return false;
  if (!fs.existsSync(source) || !fs.existsSync(pdf)) return false;
  if (!Array.isArray(c.pages) || !c.pages.length || c.pages.length !== previous.pages
    || c.pages.some((p, i) => p.page !== i + 1 || p.sourcePage !== i + 1)) return false;
  return fs.readFileSync(pdf).subarray(0, 5).toString() === '%PDF-'
    && hash(source) === c.sourceSha256 && hash(pdf) === c.pdfSha256 && previous.sha256 === c.pdfSha256;
}
