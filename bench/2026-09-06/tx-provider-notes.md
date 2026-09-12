# Provider probe notes (measured 2026-09-06 01:52, orchestrator)

## Z.ai — GLM-5.3-Flash (key present in ~/.config/olympiads-xyz/providers.env as ZAI_API_KEY)
- Endpoint: POST https://api.z.ai/api/paas/v4/chat/completions (OpenAI-compatible), model id `glm-5.3-flash`.
- Thinking cannot be disabled: `"thinking":{"type":"disabled"}` → HTTP 400 code 1210 "please use low, high, or max".
  Cheapest working shape: top-level `"reasoning_effort":"low"` → 0 reasoning tokens (verified). `"thinking":{"type":"enabled","effort":"low"}` → ~29 reasoning tokens.
  Default (no param) → heavy reasoning (979 reasoning tokens on a one-page transcription).
- Vision input: OpenAI-style `{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}` works.
  One 160-dpi page PNG (494 KB, PSF 2024 grade 9) cost ≈ 3,230 prompt tokens. Latency 24 s for 1,500 output tokens.
- Quality on that page: verbatim match with the Opus reference statement of problem 1 (incl. parts and point values).
- Usage fields: usage.prompt_tokens, usage.completion_tokens, usage.completion_tokens_details.reasoning_tokens.
- Budget: 100M-token trial bundle (3 months). Whole experiment estimate ≈ 30M tokens (≈22k input/paper for 6 pages).
- For the READER stage use reasoning_effort "low" (transcription is perception, not reasoning); for the CHECKER stage try "low" first and escalate to "high" only on disagreement.

## Gemini — no key yet (GEMINI_API_KEY absent). Anthropic API — no key (use harness agents haiku/sonnet instead).

## GLM-5.3-Flash limits (probed 02:05)
- max_tokens accepted range [1, 131072] (200000 → HTTP 400 code 1210). Use 65536 default for readers; 131072 for the biggest papers.
- Bench fixture sizes: 263 pages over 24 papers; largest nao-2024-iv-obs 36 pages (~115k image tokens) — fits a single request only if the context window allows; try single-request first, fall back to per-document requests (problems doc, solutions doc) if the API rejects.
