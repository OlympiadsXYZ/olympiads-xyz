import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { xlsxCacheValid } from './xlsx-source.mjs';

// Keep the original workbook and its derived page rendering distinguishable in
// portable receipts. The reader sees PDF pages; the archive serves XLSX bytes.
export function sourceConversions(manifest) {
  return Object.fromEntries(Object.entries(manifest.documents || {})
    .filter(([, doc]) => doc.converted)
    .map(([id, doc]) => [id, structuredClone(doc.converted)]));
}

export function sourceConversionProblems(manifest, directory, recorded) {
  const errors = [];
  for (const [id, doc] of Object.entries(manifest.documents || {})) {
    const converted = doc.converted;
    if (converted?.from !== 'xlsx') continue;
    if (recorded !== undefined && !isDeepStrictEqual(recorded[id], converted)) {
      errors.push(`conversion provenance mismatch for ${id} workbook`);
    }
    const pdf = `src/${id}.pdf`, source = `src/${id}.xlsx`;
    if (doc.file !== pdf || converted.sourceFile !== source) {
      errors.push(`unexpected converted source paths for ${id} workbook`);
      continue;
    }
    if (!xlsxCacheValid(doc, path.join(directory, pdf), path.join(directory, source))) {
      errors.push(`original workbook or derived PDF no longer matches verified conversion for ${id}`);
    }
  }
  return errors;
}
