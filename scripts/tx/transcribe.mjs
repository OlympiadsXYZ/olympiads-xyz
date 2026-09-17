#!/usr/bin/env node
// transcribe.mjs <paperId> --provider anthropic|gemini|zai --model <m> --stage reader|checker
//   [--candidate f] [--dry-run] [--prompt-version v1] [--max-tokens N] [--reasoning low|high|max]
//   [--timeout-min 20] [--window-pages N] [--out f] [--transport sync|batch]
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
//
// Batch transport (anthropic only; other providers ignore it): --transport batch, or
// TX_ANTHROPIC_TRANSPORT=batch in the environment so run.mjs/batch.mjs need no plumbing.
// send() then does not POST /v1/messages itself: it writes the exact request body to
// tmp/tx/anthropic-batch/queue/<customId>.json (+ a .meta.json sidecar) and polls every
// 5 s for tmp/tx/anthropic-batch/results/<customId>.json, which
// scripts/tx/anthropic-batch-broker.mjs (a separate long-running process) writes once
// the Message Batch has ended. The result file is the Message JSON as the sync API
// would return it, so parse() is unchanged; the Batch API bills 50%, and costUsd,
// runs.jsonl and the ident block record transport:'batch' with the batch id. Waits up to
// 6 × --timeout-min, at least 2 h; a rate-limit/overloaded/5xx/expired result is
// re-queued (new custom id) up to MAX_ATTEMPTS. ANTHROPIC_BASE_URL overrides the API
// host (tests run a fake server); TX_BATCH_POLL_MS shortens the poll (tests only).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  parseArgs, fail, readJson, writeJson, readManifest, loadPrompt, pageImages, pageWindows, windowBlock, windowLabel, contextBlock, sanitizeCandidate, repairJsonEscapes,
  candidateFile, checkFile, loadProviderKeys, PROVIDER_KEY_NAME, PROVIDER_LIMITS, TOKENS_PER_PAGE, estimateCost, appendRun, nowIso,
  checkerView, candidateCrops, sha256File, sha256, sleep, ROOT, pointerGet, normaliseCandidate, paperDir,
  ANTHROPIC_BASE_URL, BATCH_DIRS, batchCustomId, batchFiles, enqueueBatchRequest, waitForBatchResult, batchResultError, batchRequestState, brokerAlive,
} from './lib.mjs';
import { assembleWindows } from './assemble.mjs';
import { bindCheckerResult } from './evidence.mjs';
import { applyFixes } from './fixes.mjs';

const require = createRequire(import.meta.url);
const { fetch: ufetch, Agent } = require('undici');

const args = parseArgs(process.argv.slice(2), { flags: ['dry-run'] });
const paperId = args._[0];
const { provider, model, stage } = args;
if (!paperId || !['anthropic', 'gemini', 'zai', 'chatgpt'].includes(provider) || !model || !['reader', 'checker', 'refix'].includes(stage)) {
  fail('usage: transcribe.mjs <paperId> --provider anthropic|gemini|zai --model <m> --stage reader|checker|refix [--candidate f] [--defects repair-report.json] [--dry-run] [--reasoning low|high|max] [--timeout-min 20] [--window-pages N] [--max-tokens N] [--out f]');
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
// --transport batch (or TX_ANTHROPIC_TRANSPORT=batch): the Anthropic Message Batches handshake (header comment).
const transportAsked = String(args.transport || process.env.TX_ANTHROPIC_TRANSPORT || 'sync').toLowerCase();
if (!['sync', 'batch'].includes(transportAsked)) fail('--transport must be sync or batch');
const transport = provider === 'anthropic' ? transportAsked : 'sync';
if (args.transport === 'batch' && provider !== 'anthropic') console.error(`note: --transport batch applies to the anthropic provider only; ${provider} runs synchronously`);
const batch = transport === 'batch';
const costOf = (inputTokens, outputTokens) => estimateCost(model, inputTokens, outputTokens, undefined, { batch });

// ---- checker input: the sanitised view + crops (never the raw candidate)
let candidatePath = null, candidateHash = null, view = null, crops = [];
if (stage === 'checker') {
  if (!args.candidate) fail('--candidate is required for the checker stage');
  candidatePath = path.resolve(args.candidate);
  const candidateBytes = fs.readFileSync(candidatePath);
  const candidate = JSON.parse(candidateBytes.toString('utf8'));
  candidateHash = sha256(candidateBytes);
  if (!candidate) fail(`candidate not readable: ${candidatePath}`);
  view = checkerView(candidate);
  crops = candidateCrops(candidate, paperId);
  const missing = crops.filter(c => !c.exists);
  if (missing.length) fail(`${missing.length} figure crop(s) referenced by the candidate are missing on disk (${missing.map(c => c.id).join(', ')}); re-run figures.mjs`);
  writeJson(candidatePath.replace(/\.json$/, '') + '.view.json', view);
}
// ---- refix input: the current candidate and the defects the mechanical repair could not apply.
// Only the pages those defects live on are sent (defect.document/page, else the
// problem's source spans, else every page).
let refix = null;
if (stage === 'refix') {
  if (!args.candidate || !args.defects || !args.out) fail('--candidate, --defects <repair report or checker output> and --out are required for the refix stage');
  candidatePath = path.resolve(args.candidate);
  const candidate = readJson(candidatePath, null);
  if (!candidate) fail(`candidate not readable: ${candidatePath}`);
  const src = readJson(path.resolve(args.defects), null);
  const defects = (src?.unapplied || src?.defects || []).filter(d => d?.path && d.severity !== 'info');
  if (!defects.length) fail('no defects to refix');
  const wanted = new Set();
  for (const d of defects) {
    // the defect's own page, plus every page the problem spans in that document (a fix often needs the
    // page before or after the one the checker named: a formula on p.4 for a table that ends on p.6)
    if (d.document && d.page) wanted.add(`${d.document}#${d.page}`);
    // a checker's page for a figure is off by one now and then ("Figure 6 on p.4" printed on p.5): the neighbours come along
    if (d.document && d.page && d.kind === 'figure') for (const q of [d.page - 1, d.page + 1]) if (q >= 1 && q <= (manifest.documents[d.document]?.pages || 0)) wanted.add(`${d.document}#${q}`);
    const m = /^\/problems\/(\d+)(\/solution\b)?/.exec(d.path);
    const spans = m ? candidate.problems?.[Number(m[1])]?.tx?.sourceSpans : null;
    // the field's own document always comes along: a statement pasted from the solutions is attributed
    // to the solutions page by the checker, but only the problems page can say what is printed instead
    const fieldDoc = m && !m[2] ? 'problems' : (manifest.documents.solutions ? 'solutions' : 'problems');
    if (Array.isArray(spans) && spans.length) { for (const s of spans) if (!d.document || s.document === d.document || s.document === fieldDoc) wanted.add(`${s.document}#${s.page}`); }
    else if (!(d.document && d.page)) for (const p of pageImages(manifest)) wanted.add(`${p.document}#${p.page}`);
  }
  refix = { candidate, defects, wanted, round: Number(args.round || 1) };
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
  if (provider === 'chatgpt') {
    // the app gets the source PDFs (one attachment each, uploaded once per chat) instead of page images
    const docs = Object.entries(manifest.documents || {}).map(([doc, d]) => `${doc}.pdf = the ${doc} document (${d.pages} page${d.pages === 1 ? '' : 's'})`);
    parts.push(`ATTACHED DOCUMENTS (PDF; "problems p.N" / "solutions p.N" in this prompt are the pages of these files): ${docs.join('; ')}.${chatState.sameChat ? ' They were attached earlier in this conversation; use them.' : ''} Read the pages as printed (text and drawings), not only the extracted text.`);
  } else parts.push(`PAGE IMAGES, in order: ${images.filter(i => i.kind === 'page').map((i, k) => `#${k + 1} ${i.document} p.${i.page}`).join('; ')}.`);
  if (stage === 'checker') {
    parts.push(`Candidate bytes SHA-256 (copy as candidateSha256): ${candidateHash}`);
    const cropImgs = images.filter(i => i.kind === 'crop');
    if (cropImgs.length) parts.push(`FIGURE CROPS produced from the candidate's boxes${provider === 'chatgpt' ? ', on the attached sheet crops.png (one labelled tile each; the label is the crop number and the figure id)' : ', in order after the pages'}: ${cropImgs.map((i, k) => `crop #${k + 1} = figure "${i.id}" (${i.document} p.${i.page}, box ${JSON.stringify(i.bbox)})`).join('; ')}. Judge each crop itself: whole figure, nothing clipped, no swallowed body text.`);
    else parts.push('The candidate proposes no figures; verify that the pages indeed contain no figure a student needs.');
    parts.push('CANDIDATE TRANSCRIPTION (JSON, sanitised — the reader\'s notes and identity are withheld on purpose):\n' + JSON.stringify(view));
  }
  if (stage === 'refix') {
    // the current value goes whole: a clipped value comes back clipped (the model echoes the marker) and cuts the field
    const clip = v => { const s = JSON.stringify(v === undefined ? null : v); return s.length > 40000 ? s.slice(0, 40000) + '…(the value is longer than 40,000 characters; return null for this path)' : s; };
    parts.push('DEFECTS TO FIX (return one entry per path, in this order):\n' + refix.defects.map((d, i) => `${i + 1}. path ${d.path}\n   kind: ${d.kind || '?'}; severity: ${d.severity || '?'}${d.document ? `; on ${d.document} p.${d.page}` : ''}\n   defect: ${d.description || ''}\n   current value: ${clip(pointerGet(refix.candidate, d.path))}`).join('\n'));
  }
  parts.push('Respond with the single JSON object only.');
  return parts.join('\n\n');
}

// JPEG re-encode for providers with small request caps (Z.ai 20 MB). Cached as
// <name>.q80w1400.jpg next to the PNG; returns a new image descriptor.
function compressImage(i) {
  const out = i.file.replace(/\.png$/i, '') + '.q80w1400.jpg';
  if (!fs.existsSync(out)) {
    const py = "import sys; from PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB')\nw,h=im.size\nif w>1400: im=im.resize((1400, round(h*1400/w)), Image.LANCZOS)\nim.save(sys.argv[2],'JPEG',quality=80,optimize=True)";
    const r = spawnSync('python3', ['-c', py, i.file, out], { encoding: 'utf8' });
    if (r.status !== 0) fail(`could not re-encode ${path.basename(i.file)}: ${r.stderr.slice(0, 200)}`);
  }
  return { ...i, file: out, mime: 'image/jpeg', bytes: fs.statSync(out).size, original: i.file };
}

// Pixel size of a PNG (IHDR) or JPEG (first SOF marker) without decoding it; null when unreadable.
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xFF) { o++; continue; }
      const m = b[o + 1];
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { o += m === 0xFF ? 1 : 2; continue; }
      const len = b.readUInt16BE(o + 2);
      if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
      o += 2 + len;
    }
  }
  return null;
}
// Anthropic refuses a request of more than 20 images when any image exceeds 2000 px on a side (8000 px otherwise):
// a 160-dpi render of an oversized scanned page is 2,200 px tall. Downscaled to fit, cached as <name>.max<N>.jpg.
function fitImage(i, maxSide) {
  const out = i.file.replace(/\.(png|jpe?g)$/i, '') + `.max${maxSide}.jpg`;
  if (!fs.existsSync(out)) {
    const py = "import sys; from PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB')\nim.thumbnail((int(sys.argv[3]), int(sys.argv[3])), Image.LANCZOS)\nim.save(sys.argv[2],'JPEG',quality=85,optimize=True)";
    const r = spawnSync('python3', ['-c', py, i.file, out, String(maxSide)], { encoding: 'utf8' });
    if (r.status !== 0) fail(`could not downscale ${path.basename(i.file)}: ${r.stderr.slice(0, 200)}`);
  }
  return { ...i, file: out, mime: 'image/jpeg', bytes: fs.statSync(out).size, original: i.original || i.file };
}

// The ChatGPT app: files uploaded to a conversation stay available to its later messages, and every upload counts
// against the app's attachment cap (hit after ~65 files on 2026-09-13). So the PDFs go up once per chat and the
// paper's calls continue in that chat: one chat for the reader windows, another for the checker/refix rounds (the
// checker does not see the reader's conversation). State: tmp/tx/<id>/chatgpt-app/chat.json. Only one worker at a
// time may use the app (the "current chat" is whichever the last call left open).
const chatStateFile = path.join(paperDir(paperId), 'chatgpt-app', 'chat.json');
const chatGroup = stage === 'reader' ? 'reader' : 'check';
const chatState = { sameChat: false };
if (provider === 'chatgpt') { const st = readJson(chatStateFile, null); chatState.sameChat = !!(st && st.group === chatGroup && st.uploaded && st.paperId === paperId); }
function cropSheet(crops, stamp) {
  if (!crops.length) return null;
  const dir = path.join(paperDir(paperId), 'chatgpt-app'); fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${stamp}.crops.png`);
  const argv = [path.join(ROOT, 'scripts', 'tx', 'chatgpt-app', 'montage.py'), out];
  crops.forEach((c, k) => { argv.push(`#${k + 1} ${c.id} (${c.document} p.${c.page})`, c.file); });
  const r = spawnSync('python3', argv, { encoding: 'utf8' });
  if (r.status !== 0) fail(`crop sheet failed: ${r.stderr.slice(0, 300)}`);
  return out;
}
function appFiles(images) {
  const files = [];
  if (!chatState.sameChat) for (const [doc, d] of Object.entries(manifest.documents || {})) { const f = path.join(paperDir(paperId), d.file); if (fs.existsSync(f) && /\.pdf$/i.test(f)) { const named = path.join(paperDir(paperId), 'chatgpt-app', `${doc}.pdf`); fs.mkdirSync(path.dirname(named), { recursive: true }); fs.copyFileSync(f, named); files.push(named); } }
  const crops = images.filter(i => i.kind === 'crop');
  const sheet = cropSheet(crops, `${stage}-${Date.now()}`);
  if (sheet) files.push(sheet);
  return files;
}

function buildRequest(images, userText) {
  const imgs = images.map(i => ({ file: i.file, mime: i.mime || 'image/png' }));
  if (provider === 'chatgpt') return { // the ChatGPT desktop app, driven by scripts/tx/chatgpt-app/driver.ps1: files attached, prompt pasted, reply copied
    url: 'chatgpt-app://' + model, headers: () => ({}),
    body: { files: appFiles(images), sameChat: chatState.sameChat, text: 'You transcribe and verify competition papers. Reply with exactly one JSON object inside a ```json code block and nothing else.' + String.fromCharCode(10,10) + userText },
    parse: (json) => ({ text: json.text, inputTokens: null, outputTokens: null, reasoningTokens: null, requestId: json.chat ? `chat:${json.chat}` : null, stopReason: json.ok ? 'stop' : 'error' }),
  };
  if (provider === 'anthropic') return {
    url: `${ANTHROPIC_BASE_URL}/v1/messages`,
    headers: key => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    // Claude 5-generation models reject sampling parameters (temperature → 400) and think
    // adaptively by default; --reasoning maps to output_config.effort (transcription is
    // perception, so the reader runs at low effort; thinking tokens bill as output).
    body: {
      model, max_tokens: maxTokens,
      thinking: { type: 'adaptive' }, output_config: { effort: reasoning },
      system: 'You transcribe and verify competition papers. Output exactly one JSON object and nothing else.',
      messages: [{ role: 'user', content: [
        ...imgs.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: b64(i.file) } })),
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
        ...imgs.map(i => ({ inline_data: { mime_type: i.mime, data: b64(i.file) } })),
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
        ...imgs.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${b64(i.file)}` } })),
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

// One conversation at a time: the app has one composer. Workers of a batch queue on a lock file.
const APP_LOCK = path.join(ROOT, 'tmp', 'tx', 'chatgpt-app.lock');
async function withAppLock(fn) {
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  for (;;) {
    try { fs.writeFileSync(APP_LOCK, JSON.stringify({ pid: process.pid, at: nowIso() }), { flag: 'wx' }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = null; try { held = JSON.parse(fs.readFileSync(APP_LOCK, 'utf8')); } catch {}
      if (!held?.pid || !alive(held.pid)) { try { fs.unlinkSync(APP_LOCK); } catch {} continue; }
      await sleep(3000);
    }
  }
  try { return await fn(); } finally { try { if (JSON.parse(fs.readFileSync(APP_LOCK, 'utf8')).pid === process.pid) fs.unlinkSync(APP_LOCK); } catch {} }
}
async function sendViaApp(req, label) {
  const dir = path.join(paperDir(paperId), 'chatgpt-app');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = `${stage}-${label}-${Date.now()}`.replace(/[^a-z0-9_-]/gi, '_');
  const promptFile = path.join(dir, `${stamp}.prompt.txt`), listFile = path.join(dir, `${stamp}.files.txt`), outFile = path.join(dir, `${stamp}.reply.md`);
  fs.writeFileSync(promptFile, req.body.text);
  fs.writeFileSync(listFile, req.body.files.join(String.fromCharCode(10)));
  return withAppLock(async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'tx', 'chatgpt-app', 'driver.ps1'), '-PromptFile', promptFile, '-FileList', listFile, '-OutFile', outFile, '-TimeoutSec', String(Math.round(timeoutMs / 1000))];
      if (req.body.sameChat) { argv.push('-SameChat'); const st = readJson(chatStateFile, null); if (st?.chat) argv.push('-ExpectChat', st.chat); }
      const r = spawnSync('powershell', argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      const seconds = +((Date.now() - started) / 1000).toFixed(1);
      let summary = null; try { summary = JSON.parse((r.stdout || '').trim().split(String.fromCharCode(10)).filter(Boolean).pop() || 'null'); } catch {}
      if (r.status === 0 && summary?.ok && fs.existsSync(outFile)) {
        writeJson(chatStateFile, { paperId, group: chatGroup, uploaded: true, chat: summary.chat || null, at: nowIso() });
        chatState.sameChat = true; // the next window of this run continues in the chat that now holds the PDFs
        const text = fs.readFileSync(outFile, 'utf8');
        return { ...req.parse({ ok: true, text, chat: summary.chat }), seconds, attempts: attempt, status: 200, replySeconds: summary.replySeconds };
      }
      const reason = summary?.error || (r.stderr || '').trim().split(String.fromCharCode(10)).slice(-2).join(' | ').slice(0, 300) || `driver exit ${r.status}`;
      // whatever went wrong, the next attempt starts a fresh chat with the PDFs again
      if (req.body.sameChat) { try { fs.unlinkSync(chatStateFile); } catch {} chatState.sameChat = false; req.body.sameChat = false; req.body.files = appFiles(images); fs.writeFileSync(listFile, req.body.files.join(String.fromCharCode(10))); }
      if (/limit for file attachments/i.test(reason)) fail(`ChatGPT app: ${reason} (the app's attachment cap; wait for the reset it names)`);
      if (/stayed locked/i.test(reason)) fail(`ChatGPT app: ${reason} (unlock the PC and resume the job)`);
      appendRun({ paperId, stage, provider, model, window: label, ok: false, attempt, error: reason, seconds, at: nowIso() });
      const again = attempt < MAX_ATTEMPTS;
      console.error(`[transcribe] ${label} attempt ${attempt}/${MAX_ATTEMPTS} through the ChatGPT app failed after ${seconds}s — ${reason}${again ? '; retrying' : ''}`);
      if (!again) fail(`ChatGPT app request failed (${label}): ${reason}`);
      await sleep(15_000 * attempt);
    }
  });
}

// Batch transport: queue the body for anthropic-batch-broker.mjs and wait for its result file. A request still
// in queue/ when this process gives up or dies is withdrawn (nothing paid); one already submitted stays in its
// batch and its result lands in results/ unclaimed (the retry has a fresh custom id).
const queuedHere = new Set();
const withdrawQueued = () => { for (const id of queuedHere) { const f = batchFiles(id); for (const file of [f.body, f.meta]) { try { fs.unlinkSync(file); } catch {} } } queuedHere.clear(); };
if (batch && !dry) {
  process.on('exit', withdrawQueued);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { withdrawQueued(); process.exit(130); });
}
async function sendViaBatch(req, label) {
  const body = JSON.stringify(req.body);
  const pollMs = Math.max(200, Number(process.env.TX_BATCH_POLL_MS) || 5000);
  const waitMs = Math.max(2 * 3600 * 1000, timeoutMs * 6);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const customId = batchCustomId(paperId, stage, label, body);
    const started = Date.now();
    enqueueBatchRequest(customId, body, { paperId, stage, window: label, model, createdAt: nowIso(), attempt, pid: process.pid });
    queuedHere.add(customId);
    console.error(`[transcribe] ${label}: queued ${(Buffer.byteLength(body) / 1048576).toFixed(1)} MB for the Anthropic batch broker as ${customId}; waiting up to ${(waitMs / 3600000).toFixed(1)} h for ${path.relative(ROOT, batchFiles(customId).result)}`);
    let lastNote = 0;
    const result = await waitForBatchResult(customId, { pollMs, timeoutMs: waitMs, onWait: elapsed => {
      if (elapsed - lastNote < 10 * 60 * 1000) return;
      lastNote = elapsed;
      console.error(`[transcribe] ${label}: still waiting after ${Math.round(elapsed / 60000)} min (${batchRequestState(customId)}${brokerAlive() ? '' : '; NO BROKER RUNNING — start node scripts/tx/anthropic-batch-broker.mjs'})`);
    } });
    const seconds = +((Date.now() - started) / 1000).toFixed(1);
    if (!result) {
      const state = batchRequestState(customId);
      const reason = `no batch result after ${(seconds / 3600).toFixed(2)} h (${state}${brokerAlive() ? '' : '; no broker running'})`;
      withdrawQueued(); // only removes it when it is still queued
      appendRun({ paperId, stage, provider, model, transport, window: label, ok: false, attempt, customId, error: reason, seconds, at: nowIso() });
      fail(`${provider} batch request timed out (${label}): ${reason}${state === 'queued' ? '; the queued request was withdrawn' : state.startsWith('submitted') ? '; the request stays in its batch and its result will be ignored' : ''}`);
    }
    queuedHere.delete(customId);
    const err = batchResultError(result);
    const batchId = result.batch?.id || null;
    if (!err) {
      const parsed = req.parse(result, { headers: { get: () => null } }); // no HTTP headers here: requestId falls back to the message id
      parsed.seconds = seconds; parsed.attempts = attempt; parsed.status = 200; parsed.batchId = batchId; parsed.customId = customId;
      return parsed;
    }
    const reason = `batch ${batchId || '?'} ${result.batch?.resultType || 'errored'}: ${redact(JSON.stringify(result.error))}`;
    appendRun({ paperId, stage, provider, model, transport, window: label, ok: false, attempt, customId, batchId, error: reason, seconds, at: nowIso() });
    const again = attempt < MAX_ATTEMPTS && err.retryable;
    console.error(`[transcribe] ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed after ${seconds}s — ${reason}${again ? '; re-queueing' : ''}`);
    if (!again) fail(`${provider} batch request failed (${label}): ${reason}`);
    await sleep(5_000);
  }
}

async function send(req, label) {
  if (provider === 'chatgpt') return sendViaApp(req, label);
  if (batch) return sendViaBatch(req, label);
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

let jsonRepaired = null;
// soft: return null instead of failing (the caller asks the model once more)
function extractJson(text, rawFile, stopReason, soft = false) {
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  const saveRaw = () => { fs.mkdirSync(path.dirname(rawFile), { recursive: true }); fs.writeFileSync(rawFile, text); };
  if (first < 0 || last < 0) { saveRaw(); if (soft) return null; fail(`no JSON object in the response (saved ${path.relative(ROOT, rawFile)}); stop reason ${stopReason}`); }
  try { return JSON.parse(t.slice(first, last + 1)); }
  catch (e) {
    // Models occasionally leave one LaTeX backslash un-escaped (\' or \, inside a
    // JSON string). Repair only invalid escapes — \X where X is not one of "\/bfnrtu —
    // and retry; the candidate is flagged so the checker knows a repair happened.
    let repaired = repairJsonEscapes(t.slice(first, last + 1));
    // A checker once wrote `"text".replace("a", "б")` in a string position (a homoglyph fix as code): keep the literal.
    repaired = repaired.replace(/("(?:[^"\\]|\\.)*")\.replace\((?:"(?:[^"\\]|\\.)*"|'[^']*')\s*,\s*(?:"(?:[^"\\]|\\.)*"|'[^']*')\)/g, '$1');
    try { const v = JSON.parse(repaired); jsonRepaired = e.message; console.error(`[transcribe] JSON needed escape repair: ${e.message}`); return v; } catch {}
    saveRaw(); if (soft) return null; fail(`response JSON does not parse (${e.message}); raw text saved to ${path.relative(ROOT, rawFile)}. Stop reason ${stopReason} — if length/max_tokens, raise --max-tokens or use --window-pages`); }
}

const summaries = [];
const parts = [];
for (const window of windows) {
  const pages = pageImages(manifest, window).filter(p => !refix || refix.wanted.has(`${p.document}#${p.page}`));
  const missing = pages.filter(p => !fs.existsSync(p.file));
  if (missing.length) fail(`${missing.length} rendered page(s) missing; re-run prepare.mjs`);
  // A long paper with many figures can exceed the provider's image cap (izho-2023-theory-multi: 106): the pages
  // come first, crops fill what is left; when the pages alone exceed it, only the pages the candidate spans go.
  let pageList = provider === 'chatgpt' ? [] : pages, cropList = crops, imagesLeftOut = 0; // the app reads the PDFs themselves
  if (pageList.length + cropList.length > limits.images) {
    const src = view || refix?.candidate; // the checker's sanitised view keeps each problem's source pages
    if (pageList.length > limits.images && src) {
      const spanned = new Set((src.problems || []).flatMap(pr => (pr.tx?.sourceSpans || pr.sourceSpans || []).map(s => `${s.document}#${s.page}`)));
      if (spanned.size) pageList = pageList.filter(p => spanned.has(`${p.document}#${p.page}`));
    }
    const room = Math.max(0, limits.images - pageList.length);
    imagesLeftOut = Math.max(0, cropList.length - room);
    cropList = cropList.slice(0, room);
    if (imagesLeftOut) console.error(`[transcribe] ${imagesLeftOut} crop image(s) left out to stay under ${provider}'s ${limits.images}-image cap`);
    crops = cropList;
  }
  const images = [
    ...pageList.map(p => ({ kind: 'page', document: p.document, page: p.page, file: p.file, bytes: fs.statSync(p.file).size })),
    ...cropList.map(c => ({ kind: 'crop', id: c.id, document: c.document, page: c.page, bbox: c.bbox, file: c.file, bytes: fs.statSync(c.file).size })),
  ];
  // A single rasterised page can exceed the per-image cap on its own (a 160-dpi
  // PNG of a scanned page); re-encode just those as JPEG before sizing the payload.
  for (let k = 0; k < images.length; k++) if (images[k].bytes > limits.imageBytes) images[k] = compressImage(images[k]);
  const tooBig = images.filter(i => i.bytes > limits.imageBytes);
  if (tooBig.length) fail(`image(s) over ${provider}'s ${(limits.imageBytes / 1048576).toFixed(0)} MB limit even as JPEG: ${tooBig.map(i => path.basename(i.file)).join(', ')}`);
  if (images.length > limits.images) fail(`${images.length} images exceed ${provider}'s limit of ${limits.images} per request; use --window-pages`);
  if (provider === 'anthropic') {
    const maxSide = images.length > 20 ? 2000 : 8000;
    for (let k = 0; k < images.length; k++) { const s = imageSize(images[k].file); if (s && (s.w > maxSide || s.h > maxSide)) images[k] = fitImage(images[k], maxSide); }
  }
  const userText = buildText(window, images);
  let req = buildRequest(images, userText);
  let payloadBytes = Buffer.byteLength(JSON.stringify(req.body));
  let imagesCompressed = false;
  if (payloadBytes > limits.requestBytes) {
    // Over the provider's request cap: re-encode every image as JPEG (max 1400 px wide, q80)
    // and rebuild. Cached beside the originals; the model sees the same pages, smaller.
    const small = images.map(compressImage);
    const req2 = buildRequest(small, userText);
    const bytes2 = Buffer.byteLength(JSON.stringify(req2.body));
    console.error(`[transcribe] payload ${(payloadBytes / 1048576).toFixed(1)} MB over ${provider}'s cap; re-encoded ${small.length} images as JPEG -> ${(bytes2 / 1048576).toFixed(1)} MB`);
    req = req2; payloadBytes = bytes2; imagesCompressed = true; images.splice(0, images.length, ...small);
  }
  if (payloadBytes > limits.requestBytes) fail(`payload ${(payloadBytes / 1048576).toFixed(1)} MB exceeds ${provider}'s ${(limits.requestBytes / 1048576).toFixed(0)} MB request cap; use --window-pages (reader) or lower the render dpi`);
  const label = windowLabel(window);
  const target = window ? partFile(window) : outFile;
  const approxInputTokens = Math.round(userText.length / 3.5) + images.length * (TOKENS_PER_PAGE[provider] || 1600);
  if (dry) {
    const summary = {
      dryRun: true, paperId, stage, provider, model, window: label, endpoint: req.url, ...(batch ? { transport, batchQueue: path.relative(ROOT, BATCH_DIRS.queue) } : {}), keysFile: cfg.file, keysFileExists: cfg.exists, keyPresent: hasKey, keyName,
      images: images.map(i => ({ kind: i.kind, id: i.id, document: i.document, page: i.page, bytes: i.bytes })), promptVersion: prompt.version, promptSha256: prompt.sha256,
      payloadBytes, requestCapBytes: limits.requestBytes, approxInputTokens, tokensPerPageAssumed: TOKENS_PER_PAGE[provider], maxTokens, reasoning: provider === 'zai' || provider === 'anthropic' ? reasoning : null, timeoutMin: timeoutMs / 60000,
      wouldWrite: target, estimatedCostUsd: costOf(approxInputTokens, Math.round(Math.min(maxTokens, 12000) / 2)),
      note: `estimate uses unverified list prices${batch ? ' at the Batch API\'s 50%' : ''}, a measured 3,230 tokens/page for zai (guessed 1,600 for others) and a guessed output length; no request was sent`,
    };
    summaries.push(summary);
    continue;
  }
  if (provider !== 'chatgpt') {
    if (!cfg.exists) fail(`${cfg.file} does not exist; create it with ${keyName}=<key> (never commit it)`);
    if (!hasKey) fail(`${keyName} is not set in ${cfg.file}`);
  }
  // A model occasionally answers with prose or truncated JSON; one more ask is far cheaper than a lost paper.
  let parsed = null, obj = null, costUsd = 0;
  for (let ask = 1; ask <= 2 && !obj; ask++) {
    parsed = await send(req, label);
    costUsd = costOf(parsed.inputTokens, parsed.outputTokens);
    appendRun({ paperId, stage, provider, model, ...(batch ? { transport, batchId: parsed.batchId, customId: parsed.customId } : {}), window: label, ok: true, imagesCompressed, attempts: parsed.attempts, ask, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, reasoningTokens: parsed.reasoningTokens, costUsd, seconds: parsed.seconds, requestId: parsed.requestId, stopReason: parsed.stopReason, promptVersion: prompt.version, reasoning: provider === 'zai' || provider === 'anthropic' ? reasoning : null, at: nowIso() });
    obj = extractJson(parsed.text, target.replace(/\.json$/, '.raw.txt'), parsed.stopReason, ask < 2);
    if (!obj) console.error(`[transcribe] ${label}: no usable JSON in the reply (raw text saved); asking once more`);
  }
  const ident = { provider, model, promptVersion: prompt.version, promptSha256: prompt.sha256, requestId: parsed.requestId, at: nowIso(), inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, reasoningTokens: parsed.reasoningTokens, costUsd, seconds: parsed.seconds, attempts: parsed.attempts, ...(provider === 'zai' || provider === 'anthropic' ? { reasoning } : {}), ...(batch ? { transport, batchId: parsed.batchId, customId: parsed.customId } : {}) };
  if (stage === 'refix') {
    const responseFile = target.replace(/\.json$/, '') + '.response.json';
    writeJson(responseFile, { ...ident, fixes: obj.fixes ?? null });
    const problemsText = (() => { const d = manifest.documents?.problems; if (!d?.text) return null; try { return fs.readFileSync(path.join(paperDir(paperId), d.text), 'utf8'); } catch { return null; } })();
    const result = applyFixes(refix.candidate, obj.fixes, { defects: refix.defects, round: refix.round, by: `${provider}:${model} refix`, requestId: parsed.requestId, problemsText });
    writeJson(target, sanitizeCandidate(normaliseCandidate(refix.candidate, { solutionsDocument: !!manifest.documents?.solutions, documents: Object.keys(manifest.documents || {}) })));
    console.log(JSON.stringify({ paperId, stage, provider, model, out: target, responseFile, applied: result.applied.length, skipped: result.skipped.length, changes: result.applied, unapplied: result.skipped, figuresToRedo: result.figuresToRedo, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, costUsd, requestId: parsed.requestId }, null, 2));
    process.exit(result.skipped.length ? 3 : 0);
  }
  if (stage === 'reader') obj.tx = { ...(obj.tx || {}), ...(window ? { window } : {}), reader: ident };
  else Object.assign(obj, bindCheckerResult(obj, { ...ident, candidate: candidatePath, candidateSha256: candidateHash, viewSha256: sha256(JSON.stringify(view)), crops: crops.map(c => c.id) }));
  if (jsonRepaired && obj?.tx?.reader) obj.tx.reader.jsonRepaired = jsonRepaired;
  writeJson(target, stage === 'reader' ? sanitizeCandidate(normaliseCandidate(obj, { solutionsDocument: !!manifest.documents?.solutions, documents: Object.keys(manifest.documents || {}) })) : obj);
  parts.push({ window, file: target, data: obj });
  summaries.push({ paperId, stage, provider, model, ...(batch ? { transport, batchId: parsed.batchId, customId: parsed.customId } : {}), window: label, out: target, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, reasoningTokens: parsed.reasoningTokens, costUsd, seconds: parsed.seconds, attempts: parsed.attempts, requestId: parsed.requestId, stopReason: parsed.stopReason });
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
