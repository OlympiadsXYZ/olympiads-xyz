# Whole original image figures

For a complete JPEG/PNG archive source already prepared as an image conversion,
set the figure proposal to:

```json
{
	"id": "p1-photo",
	"tx": {
		"document": "supplement-4",
		"page": 1,
		"bbox": [0, 0, 1000, 1000],
		"extraction": "original-image"
	}
}
```

Run the usual `figures.mjs <paperId> <candidate.json> --no-snap`. A dry run is
available for inspection but remains ineligible for receipts. The original file
is copied byte for byte, retains its JPEG/PNG extension and native dimensions,
and passes the usual size/blank-image, immutable upload, MD5 reuse and public
HEAD checks. Inspect the final file before issuing the normal receipt.

This opt-in mode requires verified original-image conversion provenance, one
frame/page, zero rotation and exactly the full-page box. Actual image format,
EXIF orientation and dimensions, PDF MediaBox/CropBox/rotation, manifest
geometry, original/derived hashes and conversion fingerprint are checked. An
EXIF-rotated or animated source, partial box, PDF source, or changed source
bytes fails explicitly; ordinary PDF cropping remains available for those cases.

Canonical `source.originalImage` records the archive key, exact original SHA256
and derived PDF SHA256. Receipt and promotion gates additionally verify the
local final image bytes, dimensions and persisted source metadata against that
conversion. Existing conversion metadata remains in receipt `sourceConversions`.
`crops.mjs` replays the original-byte copy without rewriting the candidate. No
existing renderer identity, source manifest or historical crop is migrated.
