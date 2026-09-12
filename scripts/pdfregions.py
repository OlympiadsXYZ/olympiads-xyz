#!/usr/bin/env python3
"""Detect candidate figure regions in a PDF page, from its structure or its pixels.

For each page: embedded raster images and clusters of vector drawings, reported
in PERMILLE of the DISPLAYED page (rotation applied), the same frame the reader
prompt and figures.mjs use. Short labels next to a drawing (axis names, point
letters) are folded into its region so a snapped crop keeps its lettering;
headings, captions ("Фиг. 2", "Задача 3 (11 точки):") and body text are not,
and a region that grazes a body-text line is trimmed back from it.

A scanned page (one image covering most of it) carries no structure, so it is
judged from pixels: the page is rendered, ink is separated into text lines
(rows of many letter-sized blobs) and everything else (strokes, curves, photos),
the non-text ink is clustered, and short text lines touching a cluster are
folded in as labels. Rulings with text inside are reported as `kind: table`.
Both routes also list the problem headings a page prints (native text only) so
a region can be attributed to a problem.

  pdfregions.py in.pdf [--min-area 0.002] [--max-area 0.85] [--no-raster]
"""
import argparse, json, re, statistics, sys
import fitz

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SCALE = 1000.0
VERSION = 4
CAPTION = re.compile(r'^\s*(фиг\.?|фигура|figure|fig\.?|задача|табл\.?|таблица|схема|снимка)\b', re.I)
HEADING = re.compile(r'^\s*(?:(?:задача|з\s*а\s*д\s*а\s*ч\s*а)\s*(?:№\s*)?(\d+|[ivx]+)\b|(\d+)\s*(?:-?\s*(?:ва|ра|та|а|и))?\s+задача\b)', re.I)
ROMAN = {'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10}
RASTER_WIDTH = 1200  # px; a scan at 34 inches and a Letter page get the same treatment
DEBUG = bool(__import__('os').environ.get('PDFREGIONS_DEBUG'))
DEBUG_BOX = [float(v) for v in __import__('os').environ['PDFREGIONS_DEBUG_BOX'].split(',')] if __import__('os').environ.get('PDFREGIONS_DEBUG_BOX') else None  # permille x0,y0,x1,y1: print the text rows there


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


def headings(lines, prect):
    out = []
    for ln in lines:
        m = HEADING.match(ln['text'])
        if not m:
            continue
        n = (m.group(1) or m.group(2)).lower()
        out.append({'number': str(ROMAN.get(n) or (int(n) if n.isdigit() else n)), 'y': round(SCALE * (ln['rect'].y0 - prect.y0) / prect.height, 1), 'text': ln['text'][:80]})
    return out


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
    # vector paths per region: a table is rulings only (axis-aligned lines and rectangles); a curve or a slanted line is a drawing
    paths = []
    try:
        for p in page.get_drawings():
            ruled = True
            for it in p.get('items', []):
                if it[0] == 're':
                    continue
                if it[0] == 'l':
                    a, b = it[1], it[2]
                    if abs(a.x - b.x) > 1 and abs(a.y - b.y) > 1:
                        ruled = False
                else:
                    ruled = False
            paths.append({'rect': displayed(fitz.Rect(p['rect']), page), 'ruled': ruled})
    except Exception:
        pass
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
        # rulings only (no curve, no slanted line, no image) with several text lines inside are a table, not a drawing
        inside = [ln for ln in lines if (r & ln['rect']).height >= 0.5 * ln['rect'].height and ln['words'] >= 1]
        touching = [p for p in paths if p['rect'].intersects(r)]
        has_image = any(displayed(fitz.Rect(x['bbox']), page).intersects(r) for x in page.get_image_info())
        kind = 'table' if len(inside) >= 4 and touching and all(p['ruled'] for p in touching) and not has_image else 'drawing'
        regions.append({'bbox': to_permille(box, prect), 'core': to_permille(r, prect), 'areaFrac': round((box.width * box.height) / page_area, 4), 'kind': kind})
    regions.sort(key=lambda g: (g['bbox'][1], g['bbox'][0]))
    return regions, headings(lines, prect)


# ---------------------------------------------------------------- raster route
def raster_regions(page, min_area, max_area):
    """Regions of a scanned page from its pixels (OpenCV). Returns [] when OpenCV is missing."""
    try:
        import cv2, numpy as np
    except Exception:
        return None
    prect = page.rect
    zoom = RASTER_WIDTH / prect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    H, W = img.shape
    page_px = H * W
    blur = cv2.GaussianBlur(img, (3, 3), 0)
    ink = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 51, 15)
    ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    # bleed-through from the back of the sheet is faint: drop components whose ink is light grey
    # (measured on the unblurred image: a thin grid line blurs to grey but prints black)
    if n > 1:
        sums = np.bincount(labels.ravel(), weights=img.ravel().astype(np.float64), minlength=n)
        counts = np.bincount(labels.ravel(), minlength=n).astype(np.float64)
        mean_grey = sums / np.maximum(counts, 1)
        faint = mean_grey > 185
        faint[0] = False
        if faint.any():
            ink[faint[labels]] = 0
            n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    # letter height: the median height of letter-shaped blobs (solid enough to be ink, not scanner specks)
    hs = [stats[i, cv2.CC_STAT_HEIGHT] for i in range(1, n)
          if 6 <= stats[i, cv2.CC_STAT_HEIGHT] <= 60 and 0.3 * stats[i, cv2.CC_STAT_HEIGHT] <= stats[i, cv2.CC_STAT_WIDTH] <= 4 * stats[i, cv2.CC_STAT_HEIGHT]
          and stats[i, cv2.CC_STAT_AREA] >= 0.15 * stats[i, cv2.CC_STAT_HEIGHT] ** 2]
    ch = int(statistics.median(hs)) if len(hs) >= 20 else 12
    ch = max(6, min(ch, 40))
    if DEBUG:
        print(f'[pdfregions] page {page.number + 1}: {W}x{H}px, letter height {ch}px from {len(hs)} blobs', file=sys.stderr)
    # text lines: horizontal dilation joins letters into rows
    rows_mask = cv2.dilate(ink, cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, int(2.0 * ch)), 1)))  # justified text has wide word gaps
    rn, rlabels, rstats, _ = cv2.connectedComponentsWithStats(rows_mask, connectivity=8)
    comp_row = rlabels  # row label per pixel
    is_text_row = np.zeros(rn, dtype=bool)
    row_info = {}
    long_stroke = np.zeros(n, dtype=bool)
    thin_rule = np.zeros(n, dtype=bool)
    for i in range(1, n):
        w, h = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        # a tall blob or a thin long line; a bold or blurred word whose letters touch (w ≫ ch, h ≈ ch) is text
        thin_rule[i] = h < 0.6 * ch and w > 2 * ch
        long_stroke[i] = h > 2.5 * ch or (w > 8 * ch and h < 0.6 * ch)
    # which components fall in which row (sample the component's centroid)
    comp_rows = np.zeros(n, dtype=np.int32)
    for i in range(1, n):
        x, y = stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] // 2, stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] // 2
        comp_rows[i] = comp_row[min(H - 1, y), min(W - 1, x)]
    for r in range(1, rn):
        members = np.nonzero(comp_rows == r)[0]
        members = members[members > 0]
        if len(members) == 0:
            continue
        rw, rh = rstats[r, cv2.CC_STAT_WIDTH], rstats[r, cv2.CC_STAT_HEIGHT]
        heights = stats[members, cv2.CC_STAT_HEIGHT]
        ink_px = stats[members, cv2.CC_STAT_AREA].sum()
        stroke_px = stats[members[long_stroke[members]], cv2.CC_STAT_AREA].sum() if len(members) else 0
        letters = int(((heights >= 0.4 * ch) & (heights <= 1.8 * ch)).sum())
        # a row of letter-sized blobs is text: three or more of them, or a lone word (every blob letter-sized)
        textlike = rh <= 2.4 * ch and (stroke_px / max(1, ink_px)) < 0.25 and rw >= 1.5 * ch and (letters >= 3 or letters == len(members))
        is_text_row[r] = textlike
        row_info[r] = {'rect': (rstats[r, cv2.CC_STAT_LEFT], rstats[r, cv2.CC_STAT_TOP], rw, rh), 'letters': letters, 'text': textlike}
        if DEBUG_BOX is not None:
            bx = [v / SCALE for v in DEBUG_BOX]
            rx, ry = rstats[r, cv2.CC_STAT_LEFT], rstats[r, cv2.CC_STAT_TOP]
            if rx / W < bx[2] and (rx + rw) / W > bx[0] and ry / H < bx[3] and (ry + rh) / H > bx[1]:
                print(f'[pdfregions]   row {r}: x {rx}-{rx + rw} y {ry}-{ry + rh} members {len(members)} letters {letters} stroke {stroke_px}/{ink_px} text {textlike} heights {sorted(heights.tolist())[:12]}', file=sys.stderr)
    # graphic ink = components outside text rows (or long strokes anywhere)
    graphic = np.zeros_like(ink)
    keep_comp = np.zeros(n, dtype=bool)
    for i in range(1, n):
        if long_stroke[i] or not is_text_row[comp_rows[i]]:
            if stats[i, cv2.CC_STAT_AREA] >= 4:
                keep_comp[i] = True
    graphic[keep_comp[labels]] = 255
    k = max(3, int(1.5 * ch))
    clusters = cv2.dilate(graphic, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    cn, clabels, cstats, _ = cv2.connectedComponentsWithStats(clusters, connectivity=8)
    regions = []
    min_px = min_area * page_px
    for c in range(1, cn):
        x, y, w, h, area = cstats[c, cv2.CC_STAT_LEFT], cstats[c, cv2.CC_STAT_TOP], cstats[c, cv2.CC_STAT_WIDTH], cstats[c, cv2.CC_STAT_HEIGHT], cstats[c, cv2.CC_STAT_AREA]
        box_px = w * h
        if box_px < min_px or box_px > max_area * page_px:
            continue
        if w < 2 * ch or h < 2 * ch:
            continue
        # ink actually inside (undilated graphic pixels)
        sub = graphic[y:y + h, x:x + w]
        ink_inside = int((sub > 0).sum())
        if ink_inside < 0.5 * ch * ch:
            continue
        # a lone horizontal rule (an underline, a separator) or a lone vertical one is decoration
        if (h < 1.5 * ch and w > 6 * ch) or (w < 1.5 * ch and h > 6 * ch):
            continue
        members = np.unique(labels[y:y + h, x:x + w])
        members = members[(members > 0) & keep_comp[np.clip(members, 0, n - 1)]]
        if len(members) == 0:
            continue
        # fraction bars and underlines: nothing but thin horizontal rules
        if bool(thin_rule[members].all()):
            continue
        # a big-font heading ("Т Е М А", a bold title) is a row of uniform tall blobs, not a drawing
        if len(members) >= 3 and h <= 4.5 * ch:
            mh = stats[members, cv2.CC_STAT_HEIGHT].astype(float)
            mw = stats[members, cv2.CC_STAT_WIDTH].astype(float)
            uniform = mh.std() / max(1.0, mh.mean()) < 0.35 and float(((mw / mh) < 2.5).mean()) >= 0.8
            if uniform:
                continue
        core = fitz.Rect(x / zoom, y / zoom, (x + w) / zoom, (y + h) / zoom)
        box = fitz.Rect(core)
        # fold short text rows that touch the cluster: beside it (axis names, point letters) within
        # 2 letter-heights, or just above/below it when no wider than the drawing (a unit label,
        # the tick numbers) — a caption or heading line wider than the drawing stays out
        gap = 2 * ch
        inside_rows = 0
        for r, info in row_info.items():
            rx, ry, rw, rh = info['rect']
            if not info['text']:
                continue
            rr = fitz.Rect(rx / zoom, ry / zoom, (rx + rw) / zoom, (ry + rh) / zoom)
            if (core & rr).height >= 0.5 * rr.height and (core & rr).width >= 0.5 * rr.width:
                inside_rows += 1
                continue
            beside = (min(ry + rh, y + h) - max(ry, y)) >= 0.5 * rh and (rx + rw >= x - gap and rx <= x + w + gap)
            stacked = (ry >= y + h - 2 and ry <= y + h + gap or ry + rh <= y + 2 and ry + rh >= y - gap) and rw <= 1.2 * w and (rx + rw >= x and rx <= x + w)
            if rw <= 0.3 * W and (beside or stacked):
                box |= rr
        # text ink inside the box (letters in rows) against graphic ink: a formula or a line of bold
        # text is mostly letters with a bar or two; rulings with text in most cells are a table
        all_members = np.unique(labels[y:y + h, x:x + w])
        all_members = all_members[all_members > 0]
        text_px = int(stats[all_members[~keep_comp[all_members]], cv2.CC_STAT_AREA].sum()) if len(all_members) else 0
        if DEBUG:
            big = members[np.argmax(stats[members, cv2.CC_STAT_AREA])]
            print(f'[pdfregions]   region {to_permille(core, prect)} ink {ink_inside} text {text_px} rows {inside_rows} members {len(members)} biggest {stats[big, cv2.CC_STAT_WIDTH]}x{stats[big, cv2.CC_STAT_HEIGHT]} stroke {bool(long_stroke[big])}', file=sys.stderr)
        if inside_rows >= 1 and ink_inside < 0.35 * (text_px + ink_inside):
            continue
        kind = 'table' if inside_rows >= 4 and text_px >= 0.3 * (text_px + ink_inside) else 'drawing'
        box &= prect
        regions.append({'bbox': to_permille(box, prect), 'core': to_permille(core, prect), 'areaFrac': round((box.width * box.height) / (prect.width * prect.height), 4), 'kind': kind, 'raster': True})
    regions.sort(key=lambda g: (g['bbox'][1], g['bbox'][0]))
    return regions


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--min-area', type=float, default=0.002)
    ap.add_argument('--max-area', type=float, default=0.85)
    ap.add_argument('--no-raster', action='store_true')
    a = ap.parse_args()
    doc = fitz.open(a.pdf)
    out = []
    for i, page in enumerate(doc):
        regions, heads = page_regions(page, a.min_area, a.max_area)
        imgs = page.get_image_info()
        scanned = any((fitz.Rect(x['bbox']).width * fitz.Rect(x['bbox']).height) / (page.rect.width * page.rect.height) > a.max_area for x in imgs)
        raster = None
        if scanned and not a.no_raster:
            raster = raster_regions(page, a.min_area, a.max_area)
            if raster is not None:
                regions = raster
        out.append({'page': i + 1, 'widthPt': round(page.rect.width, 2), 'heightPt': round(page.rect.height, 2), 'rotation': page.rotation,
                    'scanned': scanned, 'raster': raster is not None, 'headings': heads, 'regions': regions})
    json.dump({'version': VERSION, 'pages': out}, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
