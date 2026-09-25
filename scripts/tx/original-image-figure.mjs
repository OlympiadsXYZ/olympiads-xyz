import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { imageCacheValid } from './image-source.mjs';

export const isOriginalImageFigure = fig => fig.tx?.extraction === 'original-image' || !!fig.source?.originalImage;
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Opt-in only. A crop proposal can never be silently replaced with a whole file.
export function originalImageInfo(fig, manifest, directory) {
  const reject = message => { throw new Error(`${fig.id}: original-image: ${message}`); };
  const tx = fig.tx;
  if (tx?.extraction !== 'original-image' || tx.page !== 1 || !isDeepStrictEqual(tx.bbox, [0, 0, 1000, 1000])
    || (tx.rotation ?? 0) !== 0 || (fig.source?.rotation ?? 0) !== 0) reject('requires page 1, exact full-page bbox [0,0,1000,1000], and zero rotation');
  const doc = manifest?.documents?.[tx.document], c = doc?.converted;
  const extension = path.extname(doc?.key || '').toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(extension) || c?.from !== 'image'
    || doc.file !== `src/${tx.document}.pdf` || c.sourceFile !== `src/${tx.document}${extension}`
    || doc.pages !== 1 || c.pages?.length !== 1 || c.pages[0].page !== 1 || c.pages[0].sourceFrame !== 0) reject('requires a prepared single-frame original JPEG or PNG source');
  const source = path.join(directory, c.sourceFile), pdf = path.join(directory, doc.file);
  if (!imageCacheValid(doc, pdf, source)) reject('original image or derived PDF conversion hash/fingerprint mismatch');
  const inspect = spawnSync('python3', ['-c', `import sys,json,fitz\nfrom PIL import Image\nim=Image.open(sys.argv[1])\nd=fitz.open(sys.argv[2]);p=d[0]\nprint(json.dumps(dict(format=im.format,frames=getattr(im,'n_frames',1),orientation=im.getexif().get(274,1),px=list(im.size),pages=len(d),rotation=p.rotation,rect=list(p.rect),crop=list(p.cropbox),media=list(p.mediabox))))`, source, pdf], { encoding: 'utf8' });
  if (inspect.status !== 0) reject(`cannot inspect original image/PDF: ${inspect.stderr}`);
  const actual = JSON.parse(inspect.stdout), size = doc.pageSizes?.[0];
  const rect = [0, 0, c.pages[0].widthPx * 72 / c.resolution, c.pages[0].heightPx * 72 / c.resolution];
  const sameRect = value => Array.isArray(value) && value.length === 4 && value.every((v, i) => Math.abs(v - rect[i]) < 0.01);
  if (actual.format !== (extension === '.png' ? 'PNG' : 'JPEG') || actual.frames !== 1 || actual.orientation !== 1
    || !isDeepStrictEqual(actual.px, [c.pages[0].widthPx, c.pages[0].heightPx])
    || actual.pages !== 1 || actual.rotation !== 0 || !sameRect(actual.rect) || !sameRect(actual.crop) || !sameRect(actual.media)
    || !sameRect([0, 0, size?.widthPt, size?.heightPt])) reject('image dimensions, orientation, frames or displayed PDF geometry do not match the conversion');
  return { source, extension, px: actual.px, bytes: fs.statSync(source).size, pdfRect: rect, dpi: c.resolution,
    originalImage: { archiveKey: doc.key, sha256: c.sourceSha256, derivedPdfSha256: c.pdfSha256 } };
}

export function copyOriginalImage(fig, manifest, directory, file) {
  const info = originalImageInfo(fig, manifest, directory);
  if (path.extname(file).toLowerCase() !== info.extension) throw new Error(`${fig.id}: original-image output extension mismatch`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(info.source, file);
  return { ...info, id: fig.id, file };
}

export function originalImageEvidenceError(fig, manifest, directory) {
  try {
    const info = originalImageInfo(fig, manifest, directory);
    if (!isDeepStrictEqual(fig.source?.originalImage, info.originalImage)
      || !isDeepStrictEqual(fig.source?.pdfRect, info.pdfRect) || fig.source?.page !== 1
      || (fig.source?.document || 'problems') !== fig.tx.document || fig.source?.dpi !== info.dpi
      || fig.width !== info.px[0] || fig.height !== info.px[1] || fig.tx.sha256 !== info.originalImage.sha256
      || !fig.tx.file || hash(path.resolve(directory, fig.tx.file)) !== info.originalImage.sha256
      || !fig.tx.remoteKey?.endsWith(info.extension) || !fig.url?.endsWith(`/${fig.tx.remoteKey}`)) {
      return 'original-image figure bytes, dimensions, URL or source provenance mismatch';
    }
  } catch (error) { return error.message; }
  return null;
}
