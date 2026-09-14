// Offline request/response adapters for the isolated page OCR pilot. No fetch,
// SDK, environment access, key loading, writes, or retries occur in this module.
// The runner loads credentials, reserves budget, then sends exactly once with
// redirect:'error'. Never log request headers, bodies, or raw provider errors.
// Schemas and limits verified 2026-09-14:
// https://developers.openai.com/api/docs/models/gpt-5.6-luna
// https://developers.openai.com/api/docs/models/gpt-5.6-terra
// https://developers.openai.com/api/docs/guides/images-vision
// https://developers.openai.com/api/docs/guides/structured-outputs
// https://developers.openai.com/api/reference/cli/resources/responses/methods/create
// https://docs.z.ai/api-reference/llm/chat-completion
// https://docs.z.ai/api-reference/tools/layout-parsing
// https://docs.z.ai/guides/vlm/glm-4.6v
// https://docs.z.ai/guides/overview/pricing
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const MiB = 1024 * 1024;
const PILOT_IMAGE_BYTES = 10 * MiB;
const PILOT_REQUEST_BYTES = 16 * MiB;
const CONFIG = Object.freeze({
  openai: Object.freeze({
    model: 'gpt-5.6-luna', url: 'https://api.openai.com/v1/responses',
    envVar: 'OPENAI_API_KEY', keyConfigName: 'OPENAI_API_KEY',
    maxInputTokens: 1050000, maxOutputTokens: 128000,
    inputRatePerMTok: 0.2, outputRatePerMTok: 1.2, cachedInputRatePerMTok: 0.02,
  }),
  'openai-terra': Object.freeze({
    model: 'gpt-5.6-terra', url: 'https://api.openai.com/v1/responses',
    envVar: 'OPENAI_API_KEY', keyConfigName: 'OPENAI_API_KEY',
    maxInputTokens: 1050000, maxOutputTokens: 128000,
    inputRatePerMTok: 2, outputRatePerMTok: 12, cachedInputRatePerMTok: 0.2,
  }),
  'zai-vision': Object.freeze({
    model: 'glm-4.6v', url: 'https://api.z.ai/api/paas/v4/chat/completions',
    envVar: 'ZAI_API_KEY', keyConfigName: 'ZAI_API_KEY',
    maxInputTokens: 131072, maxOutputTokens: 32768,
  }),
  'zai-ocr': Object.freeze({
    model: 'glm-ocr', url: 'https://api.z.ai/api/paas/v4/layout_parsing',
    envVar: 'ZAI_API_KEY', keyConfigName: 'ZAI_API_KEY',
    maxInputTokens: null, maxOutputTokens: null,
  }),
});

const objectSchema = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const string = { type: 'string' };
export const PAGE_SCHEMA = objectSchema({
  schemaVersion: { type: 'integer', enum: [1] },
  blocks: { type: 'array', items: objectSchema({
    id: string,
    type: { type: 'string', enum: ['heading', 'paragraph', 'equation', 'table', 'figure', 'caption', 'footer'] },
    text: string,
    bbox: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1000 }, minItems: 4, maxItems: 4 },
    problemNumber: { type: ['string', 'null'] },
    continuation: { type: 'boolean' },
  }) },
  uncertainties: { type: 'array', items: objectSchema({ blockId: string, note: string }) },
  normalizations: { type: 'array', items: objectSchema({ blockId: string, source: string, replacement: string, reason: string }) },
});

function config(provider) {
  if (!Object.hasOwn(CONFIG, provider)) throw new Error('Unsupported pilot provider.');
  return CONFIG[provider];
}

// Deliberately enumerate the two approved models; a prefix must never admit
// another provider/model without its own verified limits and price schedule.
const isOpenAI = provider => provider === 'openai' || provider === 'openai-terra';

/** Strict exact URL matching: no alternate hosts, paths, ports, query, or auth. */
export function assertAllowedEndpoint(provider, url) {
  if (url !== config(provider).url) throw new Error('Pilot endpoint is not allowlisted.');
  return url;
}

function checkedImage(image) {
  if (!image || !['image/png', 'image/jpeg'].includes(image.mime)) throw new Error('Pilot images must be PNG or JPEG.');
  if (!(image.bytes instanceof Uint8Array)) throw new Error('Prepare local image bytes before building a request.');
  const bytes = Buffer.from(image.bytes);
  if (!bytes.length || bytes.length > PILOT_IMAGE_BYTES) throw new Error('Pilot image exceeds the 10 MiB limit or is empty.');
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((image.mime === 'image/png' && !png) || (image.mime === 'image/jpeg' && !jpg)) throw new Error('Pilot image signature does not match its MIME type.');
  return { mime: image.mime, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Read-only path adapter; pure buildRequest below accepts its returned bytes. */
export async function prepareImages(images) {
  if (!Array.isArray(images) || images.length !== 1) throw new Error('The pilot accepts exactly one page image per request.');
  const prepared = [];
  for (const image of images) {
    if (typeof image?.path !== 'string' || !image.path || /^(?:https?|data|file):/i.test(image.path)) throw new Error('A local page image path is required.');
    let handle;
    try {
      handle = await open(image.path, 'r');
      const info = await handle.stat();
      if (!info.isFile() || info.size <= 0 || info.size > PILOT_IMAGE_BYTES) throw new Error();
      prepared.push(checkedImage({ mime: image.mime, bytes: await handle.readFile() }));
    } catch {
      // Filesystem errors contain local paths. Deliberately return a fixed error.
      throw new Error('Cannot prepare the local page image; check format, readability and the 10 MiB limit.');
    } finally {
      if (handle) await handle.close();
    }
  }
  return prepared;
}

export async function buildRequestFromPaths(provider, options) {
  return buildRequest(provider, { ...options, images: await prepareImages(options.images) });
}

/**
 * Pure builder. Input: {model?, images:[{mime,bytes}], prompt,
 * maxOutputTokens?:16000, jsonSchema?:PAGE_SCHEMA, reasoningEffort?:'none'}.
 * OpenAI additionally accepts reasoningEffort:'low'; Z.ai accepts only 'none'.
 * Output has NO credentials.
 * PNG/JPEG only, one page, 10 MiB image/16 MiB JSON: intentional pilot limits,
 * not claims about providers' broader file limits. No PDF or remote image URL.
 */
export function buildRequest(provider, options = {}) {
  const cfg = config(provider);
  const { model = cfg.model, images, prompt = '', maxOutputTokens = 16000, jsonSchema = PAGE_SCHEMA, reasoningEffort = 'none' } = options;
  if (model !== cfg.model) throw new Error('Pilot model is not allowlisted for this provider.');
  if (!(isOpenAI(provider) ? ['none', 'low'] : ['none']).includes(reasoningEffort)) throw new Error('Reasoning effort is not allowlisted for this pilot provider.');
  if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 64 * 1024) throw new Error('Pilot prompt must be a string of at most 64 KiB.');
  if (!Array.isArray(images) || images.length !== 1) throw new Error('The pilot accepts exactly one page image per request.');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > (cfg.maxOutputTokens ?? 128000)) throw new Error('Invalid maximum output token limit.');
  let schema;
  try {
    if (!jsonSchema || jsonSchema.type !== 'object') throw new Error();
    const encoded = JSON.stringify(jsonSchema);
    if (Buffer.byteLength(encoded) > 128 * 1024) throw new Error();
    schema = JSON.parse(encoded);
  } catch { throw new Error('A JSON object schema of at most 128 KiB is required.'); }
  const image = checkedImage(images[0]);
  const imageUrl = `data:${image.mime};base64,${image.bytes.toString('base64')}`;
  let body;
  if (isOpenAI(provider)) {
    body = {
      model, store: false, stream: false, service_tier: 'default', truncation: 'disabled',
      reasoning: { effort: reasoningEffort }, max_output_tokens: maxOutputTokens,
      // Disable the implicit cache breakpoint. The budget still includes the
      // worst cache-write rate, rather than depending on this optimization.
      prompt_cache_options: { mode: 'explicit' },
      input: [{ role: 'user', content: [
        { type: 'input_image', image_url: imageUrl, detail: 'high' },
        { type: 'input_text', text: prompt },
      ] }],
      text: { format: { type: 'json_schema', name: 'page_transcription', strict: true, schema } },
    };
  } else if (provider === 'zai-vision') {
    body = {
      model, stream: false, max_tokens: maxOutputTokens,
      thinking: { type: 'disabled' },
      // response_format is documented for text models only. Preserve the schema
      // instruction in text and require local validation after parsing.
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: `${prompt}\n\nReturn only one JSON object matching this schema, with no Markdown fences:\n${JSON.stringify(schema)}` },
      ] }],
    };
  } else {
    // layout_parsing has no prompt or output-token-limit parameter. Do not add
    // invented fields; its unbounded budget deliberately blocks paid dispatch.
    body = { model, file: imageUrl, return_crop_images: true, need_layout_visualization: false };
  }
  if (Buffer.byteLength(JSON.stringify(body)) > PILOT_REQUEST_BYTES) throw new Error('Pilot request exceeds the 16 MiB limit.');
  return {
    provider, model, url: assertAllowedEndpoint(provider, cfg.url), method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body,
    credential: { envVar: cfg.envVar, keyConfigName: cfg.keyConfigName },
    imageMetadata: [{ mime: image.mime, bytes: image.bytes.length, sha256: image.sha256 }],
    budget: requestBudget(provider, maxOutputTokens),
  };
}

/** Entire documented context ceiling, NOT a token/page guess. Input already
 * includes image tokens. K is conservatively interpreted as 1024 for GLM.
 * OpenAI's output ceiling includes reasoning; no separate reasoning charge.
 */
export function requestBudget(provider, maxOutputTokens = 16000) {
  const cfg = config(provider);
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > (cfg.maxOutputTokens ?? 128000)) throw new Error('Invalid maximum output token limit.');
  if (provider === 'zai-ocr') return {
    hardBoundAvailable: false, maxCostMicroUsd: null, maxInputTokens: null, maxOutputTokens: null,
    reason: 'GLM-OCR layout parsing has no documented output limit or image token ceiling.',
  };
  const inputRate = isOpenAI(provider) ? cfg.inputRatePerMTok * 2 * 1.25 : 0.3;
  const outputRate = isOpenAI(provider) ? cfg.outputRatePerMTok * 1.5 : 0.9;
  return {
    hardBoundAvailable: true,
    maxCostMicroUsd: Math.ceil(cfg.maxInputTokens * inputRate + maxOutputTokens * outputRate),
    maxInputTokens: cfg.maxInputTokens, maxOutputTokens,
    inputRatePerMTokUpper: inputRate, outputRatePerMTokUpper: outputRate,
    includesImageInput: true, outputIncludesReasoning: true,
    imageInputTokensUpper: isOpenAI(provider) ? 3001 : null,
    reason: isOpenAI(provider)
      ? 'Full context at long-input and cache-write rates; output at long-input rate. High-detail image cap is 2500 patches times 1.2, plus rounding cushion.'
      : 'Full 128 Ki-token context and requested output ceiling, including vision input and reasoning output.',
  };
}

const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const pickToken = (...values) => values.map(token).find(v => v !== null) ?? null;

function normalizeUsage(provider, value) {
  const u = value && typeof value === 'object' ? value : {};
  const inputDetails = isOpenAI(provider) ? u.input_tokens_details : u.prompt_tokens_details;
  const outputDetails = isOpenAI(provider) ? u.output_tokens_details : u.completion_tokens_details;
  return {
    inputTokens: token(isOpenAI(provider) ? u.input_tokens : u.prompt_tokens),
    outputTokens: token(isOpenAI(provider) ? u.output_tokens : u.completion_tokens),
    reasoningTokens: token(outputDetails?.reasoning_tokens),
    cachedInputTokens: token(inputDetails?.cached_tokens),
    cacheWriteTokens: token(inputDetails?.cache_write_tokens),
    imageInputTokens: pickToken(inputDetails?.image_tokens, u.image_tokens),
    totalTokens: token(u.total_tokens),
    outputIncludesReasoning: true,
  };
}

/** Integer microUSD. Missing cache categories use the maximum applicable rate;
 * missing input/output totals return null, never zero. Cached/reasoning/image
 * tokens are subsets, not additions to billed input/output totals.
 */
export function usageCostMicroUsd(provider, usage) {
  const cfg = config(provider);
  const input = token(usage?.inputTokens), output = token(usage?.outputTokens);
  if (input === null || output === null) return null;
  const cached = token(usage.cachedInputTokens);
  const writes = token(usage.cacheWriteTokens);
  if ((cached !== null && cached > input) || (writes !== null && writes > input) || (cached !== null && writes !== null && cached + writes > input)) return null;
  if (provider === 'zai-ocr') return Math.ceil((input + output) * 0.03);
  if (provider === 'zai-vision') return Math.ceil((input - (cached ?? 0)) * 0.3 + (cached ?? 0) * 0.05 + output * 0.9);
  const long = input > 272000;
  const inputRate = cfg.inputRatePerMTok * (long ? 2 : 1);
  const outputRate = cfg.outputRatePerMTok * (long ? 1.5 : 1);
  const cacheRate = cfg.cachedInputRatePerMTok * (long ? 2 : 1);
  // Unknown writes cannot safely be treated as zero when a provider adds
  // implicit caching. Settlement intentionally overestimates in that case.
  const knownCached = cached ?? 0;
  const chargedWrites = writes ?? (input - knownCached);
  const uncached = input - knownCached - chargedWrites;
  return Math.ceil(uncached * inputRate + chargedWrites * inputRate * 1.25 + knownCached * cacheRate + output * outputRate);
}

/** Never copy a provider/network error message: it may echo authorization,
 * request content, a signed URL or a local path. Only fixed categories escape.
 */
export function safeProviderError(_error, { httpStatus = null } = {}) {
  const status = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
  const code = status === 401 || status === 403 ? 'authentication_or_access'
    : status === 429 ? 'rate_limit_or_quota'
      : status !== null && status >= 500 ? 'provider_unavailable'
        : status !== null && status >= 400 ? 'request_rejected' : 'provider_or_transport_error';
  return { code, httpStatus: status, message: 'Provider request did not complete; raw error details were omitted.' };
}

function jsonFromText(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function finish(value, allowed, fallback = 'unknown') {
  return allowed.includes(value) ? value : fallback;
}

/** Parse transport JSON only. The runner must separately validate json against
 * its page schema before accepting it. Raw reasoning text is never returned.
 * ok requires completed, non-refused, parseable JSON (Markdown for OCR).
 */
export function parseResponse(provider, payload, { httpStatus = 200 } = {}) {
  config(provider);
  const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const result = {
    ok: false, complete: false, status: 'failed', finishReason: null,
    text: '', json: null, schemaValidated: false,
    usage: normalizeUsage(provider, data.usage), figures: [], layout: [], error: null,
  };
  if (httpStatus < 200 || httpStatus >= 300 || data.error || data.code != null || !payload || typeof payload !== 'object') {
    result.error = safeProviderError(data.error, { httpStatus });
    return result;
  }
  if (isOpenAI(provider)) {
    const output = Array.isArray(data.output) ? data.output : [];
    const messages = output.filter(item => item?.type === 'message' && item.role === 'assistant');
    const parts = messages.flatMap(item => Array.isArray(item.content) ? item.content : []);
    const refused = parts.some(item => item?.type === 'refusal');
    result.text = parts.filter(item => item?.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('');
    // output_text is an SDK convenience but also supported in captured fixtures.
    if (!result.text && typeof data.output_text === 'string') result.text = data.output_text;
    result.status = finish(data.status, ['completed', 'failed', 'in_progress', 'cancelled', 'queued', 'incomplete']);
    result.finishReason = refused ? 'refusal' : finish(data.incomplete_details?.reason, ['max_output_tokens', 'content_filter'], result.status);
    result.complete = result.status === 'completed' && !refused && !messages.some(item => item.status && item.status !== 'completed');
    result.json = jsonFromText(result.text);
  } else if (provider === 'zai-vision') {
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const choice = choices[0] ?? {};
    result.text = typeof choice.message?.content === 'string' ? choice.message.content : '';
    result.finishReason = finish(choice.finish_reason, ['stop', 'length', 'tool_calls', 'content_filter', 'sensitive', 'network_error']);
    result.complete = choices.length === 1 && result.finishReason === 'stop';
    result.status = result.complete ? 'completed' : 'incomplete';
    result.json = jsonFromText(result.text);
  } else {
    result.text = typeof data.md_results === 'string' ? data.md_results : '';
    const pages = Array.isArray(data.layout_details) ? data.layout_details : [];
    result.layout = pages.map((blocks, page) => (Array.isArray(blocks) ? blocks : []).map((block, order) => ({
      page: page + 1, order, index: token(block?.index),
      type: finish(block?.label, ['image', 'text', 'formula', 'table']),
      text: typeof block?.content === 'string' ? block.content : '',
      bbox: Array.isArray(block?.bbox_2d) && block.bbox_2d.length === 4 && block.bbox_2d.every(n => Number.isFinite(n) && n >= 0 && n <= 1) ? [...block.bbox_2d] : null,
      width: token(block?.width), height: token(block?.height),
    })));
    result.figures = result.layout.flat().filter(block => block.type === 'image').map(block => ({
      page: block.page, index: block.index, bbox: block.bbox, reference: block.text,
    }));
    // No downloads or interpretation of returned figure URLs occur here.
    result.json = { markdown: result.text, pages: result.layout, figures: result.figures };
    result.complete = Boolean(result.text.trim() || result.layout.some(page => page.length));
    result.status = result.complete ? 'completed' : 'incomplete';
    result.finishReason = result.complete ? 'layout_returned' : 'missing_layout';
  }
  result.ok = result.complete && result.json !== null && (provider === 'zai-ocr' || (typeof result.json === 'object' && !Array.isArray(result.json)));
  if (!result.ok) result.error = {
    code: !result.complete ? 'incomplete_or_refused' : 'invalid_json',
    httpStatus, message: 'Response requires review; no complete validated page was accepted.',
  };
  return result;
}
