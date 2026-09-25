#!/usr/bin/env python3
"""Render source previews in the same displayed CropBox space as pdfcrop.py.

Do not substitute pdftoppm here: some valid Symbol fonts lose Greek glyphs in
Poppler (ESF 2011 ST). Source bytes and their embedded fonts remain untouched.
"""
import argparse
import hashlib
import json
from pathlib import Path

import fitz


def renderer_info():
    identity = {
        'name': 'pymupdf-cropbox-v2',
        'pymupdf': fitz.VersionBind,
        'mupdf': fitz.VersionFitz,
        'helperSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'colorspace': 'RGB',
        'alpha': False,
        'annotations': True,
    }
    identity['fingerprint'] = hashlib.sha256(
        json.dumps(identity, sort_keys=True).encode('utf-8')).hexdigest()
    return identity


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--info', action='store_true')
    parser.add_argument('--dpi', type=int, default=160)
    parser.add_argument('pdf', nargs='?')
    parser.add_argument('prefix', nargs='?')
    args = parser.parse_args()
    if args.info:
        print(json.dumps(renderer_info()))
        return
    if not args.pdf or not args.prefix or args.dpi <= 0:
        parser.error('pdf, output prefix and a positive dpi are required')
    with fitz.open(args.pdf) as doc:
        if doc.needs_pass:
            raise ValueError('encrypted PDF requires a password')
        for number, page in enumerate(doc, 1):
            # page.rect is the effective, rotated CropBox. No MediaBox offset or
            # second rotation: pdfcrop.py clips in precisely this coordinate space.
            pix = page.get_pixmap(dpi=args.dpi, colorspace=fitz.csRGB,
                                  alpha=False, annots=True)
            pix.save(f'{args.prefix}-{number:02d}.png')
    print(json.dumps(renderer_info()))


if __name__ == '__main__':
    main()
