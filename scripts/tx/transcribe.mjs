#!/usr/bin/env node
// transcribe.mjs <paperId> --provider anthropic|gemini|zai --model <m> --stage reader|checker [--candidate f] [--dry-run] [--prompt-version v1] [--max-tokens N]
// Sends the rendered pages + prompt to a vision model over raw HTTPS and writes
// the JSON candidate (or checker output). Keys come from
// ~/.config/olympiads-xyz/providers.env — a file Margulan creates himself:
//   ANTHROPIC_API_KEY=...   GEMINI_API_KEY=...   ZAI_API_KEY=...
// Values are never printed. --dry-run validates the configuration, builds the
// exact payload and reports its size; it never fabricates model output.
// No SDKs: the repo forbids new npm dependencies, so each adapter is a small
// fetch() against the provider's documented HTTP endpoint.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, fail, readJson, writeJson, readManifest, loadPrompt, pageImages, contextBlock, candidateFile,
  loadProviderKeys, PROVIDER_KEY_NAME, estimateCost, appendRun, nowIso, paperDir, safeLabel,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['dry-run'] });
const paperId = args._[0];
const { provider, model, stage } = args;
if (!paperId || !['anthropic', 'gemini', 'zai'].includes(provider) || !model || !['reader', 'checker'].includes(stage)) fail('usage: transcribe.mjs <paperId> --provider anthropic|gemini|zai --model <m> --stage reader|checker [--candidate f] [--dry-run]');
const dry = !!args['dry-run'];
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}; run prepare.mjs first`);
const pages = pageImages(manifest);
const missing = pages.filter(p => !fs.existsSync(p.file));
if (missing.length) fail(`${missing.length} rendered page(s) missing; re-run prepare.mjs`);
const prompt = loadPrompt(stage, args['prompt-version'] || 'v1');
let candidateText = null;
if (stage === 'checker') {
  if (!args.candidate) fail('--candidate is required for the checker stage');
  candidateText = fs.readFileSync(path.resolve(args.candidate), 'utf8');
}
const maxTokens = Number(args['max-tokens'] || 32000);

// ---- payload (provider-neutral first)
const images = pages.map(p => ({ document: p.document, page: p.page, file: p.file, bytes: fs.statSync(p.file).size }));
const tooBig = images.filter(i => i.bytes > 5 * 1024 * 1024);
if (tooBig.length) fail(`page images over 5 MB: ${tooBig.map(i => path.basename(i.file)).join(', ')} — lower the render dpi or split the document`);
const textParts = [prompt.text.trim(), contextBlock(manifest)];
textParts.push(`PAGE IMAGES, in order: ${images.map((i, k) => `#${k + 1} ${i.document} p.${i.page}`).join('; ')}.`);
if (stage === 'checker') textParts.push('CANDIDATE TRANSCRIPTION (JSON):\n' + candidateText);
textParts.push('Respond with the single JSON object only.');
const userText = textParts.join('\n\n');
const b64 = f => fs.readFileSync(f).toString('base64');

function buildRequest() {
  if (provider === 'anthropic') return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: key => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    body: {
      model, max_tokens: maxTokens,
      system: 'You transcribe and verify competition papers. Output exactly one JSON object and nothing else.',
      messages: [{ role: 'user', content: [
        ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(i.file) } })),
        { type: 'text', text: userText },
      ] }],
    },
    parse: (json, res) => ({
      text: (json.content || []).filter(b => b.type === 'text').map(b => b.text).join(''),
      inputTokens: json.usage?.input_tokens ?? null, outputTokens: json.usage?.output_tokens ?? null,
      requestId: res.headers.get('request-id') || json.id || null, stopReason: json.stop_reason || null,
    }),
  };
  if (provider === 'gemini') return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: key => ({ 'content-type': 'application/json', 'x-goog-api-key': key }),
    body: {
      contents: [{ role: 'user', parts: [
        ...images.map(i => ({ inline_data: { mime_type: 'image/png', data: b64(i.file) } })),
        { text: userText },
      ] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, temperature: 0 },
    },
    parse: (json, res) => ({
      text: (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''),
      inputTokens: json.usageMetadata?.promptTokenCount ?? null, outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
      requestId: json.responseId || res.headers.get('x-request-id') || null, stopReason: json.candidates?.[0]?.finishReason || null,
    }),
  };
  return { // zai: OpenAI-compatible chat completions
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    headers: key => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    body: {
      model, max_tokens: maxTokens, temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        ...images.map(i => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64(i.file)}` } })),
        { type: 'text', text: userText },
      ] }],
    },
    parse: (json, res) => ({
      text: json.choices?.[0]?.message?.content || '',
      inputTokens: json.usage?.prompt_tokens ?? null, outputTokens: json.usage?.completion_tokens ?? null,
      requestId: json.id || res.headers.get('x-request-id') || null, stopReason: json.choices?.[0]?.finish_reason || null,
    }),
  };
}

const req = buildRequest();
const keyName = PROVIDER_KEY_NAME[provider];
const cfg = loadProviderKeys();
const hasKey = !!cfg.keys[keyName];
const outFile = stage === 'reader' ? candidateFile(paperId, provider, model) : path.join(paperDir(paperId), 'checks', `${safeLabel(provider)}__${safeLabel(model)}.json`);
const payloadBytes = Buffer.byteLength(JSON.stringify(req.body));
const approxInputTokens = Math.round(userText.length / 3.5) + images.length * 1600; // rough: ~1.6k tokens per A4 page image
if (dry) {
  const summary = {
    dryRun: true, paperId, stage, provider, model, endpoint: req.url, keysFile: cfg.file, keysFileExists: cfg.exists, keyPresent: hasKey, keyName,
    images: images.map(i => ({ document: i.document, page: i.page, bytes: i.bytes })), promptVersion: prompt.version, promptSha256: prompt.sha256,
    payloadBytes, approxInputTokens, maxTokens, wouldWrite: outFile,
    estimatedCostUsd: estimateCost(model, approxInputTokens, Math.round(maxTokens / 3)), note: 'estimate uses unverified list prices and a guessed output length; no request was sent',
  };
  writeJson(outFile.replace(/\.json$/, '.dryrun.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
if (!cfg.exists) fail(`${cfg.file} does not exist; create it with ${keyName}=<key> (never commit it)`);
if (!hasKey) fail(`${keyName} is not set in ${cfg.file}`);

const started = Date.now();
const res = await fetch(req.url, { method: 'POST', headers: req.headers(cfg.keys[keyName]), body: JSON.stringify(req.body) });
const seconds = +((Date.now() - started) / 1000).toFixed(1);
const rawText = await res.text();
if (!res.ok) {
  appendRun({ paperId, stage, provider, model, ok: false, status: res.status, seconds, at: nowIso() });
  fail(`${provider} returned HTTP ${res.status}: ${rawText.slice(0, 400).replace(/[A-Za-z0-9_-]{32,}/g, '…')}`);
}
let json;
try { json = JSON.parse(rawText); } catch { fail('provider response was not JSON'); }
const parsed = req.parse(json, res);
const costUsd = estimateCost(model, parsed.inputTokens, parsed.outputTokens);
appendRun({ paperId, stage, provider, model, ok: true, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, costUsd, seconds, requestId: parsed.requestId, stopReason: parsed.stopReason, promptVersion: prompt.version, at: nowIso() });

// extract the JSON object (tolerate a stray code fence)
let text = parsed.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
const first = text.indexOf('{'), last = text.lastIndexOf('}');
if (first < 0 || last < 0) { fs.writeFileSync(outFile.replace(/\.json$/, '.raw.txt'), parsed.text); fail(`no JSON object in the response (saved raw text); stop reason ${parsed.stopReason}`); }
let obj;
try { obj = JSON.parse(text.slice(first, last + 1)); } catch (e) { fs.writeFileSync(outFile.replace(/\.json$/, '.raw.txt'), parsed.text); fail(`response JSON does not parse (${e.message}); raw text saved. Stop reason ${parsed.stopReason} — if max_tokens, raise --max-tokens`); }
if (stage === 'reader') {
  obj.tx = { ...(obj.tx || {}), reader: { provider, model, promptVersion: prompt.version, promptSha256: prompt.sha256, requestId: parsed.requestId, at: nowIso(), inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, costUsd } };
} else {
  obj.checker = { provider, model, promptVersion: prompt.version, requestId: parsed.requestId, at: nowIso(), inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, costUsd, candidate: path.resolve(args.candidate) };
}
writeJson(outFile, obj);
console.log(JSON.stringify({ paperId, stage, provider, model, out: outFile, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, costUsd, seconds, requestId: parsed.requestId, stopReason: parsed.stopReason }, null, 2));
