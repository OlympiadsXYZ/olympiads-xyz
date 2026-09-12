#!/usr/bin/env python3
"""Detect candidate figure regions in a PDF from its own structure.

For each page: embedded raster images and clusters of vector drawings, reported
in PERMILLE of the DISPLAYED page (rotation applied), the same frame the reader
prompt and figures.mjs use. Short labels next to a drawing (axis names, point
letters) are folded into its region so a snapped crop keeps its lettering;
headings, captions ("Фиг. 2", "Задача 3 (11 точки):") and body text are not,
and a region that grazes a body-text line is trimmed back from it. Regions
covering most of the page (a scanned page image, a frame) are dropped: a scan
carries no usable structure and must be judged from pixels.

  pdfregions.py in.pdf [--min-area 0.002] [--max-area 0.85]
"""
import argparse, json, re, statistics, sys
import fitz

SCALE = 1000.0
VERSION = 2
CAPTION = re.compile(r'^\s*(фиг\.?|фигура|figure|fig\.?|задача|табл\.?|таблица|схема|снимка)\b', re.I)


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


def text_lines(page):
    """Lines of text with displayed rect, word count, font size, bold flag."""
    out = []
    sizes = []
    for block in page.get_text('dict').get('blocks', []):
        if block.get('type') != 0:
            continue
        for line in block.get('lines', []):
            spans = [s for s in line.get('spans', []) if s.get('text', '').strip()]
            if not spans:
                continue
            text = ''.join(s['text'] for s in spans).strip()
            size = max(s.get('size', 0) for s in spans)
            bold = any((s.get('flags', 0) & 16) or 'bold' in s.get('font', '').lower() for s in spans)
            r = displayed(fitz.Rect(line['bbox']), page)
            words = len(text.split())
            out.append({'rect': r, 'words': words, 'size': size, 'bold': bold, 'text': text})
            sizes.extend([size] * words)
    body = statistics.median(sizes) if sizes else 0
    return out, body


def page_regions(page, min_area, max_area):
    prect = page.rect  # displayed
    page_area = prect.width * prect.height
    raw = []
    for info in page.get_image_info(xrefs=True):
        r = displayed(fitz.Rect(info['bbox']), page)
        if not r.is_empty:
            raw.append(r)
    try:
        clusters = page.cluster_drawings(x_tolerance=4, y_tolerance=4)
    except Exception:
        clusters = []
    for c in clusters:
        r = displayed(fitz.Rect(c), page)
        if not r.is_empty:
            raw.append(r)
    keep = []
    for r in raw:
        frac = (r.width * r.height) / page_area
        if frac < min_area or frac > max_area or r.width < 12 or r.height < 12:
            continue
        keep.append(r)
    merged = merge(keep, tol=6)
    lines, body = text_lines(page)
    is_label = lambda ln: (ln['words'] <= 3 and ln['rect'].width < 0.3 * prect.width and not CAPTION.match(ln['text'])
                           and not ln['text'].rstrip().endswith(':') and (body == 0 or ln['size'] <= 1.15 * body))
    is_body = lambda ln: ln['words'] >= 5 or CAPTION.match(ln['text']) or (body and ln['size'] > 1.15 * body) or ln['bold']
    regions = []
    for r in merged:
        box = fitz.Rect(r)
        near = fitz.Rect(r.x0 - 0.03 * prect.width, r.y0 - 0.02 * prect.height, r.x1 + 0.03 * prect.width, r.y1 + 0.03 * prect.height)
        for ln in lines:
            if is_label(ln) and near.intersects(ln['rect']):
                box |= ln['rect']
        # trim: a body line the box only grazes (less than half its height inside) marks where the drawing ends
        for ln in lines:
            if not is_body(ln):
                continue
            lr = ln['rect']
            inter = box & lr
            if inter.is_empty or inter.height >= 0.5 * lr.height:
                continue
            if lr.y0 < box.y0 < lr.y1:
                box.y0 = lr.y1 + 1
            elif lr.y0 < box.y1 < lr.y1:
                box.y1 = lr.y0 - 1
        box &= prect
        if box.is_empty or box.width < 12 or box.height < 12:
            continue
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
    json.dump({'version': VERSION, 'pages': out}, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
