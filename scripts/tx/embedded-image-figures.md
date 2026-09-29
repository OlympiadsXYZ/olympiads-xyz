# Original images embedded in DOCX

Use only after reading the source page and the actual complete embedded image.
An embedded original can contain pixels cropped away by Word's layout. Label it
as the uncropped original example or diagram; do not assume it is a missing
separate examination sheet.

Set `tx.extraction` to `embedded-image`, `tx.document` to its prepared DOCX role,
`tx.page` to the page using it, and `tx.bbox` to `[0,0,1000,1000]` (the entire
embedded image). Set `tx.entry` to the exact `word/media/image1.png`-style ZIP
entry, `tx.documentSha256` to the original DOCX hash, and `tx.imageSha256` to the
unmodified image hash. Use `figures.mjs --no-snap` and inspect its actual output.

The helper checks the DOCX and derived PDF hashes, rejects unreferenced media,
unsafe or ambiguous entries, animated/rotated images and unsupported formats.
The PNG/JPEG bytes are copied unchanged. The published `source.embeddedImage`
records the archive key, original DOCX/image/PDF hashes, ZIP entry and main
document relationship IDs. It carries no invented PDF rectangle or raster DPI.
Receipt and promotion validation replay these checks and verify the uploaded
file bytes and dimensions. `crops.mjs` can restore the exact original bytes.
