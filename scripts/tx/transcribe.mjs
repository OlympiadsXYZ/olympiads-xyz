#!/usr/bin/env node
// transcribe.mjs <paperId> --provider anthropic|gemini|zai --model <m> --stage reader|checker
//   [--candidate f] [--dry-run] [--prompt-version v1] [--max-tokens N] [--reasoning low|high|max]
//   [--timeout-min 20] [--window-pages N] [--out f]
// Sends the rendered pages + prompt to a vision model over raw HTTPS and writes
// the JSON candidate (or checker output). Keys come from
// ~/.config/olympiads-xyz/providers.env — a file Margulan creates himself:
//   ANTHROPIC_API_KEY=...   GEMINI_API_KEY=...   ZAI_API_KEY=...
// Values are never printed. --dry-run validates the configuration, builds the
// exact payload and reports its size; it never fabricates model output.
//
// Checker isolation (Codex §4): the checker never receives the candidate file
// itself but lib.mjs:checkerView(candidate) — content plus figure document/page/
// box and problem source pages; the reader's notes, identity, cost and flags are
// stripped. The crops figures.mjs produced are attached as extra images so the
// checker judges the actual cut-out, not just four numbers.
//
// Long documents: --window-pages N splits each document into N-page windows with
// one page of overlap, one request per window, and assemble.mjs merges the parts
// by problem number (reader stage only).
//
// Transport: undici Agent with headers/body timeouts of --timeout-min (default
// 20; Node's default 5-minute headers timeout killed a 3-page GLM read), up to
// 3 attempts on 429/5xx/timeouts/network errors with 20 s·attempt backoff; every
// attempt is appended to tmp/tx/runs.jsonl.
// No SDKs: the repo forbids new npm dependencies; undici is already present.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  parseArgs, fail, readJson, writeJson, readManifest, loadPrompt, pageImages, pageWindows, windowBlock, windowLabel, contextBlock,
  candidateFile, checkFile, loadProviderKeys, PROVIDER_KEY_NAME, PROVIDER_LIMITS, TOKENS_PER_PAGE, estimateCost, appendRun, nowIso,
  checkerView, candidateCrops, sha256File, sha256, sleep, ROOT,
} from './lib.mjs';
import { assembleWindows } from './assemble.mjs';

const require = createRequire(import.meta.url);
const { fetch: ufetch, Agent } = require('undici');

const args = parseArgs(process.argv.slice(2), { flags: ['dry-run'] });
const paperId = args._[0];
const { provider, model, stage } = args;
if (!paperId || !['anthropic', 'gemini', 'zai'].includes(provider) || !model || !['reader', 'checker'].includes(stage)) {
  fail('usage: transcribe.mjs <paperId> --provider anthropic|gemini|zai --model <m> --stage reader|checker [--candidate f] [--dry-run] [--reasoning low|high|max] [--timeout-min 20] [--window-pages N] [--max-tokens N] [--out f]');
}
const dry = !!args['dry-run'];
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}; run prepare.mjs first`);
const prompt = loadPrompt(stage, args['prompt-version'] || 'v1');
const reasoning = args.reasoning || 'low';
if (!['low', 'high', 'max'].includes(reasoning)) fail('--reasoning must be low, high or max');
const timeoutMs = Math.max(1, Number(args['timeout-min'] || 20)) * 60 * 1000;
// Z.ai accepts 1..131072 and GLM readers routinely need >32k for a 6-page paper.
const maxTokens = Number(args['max-tokens'] || (provider === 'zai' ? 65536 : 32000));
const limits = PROVIDER_LIMITS[provider];
const MAX_ATTEMPTS = 3;

// ---- checker input: the sanitised view + crops (never the raw candidate)
let candidatePath = null, view = null, crops = [];
if (stage === 'checker') {
  if (!args.candidate) fail('--candidate is required for the checker stage');
  candidatePath = path.resolve(args.candidate);
  const candidate = readJson(candidatePath, null);
  if (!candidate) fail(`candidate not readable: ${candidatePath}`);
  view = checkerView(candidate);
  crops = candidateCrops(candidate, paperId);
  const missing = crops.filter(c => !c.exists);
  if (missing.length) fail(`${missing.length} figure crop(s) referenced by the candidate are missing on disk (${missing.map(c => c.id).join(', ')}); re-run figures.mjs`);
  writeJson(candidatePath.replace(/\.json$/, '') + '.view.json', view);
}
const windows = stage === 'reader' && args['window-pages'] ? pageWindows(manifest, Number(args['window-pages'])) : [null];
if (stage === 'checker' && args['window-pages']) console.error('note: --window-pages applies to the reader stage only; the checker always sees the whole paper');

const outFile = path.resolve(args.out || (stage === 'reader' ? candidateFile(paperId, provider, model) : checkFile(paperId, provider, model)));
const partFile = window => outFile.replace(/\.json$/, '') + `.window-${windowLabel(window)}.json`;
const b64 = f => fs.readFileSync(f).toString('base64');

function buildText(window, images) {
  const parts = [prompt.text.trim(), contextBlock(manifest)];
  const wb = windowBlock(manifest, window);
  if (wb) parts.push(wb);
  parts.push(`PAGE IMAGES, in order: ${images.filter(i => i.kind === 'page').map((i, k) => `#${k + 1} ${i.document} p.${i.page}`).join('; ')}.`);
  if (stage === 'checker') {
    const cropImgs = images.filter(i => i.kind === 'crop');
    if (cropImgs.length) parts.push(`FIGURE CROPS produced from the candidate's boxes, in order after the pages: ${cropImgs.map((i, k) => `crop #${k + 1} = figure "${i.id}" (${i.document} p.${i.page}, box ${JSON.stringify(i.bbox)})`).join('; ')}. Judge each crop itself: whole figure, nothing clipped, no swallowed body text.`);
    else parts.push('The candidate proposes no figures; verify that the pages indeed contain no figure a student needs.');
    parts.push('CANDIDATE TRANSCRIPTION (JSON, sanitised — the reader\'s notes and identity are withheld on purpose):\n' + JSON.stringify(view));
  }
  parts.push('Respond with the single JSON object only.');
  return parts.join('\n\n');
}

function buildRequest(images, userText) {
  const imgs = images.map(i => ({ file: i.file }));
  if (provider === 'anthropic') return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: key => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    body: {
      model, max_tokens: maxTokens, temperature: 0,
      system: 'You transcribe and verify competition papers. Output exactly one JSON object and nothing else.',
      messages: [{ role: 'user', content: [
        ...imgs.map(i => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(i.file) } })),
        { type: 'text', text: userText },
      ] }],
    },
    parse: (json, res) => ({
      text: (json.content || []).filter(b => b.type === 'text').map(b => b.text).join(''),
      inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null, reasoningTokens: null,
      requestId: res.headers.get('request-id') || json.id || null, stopReason: json.stop_reason || null,
    }),
  };
  if (provider === 'gemini') return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: key => ({ 'content-type': 'application/json', 'x-goog-api-key': key }),
    body: {
      contents: [{ role: 'user', parts: [
        ...imgs.map(i => ({ inline_data: { mime_type: 'image/png', data: b64(i.file) } })),
        { text: userText },
      ] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, temperature: 0 },
    },
    parse: (json, res) => ({
      text: (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''),
      inputTokens: json.usageMetadata?.promptTokenCount ?? null, outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
      reasoningTokens: json.usageMetadata?.thoughtsTokenCount ?? null,
      requestId: json.responseId || res.headers.get('x-request-id') || null, stopReason: json.candidates?.[0]?.finishReason || null,
    }),
  };
  return { // zai: OpenAI-compatible chat completions. thinking cannot be disabled
    // (code 1210); top-level reasoning_effort "low" measured 0 reasoning tokens.
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    headers: key => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    body: {
      model, max_tokens: maxTokens, temperature: 0, reasoning_effort: reasoning,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        ...imgs.map(i => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64(i.file)}` } })),
        { type: 'text', text: userText },
      ] }],
    },
    parse: (json, res) => ({
      text: json.choices?.[0]?.message?.content || '',
      inputTokens: json.usage?.prompt_tokens ?? null, outputTokens: json.usage?.completion_tokens ?? null,
      reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      requestId: json.id || res.headers.get('x-request-id') || null, stopReason: json.choices?.[0]?.finish_reason || null,
    }),
  };
}

const keyName = PROVIDER_KEY_NAME[provider];
const cfg = loadProviderKeys();
const hasKey = !!cfg.keys[keyName];
const redact = s => String(s).slice(0, 400).replace(/[A-Za-z0-9_-]{32,}/g, '…');
const agent = dry ? null : new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs, connectTimeout: 60_000 });
const retryable = (status, err) => (status && (status === 429 || status >= 500)) || (err && /TIMEOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|UND_ERR/i.test(String(err.code || err.cause?.code || err.message)));

async function send(req, label) {
  const body = JSON.stringify(req.body);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    let res, rawText, err = null;
    try {
      res = await ufetch(req.url, { method: 'POST', headers: req.headers(cfg.keys[keyName]), body, dispatcher: agent });
      rawText = await res.text();
    } catch (e) { err = e; }
    const seconds = +((Date.now() - started) / 1000).toFixed(1);
    const status = res?.status ?? null;
    if (!err && res.ok) {
      let json;
      try { json = JSON.parse(rawText); } catch { fail(`${provider} response was not JSON (${label})`); }
      const parsed = req.parse(json, res);
      parsed.seconds = seconds; parsed.attempts = attempt; parsed.status = status;
      return parsed;
    }
    const reason = err ? `${err.code || err.cause?.code || err.name}: ${redact(err.message)}` : `HTTP ${status}: ${redact(rawText)}`;
    appendRun({ paperId, stage, provider, model, window: label, ok: false, attempt, status, error: reason, seconds, at: nowIso() });
    const again = attempt < MAX_ATTEMPTS && retryable(status, err);
    console.error(`[transcribe] ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed after ${seconds}s — ${reason}${again ? '; retrying' : ''}`);
    if (!again) fail(`${provider} request failed (${label}): ${reason}`);
    await sleep(20_000 * attempt);
  }
}

function extractJson(text, rawFile, stopReason) {
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first < 0 || last < 0) { fs.writeFileSync(rawFile, text); fail(`no JSON object in the response (saved ${path.relative(ROOT, rawFile)}); stop reason ${stopReason}`); }
  try { return JSON.parse(t.slice(first, last + 1)); }
  catch (e) { fs.writeFileSync(rawFile, text); fail(`response JSON does not parse (${e.message}); raw text saved to ${path.relative(ROOT, rawFile)}. Stop reason ${stopReason} — if length/max_tokens, raise --max-tokens or use --window-pages`); }
}

const summaries = [];
const parts = [];
for (const window of windows) {
  const pages = pageImages(manifest, window);
  const missing = pages.filter(p => !fs.existsSync(p.file));
  if (missing.length) fail(`${missing.length} rendered page(s) missing; re-run prepare.mjs`);
  const images = [
    ...pages.map(p => ({ kind: 'page', document: p.document, page: p.page, file: p.file, bytes: fs.statSync(p.file).size })),
    ...crops.map(c => ({ kind: 'crop', id: c.id, document: c.document, page: c.page, bbox: c.bbox, file: c.file, bytes: fs.statSync(c.file).size })),
  ];
  const tooBig = images.filter(i => i.bytes > limits.imageBytes);
  if (tooBig.length) fail(`image(s) over ${provider}'s ${(limits.imageBytes / 1048576).toFixed(0)} MB limit: ${tooBig.map(i => path.basename(i.file)).join(', ')}`);
  if (images.length > limits.images) fail(`${images.length} images exceed ${provider}'s limit of ${limits.images} per request; use --window-pages`);
  const userText = buildText(window, images);
  const req = buildRequest(images, userText);
  const payloadBytes = Buffer.byteLength(JSON.stringify(req.body));
  if (payloadBytes > limits.requestBytes) fail(`payload ${(payloadBytes / 1048576).toFixed(1)} MB exceeds ${provider}'s ${(limits.requestBytes / 1048576).toFixed(0)} MB request cap; use --window-pages (reader) or lower the render dpi`);
  const label = windowLabel(window);
  const target = window ? partFile(window) : outFile;
  const approxInputTokens = Math.round(userText.length / 3.5) + images.length * (TOKENS_PER_PAGE[provider] || 1600);
  if (dry) {
    const summary = {
      dryRun: true, paperId, stage, provider, model, window: label, endpoint: req.url, keysFile: cfg.file, keysFileExists: cfg.exists, keyPresent: hasKey, keyName,
      images: images.map(i => ({ kind: i.kind, id: i.id, document: i.document, page: i.page, bytes: i.bytes })), promptVersion: prompt.version, promptSha256: prompt.sha256,
      payloadBytes, requestCapBytes: limits.requestBytes, approxInputTokens, tokensPerPageAssumed: TOKENS_PER_PAGE[provider], maxTokens, reasoning: provider === 'zai' ? reasoning : null, timeoutMin: timeoutMs / 60000,
      wouldWrite: target, estimatedCostUsd: estimateCost(model, approxInputTokens, Math.round(Math.min(maxTokens, 12000) / 2)),
      note: 'estimate uses unverified list prices, a measured 3,230 tokens/page for zai (guessed 1,600 for others) and a guessed output length; no request was sent',
    };
    summaries.push(summary);
    continue;
  }
  if (!cfg.exists) fail(`${cfg.file} does not exist; create it with ${keyName}=<key> (never commit it)`);
  if (!hasKey) fail(`${keyName} is not set in ${cfg.file}`);
  const parsed = await send(req, label);
  const costUsd = estimateCost(model, parsed.inputTokens, parsed.outputTokens);
  appendRun({ paperId, stage, provider, model, window: label, ok: true, attempts: parsed.attempts, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, reasoningTokens: parsed.reasoningTokens, costUsd, seconds: parsed.seconds, requestId: parsed.requestId, stopReason: parsed.stopReason, promptVersion: prompt.version, reasoning: provider === 'zai' ? reasoning : null, at: nowIso() });
  const obj = extractJson(parsed.text, target.replace(/\.json$/, '.raw.txt'), parsed.stopReason);
  const ident = { provider, model, promptVersion: prompt.version, promptSha256: prompt.sha256, requestId: parsed.requestId, at: nowIso(), inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, reasoningTokens: parsed.reasoningTokens, costUsd, seconds: parsed.seconds, attempts: parsed.attempts, ...(provider === 'zai' ? { reasoning } : {}) };
  if (stage === 'reader') obj.tx = { ...(obj.tx || {}), ...(window ? { window } : {}), reader: ident };
  else obj.checker = { ...ident, candidate: candidatePath, candidateSha256: sha256File(candidatePath), viewSha256: sha256(JSON.stringify(view)), crops: crops.map(c => c.id) };
  writeJson(target, obj);
  parts.push({ window, file: target, data: obj });
  summaries.push({ paperId, stage, provider, model, window: label, out: target, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, reasoningTokens: parsed.reasoningTokens, costUsd, seconds: parsed.seconds, attempts: parsed.attempts, requestId: parsed.requestId, stopReason: parsed.stopReason });
}

if (dry) {
  writeJson(outFile.replace(/\.json$/, '') + '.dryrun.json', summaries.length === 1 ? summaries[0] : { dryRun: true, paperId, stage, provider, model, windows: summaries });
  console.log(JSON.stringify(summaries.length === 1 ? summaries[0] : { dryRun: true, windows: summaries, totalPayloadBytes: summaries.reduce((a, s) => a + s.payloadBytes, 0), totalEstimatedCostUsd: +summaries.reduce((a, s) => a + (s.estimatedCostUsd || 0), 0).toFixed(4) }, null, 2));
  process.exit(0);
}
if (windows.length > 1) {
  const result = assembleWindows(parts.map(p => p.data), manifest);
  writeJson(outFile, result.data);
  console.log(JSON.stringify({ paperId, stage, provider, model, out: outFile, windows: summaries, assembly: result.report }, null, 2));
  if (!result.report.ok) { console.error(`[transcribe] assembly left problems: ${result.report.problems.join('; ')} — validate.mjs will fail until fixed`); process.exit(3); }
} else console.log(JSON.stringify(summaries[0], null, 2));
