# Native photo crops (opt-in)

For a newly read crop of a prepared single-frame original JPEG/PNG, set
`tx.extraction: "native-image-crop"` and run `figures.mjs ... --no-snap`.
The usual `tx.document`, page 1, permille `tx.bbox`, and optional clockwise
`tx.rotation` (0/90/180/270) apply. Existing candidates stay unchanged.

The helper verifies original and converted PDF hashes against the existing
image-conversion fingerprint. It applies the same `ImageOps.exif_transpose`
pixel permutation as that conversion, checks normalized native dimensions and
the actual PDF's MediaBox/CropBox/rotation, and crops outward to integer pixel
edges. It never renders the PDF, interpolates, resizes, masks, or recompresses
with a lossy codec. RGB/RGBA/L are supported; palette/CMYK, animations, invalid
orientation, geometry mismatches and missing WebP support fail closed.

Lossless WebP uses `exact=True` to retain RGB values beneath transparent pixels.
Encoding is immediately decoded and compared byte-for-byte with the original
normalized crop after the declared rotation. Source provenance records original
and PDF hashes, raw/normalized dimensions, EXIF orientation, native pixel box,
rotation, decoded pixel mode/hash, helper hash and Pillow/libwebp versions.
`source.pdfRect` describes the outward-rounded native pixel extent, so it may
differ slightly from an older PDF-rendered crop of the same permille proposal.

Receipt gates and `validate.mjs --manifest ...` regenerate the expected pixels
and encoding and compare the actual local WebP bytes and provenance. Crop replay
checks frozen encoded hashes before writing. A different encoder/helper version
fails validation rather than silently rewriting historical evidence. The site
uses ordinary remote `<img>` elements; no site renderer change is required.
Full-original pass-through, embedded DOCX images and default PDF/PNG cropping
retain their existing behavior and fingerprints.
