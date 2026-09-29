# Original documents inside ZIP archives

A supplementary source can identify an exact PDF or DOCX member without inventing an archive key:

```json
{"supplement-2":{"archiveKey":"archive/original.zip","archiveEntry":"Original folder/correction.docx"}}
```

Pass that JSON to `prepare.mjs --supplements`. Preparation retains the original ZIP bytes, extracts only the named member to a fixed local file, exports DOCX read-only through the existing Word converter and renders every page. It rejects duplicate member names, links, encrypted entries, traversal paths and members larger than 64 MiB.

Declare both `archiveKey` and `archiveEntry` in `paper.supplementarySources`, together with the original member's page numbers. Use its `supplement-N` document ID in all spans, notes and figures. `sourceConversions(manifest)` records the ZIP hash, member path and hash, derived PDF hash and converter fingerprint. Receipts and promotion replay those checks against the retained files. The published source link names the member but links to the real original ZIP.

A proposed correction remains a proposed correction; source membership does not establish official adoption.
