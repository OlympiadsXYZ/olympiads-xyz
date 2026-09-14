import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PAGE_SCHEMA, assertAllowedEndpoint, prepareImages, buildRequest,
  buildRequestFromPaths, parseResponse, requestBudget,
  usageCostMicroUsd, safeProviderError,
} from '../tx/pilot-providers.mjs';

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfocAAAAASUVORK5CYII=', 'base64');
const image = () => ({ mime: 'image/png', bytes });
const options = () => ({ images: [image()], prompt: 'Препиши формулата $x^2$.', maxOutputTokens: 16000 });
const page = { schemaVersion: 1, blocks: [], uncertainties: [], normalizations: [] };
const openaiResponse = (extra = {}) => ({
  status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(page) }] }],
  usage: { input_tokens: 5000, output_tokens: 1000, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 200 }, output_tokens_details: { reasoning_tokens: 300 }, total_tokens: 6000 },
  ...extra,
});

test('OpenAI image request is stateless, capped, strict JSON and credential-free', () => {
  const opts = options();
  opts.apiKey = 'sk-never-use-this-option';
  const request = buildRequest('openai', opts);
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.model, 'gpt-5.6-luna');
  assert.equal(request.body.max_output_tokens, 16000);
  assert.equal(request.body.store, false);
  assert.equal(request.body.service_tier, 'default');
  assert.equal(request.body.reasoning.effort, 'none');
  assert.equal(request.body.input[0].content[0].type, 'input_image');
  assert.equal(request.body.input[0].content[0].detail, 'high');
  assert.match(request.body.input[0].content[0].image_url, /^data:image\/png;base64,/);
  assert.deepEqual(request.body.text.format.schema, PAGE_SCHEMA);
  assert.equal(request.body.text.format.strict, true);
  assert.equal(request.credential.envVar, 'OPENAI_API_KEY');
  assert.deepEqual(request.headers, { 'Content-Type': 'application/json' });
  assert.doesNotMatch(JSON.stringify(request), /sk-never-use/);
  assert.equal(request.imageMetadata[0].sha256.length, 64);
  assert.equal(opts.images[0].bytes, bytes);
});

test('GLM vision uses capped chat schema and embeds JSON schema without unsupported response_format', () => {
  const request = buildRequest('zai-vision', options());
  assert.equal(request.body.model, 'glm-4.6v');
  assert.equal(request.body.max_tokens, 16000);
  assert.equal(request.body.thinking.type, 'disabled');
  assert.equal(request.body.response_format, undefined);
  assert.match(request.body.messages[0].content[1].text, /"schemaVersion"/);
  assert.equal(request.credential.keyConfigName, 'ZAI_API_KEY');
  assert.equal(request.budget.hardBoundAvailable, true);
});

test('Luna low reasoning changes only its effort, preserving the total output cap and budget', () => {
  const none = buildRequest('openai', { ...options(), reasoningEffort: 'none' });
  const low = buildRequest('openai', { ...options(), reasoningEffort: 'low' });
  assert.equal(low.body.reasoning.effort, 'low');
  assert.equal(low.body.max_output_tokens, 16000);
  assert.deepEqual(low.budget, none.budget);
  low.body.reasoning.effort = 'none';
  assert.deepEqual(low, none);
  assert.deepEqual(buildRequest('openai', options()), none);
});

test('Terra shares the Responses contract and credentials while retaining its own model and budget', () => {
  const luna = buildRequest('openai', { ...options(), reasoningEffort: 'low' });
  const terra = buildRequest('openai-terra', { ...options(), reasoningEffort: 'low' });
  assert.equal(terra.body.model, 'gpt-5.6-terra');
  assert.equal(terra.body.reasoning.effort, 'low');
  assert.deepEqual(terra.credential, luna.credential);
  assert.deepEqual(terra.imageMetadata, luna.imageMetadata);
  assert.equal(terra.url, luna.url);
  assert.equal(terra.budget.maxInputTokens, 1050000);
  assert.equal(terra.budget.maxOutputTokens, 16000);
  assert.equal(terra.budget.maxCostMicroUsd, 5538000);
  assert.equal(terra.budget.imageInputTokensUpper, 3001);
  assert.equal(terra.budget.inputRatePerMTokUpper, 5);
  assert.equal(terra.budget.outputRatePerMTokUpper, 18);
  terra.body.model = luna.body.model;
  assert.deepEqual(terra.body, luna.body);
  assert.equal(buildRequest('openai-terra', options()).body.reasoning.effort, 'none');
  assert.throws(() => buildRequest('openai-terra', { ...options(), reasoningEffort: 'high' }), /not allowlisted/);
  assert.throws(() => buildRequest('openai-terra', { ...options(), model: 'gpt-5.6-luna' }), /not allowlisted/);
  assert.throws(() => buildRequest('openai-sol', options()), /Unsupported/);
  assert.throws(() => assertAllowedEndpoint('openai-terra', 'https://api.openai.com/v1/responses?x=1'), /not allowlisted/);
});

test('Terra parses Responses usage and settles its own normal, long-input and cache-write prices', () => {
  const result = parseResponse('openai-terra', openaiResponse());
  assert.equal(result.ok, true);
  assert.deepEqual(result.json, page);
  assert.equal(result.usage.inputTokens, 5000);
  assert.equal(result.usage.reasoningTokens, 300);
  assert.equal(usageCostMicroUsd('openai-terra', result.usage), 21920);
  assert.equal(usageCostMicroUsd('openai-terra', { inputTokens: 1000, outputTokens: 1000 }), 14500);
  assert.equal(usageCostMicroUsd('openai-terra', { inputTokens: 272000, outputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0 }), 556000);
  assert.equal(usageCostMicroUsd('openai-terra', { inputTokens: 300000, outputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0 }), 1218000);
  assert.equal(usageCostMicroUsd('openai-terra', { inputTokens: 1050000, outputTokens: 16000 }), 5538000);
  assert.equal(usageCostMicroUsd('openai-terra', { inputTokens: 100 }), null);
  assert.equal(parseResponse('openai-terra', openaiResponse({ status: 'incomplete' })).ok, false);
});

test('reasoning allowlist rejects other Luna modes and any enabled reasoning for Z.ai', () => {
  for (const effort of ['medium', 'high', 'xhigh', 'max', '', null, 0, 'sk-private-invalid-mode']) {
    assert.throws(() => buildRequest('openai', { ...options(), reasoningEffort: effort }), e => /not allowlisted/.test(e.message) && !e.message.includes('sk-private'));
  }
  for (const provider of ['zai-vision', 'zai-ocr']) {
    assert.throws(() => buildRequest(provider, { ...options(), reasoningEffort: 'low' }), /not allowlisted/);
    assert.deepEqual(buildRequest(provider, { ...options(), reasoningEffort: 'none' }), buildRequest(provider, options()));
  }
});

test('GLM OCR is inspectable but has no fabricated prompt, output cap or budget bound', () => {
  const request = buildRequest('zai-ocr', options());
  assert.equal(request.url, 'https://api.z.ai/api/paas/v4/layout_parsing');
  assert.equal(request.body.model, 'glm-ocr');
  assert.equal(request.body.max_tokens, undefined);
  assert.equal(request.body.max_output_tokens, undefined);
  assert.equal(request.body.prompt, undefined);
  assert.equal(request.body.return_crop_images, true);
  assert.equal(request.budget.hardBoundAvailable, false);
  assert.equal(request.budget.maxCostMicroUsd, null);
});

test('model and endpoint allowlists reject confusion and exfiltration targets', () => {
  assert.throws(() => buildRequest('mistral', options()), /Unsupported/);
  assert.throws(() => buildRequest('openai', { ...options(), model: 'gpt-6-astra' }), /not allowlisted/);
  for (const url of ['http://api.openai.com/v1/responses', 'https://api.openai.com.evil.test/v1/responses', 'https://api.openai.com/v1/responses?key=secret', 'https://user:pass@api.openai.com/v1/responses', 'https://api.z.ai/api/paas/v4/chat/completions']) {
    assert.throws(() => assertAllowedEndpoint('openai', url), /not allowlisted/);
  }
});

test('request input validation rejects missing images, invalid types and excessive output', () => {
  assert.throws(() => buildRequest('openai', { ...options(), images: [] }), /one page/);
  assert.throws(() => buildRequest('openai', { ...options(), images: [image(), image()] }), /one page/);
  assert.throws(() => buildRequest('openai', { ...options(), images: [{ path: 'secret/path.png', mime: 'image/png' }] }), /Prepare/);
  assert.throws(() => buildRequest('openai', { ...options(), images: [{ mime: 'image/png', bytes: Buffer.from('text') }] }), /signature/);
  assert.throws(() => buildRequest('openai', { ...options(), images: [{ mime: 'application/pdf', bytes }] }), /PNG or JPEG/);
  assert.throws(() => buildRequest('zai-vision', { ...options(), maxOutputTokens: 32769 }), /token limit/);
  assert.throws(() => buildRequest('openai', { ...options(), maxOutputTokens: NaN }), /token limit/);
  assert.throws(() => buildRequest('openai', { ...options(), jsonSchema: null }), /schema/);
});

test('local image wrapper reads bytes without modifying source and sanitizes filesystem errors', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-provider-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'page.png');
  await fs.writeFile(file, bytes);
  const prepared = await prepareImages([{ path: file, mime: 'image/png' }]);
  assert.equal(prepared[0].sha256, buildRequest('openai', options()).imageMetadata[0].sha256);
  const request = await buildRequestFromPaths('openai', { ...options(), images: [{ path: file, mime: 'image/png' }] });
  assert.doesNotMatch(JSON.stringify(request.body), /pilot-provider-/);
  assert.deepEqual(await fs.readFile(file), bytes);
  await assert.rejects(prepareImages([{ path: path.join(dir, 'secret-key-name'), mime: 'image/png' }]), e => !e.message.includes('secret-key-name'));
  await assert.rejects(prepareImages([{ path: 'https://example.com/page.png', mime: 'image/png' }]), /local/);
});

test('hard reservations cover full context, cache writes, images and output, not averages', () => {
  const luna = requestBudget('openai', 16000);
  assert.equal(luna.maxCostMicroUsd, 553800);
  assert.equal(luna.maxInputTokens, 1050000);
  assert.equal(luna.imageInputTokensUpper, 3001);
  const glm = requestBudget('zai-vision', 16000);
  assert.equal(glm.maxInputTokens, 131072);
  assert.equal(glm.maxCostMicroUsd, 53722);
  assert.ok(requestBudget('openai', 32000).maxCostMicroUsd > luna.maxCostMicroUsd);
});

test('OpenAI parser preserves usage breakdown without double-counting reasoning or inventing image tokens', () => {
  const result = parseResponse('openai', openaiResponse());
  assert.equal(result.ok, true);
  assert.deepEqual(result.json, page);
  assert.equal(result.schemaValidated, false);
  assert.equal(result.usage.inputTokens, 5000);
  assert.equal(result.usage.outputTokens, 1000);
  assert.equal(result.usage.reasoningTokens, 300);
  assert.equal(result.usage.imageInputTokens, null);
  assert.equal(usageCostMicroUsd('openai', result.usage), 2192);
});

test('incomplete, refusal and invalid JSON cannot be accepted even when some text exists', () => {
  const incomplete = parseResponse('openai', openaiResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  assert.equal(incomplete.ok, false);
  assert.deepEqual(incomplete.json, page);
  assert.equal(incomplete.finishReason, 'max_output_tokens');
  const refused = parseResponse('openai', openaiResponse({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'private text' }] }] }));
  assert.equal(refused.ok, false);
  assert.equal(refused.finishReason, 'refusal');
  const invalid = parseResponse('openai', openaiResponse({ output: [], output_text: '```json\n{}\n```' }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'invalid_json');
  const unknown = parseResponse('openai', {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.usage.inputTokens, null);
});

test('GLM vision completion statuses and token details normalize consistently', () => {
  const payload = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(page), reasoning_content: 'private reasoning' } }], usage: { prompt_tokens: 3000, completion_tokens: 1000, prompt_tokens_details: { cached_tokens: 1000 }, completion_tokens_details: { reasoning_tokens: 500 } } };
  const result = parseResponse('zai-vision', payload);
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /private reasoning/);
  assert.equal(usageCostMicroUsd('zai-vision', result.usage), 1550);
  payload.choices[0].finish_reason = 'length';
  assert.equal(parseResponse('zai-vision', payload).ok, false);
});

test('GLM layout returns ordered text/formulas and figure references without fetching', () => {
  const result = parseResponse('zai-ocr', {
    md_results: '# Задача\n$x^2$',
    layout_details: [[
      { index: 1, label: 'text', content: 'Задача', bbox_2d: [0, 0, 1, 0.1], width: 100, height: 200 },
      { index: 2, label: 'formula', content: 'x^2', bbox_2d: [0, 0.1, 1, 0.2] },
      { index: 3, label: 'image', content: 'https://example.test/fig.png', bbox_2d: [0.1, 0.2, 0.7, 0.8] },
    ]],
    usage: { prompt_tokens: 1000, completion_tokens: 2000 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.layout[0][1].type, 'formula');
  assert.equal(result.figures[0].reference, 'https://example.test/fig.png');
  assert.deepEqual(result.figures[0].bbox, [0.1, 0.2, 0.7, 0.8]);
  assert.equal(usageCostMicroUsd('zai-ocr', result.usage), 90);
  assert.equal(parseResponse('zai-ocr', {}).ok, false);
});

test('raw provider and network error messages never escape sanitized errors', () => {
  const secret = 'Bearer sk-secret-api-key';
  for (const status of [401, 403, 429, 500, 400]) {
    const result = parseResponse('openai', { error: { message: secret, code: secret } }, { httpStatus: status });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /sk-secret/);
    assert.equal(result.error.httpStatus, status);
  }
  assert.doesNotMatch(JSON.stringify(safeProviderError(new Error(secret))), /sk-secret/);
});

test('billing fails closed for missing totals and invalid overlapping categories', () => {
  assert.equal(usageCostMicroUsd('openai', { inputTokens: 100 }), null);
  assert.equal(usageCostMicroUsd('zai-vision', { inputTokens: -1, outputTokens: 0 }), null);
  assert.equal(usageCostMicroUsd('openai', { inputTokens: 100, outputTokens: 1, cachedInputTokens: 90, cacheWriteTokens: 20 }), null);
  assert.equal(usageCostMicroUsd('openai', { inputTokens: 1000, outputTokens: 1000 }), 1450);
  assert.equal(usageCostMicroUsd('openai', { inputTokens: 300000, outputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0 }), 121800);
  assert.equal(usageCostMicroUsd('zai-vision', { inputTokens: 0, outputTokens: 0 }), 0);
});
