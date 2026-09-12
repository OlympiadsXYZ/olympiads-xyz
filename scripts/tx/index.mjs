#!/usr/bin/env node
// index.mjs [--all | --ids id,id] [--workers 4] [--dpi 100] [--max-pages 24] [--limit N] [--dry-run]
// Archive-wide problem inventory: for every catalogue entry of kind "competition"
// and type "problems" (all competitions, years, groups, languages) that is not
// already transcribed in content/problems, download the document, render it at
// a light dpi, ask GLM for an inventory (prompts/v1/index.md: printed
// masthead, one entry per problem with number, title, points, type, topics,
// summary) and write tmp/index/docs/<catalogue id>.json. Rendered pages are
// deleted afterwards; the PDF is kept only while it is being read. Resumable:
// an existing output is never redone. Costs are appended to tmp/index/runs.jsonl.
// index-merge.mjs then joins these rows with the transcribed papers.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs, fail, readJson, writeJson, loadPrompt, loadProviderKeys, PROVIDER_KEY_NAME, estimateCost, run, which, R2_REMOTE, ROOT, nowIso, sha256, existingPaperIndex, sleep } from './lib.mjs';

const require = createRequire(import.meta.url);
const { fetch: ufetch, Agent } = require('undici');

const args = parseArgs(process.argv.slice(2), { flags: ['all', 'dry-run', 'force'] });
if (!args.all && !args.ids) fail('usage: index.mjs --all | --ids a,b [--workers 4] [--dpi 100] [--max-pages 24] [--limit N] [--dry-run]');
for (const tool of ['rclone', 'pdftoppm', 'pdfinfo']) if (!which(tool)) fail(`${tool} not found on PATH`);
const WORKERS = Number(args.workers || 4), DPI = Number(args.dpi || 100), MAX_PAGES = Number(args['max-pages'] || 24);
const MODEL = args.model || 'glm-5.3-flash';
const OUT = path.join(ROOT, 'tmp', 'index');
const DOCS = path.join(OUT, 'docs'), WORK = path.join(OUT, 'work');
fs.mkdirSync(DOCS, { recursive: true }); fs.mkdirSync(WORK, { recursive: true });
const prompt = loadPrompt('index', 'v1');
const cfg = loadProviderKeys();
const key = cfg.keys[PROVIDER_KEY_NAME.zai];
if (!args['dry-run'] && !key) fail(`${PROVIDER_KEY_NAME.zai} is not set in ${cfg.file}`);
const agent = new Agent({ headersTimeout: 20 * 60_000, bodyTimeout: 20 * 60_000, connectTimeout: 60_000 });
const log = rec => fs.appendFileSync(path.join(OUT, 'runs.jsonl'), JSON.stringify({ at: nowIso(), ...rec }) + '\n');

// ---- what to index
let catalogue = [];
for (const f of fs.readdirSync(path.join(ROOT, 'archive-catalog')).filter(f => f.endsWith('.json') && f !== 'schema.json')) {
  const j = readJson(path.join(ROOT, 'archive-catalog', f), []);
  if (Array.isArray(j)) catalogue = catalogue.concat(j);
}
const transcribed = existingPaperIndex().byKey;
let docs = catalogue.filter(e => e.kind === 'competition' && e.type === 'problems' && !e.hidden);
if (args.ids) { const want = new Set(String(args.ids).split(',')); docs = docs.filter(e => want.has(e.id)); }
const plan = [];
let skippedTranscribed = 0, skippedDone = 0;
for (const e of docs) {
  if (transcribed.has(e.file)) { skippedTranscribed++; continue; }
  if (!args.force && fs.existsSync(path.join(DOCS, `${e.id}.json`))) { skippedDone++; continue; }
  plan.push(e);
}
if (args.limit) plan.length = Math.min(plan.length, Number(args.limit));
console.log(`${docs.length} problems documents in the catalogue; ${skippedTranscribed} transcribed (indexed from JSON), ${skippedDone} already indexed, ${plan.length} to do with ${WORKERS} workers`);
if (args['dry-run']) { console.log(plan.slice(0, 20).map(e => `${e.id}  ${e.lang}  ${e.file}`).join('\n')); process.exit(0); }

// ---- one document
let downloading = Promise.resolve(); // R2 downloads stay serial (the public base is rate-limited; keep the API side polite too)
const serialDownload = fn => { const p = downloading.then(fn, fn); downloading = p.catch(() => {}); return p; };
const b64 = f => fs.readFileSync(f).toString('base64');
const IMAGE_EXT = /\.(jpe?g|png)$/i;

async function indexOne(e) {
  const started = Date.now();
  const ext = path.extname(e.file).toLowerCase();
  const dir = path.join(WORK, e.id);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, `src${ext || '.bin'}`);
  try {
    await serialDownload(() => { run('rclone', ['copyto', `${R2_REMOTE}/${e.file}`, src]); });
    let pages = [];
    let pageCount = null, truncated = false;
    if (IMAGE_EXT.test(ext)) { pages = [src]; pageCount = 1; }
    else if (ext === '.pdf') {
      const info = run('pdfinfo', [src], { allowFail: true }).stdout || '';
      pageCount = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]) || null;
      if (!pageCount) throw new Error('pdfinfo could not read the file');
      const last = Math.min(pageCount, MAX_PAGES); truncated = pageCount > MAX_PAGES;
      run('pdftoppm', ['-r', String(DPI), '-f', '1', '-l', String(last), '-jpeg', '-jpegopt', 'quality=80', src, path.join(dir, 'p')]);
      pages = fs.readdirSync(dir).filter(f => /^p-?\d+\.jpg$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])).map(f => path.join(dir, f));
    } else throw new Error(`unsupported file type ${ext}`);
    if (!pages.length) throw new Error('no pages rendered');
    const context = [
      `DOCUMENT CONTEXT (from the archive catalogue; the printed page wins when they disagree):`,
      `- id: ${e.id}; subject: ${e.subject}; competition: ${e.competition}; catalogue year: ${e.year}; round: ${e.round ?? 'null'}; group: ${e.group ?? 'null'}; language: ${e.lang}`,
      `- title in the catalogue: ${e.title}`,
      `- file: ${e.file} (${pageCount} page(s)${truncated ? `, only the first ${MAX_PAGES} shown` : ''})`,
      `PAGE IMAGES, in order: ${pages.map((_, i) => `#${i + 1}`).join(', ')}.`,
      'Respond with the single JSON object only.',
    ].join('\n');
    const body = {
      model: MODEL, max_tokens: 16000, temperature: 0, reasoning_effort: 'low', response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        ...pages.map(f => ({ type: 'image_url', image_url: { url: `data:${/\.png$/i.test(f) ? 'image/png' : 'image/jpeg'};base64,${b64(f)}` } })),
        { type: 'text', text: `${prompt.text.trim()}\n\n${context}` },
      ] }],
    };
    let parsed = null, lastErr = null;
    for (let attempt = 1; attempt <= 3 && !parsed; attempt++) {
      try {
        const res = await ufetch('https://api.z.ai/api/paas/v4/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), dispatcher: agent });
        const text = await res.text();
        if (!res.ok) { lastErr = `HTTP ${res.status}: ${text.slice(0, 200)}`; if (res.status === 429 || res.status >= 500) { await sleep(20_000 * attempt); continue; } break; }
        const json = JSON.parse(text);
        const content = json.choices?.[0]?.message?.content || '';
        const first = content.indexOf('{'), last2 = content.lastIndexOf('}');
        let obj = null; try { obj = JSON.parse(content.slice(first, last2 + 1)); } catch (err) { lastErr = `bad JSON: ${err.message}`; continue; }
        parsed = { obj, usage: json.usage || {}, requestId: json.id || null };
      } catch (err) { lastErr = String(err.message || err); await sleep(15_000 * attempt); }
    }
    if (!parsed) throw new Error(lastErr || 'no reply');
    const inputTokens = parsed.usage.prompt_tokens ?? null, outputTokens = parsed.usage.completion_tokens ?? null;
    const costUsd = estimateCost(MODEL, inputTokens, outputTokens);
    const row = {
      id: e.id, subject: e.subject, competition: e.competition, year: e.year, round: e.round ?? null, group: e.group ?? null, lang: e.lang, type: e.type, file: e.file,
      pageCount, pagesShown: pages.length, truncated, sourceSha256: sha256(fs.readFileSync(src)),
      index: parsed.obj,
      tx: { provider: 'zai', model: MODEL, promptVersion: prompt.version, promptSha256: prompt.sha256, requestId: parsed.requestId, at: nowIso(), inputTokens, outputTokens, costUsd, dpi: DPI },
    };
    writeJson(path.join(DOCS, `${e.id}.json`), row);
    log({ id: e.id, ok: true, pages: pages.length, inputTokens, outputTokens, costUsd, seconds: Math.round((Date.now() - started) / 1000), problems: Array.isArray(parsed.obj.problems) ? parsed.obj.problems.length : null });
    return { id: e.id, ok: true, problems: parsed.obj.problems?.length ?? null, costUsd };
  } catch (err) {
    log({ id: e.id, ok: false, error: String(err.message || err).slice(0, 300), seconds: Math.round((Date.now() - started) / 1000) });
    return { id: e.id, ok: false, error: String(err.message || err) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- workers
let next = 0, done = 0, failed = 0, cost = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(WORKERS, plan.length) }, async () => {
  while (next < plan.length) {
    const e = plan[next++];
    const r = await indexOne(e);
    if (r.ok) { done++; cost += r.costUsd || 0; } else failed++;
    const n = done + failed;
    if (n % 10 === 0 || !r.ok) console.log(`[${n}/${plan.length}] ${r.ok ? 'ok' : 'FAIL'} ${e.id} ${r.ok ? `(${r.problems} problems)` : r.error.slice(0, 120)} — $${cost.toFixed(2)}, ${Math.round((Date.now() - t0) / 60000)} min`);
  }
}));
console.log(`done: ${done} indexed, ${failed} failed, $${cost.toFixed(2)} at list price, ${Math.round((Date.now() - t0) / 60000)} min`);
