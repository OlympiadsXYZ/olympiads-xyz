// Pure geometry validation for source-anchored candidate figures. No file IO,
// PDF/image verification, cropping, upload, or permission to publish.
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const size = x => Array.isArray(x) && x.length === 2 && x.every(n => Number.isSafeInteger(n) && n > 0);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const own = (x, k) => Object.hasOwn(x, k);
function reject(message) {
  throw Object.assign(new Error(`Page figure rejected: ${message}`), { code: 'UNSUPPORTED_PAGE_FIGURE_GEOMETRY' });
}

/**
 * Only an explicitly reviewed original full page, or a proportional full-page
 * resize of that original, has the same normalized coordinates as the PDF.
 * Pixel rounding is allowed if a common scale can round to both dimensions.
 * These declarations are hash-bound by page-assembly; the caller must separately
 * verify the files and the original render before dispatch/crop review.
 */
export function originalPageFigureGeometry(item, bbox) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) reject('missing page item');
  if (item.readyForDispatch !== true || item.rotationNeedsReview !== false || item.pdfDeclaredRotation !== 0
    || !size([item.imageWidth, item.imageHeight]) || !sha(item.imageSha256) || !sha(item.sourcePdfSha256)
    || !nonempty(item.imagePath) || !nonempty(item.sourcePdfPath)
    || !['problems', 'solutions'].includes(item.documentRole) || !Number.isSafeInteger(item.pdfPage) || item.pdfPage < 1) reject('page is not explicitly reviewed upright');
  const allowed = new Set(['viewTransform', 'pdfDeclaredRotation', 'rotationNeedsReview',
    'parentImageWidth', 'parentImageHeight', 'parentImagePath', 'parentImageSha256']);
  if (Object.keys(item).some(k => /crop|rotat|transform|parent/i.test(k) && !allowed.has(k))) reject('cropped, rotated, or unknown transform metadata');
  const t = item.viewTransform, parentFields = [...allowed].filter(k => k.startsWith('parent'));
  if (t === 'original' || t === 'none') {
    if (parentFields.some(k => own(item, k))) reject('original view has ambiguous parent metadata');
  } else {
    if (!t || typeof t !== 'object' || Array.isArray(t)
      || Object.keys(t).some(k => !['rotateCW', 'fullPage', 'resizeFrom', 'resizeTo', 'normalizedCoordinateMapping'].includes(k))
      || t.rotateCW !== 0 || t.fullPage !== true || !size(t.resizeFrom) || !size(t.resizeTo)
      || (own(t, 'normalizedCoordinateMapping') && typeof t.normalizedCoordinateMapping !== 'string')
      || !sha(item.parentImageSha256) || !nonempty(item.parentImagePath)
      || t.resizeFrom[0] !== item.parentImageWidth || t.resizeFrom[1] !== item.parentImageHeight
      || t.resizeTo[0] !== item.imageWidth || t.resizeTo[1] !== item.imageHeight) reject('only a declared full-page proportional resize is supported');
    const low = Math.max(...t.resizeTo.map((n, i) => (n - 0.5) / t.resizeFrom[i]));
    const high = Math.min(...t.resizeTo.map((n, i) => (n + 0.5) / t.resizeFrom[i]));
    if (!(low < high)) reject('resize changes page aspect ratio');
    if (t.resizeFrom.some((n, i) => n !== t.resizeTo[i]) && item.imageSha256 === item.parentImageSha256) reject('resized dimensions conflict with identical parent/image hashes');
  }
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)
    || bbox[0] < 0 || bbox[1] < 0 || bbox[2] > 1000 || bbox[3] > 1000
    || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) reject('invalid original-page permille box');
  return { document: item.documentRole, page: item.pdfPage, bbox: [...bbox], rotation: 0,
    sourcePdfSha256: item.sourcePdfSha256, inputImageSha256: item.imageSha256,
    inputViewTransform: structuredClone(t), coordinateSpace: 'original-pdf-page-permille',
    sourceFilesVerifiedByThisModule: false };
}
