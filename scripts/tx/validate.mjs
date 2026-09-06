#!/usr/bin/env node
// validate.mjs <candidate.json> [--paper-id X] [--manifest m] [--mode candidate|final] [--quiet]
// Mechanical checks a model cannot be trusted to do on itself. Prints a JSON
// report; exits 1 when there is at least one error.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  parseArgs, fail, readJson, compileSchema, mathSpans, splitMath, proseOnly, walkStrings, allFigures, RENDER_DPI, R2_PUBLIC,
  BBOX_SCALE, WINDOW_PLACEHOLDER, pagePx, stripTx } from './lib.mjs';

const require = createRequire(import.meta.url);
const katex = require('katex');

const args = parseArgs(process.argv.slice(2), { flags: ['quiet'] });
const file = args._[0];
if (!file) fail('usage: validate.mjs <candidate.json> [--paper-id X] [--manifest m] [--mode candidate|final]');
let data;
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log(JSON.stringify({ ok: false, errors: [{ path: '', message: `not valid JSON: ${e.message}` }] })); process.exit(1); }

const errors = [], warnings = [];
const err = (p, message) => errors.push({ path: p, message });
const warn = (p, message) => warnings.push({ path: p, message });
const hasTx = JSON.stringify(data).includes('"tx":');
const mode = args.mode || (hasTx || allFigures(data).some(f => !f.fig.url) ? 'candidate' : 'final');
const manifest = args.manifest ? readJson(path.resolve(args.manifest), null) : null;
if (args.manifest && !manifest) err('', `manifest not readable: ${args.manifest}`);

// 1. schema
const { validate, schema } = compileSchema(mode);
// Candidate mode: readers may put a tx block on any object (solution, part…); promote strips them all,
// so the schema check runs on the same stripped shape promote will write.
const schemaInput = mode === 'candidate' ? stripTx(data) : data;
if (!validate(schemaInput)) for (const e of validate.errors) err(e.dataPath || '', `${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}${e.params?.allowedValues ? ` [${e.params.allowedValues.join('|')}]` : ''}`);

const paper = data.paper || {};
const paperId = args['paper-id'] || paper.id;
if (args['paper-id'] && paper.id !== args['paper-id']) err('/paper/id', `paper.id "${paper.id}" != expected "${args['paper-id']}"`);
if (manifest && paper.source?.archiveKey && manifest.documents?.problems?.key && paper.source.archiveKey !== manifest.documents.problems.key) err('/paper/source/archiveKey', 'does not match the prepared problems document');
if (manifest && paper.solutionSource?.archiveKey && manifest.documents?.solutions?.key && paper.solutionSource.archiveKey !== manifest.documents.solutions.key) warn('/paper/solutionSource/archiveKey', 'does not match the prepared solutions document');
if (manifest && manifest.meta) {
  const m = manifest.meta;
  if (paper.competition !== m.competition) err('/paper/competition', `"${paper.competition}" != catalogue "${m.competition}"`);
  if (paper.subject !== m.subject) err('/paper/subject', `"${paper.subject}" != catalogue "${m.subject}"`);
  if (paper.year !== m.year && !data.tx?.catalogDisagrees) warn('/paper/year', `${paper.year} != catalogue ${m.year} and tx.catalogDisagrees is not set`);
}

// 2. ids, numbering, points
const problems = Array.isArray(data.problems) ? data.problems : [];
const ids = new Set();
problems.forEach((pr, i) => {
  const p = `/problems/${i}`;
  if (typeof pr.id !== 'string' || !pr.id.startsWith(`${paperId}-`)) err(`${p}/id`, `must start with "${paperId}-"`);
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pr.id)) err(`${p}/id`, 'unsafe id characters');
  if (ids.has(pr.id)) err(`${p}/id`, `duplicate id ${pr.id}`); ids.add(pr.id);
  if (Number.isInteger(pr.number)) { if (pr.number !== i + 1) err(`${p}/number`, `expected ${i + 1}, got ${pr.number} (numbering must be contiguous 1..N)`); }
  else warn(`${p}/number`, `non-integer number "${pr.number}"`);
  if (!pr.statement || !String(pr.statement).trim()) err(`${p}/statement`, 'empty statement');
  else if (String(pr.statement).includes(WINDOW_PLACEHOLDER)) err(`${p}/statement`, `window placeholder "${WINDOW_PLACEHOLDER}" left unresolved (assemble.mjs did not find the statement in any window)`);
  if (pr.points != null && (typeof pr.points !== 'number' || pr.points < 0 || pr.points > 200)) err(`${p}/points`, `implausible points ${pr.points}`);
  const labels = new Set();
  let partSum = 0, partsWithPoints = 0;
  (pr.parts || []).forEach((pt, k) => {
    const q = `${p}/parts/${k}`;
    if (labels.has(pt.label)) warn(`${q}/label`, `duplicate part label "${pt.label}"`); labels.add(pt.label);
    if (!pt.statement || !String(pt.statement).trim()) err(`${q}/statement`, 'empty part statement');
    if (pt.points != null) { if (typeof pt.points !== 'number' || pt.points < 0) err(`${q}/points`, `implausible points ${pt.points}`); else { partSum += pt.points; partsWithPoints++; } }
    checkAnswer(pt.answer, `${q}/answer`);
  });
  if (partsWithPoints && pr.points != null && partsWithPoints === (pr.parts || []).length && Math.abs(partSum - pr.points) > 1e-9) warn(`${p}/points`, `parts sum to ${partSum} but problem has ${pr.points} (fine if printed so; say it in tx.notes)`);
  checkAnswer(pr.answer, `${p}/answer`);
  if (pr.solution && !pr.solution.incomplete && !(pr.solution.statement || '').trim()) err(`${p}/solution/statement`, 'empty solution without incomplete: true');
  if (pr.solution?.incomplete && !pr.solution.incompleteReason) warn(`${p}/solution`, 'incomplete without incompleteReason');
  for (const s of pr.tx?.sourceSpans || pr.sourceSpans || []) {
    if (!['problems', 'solutions'].includes(s.document)) err(`${p}/tx/sourceSpans`, `unknown document "${s.document}"`);
    else if (manifest && !manifest.documents[s.document]) err(`${p}/tx/sourceSpans`, `document "${s.document}" was not prepared`);
    else if (manifest && (s.page < 1 || s.page > manifest.documents[s.document].pages)) err(`${p}/tx/sourceSpans`, `page ${s.page} outside ${s.document} (1..${manifest.documents[s.document].pages})`);
  }
});
const total = problems.reduce((a, pr) => a + (typeof pr.points === 'number' ? pr.points : 0), 0);
if (paper.totalPoints != null && problems.every(pr => typeof pr.points === 'number') && Math.abs(total - paper.totalPoints) > 1e-9) warn('/paper/totalPoints', `problems sum to ${total}, totalPoints is ${paper.totalPoints}`);
if (manifest) for (const doc of ['source', 'solutionSource']) {
  const d = doc === 'source' ? 'problems' : 'solutions';
  for (const pg of paper[doc]?.pages || []) if (manifest.documents[d] && (pg < 1 || pg > manifest.documents[d].pages)) err(`/paper/${doc}/pages`, `page ${pg} outside ${d} (1..${manifest.documents[d].pages})`);
}
function checkAnswer(a, p) {
  if (!a) return;
  if (a.kind === 'numeric' && typeof a.value !== 'number') err(`${p}/value`, 'numeric answer needs a number value');
  if (a.kind === 'numeric' && a.tolerance != null && a.tolerance < 0) err(`${p}/tolerance`, 'negative tolerance');
  if (a.kind === 'expression' && !a.latex) warn(`${p}/latex`, 'expression answer without latex');
  if (a.kind === 'choice' && a.correct == null) warn(`${p}/correct`, 'choice answer without correct');
}

// 3. text fields: raw HTML, << >>, math
const HTML = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/;
let mathCount = 0;
walkStrings(data, (p, s) => {
  if (/\/tx\b/.test(p) || /\/(url|archiveKey|id|from|to)$/.test(p)) return;
  const prose = proseOnly(s);
  if (HTML.test(prose)) err(p, `raw HTML tag in prose: ${HTML.exec(prose)[0].slice(0, 40)}`);
  if (/<<|>>/.test(prose)) err(p, 'bare << or >> outside math (MDX parses it as JSX); use $\\ll$ / $\\gg$');
  if (/<[\d-]/.test(prose)) warn(p, '"<" glued to a digit/minus outside math (mdText escapes it, but check it is prose)');
  // unbalanced single dollars: after removing the recognised spans nothing may contain a lone $
  const rest = splitMath(s).filter(x => !x.math).map(x => x.text).join('');
  if (/\$/.test(rest.replace(/\\\$/g, ''))) err(p, 'unbalanced $ (math delimiter without a closing one on the same line)');
  for (const span of mathSpans(s)) {
    mathCount++;
    try { katex.renderToString(span.inner, { throwOnError: true, displayMode: span.display, strict: 'ignore' }); }
    catch (e) { err(p, `KaTeX: ${String(e.message).replace(/^KaTeX parse error: /, '').slice(0, 120)} in ${span.raw.slice(0, 60)}`); }
  }
});

// 4. figures
if (data.tx?.window) err('/tx/window', 'candidate is a page-window part; run assemble.mjs before validating');
const figIds = new Set();
for (const { fig, path: p } of allFigures(data)) {
  if (figIds.has(fig.id)) err(`${p}/id`, `duplicate figure id ${fig.id}`); figIds.add(fig.id);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fig.id || '')) err(`${p}/id`, 'figure id must be a lower-case slug (pN-figM / pN-sol-figM)');
  if (fig.url && !fig.url.startsWith(`${R2_PUBLIC}/problems/${paperId}/`)) warn(`${p}/url`, `url is not under ${R2_PUBLIC}/problems/${paperId}/`);
  if (!fig.url && !fig.tx?.bbox) err(p, 'figure has neither url nor tx.bbox');
  if (fig.tx) {
    const t = fig.tx;
    if (!['problems', 'solutions'].includes(t.document)) err(`${p}/tx/document`, `unknown document "${t.document}"`);
    if (!Number.isInteger(t.page) || t.page < 1) err(`${p}/tx/page`, 'page must be a positive integer');
    const b = t.bbox;
    // Boxes are permille of the page (0..1000 on each axis), see lib.mjs BBOX_SCALE.
    if (!Array.isArray(b) || b.length !== 4 || b.some(v => typeof v !== 'number')) err(`${p}/tx/bbox`, 'bbox must be [x0,y0,x1,y1] numbers');
    else {
      if (b[0] < 0 || b[1] < 0 || b[2] > BBOX_SCALE || b[3] > BBOX_SCALE) err(`${p}/tx/bbox`, `box [${b}] outside 0..${BBOX_SCALE} permille of the page (boxes are page-relative, not pixels)`);
      if (b[2] <= b[0] || b[3] <= b[1]) err(`${p}/tx/bbox`, `box [${b}] has no area (x1 > x0 and y1 > y0 required)`);
      else if (b[2] - b[0] < 15 || b[3] - b[1] < 15) err(`${p}/tx/bbox`, `box too small (${b[2] - b[0]}x${b[3] - b[1]} permille)`);
      else if ((b[2] - b[0]) * (b[3] - b[1]) > 0.85 * BBOX_SCALE * BBOX_SCALE) warn(`${p}/tx/bbox`, 'box covers >85% of the page — is this really a figure?');
      const doc = manifest?.documents?.[t.document];
      if (doc) {
        if (t.page > doc.pages) err(`${p}/tx/page`, `page ${t.page} outside ${t.document} (1..${doc.pages})`);
        else {
          const { w, h } = pagePx(doc.pageSizes[t.page - 1], manifest.renderDpi || RENDER_DPI);
          const pw = (b[2] - b[0]) * w / BBOX_SCALE, ph = (b[3] - b[1]) * h / BBOX_SCALE;
          if (pw < 20 || ph < 20) err(`${p}/tx/bbox`, `box is only ${Math.round(pw)}x${Math.round(ph)} px on the ${manifest.renderDpi || RENDER_DPI}-dpi page`);
        }
      }
    }
    if (t.dryRun) warn(`${p}/tx`, 'figure comes from figures.mjs --dry-run; receipt.mjs will refuse it');
  }
  if (!fig.alt) warn(`${p}/alt`, 'figure without alt text');
}

const report = {
  ok: errors.length === 0, mode, file: path.resolve(file), paperId,
  stats: { problems: problems.length, parts: problems.reduce((a, p) => a + (p.parts || []).length, 0), figures: figIds.size, mathSpans: mathCount, solutions: problems.filter(p => p.solution?.statement).length, incomplete: problems.filter(p => p.solution?.incomplete).length },
  errors, warnings,
};
if (!args.quiet) console.log(JSON.stringify(report, null, 2));
else console.log(`${report.ok ? 'OK' : 'FAIL'} ${paperId}: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(report.ok ? 0 : 1);
