#!/usr/bin/env python3
"""Detect candidate figure regions in a PDF from its own structure.

For each page: embedded raster images and clusters of vector drawings, reported
in PERMILLE of the DISPLAYED page (rotation applied), the same frame the reader
prompt and figures.mjs use. Nearby short text (axis labels, point names) is
folded into a region so a snapped crop keeps its lettering. Regions covering
most of the page (a scanned page image, a frame) are dropped: a scan carries no
usable structure and must be judged from pixels.

  pdfregions.py in.pdf [--min-area 0.002] [--max-area 0.85] [--json]
"""
import argparse, json, sys
import fitz

SCALE = 1000.0


def to_permille(rect, page_rect):
    return [round(SCALE * (rect.x0 - page_rect.x0) / page_rect.width, 1),
            round(SCALE * (rect.y0 - page_rect.y0) / page_rect.height, 1),
            round(SCALE * (rect.x1 - page_rect.x0) / page_rect.width, 1),
            round(SCALE * (rect.y1 - page_rect.y0) / page_rect.height, 1)]


def displayed(rect, page):
    """Unrotated page coordinates -> displayed (rotated) coordinates."""
    r = fitz.Rect(rect) * page.rotation_matrix
    r.normalize()
    return r


def merge(rects, tol):
    """Union rects that intersect or touch within tol points, until stable."""
    rects = [fitz.Rect(r) for r in rects]
    changed = True
    while changed:
        changed = False
        out = []
        for r in rects:
            grown = fitz.Rect(r.x0 - tol, r.y0 - tol, r.x1 + tol, r.y1 + tol)
            for i, o in enumerate(out):
                if grown.intersects(o):
                    out[i] = o | r
                    changed = True
                    break
            else:
                out.append(r)
        rects = out
    return rects


def page_regions(page, min_area, max_area):
    prect = page.rect  # displayed
    page_area = prect.width * prect.height
    raw = []
    for info in page.get_image_info(xrefs=True):
        r = displayed(fitz.Rect(info['bbox']), page)
        if r.is_empty:
            continue
        raw.append(('image', r))
    try:
        clusters = page.cluster_drawings(x_tolerance=4, y_tolerance=4)
    except Exception:
        clusters = []
    for c in clusters:
        r = displayed(fitz.Rect(c), page)
        if r.is_empty:
            continue
        raw.append(('drawing', r))
    # drop hairlines/underlines and full-page frames or scans
    keep = []
    for kind, r in raw:
        frac = (r.width * r.height) / page_area
        if frac < min_area or frac > max_area:
            continue
        if r.width < 12 or r.height < 12:
            continue
        keep.append(r)
    merged = merge(keep, tol=6)
    # fold in nearby short text (labels), never long body lines
    words = page.get_text('words')  # x0,y0,x1,y1,word,block,line,wordno
    lines = {}
    for w in words:
        key = (w[5], w[6])
        wr = displayed(fitz.Rect(w[:4]), page)
        if key in lines:
            lines[key] = (lines[key][0] | wr, lines[key][1] + 1)
        else:
            lines[key] = (wr, 1)
    regions = []
    for r in merged:
        box = fitz.Rect(r)
        near = fitz.Rect(r.x0 - 0.03 * prect.width, r.y0 - 0.02 * prect.height, r.x1 + 0.03 * prect.width, r.y1 + 0.03 * prect.height)
        for (lr, n) in lines.values():
            if n <= 4 and lr.width < 0.35 * prect.width and near.intersects(lr):
                box |= lr
        box &= prect
        regions.append({'bbox': to_permille(box, prect), 'core': to_permille(r, prect), 'areaFrac': round((box.width * box.height) / page_area, 4)})
    regions.sort(key=lambda g: (g['bbox'][1], g['bbox'][0]))
    return regions


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--min-area', type=float, default=0.002)
    ap.add_argument('--max-area', type=float, default=0.85)
    a = ap.parse_args()
    doc = fitz.open(a.pdf)
    out = []
    for i, page in enumerate(doc):
        regions = page_regions(page, a.min_area, a.max_area)
        imgs = page.get_image_info()
        scanned = any((fitz.Rect(x['bbox']).width * fitz.Rect(x['bbox']).height) / (page.rect.width * page.rect.height) > a.max_area for x in imgs)
        out.append({'page': i + 1, 'widthPt': round(page.rect.width, 2), 'heightPt': round(page.rect.height, 2), 'rotation': page.rotation,
                    'scanned': scanned, 'regions': regions})
    json.dump({'pages': out}, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
