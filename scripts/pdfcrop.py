#!/usr/bin/env python3
"""Crop a region out of an exam PDF at print resolution.

Deliberately assumption-free about what the PDF contains. It re-renders the
requested rectangle, so it works the same on a vector-drawn diagram, a fully
rasterised scan, or a photo pasted into a Word export — there is no figure
detection here and none should be added. The transcribing agent looks at the
rendered page and says where the figure is; this only does the cropping.

Boxes are given in the coordinate space of a preview render (default 160 dpi),
because that is the image the agent actually looked at.

  pdfcrop.py in.pdf out_dir --dpi 300 --preview-dpi 160 \
      --box "page=1,x0=110,y0=400,x1=690,y1=670,id=p1-fig1"

--probe prints what each page is made of (text chars, embedded images, vector
drawings, whether the text layer looks trustworthy) so the agent can decide how
to treat this particular file instead of assuming.
"""
import argparse, json, os
import fitz


def parse_box(s):
    d = dict(kv.split('=', 1) for kv in s.split(','))
    return {
        'id': d.get('id', 'fig'),
        'page': int(d['page']),
        'rect': [float(d['x0']), float(d['y0']), float(d['x1']), float(d['y1'])],
    }


def probe(doc):
    """Describe each page without deciding anything for the caller."""
    out = []
    for pno, page in enumerate(doc, start=1):
        text = page.get_text().strip()
        images = page.get_images(full=True)
        drawings = page.get_drawings()
        image_area = 0.0
        for img in images:
            for r in page.get_image_rects(img[0]):
                image_area += abs(r.width * r.height)
        page_area = abs(page.rect.width * page.rect.height) or 1.0
        digits = sum(c.isdigit() for c in text)
        out.append({
            'page': pno,
            'textChars': len(text),
            'digitsInText': digits,
            'embeddedImages': len(images),
            'imageCoverage': round(image_area / page_area, 3),
            'vectorDrawings': len(drawings),
            # Hints, not verdicts: a scan has lots of image coverage and no text;
            # a Word export with equation objects has text but almost no digits.
            'looksScanned': len(text) < 120 and image_area / page_area > 0.5,
            'textLayerSuspect': len(text) > 200 and digits < 5,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('out_dir', nargs='?')
    ap.add_argument('--dpi', type=float, default=300)
    ap.add_argument('--preview-dpi', type=float, default=160)
    ap.add_argument('--box', action='append', default=[])
    ap.add_argument('--probe', action='store_true')
    a = ap.parse_args()

    doc = fitz.open(a.pdf)
    if a.probe:
        print(json.dumps({'pages': doc.page_count, 'perPage': probe(doc)}, indent=1))
        return
    if not a.out_dir:
        ap.error('out_dir is required unless --probe is given')

    os.makedirs(a.out_dir, exist_ok=True)
    to_pdf = 72.0 / a.preview_dpi          # preview px -> pdf points
    manifest = []
    for b in [parse_box(x) for x in a.box]:
        page = doc[b['page'] - 1]
        r = fitz.Rect(*[v * to_pdf for v in b['rect']]) & page.rect
        pix = page.get_pixmap(clip=r, dpi=int(a.dpi), alpha=False)
        path = os.path.join(a.out_dir, f"{b['id']}.png")
        pix.save(path)
        manifest.append({'id': b['id'], 'page': b['page'], 'file': path,
                         'pdfRect': [round(v, 2) for v in (r.x0, r.y0, r.x1, r.y1)],
                         'px': [pix.width, pix.height],
                         'bytes': os.path.getsize(path)})
        print(f"{b['id']}: {pix.width}x{pix.height}px  {os.path.getsize(path)}B  {path}")
    if manifest:
        json.dump(manifest, open(os.path.join(a.out_dir, 'figures.json'), 'w'), indent=1)


main()
