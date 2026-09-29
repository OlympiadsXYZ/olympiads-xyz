import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { imageCacheValid } from './image-source.mjs';

const helper = fileURLToPath(new URL('./native-image-crop.py', import.meta.url));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const isNativeImageCrop = fig => fig.tx?.extraction === 'native-image-crop' || !!fig.source?.nativeImageCrop;

export function nativeImageCropInfo(fig, manifest, directory, { output = '', verify = '' } = {}) {
  const reject = message => { throw new Error(`${fig.id}: native-image-crop: ${message}`); };
  const tx = fig.tx, rotation = tx?.rotation ?? fig.source?.rotation ?? 0;
  if (tx?.extraction !== 'native-image-crop' || tx.page !== 1
    || !Array.isArray(tx.bbox) || tx.bbox.length !== 4 || !tx.bbox.every(Number.isFinite)
    || !(0 <= tx.bbox[0] && tx.bbox[0] < tx.bbox[2] && tx.bbox[2] <= 1000 && 0 <= tx.bbox[1] && tx.bbox[1] < tx.bbox[3] && tx.bbox[3] <= 1000)
    || ![0, 90, 180, 270].includes(rotation)
    || fig.source?.originalImage || fig.source?.embeddedImage) reject('requires page1, valid permille bbox, orthogonal rotation and exclusive extraction mode');
  const doc = manifest?.documents?.[tx.document], c = doc?.converted;
  const extension = path.extname(doc?.key || '').toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(extension) || c?.from !== 'image'
    || doc.file !== `src/${tx.document}.pdf` || c.sourceFile !== `src/${tx.document}${extension}`
    || doc.pages !== 1 || c.pages?.length !== 1 || c.pages[0].page !== 1 || c.pages[0].sourceFrame !== 0
    || c.resolution !== 150) reject('requires prepared single-frame original JPEG/PNG conversion');
  const source = path.join(directory, c.sourceFile), pdf = path.join(directory, doc.file);
  if (!imageCacheValid(doc, pdf, source)) reject('original image or derived PDF conversion hash/fingerprint mismatch');
  const px = [c.pages[0].widthPx, c.pages[0].heightPx];
  if (!px.every(n => Number.isInteger(n) && n > 0)) reject('invalid native pixel dimensions');
  const rect = [0, 0, px[0] * 72 / c.resolution, px[1] * 72 / c.resolution], size = doc.pageSizes?.[0];
  if (!Number.isFinite(size?.widthPt) || !Number.isFinite(size?.heightPt) || Math.abs(size.widthPt - rect[2]) >= .01 || Math.abs(size.heightPt - rect[3]) >= .01) reject('manifest page geometry mismatch');
  const original = { source, px, dpi: c.resolution, originalImage: { archiveKey: doc.key, sha256: c.sourceSha256, derivedPdfSha256: c.pdfSha256 } };
  const [w, h] = original.px;
  const pixelBox = [Math.floor(tx.bbox[0] * w / 1000), Math.floor(tx.bbox[1] * h / 1000), Math.ceil(tx.bbox[2] * w / 1000), Math.ceil(tx.bbox[3] * h / 1000)];
  if (output && path.extname(output).toLowerCase() !== '.webp') reject('output extension must be .webp');
  const geometry = { px, rect, format: extension === '.png' ? 'PNG' : 'JPEG' };
  const result = spawnSync('python3', [helper, original.source, pdf, JSON.stringify(geometry), JSON.stringify(pixelBox), String(rotation), output, verify], { encoding: 'utf8' });
  if (result.status !== 0) reject(`pixel extraction/verification failed: ${result.stderr || result.stdout}`);
  const actual = JSON.parse(result.stdout);
  const nativeImageCrop = { ...original.originalImage, sourcePx: original.px, rawSourcePx: actual.rawSourcePx, exifOrientation: actual.exifOrientation, pixelBox, rotation, encoding: 'webp-lossless',
    pixelMode: actual.pixelMode, pixelSha256: actual.pixelSha256, helperSha256: hash(helper), pillow: actual.pillow, webp: actual.webp };
  const pdfRect = pixelBox.map(v => v * 72 / original.dpi);
  return { id: fig.id, file: output || verify, extension: '.webp', px: actual.px, bytes: actual.bytes, sha256: actual.sha256,
    dpi: original.dpi, pdfRect, nativeImageCrop };
}

export const writeNativeImageCrop = (fig, manifest, directory, file) => nativeImageCropInfo(fig, manifest, directory, { output: file });

export function nativeImageCropEvidenceError(fig, manifest, directory) {
  try {
    const file = fig.tx?.file;
    if (!file || path.isAbsolute(file) || path.relative(path.resolve(directory), path.resolve(directory, file)).startsWith('..')) return 'native-image-crop file must stay within paper directory';
    const info = nativeImageCropInfo(fig, manifest, directory, { verify: path.resolve(directory, file) });
    if (!isDeepStrictEqual(fig.source?.nativeImageCrop, info.nativeImageCrop)
      || !isDeepStrictEqual(fig.source?.pdfRect, info.pdfRect) || fig.source?.page !== 1
      || (fig.source?.document || 'problems') !== fig.tx.document || fig.source?.dpi !== info.dpi
      || (fig.source?.rotation ?? 0) !== info.nativeImageCrop.rotation
      || fig.width !== info.px[0] || fig.height !== info.px[1] || fig.tx.sha256 !== info.sha256
      || !fig.tx.remoteKey?.endsWith('.webp') || !fig.url?.endsWith(`/${fig.tx.remoteKey}`)) return 'native-image-crop dimensions, bytes, URL or source provenance mismatch';
  } catch (error) { return error.message; }
  return null;
}
