# Transcription benchmark evidence — 2026-09-12T09:22:54.336Z

9/24 adjudications complete; 8 usable model-adjudicated references.

## Readers

| workflow | available | schema valid | adjudicated | pass | papers with critical defects |
|---|---:|---:|---:|---:|---:|
| agent__haiku | 24 | 24 | 8 | 0 | 8 |
| zai__glm-5.3-flash | 24 | 16 | 8 | 0 | 8 |
| agent__sonnet | 21 | 20 | 7 | 0 | 5 |

## Checkers

| checker | calls | structurally valid* | adjudicated | true findings | false findings | false passes / raw passes on adjudicated candidates |
|---|---:|---:|---:|---:|---:|---|
| agent/haiku | 24 | 16 | 8 | 22 | 4 | 1 / 1 |
| zai/glm-5.3-flash | 45 | 37 | 15 | 67 | 9 | 5 / 5 |

*After normalizing the historical transport-hash integration defect in memory. Original artifacts are unchanged. Structural validity does not prove visual accuracy.

## Papers

| paper | readers | adjudication | usable reference | remaining |
|---|---:|---|---|---|
| psf-2025-proletno-10 | 2 | complete | yes |   |
| psf-2024-proletno-9 | 3 | complete | yes |   |
| nof-2024-ii-11 | 3 | complete | yes |   |
| psf-2006-proletno-sp | 3 | complete | yes |   |
| esf-2010-esenno-7 | 3 | incomplete | no | adjudication is missing or incomplete  |
| nao-2001-iii-11-12 | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nao-1998-iv | 2 | complete | no |  1 escalations |
| esf-2002-esenno-st | 2 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nof-2009-iii | 3 | complete | yes |   |
| nao-2008-iv-st-prak | 3 | complete | yes |   |
| nao-2024-iv-obs | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nof-2012-iii-7 | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nof-2015-i-8 | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nao-2023-ii-5-6 | 3 | complete | yes |   |
| nof-2024-iii-11-12 | 3 | complete | yes |   |
| nof-2018-iii-10-12 | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nao-2023-iv-nabl | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nao-2021-iv-st-prak | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| psf-2016-proletno-sp | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| esf-2022-esenno-st | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nof-2025-iii-11-12 | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nao-2025-iv-nabl | 3 | incomplete | no | adjudication is missing or incomplete  |
| psf-2026-proletno-8 | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |
| nao-2001-iii-9-10 | 3 | incomplete | no | truth missing or unreadable; adjudication is missing or incomplete  |

## Limits

- Incomplete adjudications and source escalations are excluded from quality aggregates.
- Historical pass verdicts with explicitly listed minor defects are scored as fail under the strict contract; reportedVerdict preserves the original judgment.
- Reader workflows differed: agent readers could inspect/repair with tools; API readers used scripted parsing/window assembly. This compares workflows, not raw model ability.
- Historical API requests omitted the hash they asked the model to echo. Attribution uses recorded transport hashes; modelHashMismatch is an integration defect.
- Checker precision counts adjudicated non-info findings; there is no field-level recall metric because defects are not matched one-to-one.
- Token costs are recorded list-price equivalents, not invoices; the Z.ai bundle and Claude/Codex subscription usage are not directly comparable. Agent usage and unrecorded failed calls are not priced.
- Partial coverage and adversarial fixture selection do not support a production-wide success-rate estimate.
