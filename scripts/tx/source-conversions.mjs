import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { xlsxCacheValid } from './xlsx-source.mjs';
import { IMAGE_SOURCE_EXTENSION, imageCacheValid } from './image-source.mjs';
import { PAGED_SOURCE_EXTENSION, pagedKind, pagedCacheValid } from './paged-source.mjs';

// Keep original archive files distinguishable from their derived page renderings
// in portable receipts. The reader sees PDF pages, including converted images.
export function sourceConversions(manifest) {
  return Object.fromEntries(Object.entries(manifest.documents || {})
    .filter(([, doc]) => doc.converted)
    .map(([id, doc]) => [id, structuredClone(doc.converted)]));
}

export function sourceConversionProblems(manifest, directory, recorded) {
  const errors = [];
  for (const [id, doc] of Object.entries(manifest.documents || {})) {
    const converted = doc.converted;
    if (IMAGE_SOURCE_EXTENSION.test(doc.key || '') && converted?.from !== 'image') {
      errors.push(`missing original image conversion provenance for ${id}; rerun prepare`);
      continue;
    }
    if (PAGED_SOURCE_EXTENSION.test(doc.key || '') && converted?.from !== pagedKind(doc.key)) {
      errors.push(`missing original paged source conversion provenance for ${id}; rerun prepare`);
      continue;
    }
    if (!['xlsx', 'image', 'presentation', 'djvu'].includes(converted?.from)) continue;
    const image = converted.from === 'image';
    const paged = ['presentation', 'djvu'].includes(converted.from);
    const kind = paged ? converted.from : image ? 'image' : 'workbook';
    if (recorded !== undefined && !isDeepStrictEqual(recorded[id], converted)) {
      errors.push(`conversion provenance mismatch for ${id} ${kind}`);
    }
    const extension = image || paged ? path.extname(doc.key || '').toLowerCase() : '.xlsx';
    const pdf = `src/${id}.pdf`, source = `src/${id}${extension}`;
    if ((image && !IMAGE_SOURCE_EXTENSION.test(doc.key || '')) || (paged && !PAGED_SOURCE_EXTENSION.test(doc.key || '')) || doc.file !== pdf || converted.sourceFile !== source) {
      errors.push(`unexpected converted source paths for ${id} ${kind}`);
      continue;
    }
    const valid = paged ? pagedCacheValid : image ? imageCacheValid : xlsxCacheValid;
    if (!valid(doc, path.join(directory, pdf), path.join(directory, source))) {
      errors.push(`original ${kind} or derived PDF no longer matches verified conversion for ${id}`);
    }
  }
  return errors;
}
