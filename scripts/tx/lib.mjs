// Shared helpers for the scripted transcription pipeline (scripts/tx).
// Everything here is pure plumbing: paths, hashing, paper-id derivation,
// schema compilation, math-span detection and the deterministic serialisation
// that receipt.mjs and promote.mjs must agree on byte-for-byte.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// OLYMPIADS_TX_DIR lets the tests point the pipeline at a throw-away directory.
export const TX_DIR = process.env.OLYMPIADS_TX_DIR ? path.resolve(process.env.OLYMPIADS_TX_DIR) : path.join(ROOT, 'tmp', 'tx');
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
// Windows Python defaults to the ANSI code page; archive keys and figure ids are Cyrillic.
if (process.platform === 'win32' && !process.env.PYTHONUTF8) process.env.PYTHONUTF8 = '1';
export const STAGES = ['reader', 'checker', 'adjudicator'];
// Figure boxes travel as permille of the page (0..1000, origin top-left, x right,
// y down) so that a model which internally rescales the page image still
// produces a usable box; figures.mjs converts to preview pixels via the manifest.
export const BBOX_SCALE = 1000;
// Statement placeholder a windowed reader emits for a problem whose statement
// lies outside its page window; assemble.mjs must replace every one of them.
export const WINDOW_PLACEHOLDER = '[извън прозореца]';

export const nowIso = () => new Date().toISOString();
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const md5 = value => crypto.createHash('md5').update(value).digest('hex');
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
// Approximates the id vocabulary the previous agent workflows settled on:
//   <comp>-<printed year>-<round token>-<grade token>
//   round token: ESF -> esenno, PSF -> proletno, NOF/NAO -> roman numeral lower-cased
//   grade token: digits/ranges as printed ("9", "11-12"); special groups lower-cased
//   ("st", "ml"; ESF's "SP" group was committed as "st"); NAO IV practical papers
//   -> "<group>-prak" ("ml-prak"); grade-less papers take a slug of the file name.
// Examples: psf-2026-proletno-12, nao-2016-iii-11-12, esf-2013-esenno-st,
// nof-2014-ii-7, nao-2024-iv-ml-prak.
// The historical ids are NOT fully regular (nao-2023-iv-nabl vs nao-2024-iv-obs,
// nof-2015-iii-10-12-d1, nao-2024-iii-11-12-test …), so this function is only a
// proposal for papers that do not exist yet: paperIdFor()/resolvePaper() look the
// archive key up in content/problems first and an existing id always wins.
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
    if (comp === 'esf' && gradeTok === 'sp') gradeTok = 'st';
    if (comp === 'nao' && /^(ml|st)$/.test(gradeTok) && /prak/.test(base)) gradeTok = `${gradeTok}-prak`;
  } else if (/nabl|obs/.test(base)) {
    gradeTok = 'nabl' + (/map/.test(base) ? '-maps' : '');
  } else {
    gradeTok = base.replace(/(problems?|zad|prob|tema|noa\d?_\d{4}_?|nof\d?_\d{4}_?|proletni_\d{4}_?|esenni_\d{4}_?)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
  }
  return [comp, entry.year, roundTok, gradeTok].filter(Boolean).join('-');
}
export const loadBacklog = () => readJson(BACKLOG_FILE, []);
export function listContentFiles() {
  const out = [];
  const stack = [CONTENT_DIR];
  while (stack.length) {
    const d = stack.pop();
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.json') && e.name !== 'schema.json') out.push(p);
    }
  }
  return out.sort();
}
export function findContentFile(paperId) {
  return listContentFiles().find(f => path.basename(f) === `${paperId}.json`) || null;
}
// Index of already transcribed papers by id and by problems archive key. Reading
// ~550 files takes well under a second and is the only reliable way to know
// which PDF is already on the site under which id.
let indexCache = null;
export function existingPaperIndex(force = false) {
  if (indexCache && !force) return indexCache;
  const byId = new Map(), byKey = new Map();
  for (const file of listContentFiles()) {
    let data;
    try { data = readJson(file); } catch { continue; }
    const p = data?.paper;
    if (!p?.id) continue;
    byId.set(p.id, { file, paper: p });
    if (p.source?.archiveKey) byKey.set(p.source.archiveKey, p.id);
  }
  indexCache = { byId, byKey };
  return indexCache;
}
// The id a backlog entry should be worked under: the id of the paper that already
// holds the same problems PDF, otherwise the derived proposal.
export function paperIdFor(entry, index = existingPaperIndex()) {
  return index.byKey.get(entry.problemsKey) || derivePaperId(entry);
}
// Resolve archive keys and catalogue metadata for a paper id: explicit overrides
// win, then an already-transcribed paper's own source block, then the backlog.
// Refuses to start a second paper for a PDF that is already transcribed under a
// different id (the old workflow's ids are not fully derivable).
export function resolvePaper(paperId, { problems, solutions } = {}) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(paperId)) throw new Error(`unsafe paper id: ${paperId}`);
  const index = existingPaperIndex();
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
    const backlog = loadBacklog();
    const hit = backlog.find(e => paperIdFor(e, index) === paperId) || backlog.find(e => derivePaperId(e) === paperId);
    if (hit) {
      const owner = index.byKey.get(hit.problemsKey);
      if (owner && owner !== paperId) throw new Error(`${hit.problemsKey} is already transcribed as ${owner}; use that id (derived proposal ${derivePaperId(hit)} is not the committed one)`);
      meta ||= { competition: hit.competition, year: hit.year, round: hit.round ?? null, grade: hit.grade ?? null, subject: hit.subject, lang: hit.lang || 'bg' };
      keys.problems ||= hit.problemsKey || null;
      keys.solutions ||= hit.solutionsKey || null;
      origin ||= 'tmp/shards/all.json';
    }
  }
  if (keys.problems) {
    const owner = index.byKey.get(keys.problems);
    if (owner && owner !== paperId) throw new Error(`${keys.problems} is already transcribed as ${owner}; refusing to prepare it under ${paperId}`);
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
// Normalised form of a LaTeX span for comparison: whitespace and decimal-comma
// spelling differences vanish, a changed subscript, sign or exponent does not.
export function normaliseLatex(inner) {
  return String(inner)
    .replace(/\\[,;:! ]/g, ' ').replace(/~/g, ' ')
    .replace(/\\left|\\right/g, '').replace(/\\mathrm\{([^}]*)\}/g, '$1').replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\{,\}/g, ',').replace(/\\cdot/g, '*').replace(/\\times/g, '*')
    .replace(/\\dfrac|\\tfrac/g, '\\frac')
    .replace(/\s+/g, '')
    .replace(/([_^])\{([A-Za-z0-9])\}/g, '$1$2');
}
// Walk every string field of a paper with its JSON pointer-ish path.
export function walkStrings(value, cb, p = '') {
  if (typeof value === 'string') cb(p, value);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, cb, `${p}/${i}`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walkStrings(v, cb, `${p}/${k}`);
}
// JSON-pointer get/set for repair.mjs ("/problems/1/parts/0/statement").
export function pointerGet(obj, pointer) {
  return pointer.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function pointerSet(obj, pointer, value) {
  const keys = pointer.split('/').filter(Boolean);
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (o == null || typeof o !== 'object') return false; o = o[k]; }
  if (o == null || typeof o !== 'object') return false;
  o[keys.at(-1)] = value;
  return true;
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
// What the checker is allowed to see (Codex §4): the content plus the location
// data it needs to look things up — figure document/page/box (+ crop file) and
// problem sourceSpans. Never the reader's notes, identity, cost, text-layer
// verdict or catalogue disagreement flag.
export function checkerView(candidate) {
  const view = stripTx(candidate);
  (candidate.problems || []).forEach((src, i) => {
    const spans = src.tx?.sourceSpans;
    if (spans) view.problems[i].tx = { sourceSpans: spans.map(s => ({ document: s.document, page: s.page })) };
  });
  const srcFigs = allFigures(candidate), dstFigs = allFigures(view);
  srcFigs.forEach((s, k) => {
    const t = s.fig.tx;
    if (!t) return;
    const keep = {};
    for (const key of ['document', 'page', 'bbox', 'file', 'cropError']) if (t[key] !== undefined) keep[key] = t[key]; // cropError: the box produced no usable crop — a figure defect for the checker
    if (Object.keys(keep).length) dstFigs[k].fig.tx = keep;
  });
  return view;
}
// Figure evidence a receipt needs before a candidate may pass: no dry-run
// leftovers, and every pipeline-produced figure verified public (HEAD 200).
export function figureEvidenceProblems(candidate) {
  const problems = [];
  for (const { fig, path: p } of allFigures(candidate)) {
    if (fig.tx?.dryRun) problems.push({ path: p, message: 'figure comes from a figures.mjs --dry-run (never uploaded)' });
    else if (fig.tx?.bbox && fig.tx.public200 !== true) problems.push({ path: p, message: 'figure proposal was not uploaded and HEAD-verified by figures.mjs' });
    else if (!fig.url) problems.push({ path: p, message: 'figure has no url' });
  }
  return problems;
}
// Geometry helpers: permille boxes <-> preview pixels of a rendered page.
export const pagePx = (size, dpi = RENDER_DPI) => ({ w: size.widthPt * dpi / 72, h: size.heightPt * dpi / 72 });
export function bboxToPreviewPx(bbox, size, dpi = RENDER_DPI) {
  const { w, h } = pagePx(size, dpi);
  return [bbox[0] * w / BBOX_SCALE, bbox[1] * h / BBOX_SCALE, bbox[2] * w / BBOX_SCALE, bbox[3] * h / BBOX_SCALE].map(v => +v.toFixed(1));
}
export function previewPxToBbox(px, size, dpi = RENDER_DPI) {
  const { w, h } = pagePx(size, dpi);
  return [px[0] * BBOX_SCALE / w, px[1] * BBOX_SCALE / h, px[2] * BBOX_SCALE / w, px[3] * BBOX_SCALE / h].map(v => Math.round(v));
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

// Reader/checker independence (Codex §4): a different model at least, ideally a
// different provider family. Recorded in the receipt; publicationState requires it.
export function independence(reader, checker) {
  const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  const sameModel = same(reader?.provider, checker?.provider) && same(reader?.model, checker?.model);
  return { independent: !!reader?.model && !!checker?.model && !sameModel, differentProvider: !!reader?.provider && !!checker?.provider && !same(reader.provider, checker.provider) };
}

// Build the exact paper promote.mjs writes: strip the working block, hoist
// what the committed schema holds, stamp provenance, canonicalise.
// `prov` = { provider, model, promptVersion, promptSha256, requestId, at, verifiedBy, verifiedAt, sourceSha256 }.
// Every provenance field is a real schema field (content/problems/schema.json →
// paper.transcription); nothing is serialised into notes. If the schema ever
// lacks a field this throws — extend the schema, do not smuggle.
export function buildFinalPaper(candidate, prov, schema = loadSchema()) {
  const data = stripTx(candidate);
  const paper = data.paper;
  const txPaper = candidate.tx || {};
  const problemProps = schema.$defs?.problem?.properties || {};
  (candidate.problems || []).forEach((src, i) => {
    const spans = src.tx?.sourceSpans;
    if (spans && problemProps.sourceSpans) data.problems[i].sourceSpans = spans.map(s => ({ document: s.document, page: s.page, ...(s.pdfRect ? { pdfRect: s.pdfRect } : {}) }));
  });
  const sourceProps = schema.$defs?.figure?.properties?.source?.properties || {};
  for (const { fig } of allFigures(data)) {
    if (fig.source && fig.source.document && !sourceProps.document) delete fig.source.document;
    for (const k of Object.keys(fig)) if (!schema.$defs?.figure?.properties?.[k]) delete fig[k];
  }
  const trProps = schema.properties?.paper?.properties?.transcription?.properties || {};
  const methods = trProps.method?.enum || [];
  const notes = typeof txPaper.notes === 'string' && txPaper.notes.trim() ? txPaper.notes.trim() : undefined;
  const full = {
    method: methods.includes('vision-pages') ? 'vision-pages' : 'vision',
    provider: prov.provider,
    model: prov.model,
    promptVersion: prov.promptVersion,
    promptSha256: prov.promptSha256 ?? undefined,
    requestId: prov.requestId ?? null,
    at: prov.at,
    renderDpi: RENDER_DPI,
    figureDpi: FIGURE_DPI,
    sourceSha256: prov.sourceSha256,
    verifiedBy: prov.verifiedBy ?? null,
    verifiedAt: prov.verifiedAt ?? null,
    notes,
  };
  const transcription = {};
  const dropped = [];
  for (const [k, v] of Object.entries(full)) {
    if (v === undefined) continue;
    if (trProps[k]) transcription[k] = v; else dropped.push(k);
  }
  if (dropped.length) throw new Error(`content/problems/schema.json paper.transcription lacks ${dropped.join(', ')}; extend the schema instead of serialising provenance into notes`);
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
// Documented request limits (checked before anything is sent). Anthropic: 5 MB per
// image, 100 images, ~32 MB request. Gemini: 20 MB total inline request. Z.ai:
// not documented in the repo — 20 MB is an assumption to be corrected on first error.
export const PROVIDER_LIMITS = {
  anthropic: { imageBytes: 5 * 1024 * 1024, images: 100, requestBytes: 32 * 1024 * 1024 },
  gemini: { imageBytes: 20 * 1024 * 1024, images: 3000, requestBytes: 20 * 1024 * 1024 },
  zai: { imageBytes: 20 * 1024 * 1024, images: 100, requestBytes: 20 * 1024 * 1024 },
};
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
export const checkFile = (paperId, provider, model) => path.join(paperDir(paperId), 'checks', `${safeLabel(provider)}__${safeLabel(model)}.json`);
export const figureUrl = (paperId, figId) => `${R2_PUBLIC}/problems/${paperId}/${figId}.png`;
// Only primary candidates: <provider>__<model>.json (the model may contain dots),
// not the derived .figs/.view/.dryrun/.window-*/.rN/.gold copies next to them.
export const DERIVED_SUFFIX = /\.(figs|view|dryrun|window-[^.]+|r\d+|gold|repaired|repair|x|s\d+|norm|defects|response)\.json$/;
export const isPrimaryCandidate = file => { const b = path.basename(file); return /^[^_]+__.+\.json$/.test(b) && !DERIVED_SUFFIX.test(b); };
// Crop PNGs figures.mjs produced for a candidate (dry or real): what a checker
// must look at to judge a box, keyed by figure id.
export function candidateCrops(candidate, paperId) {
  const out = [];
  for (const { fig, path: p } of allFigures(candidate)) {
    if (!fig.tx?.file) continue;
    const file = path.isAbsolute(fig.tx.file) ? fig.tx.file : path.join(paperDir(paperId), fig.tx.file);
    out.push({ id: fig.id, path: p, file, exists: fs.existsSync(file), document: fig.tx.document, page: fig.tx.page, bbox: fig.tx.bbox });
  }
  return out;
}
// Measured/guessed prompt tokens per 160-dpi A4 page image, for --dry-run estimates.
// zai: measured 2026-09-06 (494 KB PSF 2024 page = 3,230 prompt tokens). Others: guesses.
export const TOKENS_PER_PAGE = { zai: 3230, gemini: 1600, anthropic: 1600 };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
// Provenance block shared by receipt.mjs and promote.mjs so both build the same
// bytes. `ctx` = { reviewer: {provider, model}, promptVersion, checkedAt,
// sourceHashes, independent, adjudicator? }.
export function provenanceFor(candidate, ctx) {
  const reader = candidate.tx?.reader || {};
  const sha = v => (typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : undefined);
  const who = `${ctx.reviewer.provider}:${ctx.reviewer.model}`;
  const how = ctx.independent ? 'independent checker' : 'same-model checker';
  const adj = ctx.adjudicator ? `; adjudicated by ${ctx.adjudicator.provider}:${ctx.adjudicator.model}` : '';
  return {
    provider: reader.provider || 'unknown', model: reader.model || 'unknown',
    promptVersion: reader.promptVersion || ctx.promptVersion, promptSha256: sha(reader.promptSha256),
    requestId: reader.requestId ?? null,
    at: String(reader.at || candidate.tx?.at || ctx.checkedAt).slice(0, 10),
    sourceSha256: ctx.sourceHashes,
    verifiedBy: `${who} (${how}, prompt ${ctx.promptVersion}${adj})`,
    verifiedAt: String(ctx.checkedAt).slice(0, 10),
  };
}

// Throttled HEAD verification of public URLs: at most 2 in flight, 150 ms apart.
export async function headStatuses(urls) {
  const out = new Map();
  const one = async url => { try { const r = await fetch(url, { method: 'HEAD' }); out.set(url, r.status); } catch { out.set(url, 0); } };
  const list = [...new Set(urls)];
  for (let i = 0; i < list.length; i += 2) {
    await Promise.all(list.slice(i, i + 2).map(one));
    if (i + 2 < list.length) await sleep(150);
  }
  return out;
}

// ---------------------------------------------------------------- prompts & pages
export function loadPrompt(stage, version = 'v1') {
  const f = path.join(PROMPTS_DIR, version, `${stage}.md`);
  if (!fs.existsSync(f)) throw new Error(`prompt not found: ${f}`);
  return { file: f, text: fs.readFileSync(f, 'utf8'), version, sha256: sha256File(f) };
}
// Ordered page images for a prepared paper: problems first, then solutions.
// `window` = { problems: [from, to], solutions: [from, to] } restricts the pages.
export function pageImages(manifest, window = null) {
  const out = [];
  for (const doc of ['problems', 'solutions']) {
    const d = manifest.documents?.[doc];
    if (!d) continue;
    const range = window?.[doc];
    if (window && !range) continue;
    d.pageImages.forEach((rel, i) => {
      const page = i + 1;
      if (range && (page < range[0] || page > range[1])) return;
      out.push({ document: doc, page, file: path.join(paperDir(manifest.paperId), rel), size: d.pageSizes[i] });
    });
  }
  return out;
}
// Page windows for long documents: `size` pages each, 1-page overlap, per document.
export function pageWindows(manifest, size) {
  const docs = Object.entries(manifest.documents || {});
  const total = docs.reduce((a, [, d]) => a + d.pages, 0);
  if (!size || total <= size) return [null];
  const out = [];
  for (const [doc, d] of docs) {
    if (d.pages <= size) { out.push({ [doc]: [1, d.pages] }); continue; }
    for (let from = 1; from <= d.pages; from += size - 1) {
      const to = Math.min(d.pages, from + size - 1);
      out.push({ [doc]: [from, to] });
      if (to === d.pages) break;
    }
  }
  return out;
}
export const windowLabel = window => window ? Object.entries(window).map(([d, [a, b]]) => `${d}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`).join('_') : 'all';
export function windowBlock(manifest, window) {
  if (!window) return null;
  const parts = Object.entries(window).map(([d, [a, b]]) => `${d} pages ${a}–${b} of ${manifest.documents[d].pages}`);
  return [
    `PAGE WINDOW: you see only ${parts.join(' and ')}. The paper is transcribed in windows and assembled afterwards; other windows cover the rest.`,
    `- Transcribe every problem whose statement BEGINS on one of your pages, completely (a statement that continues onto the next page is in your window because windows overlap by one page).`,
    `- For an official solution on your pages whose problem statement is NOT on your pages, still emit the problem with its "number", "id", the "solution" and "tx.sourceSpans", and set "statement" to exactly "${WINDOW_PLACEHOLDER}" (parts: []). Assembly replaces the placeholder with the statement from the window that has it.`,
    `- Do not emit a problem that merely continues from a previous page — it belongs to the window where it begins.`,
    `- paper.source.pages / solutionSource.pages list only the pages you actually used; set "tx.window" to ${JSON.stringify(window)}.`,
  ].join('\n');
}
export function contextBlock(manifest) {
  const m = manifest.meta;
  const docs = Object.entries(manifest.documents || {}).map(([k, d]) => `- ${k}: ${d.pages} page(s), archive key "${d.key}", sha256 ${d.sha256.slice(0, 12)}…`).join('\n');
  return [
    `PAPER CONTEXT (from the archive catalogue; the printed page wins when they disagree — say so in tx.catalogDisagrees):`,
    `- paperId: ${manifest.paperId}`,
    `- subject: ${m.subject}; competition: ${m.competition}; catalogue year: ${m.year}; catalogue round: ${m.round ?? 'null'}; catalogue grade: ${m.grade ?? 'null'}; lang: ${m.lang || 'bg'}`,
    `- documents:\n${docs}`,
    `- figure boxes are [x0, y0, x1, y1] in PERMILLE of the page (0–${BBOX_SCALE} across the width and across the height, origin top-left), independent of image resolution.`,
  ].join('\n');
}

// Readers (GLM especially) emit `"caption": null` for optional fields the
// schema types as string/array; that is a formatting slip, not a transcription
// error. Drop null-valued optional keys everywhere before validation.
const NULLABLE_OPTIONAL = new Set(['caption', 'alt', 'title', 'held', 'organiser', 'caveat', 'incompleteReason', 'note', 'latex', 'unit', 'tolerance', 'difficulty', 'importance', 'topics', 'parts', 'figures', 'answer', 'solutionSource', 'problemType', 'apparatus', 'measurementTable', 'label']);
// Structural slips readers make that a rule can settle without a model — applied
// to every candidate before validation (reader output, refix output, run.mjs
// validate stage). Nothing here touches transcribed text except a KaTeX
// spelling ("0\,^{\circ}" -> "0\,{}^{\circ}", which KaTeX rejects otherwise).
const HOMOGLYPHS = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', i: 'і', A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х' };
export function fixHomoglyphs(s) {
  if (typeof s !== 'string' || !/[A-Za-z]/.test(s) || !/[Ѐ-ӿ]/.test(s)) return s;
  return splitMath(s).map(seg => seg.math ? seg.text : seg.text.replace(/\p{L}+/gu, w => {
    const cyr = (w.match(/[Ѐ-ӿ]/g) || []).length, lat = w.match(/[A-Za-z]/g) || [];
    if (cyr < 2 || !lat.length || !lat.every(ch => HOMOGLYPHS[ch])) return w;
    return w.replace(/[A-Za-z]/g, ch => HOMOGLYPHS[ch]);
  })).join('');
}
export function normaliseCandidate(c) {
  if (!c || typeof c !== 'object') return c;
  const changes = [];
  for (const { fig, path: p } of allFigures(c)) {
    // document/page/bbox belong under tx (the schema forbids them on the figure)
    for (const k of ['document', 'page', 'bbox']) if (fig[k] !== undefined) { if (fig.tx?.[k] === undefined) fig.tx = { ...(fig.tx || {}), [k]: fig[k] }; delete fig[k]; changes.push(`${p}: ${k} moved under tx`); }
    if (typeof fig.tx?.bbox === 'string') { const m = fig.tx.bbox.match(/-?\d+(?:\.\d+)?/g); if (m?.length === 4) { fig.tx.bbox = m.map(Number); changes.push(`${p}: bbox parsed`); } }
    if (typeof fig.tx?.page === 'string' && /^\d+$/.test(fig.tx.page)) { fig.tx.page = Number(fig.tx.page); changes.push(`${p}: page parsed`); }
  }
  // a reader sometimes emits the same problem twice (the second copy headed "Задача N."): drop the later copy
  if (Array.isArray(c.problems)) {
    const norm = s => String(s || '').replace(/^\s*задача\s*\d+\s*[.:)]?\s*/iu, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
    const firstByNumber = new Map();
    const keep = [];
    c.problems.forEach((pr, i) => {
      const prev = firstByNumber.get(pr.number);
      if (prev !== undefined && norm(pr.statement) === norm(c.problems[prev].statement) && !(pr.parts?.length > (c.problems[prev].parts?.length || 0))) { changes.push(`/problems/${i}: duplicate of problem ${pr.number}, dropped`); return; }
      if (prev === undefined) firstByNumber.set(pr.number, i);
      keep.push(pr);
    });
    if (keep.length !== c.problems.length) c.problems = keep;
  }
  const fixAnswer = (a, p) => {
    if (!a || typeof a !== 'object') return;
    if (a.kind === 'numeric' && typeof a.value !== 'number') {
      const n = typeof a.value === 'string' ? Number(a.value.trim().replace(',', '.').replace(/\s+/g, '')) : NaN;
      if (Number.isFinite(n)) { a.value = n; changes.push(`${p}: numeric value parsed`); }
      else if (a.value == null && typeof a.latex === 'string') { a.kind = 'expression'; changes.push(`${p}: numeric without a value -> expression`); }
      else { const v = String(a.value ?? ''); if (/[\\^_{}]/.test(v)) { a.kind = 'expression'; if (!a.latex) a.latex = v; delete a.value; } else { a.kind = 'text'; a.value = v; } delete a.tolerance; changes.push(`${p}: numeric value is not a number -> ${a.kind}`); }
    }
    if (a.kind === 'expression' && !a.latex && typeof a.value === 'string') { a.latex = a.value; delete a.value; changes.push(`${p}: expression value -> latex`); }
    if (a.tolerance != null && typeof a.tolerance !== 'number') { const t = Number(String(a.tolerance).replace(',', '.')); if (Number.isFinite(t)) a.tolerance = t; else delete a.tolerance; changes.push(`${p}: tolerance normalised`); }
  };
  (c.problems || []).forEach((pr, i) => { fixAnswer(pr.answer, `/problems/${i}/answer`); (pr.parts || []).forEach((part, j) => fixAnswer(part.answer, `/problems/${i}/parts/${j}/answer`)); });
  // Parts: a label typed into the text again ("в) в) Пресметнете…") is dropped; a printed
  // points marker at the end of a part ("[2 т]", "**[3 т.]**") is the points field, not
  // prose — it sets the field when empty and is stripped when it agrees with it.
  const MARKER = /\s*\**\[\s*(\d+(?:[.,]\d+)?)\s*т\.?\s*\]\**\s*$/u;
  (c.problems || []).forEach((pr, i) => (pr.parts || []).forEach((part, j) => {
    if (typeof part.statement !== 'string') return;
    const p = `/problems/${i}/parts/${j}/statement`;
    if (part.label) {
      const lab = String(part.label).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^(?:\\s*${lab}\\s+)+`, 'u');
      if (re.test(part.statement)) { part.statement = part.statement.replace(re, ''); changes.push(`${p}: leading part label removed`); }
    }
    const m = MARKER.exec(part.statement);
    if (m) {
      const n = Number(m[1].replace(',', '.'));
      if (part.points == null) { part.points = n; part.statement = part.statement.replace(MARKER, ''); changes.push(`${p}: points ${n} taken from the printed marker`); }
      else if (Math.abs(part.points - n) < 1e-9) { part.statement = part.statement.replace(MARKER, ''); changes.push(`${p}: printed points marker stripped`); }
    }
  }));
  // A statement that repeats its own parts (a refix pasted the whole problem back): drop
  // every paragraph that opens like one of the parts; the closing paragraphs stay.
  const firstWords = (s, n = 6) => proseOnly(String(s || '')).toLowerCase().replace(/^\s*[а-яa-z0-9]{1,3}[).]\s*/u, '').split(/\s+/).filter(Boolean).slice(0, n).join(' ');
  (c.problems || []).forEach((pr, i) => {
    if (typeof pr.statement !== 'string' || !(pr.parts || []).length || !/\n\s*\n/.test(pr.statement)) return;
    const heads = (pr.parts || []).map(x => firstWords(x.statement)).filter(h => h.split(' ').length >= 4);
    if (!heads.length) return;
    const paras = pr.statement.split(/\n\s*\n/);
    const kept = paras.filter(para => { const w = firstWords(para); return !heads.some(h => w === h); });
    if (kept.length !== paras.length) { pr.statement = kept.join('\n\n').trim(); changes.push(`/problems/${i}/statement: ${paras.length - kept.length} paragraph(s) repeating the parts dropped`); }
  });
  const h = c.paper?.held;
  if (h && typeof h === 'object') {
    for (const k of ['from', 'to', 'place']) if (h[k] === null) { delete h[k]; changes.push(`/paper/held/${k}: null dropped`); }
    for (const k of ['from', 'to']) if (h[k] != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(h[k]))) { delete h[k]; changes.push(`/paper/held/${k}: not a date, dropped`); }
    if (h.place != null && typeof h.place !== 'string') { h.place = Array.isArray(h.place) ? h.place.join(', ') : String(h.place); changes.push('/paper/held/place: made a string'); }
    if (h.from && !h.to) h.to = h.from; else if (!h.from && h.to) h.from = h.to;
    if (!h.from && !h.to && !h.place) { delete c.paper.held; changes.push('/paper/held: empty, dropped'); }
  } else if (h != null) { delete c.paper.held; changes.push('/paper/held: not an object, dropped'); }
  walkStrings(c, (p, s) => { if (/\\[,;: ][\^_]/.test(s)) { pointerSet(c, p, s.replace(/(\\[,;: ])([\^_])/g, '$1{}$2')); changes.push(`${p}: KaTeX spacing before ^/_`); } });
  // LaTeX spacing and text commands OUTSIDE math ("(2.1) \quad $a = b$ \ \text{и} \ $c$",
  // a display-equation habit) render literally on the page: spacing becomes a
  // space, \text{}/\mathrm{} their content, \textbf{} **bold**, \textit{} *italic*.
  walkStrings(c, (p, s) => {
    if (/\/(latex|notes|url|archiveKey|id)$/.test(p) || /\/tx\b/.test(p) || !/\\/.test(s)) return;
    let out = splitMath(s).map(seg => seg.math ? seg.text : seg.text
      .replace(/\\(?:text|textrm|textnormal|mathrm)\{([^{}]*)\}/g, '$1')
      .replace(/\\textbf\{([^{}]*)\}/g, '**$1**')
      .replace(/\\(?:textit|emph)\{([^{}]*)\}/g, '*$1*')
      .replace(/\\(?:quad|qquad)(?![a-zA-Z])|\\[,;:! ]/g, ' ')).join('');
    if (out !== s) { out = out.replace(/(?<=\S)[ \t]{2,}(?=\S)/g, ' '); pointerSet(c, p, out); changes.push(`${p}: LaTeX spacing/text command outside math`); }
  });
  // A Latin letter inside a Cyrillic word ("Виждa", "снимa", "скоростта e") is a
  // text-layer artefact no model types back reliably; map the homoglyph, outside math only.
  walkStrings(c, (p, s) => {
    if (/\/(latex|notes|url|archiveKey|id)$/.test(p) || /\/tx\b/.test(p)) return;
    const out = fixHomoglyphs(s);
    if (out !== s) { pointerSet(c, p, out); changes.push(`${p}: Latin homoglyph in a Cyrillic word`); }
  });
  if (changes.length) c.tx = { ...(c.tx || {}), normalised: [...(c.tx?.normalised || []), ...changes] };
  return c;
}
export function sanitizeCandidate(node) {
  if (Array.isArray(node)) return node.map(sanitizeCandidate);
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (node[k] === null && NULLABLE_OPTIONAL.has(k)) { delete node[k]; continue; }
      node[k] = sanitizeCandidate(node[k]);
    }
  }
  return node;
}

// Repair invalid JSON escapes left by a model writing LaTeX: scan runs of
// backslashes; an even run is fine, an odd run followed by a valid escape
// character is fine, a lone backslash before anything else gets doubled
// (forgot to escape), and an odd run of 3+ loses one (over-escaped, e.g. \\\left).
export function repairJsonEscapes(s) {
  let out = '';
  for (let i = 0; i < s.length;) {
    if (s[i] !== '\\') { out += s[i++]; continue; }
    let j = i; while (j < s.length && s[j] === '\\') j++;
    const n = j - i, c = s[j];
    if (n % 2 === 0 || '"\\/bfnrtu'.includes(c)) out += s.slice(i, j);
    else if (n === 1) out += '\\\\';
    else out += '\\'.repeat(n - 1);
    i = j;
  }
  return out;
}
