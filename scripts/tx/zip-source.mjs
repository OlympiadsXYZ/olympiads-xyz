import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ZIP_ENTRY_HELPER = path.join(here, 'zip-entry.py');
const digest = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export const ZIP_RENDERER_FINGERPRINT = createHash('sha256')
  .update(fs.readFileSync(ZIP_ENTRY_HELPER)).update(fs.readFileSync(path.join(here, 'office2pdf.ps1'))).digest('hex');

export function validArchiveEntry(entry) {
  return typeof entry === 'string' && !/[\\:]/.test(entry)
    && entry.split('/').every(p => p && p !== '.' && p !== '..') && /\.(pdf|docx)$/i.test(entry);
}

export function inspectZipEntry(archive, entry, destination) {
  if (!validArchiveEntry(entry)) throw new Error('invalid ZIP source entry');
  const r = spawnSync('python3', [ZIP_ENTRY_HELPER, archive, entry, ...(destination ? [destination] : [])], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'ZIP extraction failed').trim());
  return JSON.parse(r.stdout);
}

export function zipCacheValid(doc, directory) {
  try {
    const c = doc?.converted;
    if (c?.from !== 'zip-entry' || !/\.zip$/i.test(doc.key) || !validArchiveEntry(doc.archiveEntry)
      || c.archiveKey !== doc.key || c.entry !== doc.archiveEntry || c.rendererFingerprint !== ZIP_RENDERER_FINGERPRINT) return false;
    const match = /^src\/(supplement-[1-9][0-9]*)\.pdf$/.exec(doc.file || '');
    if (!match || c.sourceFile !== `src/${match[1]}.zip` || c.entryFile !== `src/${match[1]}${path.extname(c.entry).toLowerCase()}`) return false;
    const pdf = path.join(directory, doc.file), archive = path.join(directory, c.sourceFile), entryFile = path.join(directory, c.entryFile);
    if (!fs.readFileSync(pdf).subarray(0, 5).equals(Buffer.from('%PDF-')) || digest(pdf) !== doc.sha256
      || doc.sha256 !== c.pdfSha256 || digest(archive) !== c.sourceSha256 || digest(entryFile) !== c.entrySha256) return false;
    return inspectZipEntry(archive, c.entry).entrySha256 === c.entrySha256;
  } catch { return false; }
}
