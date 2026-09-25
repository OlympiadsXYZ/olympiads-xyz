# Source preview rendering

`prepare.mjs` renders previews with `render-pages.py` (PyMuPDF), using the same
backend as `pdfcrop.py`. Both use the displayed CropBox with PDF `/Rotate`
already applied, RGB pixels, and an opaque background. Preview boxes therefore
keep their top-left displayed-page origin; no MediaBox offset is added.

The `pageRenderer` identity is `pymupdf-cropbox-v2`. Each document also records
`pageRendererInfo`: PyMuPDF/MuPDF versions, helper SHA-256, rendering options,
and a fingerprint of those fields. Cached previews are reused only when source
hash, DPI, renderer identity, and fingerprint all match. The PDF source hash is
not changed by preview rendering. Text extraction still uses `pdftotext`.

An explicit preparation rerun migrates old Poppler previews or stale runtime
fingerprints. Nothing scans or rewrites existing manifests in the background.
The existing candidate guard still rejects a geometry-changing migration when
`candidates/` contains JSON files: those candidates require rereading/reboxing.
A renderer-only migration preserves the coordinate contract, but its preview
bytes change; retain frozen manifests/previews alongside their existing evidence
when that evidence records image hashes. Use an isolated `OLYMPIADS_TX_DIR` to
prepare a fresh copy while keeping a frozen reading bundle untouched.

The concrete ESF 2011 special-topic solution PDF contains Symbol fonts for
which local Poppler previews dropped Greek, minus, and approximation glyphs.
PyMuPDF displays them. This is a renderer discrepancy, not missing source
content; no font rewriting or guessed replacement characters are applied.

Run `node --test scripts/tests/page-render.test.mjs`. The tests exercise actual
preview/crop pixels for asymmetric offset CropBoxes at all four rotations,
Symbol glyph visibility, legacy geometry rejection, renderer/runtime cache
migration, and an unchanged-cache second preparation. Dependencies are Python
with PyMuPDF/Pillow and the preparation command's usual local tools.
