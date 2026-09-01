#!/usr/bin/env python3
"""Crop figure regions out of an exam PDF at print resolution.

Boxes are given in the coordinate space of a preview render (default 160 dpi),
because that is the image a transcriber actually looks at; they are converted
to PDF points and re-rendered at `--dpi` so the stored figure is sharp.

  pdfcrop.py in.pdf out_dir --dpi 300 --preview-dpi 160 \
      --box "page=1,x0=110,y0=400,x1=690,y1=670,id=p1-fig1"

Also supports --auto to propose boxes by clustering vector drawings, which is
how a batch pipeline gets candidate regions without a human eyeballing them.
"""
import argparse, json, os, sys
import fitz


def parse_box(s):
    d = dict(kv.split('=', 1) for kv in s.split(','))
    return {
        'id': d.get('id', 'fig'),
        'page': int(d['page']),
        'rect': [float(d['x0']), float(d['y0']), float(d['x1']), float(d['y1'])],
    }


def auto_boxes(doc, preview_scale, pad=8, min_area=4000):
    """Cluster vector drawings + embedded images into figure candidates."""
    out = []
    for pno, page in enumerate(doc, start=1):
        rects = [fitz.Rect(d['rect']) for d in page.get_drawings()]
        for img in page.get_images(full=True):
            for r in page.get_image_rects(img[0]):
                rects.append(fitz.Rect(r))
        merged = []
        for r in rects:
            if r.get_area() < 4:
                continue
            hit = None
            for m in merged:
                if m.intersects(r + (-20, -20, 20, 20)):
                    hit = m
                    break
            if hit is not None:
                hit |= r
            else:
                merged.append(fitz.Rect(r))
        # second pass: merge clusters that now touch
        changed = True
        while changed:
            changed = False
            for i in range(len(merged)):
                for j in range(len(merged) - 1, i, -1):
                    if merged[i].intersects(merged[j] + (-20, -20, 20, 20)):
                        merged[i] |= merged[j]
                        del merged[j]
                        changed = True
        for i, m in enumerate(merged, 1):
            if m.get_area() < min_area:
                continue
            m = m + (-pad, -pad, pad, pad)
            out.append({'id': f'p{pno}-auto{i}', 'page': pno,
                        'rect': [m.x0 * preview_scale, m.y0 * preview_scale,
                                 m.x1 * preview_scale, m.y1 * preview_scale]})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('out_dir')
    ap.add_argument('--dpi', type=float, default=300)
    ap.add_argument('--preview-dpi', type=float, default=160)
    ap.add_argument('--box', action='append', default=[])
    ap.add_argument('--auto', action='store_true')
    a = ap.parse_args()

    doc = fitz.open(a.pdf)
    os.makedirs(a.out_dir, exist_ok=True)
    to_pdf = 72.0 / a.preview_dpi          # preview px -> pdf points
    boxes = [parse_box(b) for b in a.box]
    if a.auto:
        boxes += auto_boxes(doc, 1.0 / to_pdf)

    manifest = []
    for b in boxes:
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
    json.dump(manifest, open(os.path.join(a.out_dir, 'figures.json'), 'w'), indent=1)


main()
