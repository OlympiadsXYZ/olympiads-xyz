"""Opt-in integer crop of decoded original pixels; never resample or render PDF."""
import hashlib
import io
import json
import sys
from pathlib import Path
import fitz
from PIL import Image, ImageOps, features, __version__ as pillow_version


def main():
    source, pdf, geometry_json, box_json, rotation, output, verify = sys.argv[1:]
    if not features.check('webp'):
        raise ValueError('lossless WebP support unavailable')
    with Image.open(source) as original:
        orientation = original.getexif().get(274, 1)
        raw_size = list(original.size)
        if (original.format not in ('JPEG', 'PNG') or getattr(original, 'n_frames', 1) != 1
                or orientation not in range(1, 9) or original.mode not in ('RGB', 'RGBA', 'L')):
            raise ValueError('requires single-frame RGB/RGBA/L JPEG or PNG with supported EXIF orientation')
        # Exactly the existing conversion's lossless orientation permutation.
        normalized = ImageOps.exif_transpose(original)
        geometry = json.loads(geometry_json)
        if list(normalized.size) != geometry['px'] or original.format != geometry['format']:
            raise ValueError('source geometry/format differs from conversion')
        with fitz.open(pdf) as document:
            if len(document) != 1 or document[0].rotation != 0:
                raise ValueError('unsupported PDF page count/rotation')
            for actual in (document[0].rect, document[0].cropbox, document[0].mediabox):
                if any(abs(a-b) >= .01 for a, b in zip(actual, geometry['rect'])):
                    raise ValueError('displayed PDF geometry differs from native source')
        box = json.loads(box_json)
        if (len(box) != 4 or any(type(x) is not int for x in box)
                or not (0 <= box[0] < box[2] <= normalized.width and 0 <= box[1] < box[3] <= normalized.height)):
            raise ValueError('invalid native pixel box')
        mode = 'RGBA' if original.mode == 'RGBA' else 'RGB'
        crop = normalized.convert(mode).crop(box)
    turns = {0: None, 90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}
    rotation = int(rotation)
    if rotation not in turns:
        raise ValueError('unsupported rotation')
    if rotation:
        crop = crop.transpose(turns[rotation])
    pixels = crop.tobytes()
    encoded = io.BytesIO()
    crop.save(encoded, format='WEBP', lossless=True, exact=True, method=6)
    data = encoded.getvalue()
    # Verify our encoder, including RGB values underneath transparent pixels.
    with Image.open(io.BytesIO(data)) as decoded:
        if decoded.format != 'WEBP' or decoded.size != crop.size or decoded.convert(mode).tobytes() != pixels:
            raise ValueError('lossless WebP decoded pixels differ from original crop')
    if verify:
        actual = Path(verify).read_bytes()
        if actual != data:
            raise ValueError('encoded output bytes do not match source crop/encoder')
        with Image.open(io.BytesIO(actual)) as decoded:
            if decoded.size != crop.size or decoded.convert(mode).tobytes() != pixels:
                raise ValueError('output decoded pixels differ from source crop')
    if output:
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        Path(output).write_bytes(data)
    print(json.dumps(dict(px=list(crop.size), bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                         pixelSha256=hashlib.sha256(pixels).hexdigest(), pixelMode=mode,
                         rawSourcePx=raw_size, exifOrientation=orientation,
                         pillow=pillow_version, webp=features.version('webp'))))


if __name__ == '__main__':
    main()
