"""Render archive image sheets as PDF pages, retaining exact source provenance."""
import hashlib
import io
import json
import sys

import fitz
from PIL import Image, ImageOps


def digest(file):
    with open(file, "rb") as stream:
        return hashlib.sha256(stream.read()).hexdigest()


source, output = sys.argv[1:3]
resolution = 150
document = fitz.open()
pages = []
with Image.open(source) as original:
    for frame in range(getattr(original, "n_frames", 1)):
        original.seek(frame)
        image = ImageOps.exif_transpose(original).convert("RGBA")
        # PNG avoids a second lossy JPEG encoding and retains transparency.
        data = io.BytesIO()
        image.save(data, format="PNG")
        width, height = image.size
        page = document.new_page(width=width * 72 / resolution, height=height * 72 / resolution)
        page.insert_image(page.rect, stream=data.getvalue())
        pages.append({"page": frame + 1, "sourceFrame": frame, "widthPx": width, "heightPx": height})
document.set_metadata({"producer": "olympiads-xyz image-pages-v1"})
document.save(output, garbage=4, deflate=True, no_new_id=True)
document.close()
print(json.dumps({"from": "image", "renderer": "image-pages-v1", "sourceSha256": digest(source),
                  "pdfSha256": digest(output), "resolution": resolution, "pages": pages}))
