# Transcription routes for the remaining archive — research memo (2026-09-14)

Written by Claude (Opus 5) as a research analyst for Margulan. Scope: the cheapest reliable way to finish the
~2,000 remaining papers (16,400 pages) and re-verify the 446 legacy papers, given the pipeline in `scripts/tx`, the
cost history in `tmp/tx/runs.jsonl`, and the state of vendor prices, limits and models as seen on 2026-09-14. All
prices are USD per million tokens unless stated; every number carries its source in §9. Nothing in the repository was
modified except the creation of this file.

## 0. Executive summary

1. **The money is not going to the model, it is going to the loop.** The runs log (3,929 calls, 323 papers, $30.58)
   says: the LLM checker is 66 % of spend ($20.15 over 1,973 calls, 61 k input tokens each), refix 24 %, the reader
   10 %. The median paper takes **4 checker rounds** (histogram tail to 26); 1,394 of 1,652 saved checker rounds
   failed, and **about 60 % of the non-info defects in those rounds came from the mechanical checks** (text layer:
   2,458; uncovered printed graphics: 1,952) — defects the LLM checker did not need to be called to find. The loop
   calls the $0.01 LLM checker first and the free mechanical checks second, every round. Re-ordering the loop
   ("mechanical-first": validate → figures → text-layer → refix until the mechanical checks are silent → only then
   the LLM checker, at most twice) cuts the per-paper cost of the *current* model by roughly 40 % with no model
   change. That is the first thing to do whatever provider is chosen.
2. **GLM-5.3-Flash was never the problem.** On the only third-party OCR leaderboard that prices per sample
   (Roboflow Vision Evals, 2026-09-05), GLM-5.3-Flash scores 90.6 % at $0.0004/image — the same quality as GPT-5.6
   Luna (90.7 %, $0.0012) and above Gemini 3.5 Flash-Lite (87.4 %, $0.0011) and Qwen3.8 Flash (88.0 %). Its list
   price ($0.15 in / $0.50 out, cached in $0.03) is at or below every comparable vision model in §2. The remaining
   2,000 papers cost about **$150 as the loop stands, about $90 mechanical-first** — the projected "$150–200" was
   right, and the fix is the loop, not a cheaper vendor.
3. **Two genuinely free API routes exist and are worth a benchmark run before spending anything:**
   Google's free tier gives Gemini 3.1/3.5 Flash-Lite **500 requests/day per project** (measured 2026-09-02; Google
   no longer publishes the table) — enough for ~50–65 papers/day, i.e. the whole backlog in ~5 weeks at $0, and
   Gemini 3.1 Flash-Lite is the best model on Cyrillic in the one multi-script OCR benchmark that reports it
   (GlotOCR Bench: 88.8 % Acc@5, above dots.ocr 86 %, Qwen3-VL-8B 79 %, GLM-OCR 26 %). Z.ai lists
   **GLM-4.6V-Flash (9B) as free on all tiers** — a different model family from GLM-5.3-Flash, so it would also
   satisfy the independent-checker rule the pipeline gave up on. Both are unproven on Bulgarian math papers; the
   24-paper benchmark harness (`bench.mjs`) settles that in an afternoon for free.
4. **Local inference is the wrong tool for the JSON job and the right tool for one niche.** General VLMs that could
   produce the schema (Qwen3.5/3.6 9B–27B) run 3–5 minutes per 6-page window on a 24 GB card: 500+ hours for the
   backlog, to save $40–$90. Dedicated OCR models are fast (1–3 pages/s under vLLM on a 4090-class GPU) but emit
   markdown/LaTeX plus layout boxes, not the schema, and the leading ones are weak on Cyrillic (GLM-OCR 26 %,
   DeepSeek-OCR-2 58 %); only dots.ocr (3B, MIT, 86 % Cyrillic, "Picture" bounding boxes) is credible. Its one real
   use here: giving the **222 image-only sheets and other scans a mechanical text layer**, which they lack today.
5. **The ChatGPT-desktop-app driver should be dropped as a bulk route.** Documented/reported caps: 80 file uploads
   per rolling 3 h on Plus (observed 65), 20 files per message, 3,000 manually-selected Thinking messages per week on
   Plus, one composer, 2–5 min per call; the PC must stay unlocked and unusable; OpenAI's Terms prohibit
   "automatically or programmatically extracting data or Output" and 2026 forum reports describe unexplained
   Plus/Pro suspensions with slow appeals. Best case ~40 papers/day → 50+ days of a hostage PC for a route that
   risks the subscription it depends on. None of the sanctioned surfaces (Projects, scheduled tasks, ChatGPT Work,
   MCP apps) is a bulk API. Keep the *idea* — the app's model read a word GLM misread — as a hand-driven
   adjudication aid on single hard papers, and retire `driver.ps1`.
6. **Codex CLI is the one subscription route that is both sanctioned and large enough**: OpenAI's own rate card
   gives Plus **250–2,000 GPT-5.6 Luna local messages per 5 hours** (weekly limits "may also apply", unpublished),
   `codex exec -i page.png … -o out.json` is supported, and Luna's OCR quality equals GLM's. Because each of our
   calls is a heavy 20–40 k-token message, plan on the low end: ~110–160 papers/day, the backlog in about two
   weeks, at $0 beyond the subscription. Margulan ruled Codex out because "it has usage limits like Claude Code";
   the numbers say those limits are 5–20× more generous than the app's upload cap. Worth re-deciding.
7. **Recommended plan** (details in §8): (A) implement the mechanical-first loop this week — it pays for itself on
   any provider; (B) run the 24-paper benchmark on Gemini 3.1 Flash-Lite (PDF input, `media_resolution: high`) and
   GLM-4.6V-Flash, both free; (C) finish the backlog on whichever of {GLM-5.3-Flash paid ≈ $90, Gemini Flash-Lite
   free tier ≈ $0 / 5 weeks, Codex+Luna ≈ $0 / 2 weeks if the ruling changes} passes the benchmark, with the legacy
   re-verification (checker + text layer only, ≈ $8–$12 on GLM) running alongside; (D) only if scans dominate the
   parked queue, add a local dots.ocr pass to give them a text layer. Expected total: **$0–$100 and 2–5 weeks of
   wall clock**, versus $150–200 and ~3 days on the current loop, or ~50 days and an account risk on the app.

## 1. Where the money actually went (from `tmp/tx/runs.jsonl`, 2026-09-06 → 09-13)

| stage (GLM-5.3-Flash) | calls | input tok/call | output tok/call | $/call | total | share | s/call |
|---|---:|---:|---:|---:|---:|---:|---:|
| reader | 498 | 21,541 | 6,466 | 0.0065 | $3.22 | 10 % | 102 |
| checker | 1,973 | 61,124 | 2,093 | 0.0102 | $20.15 | 66 % | 50 |
| refix | 1,351 | 23,809 | 3,531 | 0.0053 | $7.21 | 24 % | 55 |

323 distinct papers, mean $0.095, median $0.064 per paper; median pages per paper 10 (mean 15.8, p90 21, max 733).
Per paper: 1.5 reader calls, **6.1 checker calls**, 4.2 refix calls. Checker-round histogram: 2 rounds 66 papers,
3 → 49, 4 → 36, 5 → 23, 6 → 24, 7–10 → 54, 11–26 → 49. Job states: 226 done, 57 escalated, 24 in flight.

Composition of the 1,394 failed checker rounds (non-info defects, by origin):

| origin / kind | count | note |
|---|---:|---|
| text-layer check / reworded | 2,159 | deterministic (`textlayer.mjs`), computed after the LLM call |
| pdfregions / figure (uncovered printed graphic) | 1,952 | deterministic (`figures.mjs`), computed before the LLM call |
| model / figure (crop judgement) | 899 | needs the crops, not the full pages |
| model / reworded | 403 | on papers with a trusted text layer this duplicates the text-layer check |
| model / other, omission, pairing, wrong-value, points, metadata, latex | 1,049 | the checker's real job |
| text-layer / omission, other | 388 | deterministic |

141 failed rounds had no critical/major defect at all; 251 had only figure defects; 164 only text-layer defects;
194 only "reworded". Every one of those rounds paid a 61 k-token LLM checker call first.

Implications used throughout this memo: (i) input tokens dominate the checker (page images every round);
(ii) output tokens dominate the reader (6.5 k JSON tokens per window) — so a provider's **output** price matters
more than its image price for the reader, and its **image/input** price for the checker; (iii) the number of LLM
checker rounds is the biggest lever, and it is under our control.

## 2. Question 1 — cheapest reliable API route (prices as seen 2026-09-14)

### 2a. Vision LLMs: price, image accounting for one 160-dpi A4 page (1360×1760 px), free tier, batch

| model | in / out $/M | cached in | tokens per page image | free tier / promo | batch | OCR quality signal |
|---|---|---|---|---|---|---|
| **Z.ai GLM-5.3-Flash** | 0.15 / 0.50 | 0.03 | ~3,230 measured (1400-px JPEG); 1M ctx, 128K out, thinking cannot be disabled | 50 %-off launch promo ended 2026-09-09; prepaid balance only | none listed | Roboflow OCR 90.6 %, $0.0004/sample; OmniDocBench-class not reported |
| **Z.ai GLM-4.6V-Flash (9B)** | **free, all tiers** | — | not documented; 128K ctx; output 8–32K (sources disagree) | concurrency ≈ 1 (third-party listing) | — | unknown on Cyrillic; open weights (MIT), runs locally too |
| Z.ai GLM-4.6V-FlashX / GLM-4.6V | 0.04 / 0.40 · 0.30 / 0.90 | 0.004 · 0.05 | — | — | — | GLM-4.6V is the 106B MoE; grounding boxes `[[x,y,x,y]]` |
| Z.ai GLM-OCR (0.9B) | 0.03 / 0.03 | — | PDF ≤100 pp; layout-parsing tool returns text/formula/table/**image boxes**, ≤30 pp | — | — | OmniDocBench v1.6 95.2, formula CDM 97.2 — **but GlotOCR Cyrillic Acc@5 26.2 %** |
| **Google Gemini 3.1 Flash-Lite** | 0.25 / 1.50 | ~0.03–0.06 | images: `media_resolution` low 280 / medium 560 / **high 1,120** / ultra 2,240; PDF pages 560 default + native text **free** | free tier: **15 RPM, 500 RPD** per project (measured 2026-09-02) | 50 % (0.125 / 0.75), ≤24 h | GlotOCR overall #1, Cyrillic 88.8 %; Roboflow not listed; shutdown announced 2027-05-07 |
| Google Gemini 3.5 Flash-Lite (2026-07-21) | 0.30 / 2.50 | — | same 3.x accounting | 15 RPM, 500 RPD | 0.15 / 1.25 | Roboflow OCR 87.4 % (#52/70), $0.0011 |
| Google Gemini 3.6 / 3.7 / 3.8 Flash | 0.75 / 3.75 (3.7, 3.8, until 2026-12-31, then 1.50 / 7.50); 3.6: 1.50 / 7.50 | — | same | Flash: **5 RPM, 20 RPD** free | 50 % | Gemini 3.5 Flash 89.3 % (#36), $0.016 |
| Google Gemini 2.5 Flash-Lite | **0.10 / 0.40** | — | tiles of 768 px × 258 tok → **1,032 tok** per page image; native PDF **258 tok/page** | no shutdown date; free tier ~15 RPM / 1,000 RPD (Jan 2026 figures, likely lower now) | 50 % | 2025-era model; OCR regression complaints on newer Lites, none on 2.5 |
| **OpenAI GPT-5.6 Luna** (2026-07-09) | 0.20 / 1.20 | 0.02 | 32-px patches ×1.2: ceil(1360/32)·ceil(1760/32)=2,365 → **2,838 tok**; 2,500-patch budget | none | 50 % (0.10 / 0.60); Flex not supported | Roboflow OCR 90.7 % (#28), text extraction 79.4 % (Roboflow blog) |
| OpenAI GPT-5.6 Terra | 2.00 / 12.00 | 0.20 | same | — | 50 % | OCR 88.8 % |
| OpenAI gpt-5-mini / nano, gpt-4.1-nano | 0.25 / 2.00 · 0.05 / 0.40 · 0.10 / 0.40 | | mini 1.2×, nano 1.5×/2.46× patches | — | 50 % | **shut down 2026-12-11 (5-mini/nano) and 2026-10-23 (4.1-nano)**; migrate to Luna |
| Alibaba Qwen3.8-flash (Singapore) | 0.15 / 0.47 | 0.016 | h·w/1024 + 2 = **2,340 tok** | 1M tokens free per model for 90 days (new accounts; not all models) | 50 % on supported models | Roboflow OCR 88.0 % (#49), $0.0003 |
| Alibaba Qwen3.7-flash | ≈ half of 3.8-flash | | same | | | 84.1 % (#60), $0.0001 — too weak |
| Alibaba qwen-vl-ocr / Qwen3.5-OCR | 0.72 / 0.72 | | ≤8.4 Mpx; max output 4,096 (8,192 on request); PDF ≤50 pp | | | document→LaTeX, boxes in 0–999 grid; Russian listed |
| DeepSeek V4.1-Flash (2026-09-10) | 0.15–0.30 / 0.60–1.20 (off-peak/peak) | 0.003 | images resized to ≤~1300 px, **≤1,024 tok/image** (docs) or 384 (news) | — | — | native vision 4 days old; no OCR data; resolution cap is a risk for subscripts |
| Moonshot Kimi K2.5 / K2.6 | 0.60 / 3.00 · 0.95 / 4.00 | | | | | K2.5 retired 2026-08-31; Kimi K3 93.0 % OCR but $0.0083/sample |
| MiniMax M2.5 / M2.7 | 0.15–0.27 / 0.95–1.15 | | image tokens billed separately (unspecified) | | | no OCR data |
| Hosted open Qwen3-VL-32B / 235B-A22B (Alibaba, Together, Fireworks, DeepInfra via OpenRouter) | 0.104–0.90 / 0.416+ · 0.20 / 0.88 (Thinking 0.40 / 0.90) | | provider-dependent | | | OmniDocBench 89.8 (235B); Qwen3-VL-8B 79 % Cyrillic; no price advantage over GLM |
| Meta Muse Glimmer 30B (via OpenRouter/Together) | 0.30 / 1.10 · 0.35 / 1.50 | | | OpenRouter `:free` variant exists | | Roboflow OCR **92.1 %** (#15), $0.0012 — the best cheap score, unproven on Cyrillic |
| Mistral Small 4 / Ministral 3 8B | 0.15 / 0.60 · 0.15 / 0.15 | | | $10/mo free API credits on the Free plan | 50 % | no OCR data; French papers only would suit |
| Groq Llama 4 Scout / Maverick | 0.11 / 0.34 · 0.50 / 0.77 | | | 30 RPM, 14,400 RPD free | | Scout "preview"; Llama 4 is weak on non-Latin OCR |
| Cerebras Gemma 4 31B | private preview | | | | | image input only in preview |
| OpenRouter `:free` models | $0 | | Gemma 4 31B/26B (image, 140+ languages), Nemotron 3 Nano Omni, Ling 3.0 Flash VL | **20 RPM; 50 RPD, or 1,000 RPD after a one-time $10 credit purchase** | | untested on math |
| Anthropic Haiku 4.5 / Sonnet 5 / Opus 5 | 1 / 5 · 2 / 10 · 5 / 25 | | ≈ w·h/750 ≈ 3,190 tok | | 50 % | excluded for bulk by the standing rule; adjudication only |

**GLM Coding Plan (subscription) and vision.** Lite $18/month (2,000 credits per 5 h, 10,000 per week), Pro $72
(12,000 / 60,000), Max $160 (28,000 / 140,000); GLM-5.3-Flash — which *is* the vision model — costs 2.3 credits
per 10 k input tokens, 0.56 cached, 8 per 10 k output. Our as-is call profile is ≈ 142 credits per paper (reader
10, checker 15.6 × 6.1, refix 8.3 × 4.2), mechanical-first ≈ 79: Lite covers 70–125 papers/week (4–7 months for the
backlog), Pro 420–760/week for $72–$144 — no cheaper than pay-as-you-go. And the plan "must be used in officially
supported tools and products" (Claude Code, Cline, Cursor, OpenCode …); a transcription script is not one, and
violations are met with rate limiting or account freezing. The 2026-09-03 → 09-20 "zero quota for GLM-5.3-Flash"
campaign applies only through ZCode, 23:00–09:00 Singapore time. Not a route.

Notes. Gemini's PDF path is uniquely cheap because "native text embedded in PDFs is extracted automatically and
doesn't incur token charges" on Gemini 3 — the model gets our text layer for free next to the rendered page; the
doc's own advice is that OCR quality "saturates at medium" for standard documents, but the May 2026 forum thread on
the 3.1 Flash-Lite "OCR regression" was traced by users to the lower default resolution, so use `high` (1,120
tokens/page) for exam papers. OpenAI's PDF input sends text + page images too (50 MB per request). Alibaba's
Singapore endpoint requires account verification before paid use. Google's free tier data may be used to improve
Google products (olympiad papers are public, so this is not a concern here).

### 2b. Dedicated document-AI services (text + layout only; none produces the schema)

| service | price | math / Cyrillic | figure boxes | verdict |
|---|---|---|---|---|
| Mistral OCR 4.1 / Document AI | **$4 / 1,000 pp** (OCR 3 was $2; batch half) · $5 / 1,000 | markdown + LaTeX; OmniDocBench 85.7, table 76.8 (weak) | image extraction | $66 for 16,400 pages, weaker than the free models above |
| Mathpix Convert (v3/pdf) | **$0.005/page** ($29 trial credit, $19.99 one-off setup) | the STEM specialist: Mathpix Markdown / LaTeX, line-level JSON with boxes | yes | $82 for the backlog; best-in-class math, Cyrillic supported; no schema, no figure-crop judgement |
| Azure Document Intelligence Read / Layout | $1.50 / $10 per 1,000 pp (500 pp/month free) | Layout has a formula add-on; Cyrillic OK | layout boxes | $25–$164; no LaTeX quality data for olympiad math |
| Google Document AI Enterprise OCR / Layout Parser | $1.50 / $10 per 1,000 pp | text only / layout | | same as Azure |
| Datalab (Marker/Chandra hosted) | $4 / 1,000 pp (fast), $10 accurate; $10–20/month free allowance; boxes +$3–9 | Chandra 2: olmOCR-bench 85.8, math tables 92.1, multilingual 77.8 % | yes | $66–$164; the model is open (see §3) |
| LlamaParse | 1 credit/page fast, 3 cost-effective, 10 agentic; $1.25 per 1,000 credits; **10,000 free credits/month** (per multiple sources; the pricing page itself no longer states it) | LaTeX only on agentic tiers | layout +3 credits | free tier could OCR ~3,000 pages/month at the cost-effective tier |
| Reducto | $10 / 1,000 pp parse; 15,000 free credits | | yes | enterprise-priced |
| AWS Textract | ~$1.50 / 1,000 pp | no LaTeX | | unsuitable |

**"Cheap OCR + cheap text LLM" versus "vision LLM per page":** for born-digital PDFs the pipeline already has the
cheapest OCR there is (pdftotext, free, exact) and uses it mechanically; a paid OCR pass adds nothing. For scans
(the 222 image-only sheets, old typewriter papers) an OCR pass *does* add something the vision-LLM loop cannot give
today — a text layer to check against — and the cheapest good one is local dots.ocr (§3) or Gemini Flash-Lite used
as an OCR engine (~$0.0003/page at `high`). The LLM-structuring step then costs almost nothing: a text-only
GLM-5.3-Flash call over ~8 k tokens of markdown returns the JSON for ~$0.004 per paper. The catch is figure boxes
and crop judgement, which still need a vision call per figure page; and the math conventions of the OCR output
(`\(`…`\)`, HTML tables) must be normalised before the text-layer diff. Net: worth doing for scans only.

### 2c. Per-paper cost, remaining set (8.2 pages/paper average; profiles from §1)

Call profile "as-is": reader 1.5 windows, checker 6.1, refix 4.2. "Mechanical-first" (§6): checker 2, refix 4.
Checker input for an 8-page paper: 8 page images (or PDF pages) + ~4 crops + ~12 k tokens of prompt and candidate.

| route | as-is $/paper | mech-first $/paper | 2,000 papers (as-is → mech-first) | legacy 446 (checker+textlayer+refix) | throughput |
|---|---:|---:|---|---:|---|
| GLM-5.3-Flash (list) | 0.068 | 0.041 | **$137 → $82** | ≈ $12 | 5 workers, ~11 calls × 60 s → ~3 days |
| Gemini 2.5 Flash-Lite, native PDF (258 tok/page) | 0.029 | 0.019 | $58 → $38 | ≈ $5 | Tier 1: hours–days; free tier: ~1,000 RPD (unverified for 2026) |
| Gemini 2.5 Flash-Lite, page images (1,032 tok) | 0.036 | 0.023 | $72 → $46 | ≈ $6 | same |
| Gemini 3.1 Flash-Lite, PDF at `high` (1,120 tok + free text) | 0.108 | 0.072 | $216 → $144 (batch on reader + first check ≈ −15 %) | ≈ $15 | paid Tier 1; **free tier 500 RPD → 45–65 papers/day → 4–6 weeks at $0** |
| GPT-5.6 Luna, page images (2,838 tok) | 0.112 | 0.070 | $224 → $140; batch on reader+first check ≈ $170 → $110 | ≈ $16 | API; or **Codex on Plus at $0** (§5) |
| Qwen3.8-flash (Singapore) | ≈ GLM | ≈ GLM | ≈ $130 → $80 | | first 1M tokens free |
| DeepSeek V4.1-Flash off-peak | ≈ 0.03 | ≈ 0.02 | ≈ $60 → $40 | | unproven; ≤1,024 tok/image is a resolution cap |
| ChatGPT app driver | $0 | $0 | $0 | $0 | ~40 papers/day best case, 50+ days, ToS risk (§4) |
| OCR-first (local dots.ocr + text GLM) | ≈ 0.01 + vision calls for figure pages | | ≈ $20–$40 + electricity | | GPU 5–10 h (vLLM) for OCR; pipeline work 2–4 days |

The surprise in this table: **Gemini 3.x Flash-Lite and GPT-5.6 Luna are not cheaper than GLM-5.3-Flash** — their
output prices ($1.50, $1.20) are 2.4–3× GLM's, and the reader and refix are output-heavy. Only Gemini **2.5**
Flash-Lite ($0.40 out, 258-token PDF pages) undercuts GLM, and it is a 2025 model with an uncertain future and a
coarse page view. The free tiers change the picture entirely: at $0 the only questions are quality and calendar time.

## 3. Question 2 — local inference on the gaming PC

Evidence on the two things that matter here, Cyrillic and math:

| model (size) | OmniDocBench v1.6 overall / formula CDM | GlotOCR Cyrillic Acc@5 (400 samples) | boxes for figures | speed / VRAM | licence |
|---|---|---|---|---|---|
| **dots.ocr / dots.mocr (3B)** | 90.8 / 90.0 (v1.5 text edit 0.031 for mocr) | **86.0 % / 83.5 %** (2nd–3rd overall after Gemini 3.1 Flash-Lite) | layout JSON: Picture, Formula, Table, Caption… with `[x1,y1,x2,y2]` | vLLM ≥ 0.11 integrated; 3B bf16 fits 12 GB; ~1 page/s on a 4090-class card is realistic | MIT |
| GLM-OCR (0.9B) | 95.2 / 97.2 | **26.2 %** (ScriptAcc 98 % — right alphabet, wrong words) | layout-parsing boxes | 1.86 pp/s (vendor); vLLM + MTP | MIT |
| PaddleOCR-VL-1.5 (0.9B) | 94.9 / 96.9 | not in the summary; claims 109 languages incl. Bulgarian | text spotting boxes | 1.43 pp/s on an A100 with FastDeploy; **20–32 s/page reported on an RTX 4060 Ti** without it | Apache |
| DeepSeek-OCR-2 (3B) | 90.3 / 91.8 | 57.8 % | | ≥8 GB VRAM | MIT |
| olmOCR-2 (7B, v0.4.0) | 85.7 / 88.1 | 71.2 % | no | ≥12 GB VRAM; "<$200 per million pages" on datacentre GPUs | Apache |
| Chandra 2 (5B) | olmOCR-bench 85.8; math tables 92.1; old scans 89.1 | 43-language avg 77.8 % | yes (layout + image boxes) | 1.44 pp/s on an H100 | OpenRAIL-M (free for personal use) |
| Qwen3-VL-8B (general) | — | 79.0 % | can be prompted | slow for long JSON | Apache |
| Qwen3.5/3.6 9B–27B (general, could emit the schema) | — | ≈ Qwen3-VL class | prompted permille boxes | 27B Q4 needs ~16.5 GB; a 6-page window with 6.5 k output tokens at 20–40 tok/s = **3–5 min** | Apache |
| TeleOCR (1.2B), OvisOCR2 (0.8B) | 96.9 / 96.6 · 96.5 / 97.5 | not evaluated | | new, no consumer-GPU reports | |

Readings:

- **Which is best for math-heavy exam papers with LaTeX output?** On formula recognition the 0.9B specialists
  (GLM-OCR, PaddleOCR-VL-1.5) lead every benchmark, but the GlotOCR result disqualifies GLM-OCR for Bulgarian and
  Russian text and leaves PaddleOCR-VL untested. **dots.ocr is the only open model with both credible Cyrillic and
  usable figure boxes**; its formula score (90) is a step below the specialists. A hybrid — dots.ocr for text and
  boxes, a formula-specialist crop pass for display math — is possible but is a project in itself.
- **Throughput.** 16,400 pages at ~1 page/s (vLLM, 4090-class) is 5 hours; at the naive 20–32 s/page seen on a
  4060 Ti it is 4–6 days. The GPU model is unknown; assume the naive number until measured. Windows-native vLLM is
  not supported — this runs in the existing WSL2 Ubuntu with CUDA.
- **Could a local model do the whole JSON job?** Technically (Qwen3.6-27B), but at 3–5 min per window the reader
  alone is ~200 h and the loop 500+ h, to save $40–$90 of API. No.
- **The right local split**, if any: local OCR → markdown + boxes → the *existing* text-layer machinery treats the
  OCR markdown as the text layer for scans → a cheap text LLM (GLM-5.3-Flash without images, ~$0.004/paper)
  structures the JSON → vision calls only for figure pages and the final check. This is "OCR-first + LLM
  structuring" (§6c). Its value is confined to the scans, which is exactly where the current pipeline is blind
  (no text layer, boxes from pixels). Setup: WSL2 + vLLM + dots.ocr ≈ one day; pipeline changes 2–4 days.

## 4. Question 3 — the ChatGPT consumer app route

**Documented or widely reported limits (Plus unless stated).** OpenAI's help centre returns 403 to fetchers, so the
numbers below are from third-party pages that cite the File Uploads FAQ and the Projects article, cross-checked
against each other (FileUploadGPT "last checked 25 Aug 2026"; CustomGPT "updated 25 May 2026"):

| limit | value | source class |
|---|---|---|
| file uploads | **80 per rolling 3 h** (Plus and Pro alike per the FAQ; "may be lowered at peak"); Free 3/day | help-centre-derived; our observation: cap hit at ~65 |
| files per message | 20 (web/desktop; was 10) | help-centre-derived; matches our 20-file test |
| per file | 512 MB; 2 M tokens per document; 20 MB per image; 25 GB storage per user | help-centre-derived |
| messages | 160 per 3 h on the default model (Plus); **3,000 manually-selected Thinking messages per week**, rolling from the first Thinking message; Pro "unlimited subject to abuse guardrails" | help-centre-derived |
| Projects | 25 files per project on Plus (FAQ says 20), 40 on Pro; files persist across the project's chats; added in batches of 10; **adding them still counts against the 80/3 h** | help-centre-derived |
| Scheduled tasks | 5 active on Plus, 15 on Pro; **no file uploads and no access to project files** inside a task; ≥1 h apart | help-centre-derived |
| ChatGPT Work (launched 2026-07-09, on Plus/Pro/Business) | desktop-app agent that can be granted a **local folder** (no uploads); metered like other agentic features; rollout staged; no scripting surface | OpenAI announcement + guides |
| Apps SDK / MCP | ChatGPT can call MCP apps, but the prompt still has to be sent through the UI and the reply read back | docs |

**Terms.** OpenAI's Terms of Use (ROW and EU) prohibit "automatically or programmatically extracting data or
Output" and circumventing usage restrictions; consequences range from feature limits to termination. The driver
does exactly that (pastes prompts, waits, copies the reply). 2026 guides report Plus/Pro/Codex suspensions "with no
explanation and slow appeals" for bulk automation among the triggers; there is no published tolerance. The
probability is unknowable; the cost of the event is the subscription the whole route depends on, plus every chat
in it.

**Arithmetic.** With PDFs uploaded once per chat (5 uploads/paper), the upload cap allows ~16 papers per 3 h; the
binding constraint is the single composer: ~11 calls/paper × 2–5 min = 25–55 min per paper → **25–45 papers per
day** with the PC unlocked, the app in front, and nothing else using ChatGPT. 2,000 papers = 45–80 days; the
Thinking cap (3,000/week ≈ 430/day) is hit at ~40 papers/day. Reducing uploads further (one merged PDF per paper,
Projects) does not move the composer bottleneck. "Standard" instead of "High" thinking would roughly halve the
per-call time at an unknown quality cost — untested.

**Verdict:** drop as a bulk route; retire `driver.ps1` and the `chatgpt` provider. What survives is the observation
from §12e of the handoff — the app's frontier model read „в електрична схема“ where GLM (reader, checker and refix)
had all misread it. That is an adjudicator, not a reader: for a parked paper Margulan can, by hand, attach the PDF
and the reader prompt in a chat and paste the JSON into `--continue --repaired`. Five minutes per hard paper, no
automation, no upload arithmetic.

## 5. Question 4 — Codex CLI on the ChatGPT plan

Facts (OpenAI's rate card at learn.chatgpt.com/docs/pricing, seen 2026-09-14; CLI reference, same site):

- Local messages per 5-hour window, Plus: **GPT-5.6 Sol 10–100, Terra 25–200, Luna 250–2,000**; Pro 5x ($100):
  50–500 / 125–1,000 / 1,250–10,000; Pro 20x: 200–2,000 / 500–4,000 / 5,000–40,000. "Weekly limits may also
  apply" — the number is not published; third-party trackers say a rolling 7-day cap exists. Since April 2026 the
  metering is token-aligned credits (Luna: 5 credits per 1M input, 0.5 cached, 30 per 1M output; Sol 100/10/500),
  so the range collapses to the low end for heavy messages like ours. The 5-hour window was suspended 2026-07-12
  and reinstated 2026-07-30.
- `codex exec` is non-interactive: `--image/-i path[,path…]` attaches images to the first message,
  `--model/-m`, `-c model_reasoning_effort=…`, `--output-last-message/-o file`, `--json`, `--sandbox read-only`;
  works signed in with ChatGPT or with an API key. Images must be PNG/JPEG/GIF/WebP — PDFs are not attached
  directly, so page PNGs (which the pipeline already renders) are the input.
- Quality: Luna 90.7 % on Roboflow OCR — statistically the same as GLM-5.3-Flash (90.6 %); Sol 90.7 %, GPT-5.5
  91.2 %. Luna is the model to use; Sol at 10–100 messages/5 h would not cover the workload.
- Non-coding use: the rate card ties Codex usage to the plan and shares it "with other agentic features"; nothing
  in the docs restricts Codex to code, and image-input OCR workflows are documented by OpenAI's own knowledge base
  articles. It is the sanctioned automation surface for the subscription.

Throughput: our calls are 20–40 k input tokens (page images), so assume the low end, 250 Luna messages per 5 h ≈
1,200/day. At 7.5–11 calls per paper: **110–160 papers/day → the backlog in ~2 weeks**, legacy re-verification in
another 2–3 days, at $0 beyond the $20 subscription — subject to the unpublished weekly cap, which could stretch
this to a month. Risks: each `codex exec` is an agent run (sandbox, possible tool calls, its own system prompt),
so the reader prompt needs a "do not use tools, reply with the JSON only" wrapper and the JSON extracted from
`-o`; Luna's `reasoning.effort` should be `low`–`medium` to keep credits down; Windows-native Codex works but
sandboxing differs. Setup: a `codex` provider in `transcribe.mjs` mirroring the `chatgpt` one but without UI
automation — half a day.

Comparison with the API-key route: identical model and quality; API costs $110–$224 (§2c) versus $0; the API is
faster (no window) and parallel (Tier 1: 500 RPM). If Margulan keeps his Codex ruling, the API-key route with
Luna is strictly worse than GLM on price; Codex only wins because the subscription is already paid.

## 6. Question 5 — is reader + independent checker + refix the right architecture?

The architecture is right; its **schedule** is wrong. What the data (§1) says:

- The independent LLM checker earns its keep on things no text layer can see: figure crops (899 model/figure
  findings), structure and pairing (204), points, wrong values and units, LaTeX (41), metadata, and the
  solution-attached-to-the-wrong-problem class. Benchmark precision was 91 %. Keep it.
- But the same checker also duplicated the text-layer check (403 model/reworded on top of 2,159 mechanical ones),
  was called before the mechanical checks every round, and was called again after every refix. That is the 66 %.

Ranked cut list (each item independent; expected effect on the current GLM cost):

1. **Mechanical-first loop (−35 to −45 %).** Order per round: validate → figures/regions → text layer → if any
   mechanical defect: repair/refix (pages of the defects only) → repeat; when the mechanical checks are silent,
   call the LLM checker; after its fixes, mechanical again (free), then one final LLM re-check; hard cap of 2 LLM
   checks per paper before parking. The 415 rounds that had only figure or only text-layer defects and the 141 with
   nothing critical/major stop costing an LLM call. Estimated LLM checker calls per paper: 6.1 → ~2.
2. **Checker sees less (−10 to −15 % more).** On papers whose text layer is trusted, tell the checker in the prompt
   that wording is verified mechanically and to report only structure, quantities, math, tables, figures, pairing,
   points — fewer output tokens, fewer "reworded" false positives that spawn refix rounds. Send page images at
   ~1,000 px width for the checker (it judges crops separately at full resolution); GLM tokens per page fall from
   ~3.2 k to ~1.7 k. Or, on Gemini, send the PDF (free native text) instead of PNGs.
3. **Cache the page prefix (−5 to −10 % on rounds 2+).** Images already come first in the request; keep the crop
   images and candidate text after them so the page-image prefix is byte-identical across rounds. GLM-5.3-Flash
   lists cached input at $0.03 vs $0.15; Luna $0.02 vs $0.20; Gemini implicit caching ~75–90 % off above 4,096
   tokens on 3.x. The pipeline does not record `cached_tokens` today — log it first, then decide.
4. **Refix batching and page discipline (−5 %).** Refix already sends only the defect pages; group text-layer
   fixes with a mechanical suggested fix so they never reach the model (many already do), and refuse refix rounds
   whose defects are all `minor` unless a `critical`/`major` remains.
5. **Figure boxes out of the LLM loop entirely (long term).** 1,952 "uncovered graphic" and 899 crop findings say
   boxes are the second-biggest churn. For born-digital PDFs the regions are known before any model runs — seed
   the reader with the region list ("figures on p.3: two drawings at …") and let the reader only *assign* regions
   to problems; snap is then an identity. For scans, dots.ocr's Picture boxes play the same role (§3).

The four alternatives asked about:

- (a) **Single strong model + text-layer diff.** Cheaper only if the strong model passes the text-layer diff on the
  first try often enough to skip the checker. Sonnet-class readers passed 2 of 18 benchmark papers under the
  strict contract; the failures were crop edges and silently corrected typos — exactly what the mechanical checks
  catch, but the fixes still need a model call. A strong reader costs 10–25× a Flash reader per window and is
  excluded by the standing rule. No.
- (b) **Two cheap readers + mechanical agreement.** Attractive in theory (two independent readings, diff the JSON,
  send only disagreements to a third opinion), and free if the second reader is GLM-4.6V-Flash or Gemini Flash-Lite
  on the free tier. In practice two readers rarely produce the same problem/part segmentation or the same LaTeX,
  so the diff needs the same normalisation machinery the checker already has, and both readers share the "silently
  fix the typo" failure mode, which agreement cannot detect — only the text layer can. Worth it in one form: a
  **free second reader as the independent checker's eyes** (D-P10 wanted a different family) rather than as a
  replacement for the checker.
- (c) **OCR-first + LLM structuring.** Best for scans (they get a text layer), neutral for born-digital PDFs (they
  already have one), costs a new pass and normalisation work; see §3. Recommended as phase 2, scans only.
- (d) **Page-level instead of paper-level calls.** The reader already windows (6 pages); page-level reading would
  multiply output tokens (the JSON envelope per page) and break problems that span pages. The *checker* at
  page-level makes sense in one place: the final re-check after refix could look only at the pages the refix
  touched plus a cheap whole-paper coverage count. That is item 1's second LLM call, made smaller.

## 7. Question 6 — the plan

### Route A — GLM-5.3-Flash, mechanical-first loop (paid, fastest, lowest risk)
Cost ≈ $82 for the backlog + $12 legacy + refix margin → **budget $100**; ~3 days with 5 workers; quality as
today (verbatim text, 91 %-precise checker, boxes snapped); setup: the loop reorder (1–2 days of pipeline work,
tested against the 24 fixtures). Recharge in $20 steps so a bug cannot drain the balance in a night.

### Route B — Gemini Flash-Lite on the free tier, mechanical-first loop (free, slow, quality to prove)
Gemini 3.1 Flash-Lite, native PDF input, `media_resolution: high`, `responseMimeType: application/json`; **500
requests/day, 15 RPM**, one project, no parallel projects (that is the rate-limit circumvention the terms forbid).
~7.5 calls/paper → ~65 papers/day → backlog in ~5 weeks, legacy in another week; $0. Quality: #1 on GlotOCR
Cyrillic, but untested on our math and our schema — run `bench.mjs` on the 24 fixtures first (24 papers ≈ 200
requests, half a day, free). Setup: `gemini` provider exists; add PDF parts, `media_resolution`, a 15-RPM/500-RPD
throttle, and Tier-1 fallback (add billing; then the same run costs ≈ $144 as-is or ≈ $100 mechanical-first with
batch on the reader — no better than GLM, so Tier 1 is only the "finish faster" button).

### Route C — Codex CLI with GPT-5.6 Luna (free within the subscription, sanctioned, needs Margulan to reverse D-P14's Codex ruling)
~110–160 papers/day at the conservative 250 messages/5 h → backlog in ~2 weeks (a month if the unpublished
weekly cap bites); $0; quality ≈ GLM; setup: a `codex` provider (half a day) and a small bench run. This is the
route that gives Margulan what he wanted from the app — the subscription doing the work — without the ToS exposure
or the hostage PC.

### Optional phase 2 — local dots.ocr for scans
Only if, after A/B/C, the parked queue is dominated by scans (the 222 image-only sheets, 2000s typewriter papers):
WSL2 + vLLM + dots.ocr, one day; text-layer adapter for OCR markdown, 2–3 days; then the same loop runs with a
mechanical check on scans too. Cost ≈ electricity; value ≈ removing the one class of paper the loop cannot verify.

### What to run alongside, whatever the route
- The 24-fixture benchmark on GLM-4.6V-Flash (free, different family) as a **checker**. If it is precise enough,
  the "same-model checker" note on every page goes away at $0.
- Log `cached_tokens` per call; reorder request parts so the page prefix is stable.
- Keep Z.ai as the burst provider even on B/C: it is the only one of the three that is parallel and unthrottled.

### Verdict on the ChatGPT-app automation
Stop it. Uninstall the driver from the batch path, keep the montage/crop-sheet code (useful for any single-image
adjudication), and record in D-P14's row that the app is a hand-driven adjudication aid only. The numbers: ≤ 45
papers/day versus 65 (Gemini free), 110–160 (Codex) or 700 (GLM paid); 50+ days of an unlockable PC; a Terms
violation on the account that hosts the subscription; and no measurable quality advantage on the bulk work, because
the loop's remaining errors are structural (boxes, pairing, typos preserved) rather than reading errors.

## 8. Things that would change this memo

- If GLM-4.6V-Flash or Gemini Flash-Lite fails the fixture benchmark on Cyrillic math (subscripts, decimal commas,
  `[2 т.]` markers), routes B and the free checker fall away and A is the answer.
- Gemini 3.x prices double on 2027-01-01 (Flash) — Flash-Lite is not listed for that increase; 2.5 Flash-Lite has
  no shutdown date but Google retired every other 2.x model in 2026.
- OpenAI retires gpt-5-mini/nano on 2026-12-11; Luna is the small model that remains. Codex's weekly cap is
  unpublished and has changed three times in 2026.
- DeepSeek V4.1-Flash (2026-09-10) is the wild card: cheapest input of all, native vision, MIT weights, but a
  ≤1,024-token image cap. A fixture run costs cents.

## 9. Sources (all seen 2026-09-14 unless the source itself carries a date)

Repository: `docs/Handoff-2026-09-12.md` §12b–12f; `docs/Problems-Decisions-2026-09.md` D-P10–D-P14;
`docs/Transcription-Benchmark-2026-09.md`; `scripts/tx/{run,transcribe,textlayer,lib}.mjs`,
`scripts/tx/prompts/v1/*.md`, `scripts/tx/prices.json`; `tmp/tx/runs.jsonl` (3,929 rows), `tmp/tx/jobs.json`,
`tmp/tx/*/checks/*.json` (1,652 checker outputs) — aggregated with node one-liners, not modified.

Pricing and limits (primary):
- Google — https://ai.google.dev/gemini-api/docs/pricing ; https://ai.google.dev/gemini-api/docs/media-resolution ;
  https://ai.google.dev/gemini-api/docs/document-processing ; https://ai.google.dev/gemini-api/docs/image-understanding ;
  https://ai.google.dev/gemini-api/docs/rate-limits (free-tier table removed; batch enqueued-token caps) ;
  https://ai.google.dev/gemini-api/docs/batch-mode ; https://ai.google.dev/gemini-api/docs/deprecations ;
  https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/ (2026-07-21)
- OpenAI — https://developers.openai.com/api/docs/pricing ; https://developers.openai.com/api/docs/models/gpt-5.6-luna ;
  https://developers.openai.com/api/docs/models/gpt-5.6-terra ; https://developers.openai.com/api/docs/guides/images-vision ;
  https://developers.openai.com/api/docs/guides/pdf-files ; https://developers.openai.com/api/docs/guides/batch ;
  https://developers.openai.com/api/docs/deprecations ; https://learn.chatgpt.com/docs/pricing (Codex rate card) ;
  https://learn.chatgpt.com/docs/developer-commands?surface=cli (codex exec flags) ; https://openai.com/policies/row-terms-of-use/
- Z.ai — https://docs.z.ai/guides/overview/pricing ; https://docs.z.ai/guides/vlm/glm-5.3-flash ; https://docs.z.ai/guides/vlm/glm-4.6v ;
  https://docs.z.ai/guides/vlm/glm-ocr ; https://docs.z.ai/api-reference/tools/layout-parsing ; https://docs.z.ai/devpack/overview ;
  https://docs.z.ai/devpack/quick-start ; https://docs.z.ai/devpack/teamplan ; https://docs.z.ai/devpack/usage-policy ;
  https://docs.z.ai/devpack/notice/event-glm-5.3-flash (campaign 2026-09-03 → 09-20) ; https://huggingface.co/zai-org/GLM-4.6V-Flash
- DeepSeek — https://api-docs.deepseek.com/quick_start/pricing ; https://api-docs.deepseek.com/guides/vision ;
  https://www.deepseek.com/en/news/deepseek-v4-1-flash/ (2026-09-10)
- Alibaba — https://www.alibabacloud.com/help/en/model-studio/vision-model/ (token formula) ;
  https://www.alibabacloud.com/help/en/model-studio/new-free-quota ; https://www.alibabacloud.com/help/en/model-studio/qwen-vl-ocr
- Mistral — https://mistral.ai/pricing/api ; https://mistral.ai/pricing
- OpenRouter — https://openrouter.ai/docs/api-reference/limits ; https://openrouter.ai/z-ai ; https://openrouter.ai/models?q=free&modality=image
- Document AI — https://mathpix.com/pricing/api ; https://www.datalab.to/pricing ; https://developers.llamaindex.ai/llamaparse/general/pricing/ ;
  https://reducto.ai/pricing ; https://docs.reducto.ai/reference/credit-usage ; https://cloud.google.com/document-ai/pricing ;
  Azure Document Intelligence pricing via https://learn.microsoft.com/en-us/answers/questions/5665475/ and https://docuocr.com/blog/azure-document-intelligence-pricing
- Anthropic — claude-api skill pricing table (cached 2026-06-24): Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25.

Quality and benchmarks:
- Roboflow Vision Evals OCR leaderboard — https://playground.roboflow.com/evals/ocr (evals 2026-09-05, prices 2026-09-13) ;
  https://blog.roboflow.com/openai-gpt-5-6/ (2026-07-16) ; https://playground.roboflow.com/models/compare/gemini-3-5-flash-lite-vs-glm-ocr
- GlotOCR Bench (Cyrillic per-model table) — https://arxiv.org/html/2604.12978
- OmniDocBench v1.6 leaderboard — https://github.com/opendatalab/OmniDocBench
- olmOCR — https://github.com/allenai/olmocr ; Chandra 2 — https://huggingface.co/datalab-to/chandra-ocr-2 ;
  dots.ocr — https://github.com/rednote-hilab/dots.ocr ; GLM-OCR — https://github.com/zai-org/GLM-OCR , https://arxiv.org/abs/2603.10910 ,
  https://recipes.vllm.ai/zai-org/GLM-OCR ; PaddleOCR-VL-1.5 — https://arxiv.org/html/2601.21957v1 ,
  https://github.com/PaddlePaddle/PaddleOCR/issues/18164 (20–32 s/page on RTX 4060 Ti) ; DeepSeek-OCR-2 — https://recipes.vllm.ai/deepseek-ai/DeepSeek-OCR-2
- Gemini OCR regression thread — https://discuss.ai.google.dev/t/critical-ocr-performance-regression-2-5-flash-vs-3-1-flash-lite/145361 (2026-05-19)
- Gemini implicit caching — https://developers.googleblog.com/gemini-2-5-models-now-support-implicit-caching/ ; https://ai.google.dev/gemini-api/docs/caching

Reported (secondary) limits, labelled as such in the text:
- Gemini free tier measured 2026-09-02 (Flash 5 RPM/20 RPD, Flash-Lite 15 RPM/500 RPD, from 429 bodies) —
  https://dev.to/romeroyang/geminis-free-tier-measured-20-requests-a-day-and-google-no-longer-publishes-the-number-4gf2 ;
  Jan-2026 table (2.5 Flash-Lite 1,000 RPD) — https://www.aifreeapi.com/en/posts/gemini-api-free-tier-rate-limits
- ChatGPT upload/message caps — https://www.fileuploadgpt.com/blog/chatgpt-plus-file-upload-limit (checked 2026-08-25) ;
  https://customgpt.ai/chatgpt-plus-limits-2026/ (2026-05-25) ; https://www.fileuploadgpt.com/blog/chatgpt-projects-file-limit ;
  ChatGPT Work — https://www.bnnbloomberg.ca/business/artificial-intelligence/2026/07/09/openai-launches-chatgpt-work/ ,
  https://www.bigprompthub.com/chatgpt-work-local-folder-guide/ (2026-07-15) ; scheduled tasks — https://learn.chatgpt.com/docs/automations ;
  bans — https://qcode.cc/en/codex-account-ban-guide , https://www.nstbrowser.io/en/blog/chatgpt-ban
- Codex limits history — https://codexinsider.com/limits/ (2026-08-03) ; https://www.codexusage.dev/changes ;
  https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan (403 to fetchers; quoted via search)
- Z.ai free-model concurrency (1 concurrent request) — https://freellm.net/models/z-ai-zhipu-ai/glm-4-6v-flash ; https://itsfree.ai/provider/zai/ (2026-09-02)
- GLM Coding Plan prices (Lite $18 / Pro $72 / Max $160, restricted to supported coding tools) — https://www.aipricing.guru/z-ai-subscription-pricing/ (2026-09-14)
- Muse Glimmer 30B — https://openrouter.ai/meta/muse-glimmer-30b ; Groq — https://www.cloudzero.com/blog/groq-pricing/ ;
  Cerebras Gemma 4 vision preview — https://inference-docs.cerebras.ai/capabilities/image-inputs
