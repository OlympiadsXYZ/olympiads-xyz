import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const isEmbeddedImageFigure = fig => fig.tx?.extraction === 'embedded-image' || !!fig.source?.embeddedImage;

// Recover the complete raster stored in a Word package, including pixels hidden
// by its page-layout crop. This is never a replacement for a PDF crop by default.
export function embeddedImageInfo(fig, manifest, directory) {
  const reject = message => { throw new Error(`${fig.id}: embedded-image: ${message}`); };
  const tx = fig.tx, doc = manifest?.documents?.[tx?.document];
  if (tx?.extraction !== 'embedded-image' || !Number.isInteger(tx.page) || tx.page < 1 || tx.page > (doc?.pages || 0)
    || !isDeepStrictEqual(tx.bbox, [0, 0, 1000, 1000]) || (tx.rotation ?? 0) !== 0 || (fig.source?.rotation ?? 0) !== 0) {
    reject('requires an existing source page, a full-image box and zero rotation');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tx.document) || !/\.docx$/i.test(doc?.key || '')
    || doc.file !== `src/${tx.document}.pdf` || !/^word\/media\/[a-zA-Z0-9_.-]+\.(png|jpe?g)$/.test(tx.entry || '')) {
    reject('requires a prepared DOCX and a safe word/media PNG or JPEG entry');
  }
  const source = path.join(directory, `src/${tx.document}.docx`), pdf = path.join(directory, doc.file);
  if (!/^[a-f0-9]{64}$/.test(tx.documentSha256 || '') || hash(fs.readFileSync(source)) !== tx.documentSha256
    || hash(fs.readFileSync(pdf)) !== doc.sha256) reject('original DOCX or derived PDF hash mismatch');
  const py = `import sys,json,zipfile,io,base64,posixpath
from PIL import Image
from xml.etree import ElementTree as ET
source,entry=sys.argv[1:]
with zipfile.ZipFile(source) as z:
 if z.namelist().count(entry)!=1: raise ValueError('missing or ambiguous media entry')
 info=z.getinfo(entry)
 if info.file_size>32*1024*1024: raise ValueError('media entry exceeds32MiB')
 rels=ET.fromstring(z.read('word/_rels/document.xml.rels'))
 ids=[r.attrib['Id'] for r in rels if r.attrib.get('Type','').endswith('/image') and r.attrib.get('TargetMode')!='External' and posixpath.normpath(posixpath.join('word',r.attrib.get('Target','')))==entry]
 document=ET.fromstring(z.read('word/document.xml'))
 referenced=[r for r in ids if any(v==r for e in document.iter() for k,v in e.attrib.items() if k in ['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed','{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'])]
 if not referenced: raise ValueError('media is not referenced by the main document')
 raw=z.read(entry);im=Image.open(io.BytesIO(raw))
 if im.format not in ['PNG','JPEG'] or getattr(im,'n_frames',1)!=1 or im.getexif().get(274,1)!=1: raise ValueError('only static unrotated PNG/JPEG media is supported')
 print(json.dumps(dict(px=list(im.size),format=im.format,relationshipIds=referenced,data=base64.b64encode(raw).decode('ascii'))))`;
  const r = spawnSync('python3', ['-c', py, source, tx.entry], { encoding: 'utf8', maxBuffer: 48 * 1024 * 1024 });
  if (r.status !== 0) reject(`cannot read original media: ${r.stderr.trim()}`);
  const actual = JSON.parse(r.stdout), bytes = Buffer.from(actual.data, 'base64'), sha256 = hash(bytes);
  const extension = path.extname(tx.entry).toLowerCase();
  if (sha256 !== tx.imageSha256 || (extension === '.png' ? actual.format !== 'PNG' : actual.format !== 'JPEG')) reject('embedded image hash or format mismatch');
  return { bytes: bytes.length, data: bytes, extension, px: actual.px,
    embeddedImage: { archiveKey: doc.key, documentSha256: tx.documentSha256, entry: tx.entry, sha256, derivedPdfSha256: doc.sha256, relationshipIds: actual.relationshipIds } };
}

export function copyEmbeddedImage(fig, manifest, directory, file) {
  const { data, ...info } = embeddedImageInfo(fig, manifest, directory);
  if (path.extname(file).toLowerCase() !== info.extension) throw new Error(`${fig.id}: embedded-image output extension mismatch`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return { ...info, id: fig.id, file };
}

export function embeddedImageEvidenceError(fig, manifest, directory) {
  try {
    const info = embeddedImageInfo(fig, manifest, directory);
    if (!isDeepStrictEqual(fig.source?.embeddedImage, info.embeddedImage) || fig.source.page !== fig.tx.page
      || (fig.source.document || 'problems') !== fig.tx.document || fig.source.pdfRect !== undefined || fig.source.dpi !== undefined
      || fig.width !== info.px[0] || fig.height !== info.px[1] || fig.tx.sha256 !== info.embeddedImage.sha256
      || !fig.tx.file || hash(fs.readFileSync(path.resolve(directory, fig.tx.file))) !== info.embeddedImage.sha256
      || !fig.tx.remoteKey?.endsWith(info.extension) || !fig.url?.endsWith(`/${fig.tx.remoteKey}`)) {
      return 'embedded-image figure bytes, dimensions, URL or source provenance mismatch';
    }
  } catch (error) { return error.message; }
  return null;
}
