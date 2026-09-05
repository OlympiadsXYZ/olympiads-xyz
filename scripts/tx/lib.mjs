// Shared helpers for the scripted transcription pipeline (scripts/tx).
// Everything here is pure plumbing: paths, hashing, paper-id derivation,
// schema compilation, math-span detection and the deterministic serialisation
// that receipt.mjs and promote.mjs must agree on byte-for-byte.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TX_DIR = path.join(ROOT, 'tmp', 'tx');
export const CONTENT_DIR = path.join(ROOT, 'content', 'problems');
export const SCHEMA_FILE = path.join(CONTENT_DIR, 'schema.json');
export const BACKLOG_FILE = path.join(ROOT, 'tmp', 'shards', 'all.json');
export const RUNS_FILE = path.join(TX_DIR, 'runs.jsonl');
export const JOBS_FILE = path.join(TX_DIR, 'jobs.json');
export const PRICES_FILE = path.join(ROOT, 'scripts', 'tx', 'prices.json');
export const PROMPTS_DIR = path.join(ROOT, 'scripts', 'tx', 'prompts');
export const KEYS_FILE = path.join(os.homedir(), '.config', 'olympiads-xyz', 'providers.env');
export const R2_REMOTE = 'r2:olympiads-archive';
export const R2_PUBLIC = 'https://pub-43290baaaff14857b5dd59610ea438c7.r2.dev';
export const RENDER_DPI = 160;
export const FIGURE_DPI = 300;
export const PDFCROP = path.join(ROOT, 'scripts', 'pdfcrop.py');

export const nowIso = () => new Date().toISOString();
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const sha256File = file => sha256(fs.readFileSync(file));
export const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
export function writeJson(file, value, indent = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.partial`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, indent) + '\n');
  fs.renameSync(tmp, file);
}
export const paperDir = paperId => path.join(TX_DIR, paperId);
export const manifestFile = paperId => path.join(paperDir(paperId), 'manifest.json');
export const readManifest = paperId => readJson(manifestFile(paperId), null);

// ---------------------------------------------------------------- CLI args
export function parseArgs(argv, { flags = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (flags.includes(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) out[key] = true;
      else out[key] = argv[++i];
    } else out._.push(a);
  }
  return out;
}
export function fail(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

// ---------------------------------------------------------------- shell
export function run(cmd, args, { input, maxBuffer = 64 * 1024 * 1024, allowFail = false, cwd = ROOT } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${(r.stderr || '').slice(0, 2000)}`);
  return r;
}
export const which = cmd => spawnSync('which', [cmd], { encoding: 'utf8' }).status === 0;

// ---------------------------------------------------------------- paper ids
// Replicates the id vocabulary the previous agent workflows settled on:
//   <comp>-<printed year>-<round token>-<grade token>
//   round token: ESF -> esenno, PSF -> proletno, NOF/NAO -> roman numeral lower-cased
//   grade token: digits/ranges as printed ("9", "11-12"), special groups lower-cased
//   ("sp", "st", "ml"); NAO IV practical papers -> "prakt" + group ("praktml");
//   grade-less papers take a slug of the archive file name ("obs", "exp-var1").
// Examples: psf-2026-proletno-12, nao-2016-iii-11-12, esf-2013-esenno-9,
// nof-2014-ii-7, nao-2024-iv-praktml.
export function derivePaperId(entry) {
  const comp = String(entry.competition).toLowerCase();
  let roundTok = null;
  if (comp === 'esf') roundTok = 'esenno';
  else if (comp === 'psf') roundTok = 'proletno';
  else if (entry.round) roundTok = String(entry.round).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const base = path.basename(entry.problemsKey || '', '.pdf').toLowerCase();
  let gradeTok;
  if (entry.grade) {
    gradeTok = String(entry.grade).toLowerCase().replace(/\s*[–—-]\s*/g, '-').replace(/[^a-z0-9-]+/g, '');
    if (comp === 'nao' && /^(ml|st)$/.test(gradeTok) && /prak/.test(base)) gradeTok = `prakt${gradeTok}`;
  } else if (/nabl|obs/.test(base)) {
    gradeTok = 'obs' + (/map/.test(base) ? '-maps' : '');
  } else {
    gradeTok = base.replace(/(problems?|zad|prob|tema|noa\d?_\d{4}_?|nof\d?_\d{4}_?|proletni_\d{4}_?|esenni_\d{4}_?)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
  }
  return [comp, entry.year, roundTok, gradeTok].filter(Boolean).join('-');
}
export const loadBacklog = () => readJson(BACKLOG_FILE, []);
export function findContentFile(paperId) {
  const stack = [CONTENT_DIR];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === `${paperId}.json`) return p;
    }
  }
  return null;
}
// Resolve archive keys and catalogue metadata for a paper id: explicit overrides
// win, then an already-transcribed paper's own source block, then the backlog.
export function resolvePaper(paperId, { problems, solutions } = {}) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(paperId)) throw new Error(`unsafe paper id: ${paperId}`);
  let meta = null, keys = { problems: problems || null, solutions: solutions || null }, origin = null;
  const existing = findContentFile(paperId);
  if (existing) {
    const p = readJson(existing).paper;
    meta = { competition: p.competition, year: p.year, round: p.round ?? null, grade: p.grade ?? null, subject: p.subject, lang: p.lang };
    keys.problems ||= p.source?.archiveKey || null;
    keys.solutions ||= p.solutionSource?.archiveKey || null;
    origin = path.relative(ROOT, existing);
  }
  if (!meta || !keys.problems) {
    const hit = loadBacklog().find(e => derivePaperId(e) === paperId);
    if (hit) {
      meta ||= { competition: hit.competition, year: hit.year, round: hit.round ?? null, grade: hit.grade ?? null, subject: hit.subject, lang: hit.lang || 'bg' };
      keys.problems ||= hit.problemsKey || null;
      keys.solutions ||= hit.solutionsKey || null;
      origin ||= 'tmp/shards/all.json';
    }
  }
  if (!meta) {
    const m = /^([a-z]+)-(\d{4})-/.exec(paperId);
    if (!m) throw new Error(`cannot derive metadata for ${paperId}; pass --problems/--solutions`);
    meta = { competition: m[1].toUpperCase(), year: Number(m[2]), round: null, grade: null, subject: m[1] === 'nao' ? 'astronomy' : 'physics', lang: 'bg' };
    origin ||= 'paper-id';
  }
  if (!keys.problems) throw new Error(`no problems key known for ${paperId}; pass --problems <archive key>`);
  return { paperId, meta, keys, origin, existingFile: existing };
}
export const contentPathFor = (paperId, meta) => path.join(CONTENT_DIR, meta.subject, meta.competition, String(meta.year), `${paperId}.json`);

// ---------------------------------------------------------------- schema
export function loadSchema() {
  const s = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  delete s.$schema; // ajv 6 speaks draft-07; the schema uses nothing beyond it ($defs is resolved as a plain pointer)
  return s;
}
// mode 'final'     : the schema as committed.
// mode 'candidate' : additionally tolerates the "tx" working block on the paper,
//                    on problems and on figures, and lets a figure omit url/width/
//                    height until figures.mjs has cropped and uploaded it.
export function compileSchema(mode = 'final') {
  const Ajv = require('ajv');
  const schema = loadSchema();
  if (mode === 'candidate') {
    schema.properties.tx = { type: 'object' };
    schema.$defs.problem.properties.tx = { type: 'object' };
    schema.$defs.figure.properties.tx = { type: 'object' };
    schema.$defs.figure.required = ['id'];
    schema.$defs.problem.properties.sourceSpans ||= { type: 'array' };
  }
  const ajv = new Ajv({ allErrors: true, jsonPointers: true, schemaId: 'auto' });
  return { validate: ajv.compile(schema), schema };
}
export function schemaSupports(schema, pointer) {
  return pointer.split('/').filter(Boolean).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), schema) !== undefined;
}

// ---------------------------------------------------------------- text & math
// Same split as mdText() in scripts/problems-to-site.mjs: odd segments are math.
export const MATH_SPLIT = /(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/;
export function splitMath(text) {
  return String(text).split(MATH_SPLIT).map((seg, i) => ({ text: seg, math: i % 2 === 1 }));
}
export function mathSpans(text) {
  return splitMath(text).filter(s => s.math).map(s => {
    const display = s.text.startsWith('$$');
    return { display, raw: s.text, inner: display ? s.text.slice(2, -2) : s.text.slice(1, -1) };
  });
}
export const proseOnly = text => splitMath(text).filter(s => !s.math).map(s => s.text).join(' ');
// Walk every string field of a paper with its JSON pointer-ish path.
export function walkStrings(value, cb, p = '') {
  if (typeof value === 'string') cb(p, value);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, cb, `${p}/${i}`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walkStrings(v, cb, `${p}/${k}`);
}
// Every figure in a paper with the path to it and which text it belongs to.
export function allFigures(data) {
  const out = [];
  (data.problems || []).forEach((pr, i) => {
    (pr.figures || []).forEach((f, j) => out.push({ fig: f, path: `/problems/${i}/figures/${j}`, problem: pr }));
    (pr.parts || []).forEach((pt, k) => (pt.figures || []).forEach((f, j) => out.push({ fig: f, path: `/problems/${i}/parts/${k}/figures/${j}`, problem: pr })));
    ((pr.solution || {}).figures || []).forEach((f, j) => out.push({ fig: f, path: `/problems/${i}/solution/figures/${j}`, problem: pr }));
  });
  return out;
}
export function stripTx(value) {
  if (Array.isArray(value)) return value.map(stripTx);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (k !== 'tx') out[k] = stripTx(v);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------- canonicalisation
// Mirrors scripts/normalise-papers.mjs exactly so that the bytes we hash in the
// receipt are the bytes normalise leaves on disk. Keep the two in step.
const ROUND_MAP = [
  [/^(I|1)\b.*(общин)/iu, 'I кръг (общински)'],
  [/^(II|2)\b.*(областен|regional|обл)/iu, 'II кръг (областен)'],
  [/^(III|3)\b.*(национал|national|нац)/iu, 'III кръг (национален)'],
  [/^(IV|4)\b/u, 'IV кръг'],
  [/^I кръг$/u, 'I кръг (общински)'], [/^II кръг$/u, 'II кръг (областен)'], [/^III кръг$/u, 'III кръг (национален)'],
  [/^общински/iu, 'I кръг (общински)'], [/^областен/iu, 'II кръг (областен)'], [/^национален/iu, 'III кръг (национален)'], [/^(финал|финален)/iu, 'IV кръг'],
];
export function canonRound(r) {
  if (r == null) return r;
  const s = String(r).trim();
  for (const [re, out] of ROUND_MAP) if (re.test(s)) return out;
  return s;
}
export function canonGrade(g) {
  if (g == null) return g;
  return String(g).trim().replace(/\s*(клас|кл\.?|class)\s*$/iu, '').replace(/\s*[–—-]\s*/g, '-').replace(/\.$/, '');
}
const SAFE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export function canonProblemIds(d) {
  const pid = d.paper.id;
  (d.problems ?? []).forEach((pr, i) => {
    const id = typeof pr.id === 'string' ? pr.id : '';
    if (id.startsWith(`${pid}-`) && SAFE.test(id)) return;
    let suffix;
    if (SAFE.test(id) && !id.startsWith(pid)) suffix = id;
    else if (Number.isInteger(pr.number)) suffix = `p${pr.number}`;
    else suffix = `p${i + 1}`;
    pr.id = `${pid}-${suffix}`;
  });
}
export const serialisePaper = data => JSON.stringify(data, null, 1) + '\n';

// Build the exact paper promote.mjs writes: strip the working block, hoist
// what the committed schema can hold, stamp provenance, canonicalise.
// `prov` = { provider, model, promptVersion, at, verifiedBy, verifiedAt, notes, sourceSha256 }.
export function buildFinalPaper(candidate, prov, schema = loadSchema()) {
  const data = stripTx(candidate);
  const paper = data.paper;
  const txPaper = candidate.tx || {};
  const problemProps = schema.$defs?.problem?.properties || {};
  (candidate.problems || []).forEach((src, i) => {
    const spans = src.tx?.sourceSpans;
    if (spans && problemProps.sourceSpans) data.problems[i].sourceSpans = spans.map(s => ({ document: s.document, page: s.page, ...(s.pdfRect ? { pdfRect: s.pdfRect } : {}) }));
  });
  // figure.source.document exists only in the extended schema; drop it otherwise
  const sourceProps = schema.$defs?.figure?.properties?.source?.properties || {};
  for (const { fig } of allFigures(data)) {
    if (fig.source && fig.source.document && !sourceProps.document) delete fig.source.document;
    for (const k of Object.keys(fig)) if (!schema.$defs?.figure?.properties?.[k]) delete fig[k];
  }
  const trProps = schema.properties?.paper?.properties?.transcription?.properties || {};
  const methods = schema.properties?.paper?.properties?.transcription?.properties?.method?.enum || [];
  const full = {
    method: methods.includes('vision-pages') ? 'vision-pages' : 'vision',
    provider: prov.provider,
    model: prov.model,
    promptVersion: prov.promptVersion,
    at: prov.at,
    renderDpi: RENDER_DPI,
    figureDpi: FIGURE_DPI,
    sourceSha256: prov.sourceSha256,
    verifiedBy: prov.verifiedBy ?? null,
    verifiedAt: prov.verifiedAt ?? null,
    notes: [txPaper.notes, prov.notes].filter(Boolean).join(' ') || undefined,
  };
  const transcription = {};
  const dropped = [];
  for (const [k, v] of Object.entries(full)) {
    if (v === undefined) continue;
    if (trProps[k]) transcription[k] = v; else dropped.push(k);
  }
  if (dropped.length) {
    // The committed schema cannot hold these yet; keep them human-readable in notes
    // so nothing is lost, and let the receipt carry the machine copy.
    const extra = dropped.map(k => `${k}=${typeof full[k] === 'object' ? JSON.stringify(full[k]) : full[k]}`).join('; ');
    transcription.notes = [transcription.notes, `[tx] ${extra}`].filter(Boolean).join(' ');
  }
  paper.transcription = transcription;
  paper.status = 'review';
  if (txPaper.caveat && !paper.caveat && schema.properties?.paper?.properties?.caveat) paper.caveat = txPaper.caveat;
  paper.grade = canonGrade(paper.grade);
  paper.round = canonRound(paper.round);
  canonProblemIds(data);
  const bytes = Buffer.from(serialisePaper(data), 'utf8');
  return { data, bytes, contentHash: sha256(bytes), droppedTranscriptionFields: dropped };
}

// ---------------------------------------------------------------- providers & cost
export function loadProviderKeys() {
  const keys = {};
  if (!fs.existsSync(KEYS_FILE)) return { file: KEYS_FILE, exists: false, keys };
  for (const line of fs.readFileSync(KEYS_FILE, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) keys[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { file: KEYS_FILE, exists: true, keys };
}
export const PROVIDER_KEY_NAME = { anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', zai: 'ZAI_API_KEY' };
export const readPrices = () => readJson(PRICES_FILE, { models: {} });
export function estimateCost(model, inputTokens, outputTokens, prices = readPrices()) {
  const p = prices.models?.[model];
  if (!p) return null;
  return +(((inputTokens || 0) * p.inputPerMTok + (outputTokens || 0) * p.outputPerMTok) / 1e6).toFixed(6);
}
export function appendRun(record) {
  fs.mkdirSync(TX_DIR, { recursive: true });
  fs.appendFileSync(RUNS_FILE, JSON.stringify(record) + '\n');
}
export const readRuns = () => fs.existsSync(RUNS_FILE) ? fs.readFileSync(RUNS_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
export const safeLabel = s => String(s).replace(/[^a-zA-Z0-9._-]+/g, '-');
export const candidateFile = (paperId, provider, model) => path.join(paperDir(paperId), 'candidates', `${safeLabel(provider)}__${safeLabel(model)}.json`);
export const figureUrl = (paperId, figId) => `${R2_PUBLIC}/problems/${paperId}/${figId}.png`;

// ---------------------------------------------------------------- prompts & pages
export function loadPrompt(stage, version = 'v1') {
  const f = path.join(PROMPTS_DIR, version, `${stage}.md`);
  if (!fs.existsSync(f)) throw new Error(`prompt not found: ${f}`);
  return { file: f, text: fs.readFileSync(f, 'utf8'), version, sha256: sha256File(f) };
}
// Ordered page images for a prepared paper: problems first, then solutions.
export function pageImages(manifest) {
  const out = [];
  for (const doc of ['problems', 'solutions']) {
    const d = manifest.documents?.[doc];
    if (!d) continue;
    d.pageImages.forEach((rel, i) => out.push({ document: doc, page: i + 1, file: path.join(paperDir(manifest.paperId), rel), size: d.pageSizes[i] }));
  }
  return out;
}
export function contextBlock(manifest) {
  const m = manifest.meta;
  const docs = Object.entries(manifest.documents || {}).map(([k, d]) => `- ${k}: ${d.pages} page(s), archive key "${d.key}", sha256 ${d.sha256.slice(0, 12)}…`).join('\n');
  return [
    `PAPER CONTEXT (from the archive catalogue; the printed page wins when they disagree — say so in tx.catalogDisagrees):`,
    `- paperId: ${manifest.paperId}`,
    `- subject: ${m.subject}; competition: ${m.competition}; catalogue year: ${m.year}; catalogue round: ${m.round ?? 'null'}; catalogue grade: ${m.grade ?? 'null'}; lang: ${m.lang || 'bg'}`,
    `- documents:\n${docs}`,
    `- page images were rendered at ${manifest.renderDpi} dpi; figure boxes are in pixels of those images.`,
  ].join('\n');
}
