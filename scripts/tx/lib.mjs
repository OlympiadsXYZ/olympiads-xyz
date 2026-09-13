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
  // Windows refuses the rename while another process has the target open (eight workers and the
  // ship share the ledger and jobs.json): wait a little and try again before giving up
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || attempt >= 8) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
    }
  }
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
// `which` lives in Git's usr/bin; a node started from PowerShell may not have it, so fall back to where.exe
export const which = cmd => spawnSync('which', [cmd], { encoding: 'utf8' }).status === 0 || (process.platform === 'win32' && spawnSync('where.exe', [cmd], { encoding: 'utf8' }).status === 0);

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
// Competition codes in Cyrillic ("Всерусийска", "Балкански", "ПУ") become ASCII slugs, as src/archive/labels.ts does.
const CYR_TO_LAT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya', ы: 'y', э: 'e', ё: 'yo' };
export const competitionSlug = code => String(code).toLowerCase().split('').map(c => CYR_TO_LAT[c] ?? c).join('').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
export function derivePaperId(entry) {
  const comp = competitionSlug(entry.competition);
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
    // the file name minus the words every paper carries (problems, the competition code, the year, the round)
    const strip = new RegExp(`(problems?|zad|prob|tema|noa\\d?_\\d{4}_?|nof\\d?_\\d{4}_?|proletni_\\d{4}_?|esenni_\\d{4}_?|${comp.replace(/-/g, '[-_]?')}|${entry.year}|${roundTok ? roundTok.replace(/-/g, '[-_]?') : 'NOMATCH'})`, 'g');
    gradeTok = base.replace(strip, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
  }
  return [comp, entry.year, roundTok, gradeTok].filter(Boolean).join('-').replace(/-+/g, '-');
}
// The archive catalogue (every archive-catalog/*.json array), cached.
let catalogueCache = null;
export function loadCatalogue() {
  if (catalogueCache) return catalogueCache;
  const dir = path.join(ROOT, 'archive-catalog');
  let all = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'schema.json')) { const j = readJson(path.join(dir, f), []); if (Array.isArray(j)) all = all.concat(j); }
  return (catalogueCache = all);
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
  // a paper outside the Bulgarian shards: its catalogue entry (found by the problems key) carries the metadata
  if (!meta && keys.problems) {
    const e = loadCatalogue().find(x => x.file === keys.problems && x.kind === 'competition');
    if (e) { meta = { competition: e.competition, year: e.year, round: e.round ?? null, grade: e.group ?? null, subject: e.subject, lang: e.lang || 'other' }; origin ||= 'archive-catalog'; }
  }
  if (!meta) {
    const m = /^([a-z]+)-(\d{4})-/.exec(paperId);
    if (!m) throw new Error(`cannot derive metadata for ${paperId}; pass --problems/--solutions`);
    meta = { competition: m[1].toUpperCase(), year: Number(m[2]), round: null, grade: null, subject: m[1] === 'nao' ? 'astronomy' : 'physics', lang: 'bg' };
    origin ||= 'paper-id';
  }
  if (!keys.problems) throw new Error(`no problems key known for ${paperId}; pass --problems <archive key>`);
  // what the archive inventory (content/archive-index.json, GLM-indexed) lists in the problems document: the reader is
  // told how many top-level problems there are (an IPhO question with Parts A–C is one problem, not three)
  if (keys.problems) {
    const row = (readJson(path.join(ROOT, 'content', 'archive-index.json'), null)?.rows || []).find(r => r.file === keys.problems && Array.isArray(r.problems) && r.problems.length);
    if (row) {
      // the inventory sometimes lists a problem's printed sections as problems of their own ("Experiment 1 (Part A) · The
      // short copper rod" next to "Experiment 1 · Heat Conduction…"): those are parts, and are not counted
      const titles = row.problems.map(p => [p.number, p.title].filter(Boolean).join(' · '));
      const isSection = t => /\((?:part|section|част)\s*[a-zа-я0-9]+\)|^\s*(?:part|част)\s+[a-zа-я0-9]+\b/i.test(t) || /^[^·]*\((?:part|част) [a-z0-9]+\)/i.test(String(t));
      const top = titles.filter(t => !isSection(t));
      const parts = row.problems.filter((p, i) => !isSection(titles[i])).reduce((a, p) => a + (Number(p.parts) || 0), 0);
      meta.listed = { problems: Math.max(1, top.length), titles: top.slice(0, 12), ...(parts ? { parts } : {}) };
    }
  }
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
  size = Math.floor(Number(size) || 0);
  if (size === 1) size = 2; // windows overlap by one page: a 1-page window never advances (heap blow-up, 2026-09-13)
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
    ...(window.solutions && !window.problems && manifest.documents.problems ? [`- Your pages are the SOLUTIONS document only. The problem statements are printed in the separate problems document and are transcribed from there by another window: set "statement" to "${WINDOW_PLACEHOLDER}" (parts: []) for EVERY problem you emit, even when the solutions restate the problem. Solution text never goes into "statement" or "parts".`] : []),
    `- For an official solution that BEGAN on a page before your first page and continues on your pages: emit its problem with the placeholder statement (parts: []) and, in "solution.statement", ONLY the text printed on your pages AFTER your first page (that page was covered by the previous window); set "tx.continuation": true on that problem. Assembly appends it to the beginning read by the earlier window. Never replace such a continuation by a note or a placeholder — transcribe it. A continuation is not "incomplete" because its beginning lies in an earlier window: set solution.incomplete only when the printed solution itself stops short of its end (it runs past your last page).`,
    `- Do not re-transcribe a problem statement that merely continues from a previous page — it belongs to the window where it begins; only solutions are continued, as above.`,
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
    ...(m.listed?.problems ? [`- the archive inventory lists ${m.listed.problems} top-level problem(s) in the problems document (${m.listed.titles.join('; ')})${m.listed.parts ? ` with about ${m.listed.parts} printed sub-tasks` : ''}: emit exactly one problems[] entry per top-level problem; printed sections and sub-tasks inside one (Part A/B/C, A.1, E1.3, а)/б)) are its parts[] — one entry per printed sub-task with its label and points — never problems of their own and never folded into the statement. Say so in tx.notes if the page really prints a different number.`] : []),
    ...(Object.values(manifest.documents || {}).some(d => /multi/i.test(String(d.key || d.file || ''))) ? [`- this file prints the same paper in SEVERAL LANGUAGES one after another: transcribe ONLY the ${m.lang || 'en'} version of every problem and solution — never the other languages' copies, never a mixture. Say in tx.notes which pages hold the ${m.lang || 'en'} version.`] : []),
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
// A $$-block that runs into prose (paragraph break + a sentence, or inline $…$ inside it) is an unclosed
// equation: close it at that paragraph break, then look again (each repair shifts the pairing that follows).
export function balanceDisplayMath(s) {
  let text = String(s);
  for (let guard = 0; guard < 40; guard++) {
    const parts = text.split('$$');
    if (parts.length < 3) return text;
    let fixed = false;
    for (let i = 1; i < parts.length; i += 2) {
      const inside = parts[i];
      // the paragraph after the break must read like a sentence (three lowercase words in its first line): an equation
      // broken over blank lines ("\mat\n\nrm\n\nn_0\left(…") is not prose (izho-2022-theory-eng-docx)
      const m = /\n[ \t]*\n(?=[ \t]*(?:\*\*)?[A-Za-zА-Яа-я(][^\n$\\]*?\b[a-zа-я]{2,} [a-zа-я]{2,} [a-zа-я]{2,}\b)/.exec(inside);
      const prosey = m && (inside.length > 400 || /\$[^$\n]+\$/.test(inside) || true);
      if (!prosey) continue;
      parts[i] = inside.slice(0, m.index) + '$$' + inside.slice(m.index); // closes the equation, the next $$ opens again
      text = parts.join('$$');
      fixed = true;
      break;
    }
    if (!fixed) return text;
  }
  return text;
}
// A reader that split one printed problem into several (a title per Part) is folded back: the extra entries become
// parts of the first — their statement as a part carrying their title, their own parts after it — with figures and
// solutions carried along. Used when the archive inventory and the checker both count one problem.
export function mergeProblemsIntoOne(c) {
  const list = c?.problems || [];
  if (list.length < 2) return false;
  const base = list[0];
  base.parts = base.parts || [];
  for (const extra of list.slice(1)) {
    const label = String(extra.title || (extra.number != null ? `Part ${extra.number}` : 'Part')).trim();
    if (String(extra.statement || '').trim() || !(extra.parts || []).length) base.parts.push({ label, statement: String(extra.statement || '').trim(), ...(extra.points != null ? { points: extra.points } : {}) });
    for (const pt of extra.parts || []) base.parts.push(pt);
    if ((extra.figures || []).length) base.figures = [...(base.figures || []), ...extra.figures];
    if (extra.solution && (String(extra.solution.statement || '').trim() || (extra.solution.figures || []).length)) {
      base.solution = base.solution || { statement: '' };
      const text = String(extra.solution.statement || '').trim();
      if (text) base.solution.statement = [String(base.solution.statement || '').trim(), `**${label}**`, text].filter(Boolean).join('\n\n');
      if ((extra.solution.figures || []).length) base.solution.figures = [...(base.solution.figures || []), ...extra.solution.figures];
      if (extra.solution.incomplete && !text) { base.solution.incomplete = true; base.solution.incompleteReason = base.solution.incompleteReason || extra.solution.incompleteReason; }
    }
    const spans = [...(base.tx?.sourceSpans || []), ...(extra.tx?.sourceSpans || [])];
    const seen = new Set(); base.tx = { ...(base.tx || {}), sourceSpans: spans.filter(s => { const k = `${s.document}#${s.page}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
    if (base.points == null && typeof extra.points === 'number') base.points = list.reduce((a, p) => a + (typeof p.points === 'number' ? p.points : 0), 0) || null;
  }
  c.problems = [base];
  base.number = 1;
  c.tx = { ...(c.tx || {}), normalised: [...(c.tx?.normalised || []), `problems 2–${list.length} folded into problem 1 as parts (one printed problem)`] };
  return true;
}
// A paragraph that is nothing but LaTeX (a formula the reader left without its $$: "n_0\left(\frac{R_0}{r}\right)^2.
// \qquad (18)") is wrapped as display math; a paragraph with real words in it is prose and stays.
export function wrapBareFormulaParagraphs(s) {
  return String(s).split(/\n[ \t]*\n/).map(par => {
    const p = par.trim();
    if (!p || p.includes('$') || !/\\[a-zA-Z]+|[{}^_]/.test(p) || p.length > 600) return par;
    const words = p.replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[{}^_()\[\]\\|=+\-*/.,;:0-9]/g, ' ').split(/\s+/).filter(w => /^[A-Za-zА-Яа-я]{3,}$/.test(w));
    return words.length <= 1 ? par.replace(p, () => `$$${p}$$`) : par; // a function: replace() reads "$$" in a string as one "$"
  }).join('\n\n');
}
export function normaliseCandidate(c) {
  if (!c || typeof c !== 'object') return c;
  const changes = [];
  for (const { fig, path: p } of allFigures(c)) {
    // document/page/bbox belong under tx (the schema forbids them on the figure); a refix that copies
    // a figure back sometimes flattens the rest of its tx block onto the figure as well
    for (const k of ['document', 'page', 'bbox']) if (fig[k] !== undefined) { if (fig.tx?.[k] === undefined) fig.tx = { ...(fig.tx || {}), [k]: fig[k] }; delete fig[k]; changes.push(`${p}: ${k} moved under tx`); }
    for (const k of Object.keys(fig)) if (!['id', 'caption', 'alt', 'url', 'width', 'height', 'source', 'tx'].includes(k)) { delete fig[k]; changes.push(`${p}: stray ${k} dropped from the figure`); }
    if (typeof fig.tx?.bbox === 'string') { const m = fig.tx.bbox.match(/-?\d+(?:\.\d+)?/g); if (m?.length === 4) { fig.tx.bbox = m.map(Number); changes.push(`${p}: bbox parsed`); } }
    if (typeof fig.tx?.page === 'string' && /^\d+$/.test(fig.tx.page)) { fig.tx.page = Number(fig.tx.page); changes.push(`${p}: page parsed`); }
  }
  // Figure ids are unique and positional (pN-figM under problem N, pN-sol-figM under its solution); a
  // figure that repeats an earlier id (a refix copied a neighbour's) is renamed by its position, and loses
  // its crop/upload evidence, which was bound to the old name.
  {
    const seen = new Set();
    (c.problems || []).forEach((pr, i) => {
      const n = String(pr.number ?? i + 1).replace(/[^a-z0-9]/gi, '').toLowerCase() || String(i + 1);
      const lists = [[pr.figures, `p${n}-fig`], ...(pr.parts || []).map(pt => [pt.figures, `p${n}-fig`]), [pr.solution?.figures, `p${n}-sol-fig`]];
      for (const [arr, stem] of lists) {
        if (!Array.isArray(arr)) continue;
        for (const fig of arr) {
          if (!fig || typeof fig !== 'object') continue;
          // a version suffix belongs to the remote key (p2-sol-fig2-v3.png), never to the id
          if (typeof fig.id === 'string' && /-v\d+$/.test(fig.id)) { const from = fig.id; fig.id = fig.id.replace(/-v\d+$/, ''); changes.push(`/problems/${i}: figure id ${from} stripped of its version suffix`); }
          if (typeof fig.id === 'string' && fig.id && !seen.has(fig.id)) { seen.add(fig.id); continue; }
          let k = 1; while (seen.has(`${stem}${k}`)) k++;
          const from = fig.id; fig.id = `${stem}${k}`; seen.add(fig.id);
          delete fig.url; delete fig.width; delete fig.height; delete fig.source;
          if (fig.tx) fig.tx = { document: fig.tx.document, page: fig.tx.page, bbox: fig.tx.bbox, ...(fig.tx.boxFrom ? { boxFrom: fig.tx.boxFrom } : {}) };
          changes.push(`/problems/${i}: figure id ${from ?? '(none)'} renamed to ${fig.id} (duplicate or missing); crop evidence cleared`);
        }
      }
    });
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
    // a part without its label: the printed label opens the text ("б) …", "2. …"), else the position gives it
    if (part.label == null || part.label === '') {
      const m = /^\s*((?:[а-я]|\d{1,2}|[ivx]{1,4})\s*[).])\s+/iu.exec(part.statement);
      if (m) { part.label = m[1].replace(/\s+/g, ''); part.statement = part.statement.slice(m[0].length); changes.push(`${p}: label taken from the text`); }
      else { part.label = ''; changes.push(`${p}: no printed label — left empty (the page shows none)`); } // never invent lettering the print does not have
    }
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
  // A statement that runs on into the next problem's text (a paste of the page) is cut where that problem opens.
  (c.problems || []).forEach((pr, i) => {
    if (typeof pr.statement !== 'string') return;
    for (const other of (c.problems || []).slice(i + 1)) {
      const head = firstWords(other.statement);
      if (head.split(' ').length < 5) continue;
      const flat = proseOnly(pr.statement).toLowerCase();
      const at = flat.indexOf(head);
      if (at < 40) continue; // not present, or the statement itself opens that way (a shared formula of words)
      // cut the original text at the paragraph that holds the other problem's opening
      const paras = pr.statement.split(/\n\s*\n/);
      const keep = [];
      for (const para of paras) { if (proseOnly(para).toLowerCase().includes(head)) break; keep.push(para); }
      if (keep.length && keep.length < paras.length) { pr.statement = keep.join('\n\n').trim(); changes.push(`/problems/${i}/statement: cut where problem ${other.number} opens (pasted page text)`); }
    }
  });
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
  // Display math that lost a closing $$ flips every later block: the prose after it is "inside" math and the next
  // equation's opener closes it (izho-2022-theory-eng-docx: 121 delimiters, everything after block 31 inverted).
  // When a $$-block reads like prose (a paragraph break followed by a sentence, or inline $…$ inside it), the
  // block is closed at that paragraph break — before the rule below, which would otherwise strip the spacing
  // commands of the equations it mistakes for prose. Word-exported LaTeX also brings \nicefrac, which KaTeX lacks.
  walkStrings(c, (p, s) => {
    if (!/\/(statement|caption|alt|title)$/.test(p) || !/\$\$|\\nicefrac|\\[a-zA-Z]+/.test(s)) return;
    let out = balanceDisplayMath(s);
    // a lone "$$" after a formula fragment (a duplicated equation tail) leaves an empty block once balanced:
    // drop it, so the fragment is a bare formula paragraph for the wrapper below
    out = out.replace(/\$\$[ \t]*\$\$/g, '');
    out = /\/(statement)$/.test(p) ? wrapBareFormulaParagraphs(out) : out;
    out = out.replace(/\\nicefrac\b/g, '\\frac');
    if (out !== s) { pointerSet(c, p, out); changes.push(`${p}: display math balanced / bare formula paragraph wrapped / \\nicefrac`); }
  });
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
  // A printed section heading read as a part of its own ("Part 3. Engine with a Governor", empty statement) is
  // folded into the next part as a bold heading line (or the previous one when it is the last); a bare empty part
  // is dropped (izho-2026-theory-eng: the schema refix could not settle it).
  (c.problems || []).forEach((pr, i) => {
    const parts = pr.parts;
    if (!Array.isArray(parts)) return;
    for (let k = parts.length - 1; k >= 0; k--) {
      const pt = parts[k];
      if (!pt || typeof pt !== 'object' || String(pt.statement || '').trim() || (pt.figures || []).length) continue;
      const label = String(pt.label || '').trim();
      const heading = /\p{L}{3,}/u.test(label) && label.length > 6;
      const host = heading ? (parts[k + 1] || parts[k - 1]) : null;
      if (host && typeof host.statement === 'string') host.statement = parts[k + 1] ? `**${label}**\n\n${host.statement}` : `${host.statement}\n\n**${label}**`;
      parts.splice(k, 1);
      changes.push(`/problems/${i}/parts/${k}: empty part ${heading ? `"${label}" folded into the neighbouring part as a heading` : 'dropped'}`);
    }
  });
  // a solution with no text and no figures is incomplete by definition (a refix once flipped the flag to false and
  // the candidate could not validate again: ipho-2023-experiment-q4)
  (c.problems || []).forEach((pr, i) => {
    const s = pr.solution;
    if (s && typeof s === 'object' && !String(s.statement || '').trim() && !s.incomplete && !(s.figures || []).length) { s.incomplete = true; s.incompleteReason = s.incompleteReason || 'no solution text'; changes.push(`/problems/${i}/solution: empty solution marked incomplete`); }
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
