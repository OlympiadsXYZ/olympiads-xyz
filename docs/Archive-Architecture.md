# Olympiads XYZ Archive — Architecture

Consolidated blueprint, 2026-08-30. Sources: hosting research (object storage / Google Drive / GitHub+archive.org), the archive site design doc, the maintenance pipeline design doc, and validation of `archive-catalog/*.json`. This document is decision-complete: implementation follows it without reopening the choices below.

Workload facts (validated against the catalogs, see §6): **4,110 entries / 7.11 GB** (3,437 PDFs, plus doc/docx/jpg/png and a handful of oddballs), many Cyrillic filenames, +1–2 GB/yr growth, <50 GB/month expected egress, public no-login direct links, uploads automated by an agent, budget $0 preferred / $5 per month hard cap.

---

## 1. Hosting decision

### Chosen: Cloudflare R2 (public bucket + custom domain)

**Runner-up: Backblaze B2** (free ≤10 GB, no card needed). Third place: GitHub Releases ($0 but mangles Cyrillic filenames). Rejected: Wasabi (≥$7/mo floor — over cap), Git LFS (~$3.50/mo metered bandwidth, downloads *block* at quota), GitHub Pages (1 GB cap), jsDelivr (20 MB/file), Google Drive as primary (undocumented endpoints, 24 h per-file quota lockouts at exactly the traffic spikes olympiad season produces).

**Why R2 wins:**

- **Cost:** $0 today (7.11 GB fits the permanent 10 GB free tier), **$0 egress forever at any volume**. When growth crosses 10 GB (~2028), overage is $0.015/GB-month — e.g. ~$0.08/month at 15 GB. Never approaches the $5 cap.
- **Limits:** UTF-8 object keys up to 1024 bytes — the existing Cyrillic paths upload **as-is, no transliteration, no manifest layer** (the decisive advantage over GitHub Releases, which renames non-ASCII asset filenames, and archive.org, which is ASCII-only). Upload ops for all 4,110 files ≈ 0.4% of the free monthly Class A allowance; 50 GB/mo of reads is nowhere near the 10M free Class B ops, and the custom domain puts Cloudflare's CDN cache in front anyway.
- **Automation:** full S3 API. The agent uses `rclone copy ./archive r2:olympiads-archive --s3-no-check-bucket` (provider `Cloudflare`) with a bucket-scoped Object Read & Write token; rclone round-trips Unicode keys byte-exactly. boto3/aws-cli/wrangler all work too.
- **Links:** public bucket mapped to `files.<domain>` — permanent, boring URLs; per-path `encodeURIComponent` in the Gatsby build; browsers save downloads with the original Cyrillic filename. Do **not** ship the `r2.dev` subdomain (rate-limited, dev-only).

**Why B2 is runner-up and not winner:** also effectively free (first 10 GB storage free; ~$0.29/mo worst-case egress at 50 GB, or $0 via Cloudflare Bandwidth Alliance proxy) — but clean custom-domain links require proxying through Cloudflare anyway, at which point R2 alone is fewer moving parts. B2 becomes the switch target only if the archive somehow grows past ~50–100 GB ($6.95/TB vs R2's $15/TB) — the catalog's `url`-rewrite migration path (§2) makes that a one-script move.

**Mirror (not primary):** the olympiads Google account's 15 GB Drive — one `rclone sync` step in the agent pipeline. Free, offsite, zero user-facing links, so none of Drive's endpoint-churn/lockout problems apply. Optional phase-2 permanence layer: archive.org items (would require ASCII slugs — deferred, see §7).

### Migration path — manual (owner) vs automated (agent)

Owner must do by hand (account/credential actions the agent must not perform):

1. Reactivate the old Cloudflare account; enable R2. Expect a payment-card prompt (fraud prevention; nothing is charged within the free tier).
2. Move the site domain's nameservers to Cloudflare (free plan). The Gatsby site stays on Vercel — recreate the existing DNS records pointing at Vercel inside the Cloudflare zone.
3. Create the bucket `olympiads-archive` (location hint EEUR — Eastern Europe), enable public access, attach custom domain `files.<domain>`, add a cache-everything cache rule.
4. Create an R2 API token scoped to that bucket (Object Read & Write only) and hand it to the agent environment.
5. Fallback if the domain cannot move to Cloudflare: B2 public bucket with `f00x.backblazeb2.com/file/olympiads-archive/...` links (no card needed at signup) — everything else in this document is unchanged except the URL template.

Agent automates everything else:

1. Bulk upload: `rclone copy ./archive r2:olympiads-archive --s3-no-check-bucket` preserving the existing tree (object key = the catalog `file` path, verbatim UTF-8).
2. Verify: `rclone check` (or size/hash listing) against the local tree; spot-check HTTP 200 + `%PDF` magic on sampled URLs.
3. Inject `url` into every catalog entry (script, §2), commit via PR.
4. `rclone sync` the same tree to the Drive mirror (own OAuth client ID — rclone's bundled one retires during 2026; authenticate as the olympiads account, **not** a service account, whose files would count against the service account's own quota).
5. Site switchover PR per the design doc's plan (§3.4 below).

---

## 2. Catalog format spec

`archive-catalog/*.json` — five files, each a **flat JSON array** of entries. The catalog is the single source of truth the site builds from; the site never touches archive files. Current files: `physics-international.json`, `physics-bulgarian.json`, `astronomy-international.json`, `astronomy-rest.json`, `other-subjects.json`. A science may span several files; the build concatenates all `*.json` and merges by `subject`.

### Entry schema

```jsonc
{
  "id": "phys-apho-2000-exp-exp-problems",  // REQUIRED, unique across ALL files (validated: 0 dups in 4,110)
  "subject": "physics",       // REQUIRED: physics | astronomy | chemistry | geography | math | informatics
  "kind": "competition",      // REQUIRED: competition | book | handout | other
  "competition": "APhO",      // code or null (34 distinct codes present, incl. Cyrillic ones — open set)
  "year": 2000,               // integer or null (275 entries null — books/handouts mostly)
  "round": "experiment",      // raw code or null; labels resolved client-side
  "group": null,              // grade/age group code or null
  "type": "problems",         // problems | solutions | answers | results | data | book | handout | translation | other
  "lang": "en",               // bg | en | ru | mk | cs | fr | kk | ro  (open set)
  "title": "APhO 2000 · Експеримент · Условия",  // REQUIRED display title (raw path when unparsed)
  "file": "Физика/Състезания/APhO/2000/Experiment/exp_problems.pdf",  // REQUIRED path in archive tree = R2 object key
  "size": 97588,              // REQUIRED bytes, non-null (validated: 0 zero/missing)
  "unparsed": true,           // OPTIONAL flag: metadata underivable (47 entries total)
  "url": "https://files.<domain>/%D0%A4%D0%B8...pdf"  // *** TO BE ADDED — the hosted-URL field ***
}
```

**The `url` field (a.k.a. hostedUrl):** absolute public URL of the hosted object. **Decision:** store the absolute URL per entry (not a relative key + base env var) — it is what the design doc's `EntryRow` consumes, and it makes backend migration a pure catalog rewrite with no site code change. Derivation for all existing entries: `url = "https://files.<domain>/" + file.split('/').map(encodeURIComponent).join('/')` — a single agent script adds it after the bulk upload verifies. Entries without `url` render muted with a „скоро" badge until then (`SHOW_UNHOSTED` in `EntryRow.tsx`).

**Schema rules for the build and for CI validation:** required fields `id, subject, kind, type, lang, title, file, size`; `warn+skip` malformed entries, never fail the build; treat every enum as an **open set** with raw-code fallback labels (the catalogs already contain values the site design's enums didn't list — `translation` type; `cs/fr/kk/ro` langs; Cyrillic competition codes).

**New entries** (maintenance pipeline) must emit **this exact schema** — the divergent entry sketch in the maintenance design doc (`grades`/`paper`/`sizeBytes`/bilingual `title`) is superseded; its useful extras are adopted as **optional** fields on new entries only: `sourceUrl`, `sha256`, `addedAt`, `addedBy`, `errata`. New files use the ASCII canonical filename grammar from the maintenance doc (`{comp}-{year}[-{round}][-{grades}]-{paper}-{lang}.pdf`) under key `{comp}/{year}/{filename}`; the 4,110 legacy entries keep their Cyrillic paths untouched — both coexist because `url` is absolute per entry.

---

## 3. Site integration (summary of the design doc)

Full detail in the archive site design doc; the load-bearing points:

1. **Routes** built in `gatsby-node.ts` from the catalog (no GraphQL, no `gatsby-source-filesystem`): `/archive/` (science cards) → `/archive/<science>/` (competition cards + library + science-wide search) → `/archive/<science>/<comp>/` (year grid + filters) → `/archive/<science>/<comp>/<year>/`. Filters/search are query params. `kind: book|handout|other` render as a `LibraryTree` on the science page.
2. **Data flow:** `src/archive/catalog-node.ts` loads/validates/groups the catalog; pages get pre-sliced slim `ClientEntry` payloads (`id,title,year,round,group,type,lang,size,url,ext`); `onPreBootstrap` writes per-science search indexes to `static/archive-data/<science>.json`, lazily fetched on first search. `ext` derivation from `file` must handle the 5 extensionless EuPhO-2021 simulator binaries (fall back to `other`).
3. **New code:** 4 templates under `src/templates/archive/`, rebuilt `src/components/Archive/` (EntryRow, FilterBar, YearGrid, LibraryTree, etc.), `src/archive/labels.ts` with BG label maps + `COMPETITION_META` (slugs). Delete `archiveTemplate.tsx`, `ArchiveGraph.tsx`, `archiveOrdering.ts`.
4. **Switchover:** rename flag to `GATSBY_ARCHIVE_ENABLED` (old name read as fallback one release); land everything flag-off; when catalogs carry `url`, one PR flips the Vercel env var **and** removes the `/archive/:path*` → `/archive` rewrite from `vercel.json` (atomic: env change forces the redeploy). Rollback = flip env + restore rewrite. Post-deploy checks per the design doc.
5. **Label-map additions required by validation** (§6): `COMPETITION_META` needs slugs beyond the doc's five (NOF/PSF/ESF/IAO/IOAA) — at minimum the high-volume codes IPhO, APhO, EuPhO, IZhO, NAO; the long tail (34 codes total, incl. `Балкански`, `Всерусийска`, `Московска`, `ПУ`, `VsOA-ru`, `SPbA`…) falls back to the „Други състезания" bucket until given slugs, which the design already supports.

---

## 4. Maintenance runbook (summary) + quarterly sweep prompt

**Add-item flow:** discover → download (`curl -L` with real-browser UA; mon.bg 403s plain fetchers; Mega via rclone/megatools, never hotlinked) → verify (`%PDF` magic, opens, first-page metadata matches; sha256) → normalize name (ASCII grammar, §2) → upload via `scripts/lib/storage.mjs` backend (rclone → R2) → append catalog entry → PR (binaries never in git; the PR diff is the review surface; Vercel preview = click-test) → merge = deploy. **Immutability rules:** never overwrite a storage key (corrections get `-v2` + catalog update in the same PR); never delete via automation; ambiguity ⇒ stop and ask.

**Scripts:** `add-archive-item.mjs` (single entry point: validate → sha256 dedupe → tuple dedupe → upload → catalog append; `--dry-run`; exit 2 = duplicate, 1 = validation error), `check-links.mjs`, `find-dupes.mjs`, `archive.config.json` (`{"backend":"rclone","remote":"r2:olympiads-archive","publicUrlTemplate":"https://files.<domain>/{key}"}`).

**CI:** `catalog-validate` (every PR: schema per §2, unique ids), `check-links` (changed entries on PR + weekly full-catalog cron: HTTP 200, pdf-ish Content-Type, length ≈ size; `url` failures block, `sourceUrl` failures warn), `orphan-check` (weekly: storage listing vs catalog, both directions, auto-filed issue), `errata-watch` (quarterly: hash Stefan Ivanov's errata files, flag affected entries).

**Canonical sources** (verified live 2026-08-30): IPhO — host site, then ipho.olimpicos.net, fallback phoxiv.org; APhO — apho.olimpicos.net (+ physicswithstefan.com); EuPhO — **eupho.ee/archive/** (eupho.eu is an empty directory listing — trap); IZhO — izho.kz/contest/problems/; BG astronomy — astro-olymp.org; BG physics — prirodninauki.bg category feed (primary in practice), mon.bg official archive (browser UA required), physicstime.com secondary; bulk/errata upstream — stefanivanov.site/teaching → two Mega folders. Seasonal expectations: Q1 IZhO + BG municipal/regional; Q2 BG nationals + APhO + EuPhO; Q3 IPhO + mirror catch-up; Q4 IOAA/IAO results + errata + BG municipal starts.

### Quarterly sweep prompt (paste-ready; fill `<REPO_URL>`, `<LAST_SWEEP_DATE>`, `<EXPECTED>`)

```
You are maintaining the Olympiads XYZ archive (repo: <REPO_URL>, catalog: archive-catalog/*.json).
Task: find olympiad papers published since <LAST_SWEEP_DATE> that are missing from the catalog, and add them via PRs. Do not implement anything else.

Sources to check (canonical, in priority order):
- IPhO: this year's host site, then https://ipho.olimpicos.net/ , fallback https://phoxiv.org/contests/ipho
- APhO: https://apho.olimpicos.net/ , fallback https://phoxiv.org/contests/apho and https://physicswithstefan.com/apho-papers/
- EuPhO: https://eupho.ee/archive/  (NOT eupho.eu — that domain is an empty directory listing)
- IZhO: https://izho.kz/contest/problems/
- BG astronomy (all rounds, all grade groups): http://astro-olymp.org/
- BG physics (all rounds): https://www.prirodninauki.bg/archives/category/олимпиада-по-физика ,
  official archive https://www.mon.bg/…/fizika/ (403s plain fetchers — use a browser tool or flag for manual download),
  secondary https://physicstime.com/tags/олимпиада-по-физика
- Bulk/errata upstream: https://stefanivanov.site/teaching → the two Mega folders (also re-check the errata files; if errata changed, flag affected catalog entries).

Given the season, expect: <EXPECTED — e.g. "Q3: this year's IPhO theory+experiment problems/solutions">.

For each missing paper:
1. Download the PDF from the source (browser UA), verify it opens and matches the claimed year/round/language.
2. Run: node scripts/add-archive-item.mjs <file> --competition … --year … --round … --grades … --paper … --lang … --source-url … --dry-run
3. If dry-run is clean, rerun without --dry-run, then commit the catalog change on branch archive/sweep-<YYYYQ#>.
Open ONE PR for the whole sweep. In the PR body include a table: file | competition | year | round | paper | source URL | sha256.

Hard rules: never overwrite existing storage keys or catalog entries; never delete anything; if metadata is ambiguous or a source is unreachable, list it under "Needs owner attention" in the PR body instead of guessing; do not merge the PR yourself.
End with a summary: N added, M skipped as duplicates, K flagged for attention.
```

---

## 5. Open items

1. **Owner-manual hosting steps** (§1): Cloudflare account + card, nameserver move, bucket/domain/token setup. Everything downstream is blocked on the token.
2. **`url` field absent everywhere** (0 of 4,110 entries) — expected; added by the post-upload script. Site ships flag-off until it lands.
3. **Label maps incomplete for real data:** `COMPETITION_META` slugs for IPhO/APhO/EuPhO/IZhO/NAO at minimum; decide which of the 34 codes get dedicated routes vs the „Други" bucket. Confirm official BG names for PSF/ESF and the physics round I–IV parentheticals.
4. **47 unparsed entries** (`title` = raw path; 31 in astronomy-rest, 11 physics-bulgarian, 3 other-subjects, 2 physics-international) — render as-is now; optional cleanup pass later.
5. **Non-document files in the catalog:** 4 `.exe`, 5 extensionless Linux/macOS binaries (EuPhO 2021 simulators), 2 `.wmv`, 8 `.djvu`. Decide: host as-is (they're legitimate competition materials) vs zip the executables. Default: host as-is; `ext` mapper must not crash on them.
6. **Maintenance-doc schema superseded** by §2 — `add-archive-item.mjs` must be implemented against the real catalog schema (this doc), not the sketch in the maintenance design doc.
7. **archive.org permanence mirror** — deferred (needs ASCII slug layer); revisit if GitHub/Cloudflare risk posture changes.
8. **Drive mirror prerequisite:** create own OAuth client ID before rclone's bundled one retires in 2026.
9. **Catalog files not yet committed** to the repo history at time of writing — commit them with the site PR so CI validation has a target.

## 6. Catalog validation report (2026-08-30, read-only — nothing was modified)

| File | Entries | Reported files | Match | Bytes | Unparsed | Schema violations | Dup ids |
|---|---|---|---|---|---|---|---|
| physics-international.json | 1,223 | 1,223 | ✓ | 755,708,192 | 2 | 0 | 0 |
| physics-bulgarian.json | 920 | 920 | ✓ | 2,215,075,157 | 11 | 0 | 0 |
| astronomy-international.json | 619 | 619 | ✓ | 1,046,259,006 | 0 | 0 | 0 |
| astronomy-rest.json | 948 | 948 | ✓ | 659,076,151 | 31 | 0 | 0 |
| other-subjects.json | 400 | 400 | ✓ | 2,434,235,816 | 3 | 0 | 0 |
| **Total** | **4,110** | **4,110** | ✓ | **7,110,354,322 (7.11 GB)** | **47** | **0** | **0 (also across files)** |

Additional checks: no `size` null/zero; no `url` present anywhere yet; 275 entries with `year: null` (books/handouts — expected); subjects, kinds, types, langs enumerated above (open sets confirmed necessary: `translation` type, `cs/fr/kk/ro` langs, 34 competition codes incl. Cyrillic). Extensions: 3,437 pdf, 116 doc, 63 docx, 318 jpg, 107 png, 21 txt, 16 xls(x), 8 djvu, 9 zip/rar/pptx/rtf/gif, 4 exe, 4 mp4/wmv, 5 extensionless binaries.
