# Reader-model benchmark fixtures (24 papers)

Generated 2026-09-06T01:35:00+03:00. 20 papers have a verified reference transcription in `content/problems`; 4 are held out from the backlog (`tmp/shards/shard{6,7,8}.json`) and appear in neither `content/problems` nor `tmp/staging`.

| # | paperId | held out | family | subj | comp | year | round | grade | reference JSON |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `psf-2025-proletno-10` |  | clean-digital | physics | PSF | 2025 | - | 10 | `content/problems/physics/PSF/2025/psf-2025-proletno-10.json` |
| 2 | `psf-2024-proletno-9` |  | clean-digital | physics | PSF | 2024 | - | 9 | `content/problems/physics/PSF/2024/psf-2024-proletno-9.json` |
| 3 | `nof-2024-ii-11` |  | clean-digital | physics | NOF | 2024 | II кръг (областен) | 11 | `content/problems/physics/NOF/2024/nof-2024-ii-11.json` |
| 4 | `psf-2006-proletno-sp` |  | embedded-equations | physics | PSF | 2006 | - | ST | `content/problems/physics/PSF/2006/psf-2006-proletno-sp.json` |
| 5 | `esf-2010-esenno-7` |  | embedded-equations | physics | ESF | 2010 | - | 7 | `content/problems/physics/ESF/2010/esf-2010-esenno-7.json` |
| 6 | `nao-2001-iii-11-12` |  | embedded-equations | astronomy | NAO | 2001 | III кръг (национален) | 11-12 | `content/problems/astronomy/NAO/2001/nao-2001-iii-11-12.json` |
| 7 | `nao-1998-iv` |  | old-scan | astronomy | NAO | 1998 | IV кръг | - | `content/problems/astronomy/NAO/1998/nao-1998-iv.json` |
| 8 | `esf-2002-esenno-st` |  | old-scan | physics | ESF | 2002 | - | ST | `content/problems/physics/ESF/2002/esf-2002-esenno-st.json` |
| 9 | `nof-2009-iii` |  | old-scan | physics | NOF | 2009 | III кръг (национален) | - | `content/problems/physics/NOF/2009/nof-2009-iii.json` |
| 10 | `nao-2008-iv-st-prak` |  | dense-tables | astronomy | NAO | 2008 | IV кръг | Старша възраст | `content/problems/astronomy/NAO/2008/nao-2008-iv-st-prak.json` |
| 11 | `nao-2024-iv-obs` |  | dense-tables | astronomy | NAO | 2024 | IV кръг | - | `content/problems/astronomy/NAO/2024/nao-2024-iv-obs.json` |
| 12 | `nof-2012-iii-7` |  | figure-heavy | physics | NOF | 2012 | III кръг (национален) | 7 | `content/problems/physics/NOF/2012/nof-2012-iii-7.json` |
| 13 | `nof-2015-i-8` |  | figure-heavy | physics | NOF | 2015 | I кръг (общински) | 8 | `content/problems/physics/NOF/2015/nof-2015-i-8.json` |
| 14 | `nao-2023-ii-5-6` |  | figure-heavy | astronomy | NAO | 2023 | II кръг (областен) | 5-6 | `content/problems/astronomy/NAO/2023/nao-2023-ii-5-6.json` |
| 15 | `nof-2024-iii-11-12` |  | long-multipage | physics | NOF | 2024 | III кръг (национален) | 11-12 | `content/problems/physics/NOF/2024/nof-2024-iii-11-12.json` |
| 16 | `nof-2018-iii-10-12` |  | long-multipage | physics | NOF | 2018 | III кръг (национален) | 10-12 | `content/problems/physics/NOF/2018/nof-2018-iii-10-12.json` |
| 17 | `nao-2023-iv-nabl` |  | astro-observational | astronomy | NAO | 2023 | IV кръг | - | `content/problems/astronomy/NAO/2023/nao-2023-iv-nabl.json` |
| 18 | `nao-2021-iv-st-prak` |  | astro-observational | astronomy | NAO | 2021 | IV кръг | Старша възраст | `content/problems/astronomy/NAO/2021/nao-2021-iv-st-prak.json` |
| 19 | `psf-2016-proletno-sp` |  | special-topic | physics | PSF | 2016 | - | ST | `content/problems/physics/PSF/2016/psf-2016-proletno-sp.json` |
| 20 | `esf-2022-esenno-st` |  | special-topic | physics | ESF | 2022 | - | ST | `content/problems/physics/ESF/2022/esf-2022-esenno-st.json` |
| 21 | `nof-2025-iii-11-12` | yes | long-multipage | physics | NOF | 2025 | III | 11-12 | - |
| 22 | `nao-2025-iv-nabl` | yes | astro-observational | astronomy | NAO | 2025 | IV | - | - |
| 23 | `psf-2026-proletno-8` | yes | clean-digital | physics | PSF | 2026 | - | 8 | - |
| 24 | `nao-2001-iii-9-10` | yes | old-scan | astronomy | NAO | 2001 | III | 9-10 | - |

## Why each paper

- **psf-2025-proletno-10** (clean-digital) — Recent born-digital PSF paper (2 pp, 112 KB/pg, embedded fonts): baseline for the easy end; caveat present in reference so grader also sees a flagged edge case.
- **psf-2024-proletno-9** (clean-digital) — Single-page born-digital PSF, 3 problems, tiny figures: shortest clean case, isolates plain statement fidelity.
- **nof-2024-ii-11** (clean-digital) — Recent NOF regional round, born-digital, 3 pp/5 pp solutions, 6 figures; reference carries paper.caveat.
- **psf-2006-proletno-sp** (embedded-equations) — Page-1 render inspected: MathType/Symbol-font inline math and numbered display equations (1)-(3); no images at all, so the text layer looks fine but drops the math. Classic embedded-equation trap.
- **esf-2010-esenno-7** (embedded-equations) — Page-1 render inspected: two-column multiple-choice sheet typeset with custom-encoded SPTimeML Type1C fonts (text layer garbled), 10 figures including circuit and 3D sketches; 29 KB/pg.
- **nao-2001-iii-11-12** (embedded-equations) — Page-1 render inspected: born-digital but with non-embedded TimesNewRomanPS WinAnsi fonts (Cyrillic text layer unreliable) and a vector ellipse figure with rotated axis labels; reference has paper.caveat.
- **nao-1998-iv** (old-scan) — Page-1 render inspected: 614 KB/pg colour JPEG scan of a three-column magazine spread (Андромеда) with plots and spectra, no text layer at all. Hardest scan in the corpus; reference has paper.caveat.
- **esf-2002-esenno-st** (old-scan) — Page-1 render inspected: 306 KB/pg grayscale JPEG scan, two printed pages imaged side by side, 6 problems, dense hand-set formulas and mechanical figures, no text layer; reference has paper.caveat.
- **nof-2009-iii** (old-scan) — Page-1 render inspected: image-only scan (96 dpi JPEG per page), slightly skewed, handwritten archive number in the margin, per-part point values in brackets; reference has paper.caveat.
- **nao-2008-iv-st-prak** (dense-tables) — NAO IV round practical, senior age: reference holds ~46 markdown table rows of measurement data plus 6 figures in 3 pp; paper.caveat set.
- **nao-2024-iv-obs** (dense-tables) — Largest tabular paper in the corpus: 16 problem pages / 20 solution pages, ~105 table rows, 32 figures (observation logs and star-chart data).
- **nof-2012-iii-7** (figure-heavy) — NOF national round grade 7 with 13 cropped figures over 2 pp — the highest figure-per-page density among grade 7-8 physics papers.
- **nof-2015-i-8** (figure-heavy) — NOF municipal round grade 8, 9 figures, 72 KB/pg born-digital; tests figure/box placement when the PDF is light and figures are vector.
- **nao-2023-ii-5-6** (figure-heavy) — Junior NAO regional paper with 58 figure references and 12 table rows over 4 pp/9 pp; picture-driven statements for the youngest grade band; paper.caveat set.
- **nof-2024-iii-11-12** (long-multipage) — NOF III national round 11-12: 5 problem pages, 10 solution pages, 4 multi-part problems, 12 figures — long-context and part/answer attachment stress.
- **nof-2018-iii-10-12** (long-multipage) — NOF III national round 10-12: 6 pp/9 pp and 892 KB/pg (hybrid scan-rasterised pages), 11 table rows, 7 figures; long AND visually degraded.
- **nao-2023-iv-nabl** (astro-observational) — Observational (наблюдателен) NAO IV round: 13 pp/17 pp, 58 figures, 43 table rows, no grade band; paper.caveat set. Hardest astronomy layout in the corpus.
- **nao-2021-iv-st-prak** (astro-observational) — NAO IV round practical, senior age, 6 pp/9 pp, 12 figures; reference marks a solution as incomplete — checks that a reader does not hallucinate the missing part.
- **psf-2016-proletno-sp** (special-topic) — PSF spring special topic (SP): 6 pp/5 pp, 13 table rows, 11 figures, 224 KB/pg; olympiad-level special-topic physics with data tables. paper.caveat set.
- **esf-2022-esenno-st** (special-topic) — ESF autumn special topic (ST): 787 KB/pg rasterised pages with 8 figures and 3 table rows over 3 pp; recent paper but visually heavy. paper.caveat set.
- **nof-2025-iii-11-12** (long-multipage, held out) — Held-out NOF national round 11-12, 2025 (938 KB problems PDF, non-standard file naming 11-12_th_zad.pdf): long multi-part theory paper, never transcribed, so no reference text can leak into a reader model.
- **nao-2025-iv-nabl** (astro-observational, held out) — Held-out 2025 observational round (858 KB, no grade band). Derived id follows the archive convention nao-<year>-iv-nabl used by nao-2023-iv-nabl; the bare derivation would be nao-2025-iv, which is also unused.
- **psf-2026-proletno-8** (clean-digital, held out) — Held-out newest spring paper (2026, grade 8, 401 KB): clean recent digital PDF; the whole 2026 PSF sitting is untranscribed, so it is a clean easy-end control.
- **nao-2001-iii-9-10** (old-scan, held out) — Held-out sibling of nao-2001-iii-11-12 (194 KB, same 2001 III round production): early-2000s NAO with non-embedded Cyrillic fonts and vector figures — hard end, untranscribed.

## Archive keys

| paperId | problemsKey | solutionsKey |
|---|---|---|
| `psf-2025-proletno-10` | `Физика/Състезания/Пролетни/2025/proletni_2025_10problems.pdf` | `Физика/Състезания/Пролетни/2025/proletni_2025_10solutions.pdf` |
| `psf-2024-proletno-9` | `Физика/Състезания/Пролетни/2024/9_9-klas-zadachy.pdf` | `Физика/Състезания/Пролетни/2024/9_9-klas-reshenyja.pdf` |
| `nof-2024-ii-11` | `Физика/Състезания/Национална олимпиада/II Областен кръг/2024/NOF2_2024_11problems.pdf` | `Физика/Състезания/Национална олимпиада/II Областен кръг/2024/NOF2_2024_11solutions.pdf` |
| `psf-2006-proletno-sp` | `Физика/Състезания/Пролетни/2006/proletni_2006_STproblems.pdf` | `Физика/Състезания/Пролетни/2006/proletni_2006_STsolutions.pdf` |
| `esf-2010-esenno-7` | `Физика/Състезания/Есенни/2010/esenni_2010_7problems.pdf` | `Физика/Състезания/Есенни/2010/esenni_2010_7solutions.pdf` |
| `nao-2001-iii-11-12` | `Астрономия/Състезания/Национална олимпиада/2001/2001-III/NOA3_2001_11-12problems.pdf` | `Астрономия/Състезания/Национална олимпиада/2001/2001-III/NOA3_2001_11-12solutions.pdf` |
| `nao-1998-iv` | `Астрономия/Състезания/Национална олимпиада/1998/1998-IV/prac+obs.pdf` | `Астрономия/Състезания/Национална олимпиада/1998/1998-IV/solutions.pdf` |
| `esf-2002-esenno-st` | `Физика/Състезания/Есенни/2002/esenni_2002_STproblems.pdf` | `Физика/Състезания/Есенни/2002/esenni_2002_STsolutions.pdf` |
| `nof-2009-iii` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2001-2009/2009/th_zad.pdf` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2001-2009/2009/th_resh.pdf` |
| `nao-2008-iv-st-prak` | `Астрономия/Състезания/Национална олимпиада/2008/2008-IV/NOA4_2008_STprak-prob.pdf` | `Астрономия/Състезания/Национална олимпиада/2008/2008-IV/NOA4_2008_STprak-sol.pdf` |
| `nao-2024-iv-obs` | `Астрономия/Състезания/Национална олимпиада/2024/2024-IV/obs/24-IV-Nabl.pdf` | `Астрономия/Състезания/Национална олимпиада/2024/2024-IV/obs/a24-IV-Nabl.pdf` |
| `nof-2012-iii-7` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2012/NOF3_2012_7problems.pdf` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2012/NOF3_2012_7solutions.pdf` |
| `nof-2015-i-8` | `Физика/Състезания/Национална олимпиада/I Общински кръг/2015/8.pdf` | `Физика/Състезания/Национална олимпиада/I Общински кръг/2015/8_resh.pdf` |
| `nao-2023-ii-5-6` | `Астрономия/Състезания/Национална олимпиада/2023/2023-II/23-II-56.pdf` | `Астрономия/Състезания/Национална олимпиада/2023/2023-II/a23-II-56.pdf` |
| `nof-2024-iii-11-12` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2024/11-12_th_zad.pdf` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2024/11-12_th_resh.pdf` |
| `nof-2018-iii-10-12` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2018/NOF3_2018_10-12problems.pdf` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2018/NOF3_2018_10-12solutions.pdf` |
| `nao-2023-iv-nabl` | `Астрономия/Състезания/Национална олимпиада/2023/2023-IV/obs/23-IV-Nabl.pdf` | `Астрономия/Състезания/Национална олимпиада/2023/2023-IV/obs/a23-IV-Nabl.pdf` |
| `nao-2021-iv-st-prak` | `Астрономия/Състезания/Национална олимпиада/2021/2021-IV/pract/beta/21-IV-praktST.pdf` | `Астрономия/Състезания/Национална олимпиада/2021/2021-IV/pract/beta/a21-IV-praktST.pdf` |
| `psf-2016-proletno-sp` | `Физика/Състезания/Пролетни/2016/proletni_2016_STproblems.pdf` | `Физика/Състезания/Пролетни/2016/proletni_2016_STsolutions.pdf` |
| `esf-2022-esenno-st` | `Физика/Състезания/Есенни/2023/esenni_2023_STproblems.pdf` | `Физика/Състезания/Есенни/2023/esenni_2023_STsolutions.pdf` |
| `nof-2025-iii-11-12` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2025/11-12_th_zad.pdf` | `Физика/Състезания/Национална олимпиада/III Национален кръг/2025/11-12_th_resh.pdf` |
| `nao-2025-iv-nabl` | `Астрономия/Състезания/Национална олимпиада/2025/2025-IV/obs/25-IV-nabl.pdf` | `Астрономия/Състезания/Национална олимпиада/2025/2025-IV/obs/a25-IV-nabl.pdf` |
| `psf-2026-proletno-8` | `Физика/Състезания/Пролетни/2026/proletni_2026_8problems.pdf` | `Физика/Състезания/Пролетни/2026/proletni_2026_8solutions.pdf` |
| `nao-2001-iii-9-10` | `Астрономия/Състезания/Национална олимпиада/2001/2001-III/NOA3_2001_9-10problems.pdf` | `Астрономия/Състезания/Национална олимпиада/2001/2001-III/NOA3_2001_9-10solutions.pdf` |
