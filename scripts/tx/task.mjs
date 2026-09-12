#!/usr/bin/env node
// task.mjs <paperId> --stage reader|checker|adjudicator --out <file> [--model <label>] [--prompt-version v1] [--json]
//   checker:     --candidate <file>
//   adjudicator: [--candidates a.json,b.json] [--checks c.json,d.json] [--reference ref.json] [--adjudication <file>]
// Prints a self-contained task for a harness agent (Claude-tier model without
// API keys): the prompt, the exact images to Read in order, the output path and
// the command to run afterwards. Nothing is executed here.
//
// Isolation: the checker and the adjudicator never get the raw candidate file.
// task.mjs writes a sanitised copy (<candidate>.view.json = lib.mjs:checkerView:
// content + figure document/page/box/crop file + problem source pages; no
// reader notes, identity, cost or flags) and lists the crop PNGs figures.mjs
// produced so the box is judged by looking at the actual cut-out.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, fail, readJson, writeJson, readManifest, loadPrompt, pageImages, contextBlock, paperDir, ROOT, nowIso, checkerView, candidateCrops,
  sha256File, isPrimaryCandidate,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['json'] });
const paperId = args._[0];
const stage = args.stage;
if (!paperId || !['reader', 'checker', 'adjudicator'].includes(stage) || !args.out) fail('usage: task.mjs <paperId> --stage reader|checker|adjudicator --out <file> [--candidate <file>] [--candidates a,b] [--checks c,d] [--reference r] [--model <label>]');
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}; run prepare.mjs first`);
const pages = pageImages(manifest);
if (pages.some(p => !fs.existsSync(p.file))) fail('rendered pages are missing (prepare.mjs --gc was run?); re-run prepare.mjs');
const prompt = loadPrompt(stage, args['prompt-version'] || 'v1');
const out = path.resolve(args.out);
const model = args.model || 'agent';
const rel = f => path.relative(ROOT, f).split(path.sep).join('/'); // forward slashes: the printed commands run in a POSIX shell on every OS
const textFiles = Object.values(manifest.documents).map(d => path.join(paperDir(paperId), d.text));
const validateFor = f => `node scripts/tx/validate.mjs ${rel(f)} --paper-id ${paperId} --manifest ${rel(path.join(paperDir(paperId), 'manifest.json'))}`;

// sanitised view of one candidate + its crops
function viewOf(candFile) {
  const abs = path.resolve(candFile);
  if (!fs.existsSync(abs)) fail(`candidate not found: ${abs}`);
  const candidate = readJson(abs, null);
  if (!candidate) fail(`candidate not readable: ${abs}`);
  const viewFile = abs.replace(/\.json$/, '') + '.view.json';
  writeJson(viewFile, checkerView(candidate));
  const crops = candidateCrops(candidate, paperId);
  return { candidate: abs, candidateSha256: sha256File(abs), view: viewFile, crops, reader: candidate.tx?.reader ? `${candidate.tx.reader.provider}:${candidate.tx.reader.model}` : 'unknown' };
}
const list = s => String(s).split(',').map(x => x.trim()).filter(Boolean).map(x => path.resolve(x));

let checker = null, adj = null;
if (stage === 'checker') {
  if (!args.candidate) fail('--candidate is required for the checker stage');
  checker = viewOf(args.candidate);
}
if (stage === 'adjudicator') {
  const candDir = path.join(paperDir(paperId), 'candidates'), checkDir = path.join(paperDir(paperId), 'checks');
  let cands = args.candidates ? list(args.candidates) : (fs.existsSync(candDir) ? fs.readdirSync(candDir).filter(f => isPrimaryCandidate(f)).map(f => path.join(candDir, f)) : []);
  // prefer the figs copy of each primary candidate when it exists (it has the crop files)
  cands = cands.map(f => { const figs = f.replace(/\.json$/, '.figs.json'); return !args.candidates && fs.existsSync(figs) ? figs : f; });
  if (!cands.length) fail('no candidates found; pass --candidates a.json,b.json');
  const checks = args.checks ? list(args.checks) : (fs.existsSync(checkDir) ? fs.readdirSync(checkDir).filter(f => f.endsWith('.json')).map(f => path.join(checkDir, f)) : []);
  const reference = args.reference ? path.resolve(args.reference) : null;
  if (reference && !fs.existsSync(reference)) fail(`reference not found: ${reference}`);
  adj = { candidates: cands.map(viewOf), checks, reference, adjudication: path.resolve(args.adjudication || path.join(paperDir(paperId), 'adjudication.json')) };
}

const task = {
  paperId, stage, model, promptVersion: prompt.version, promptSha256: prompt.sha256, createdAt: nowIso(),
  pages: pages.map(p => ({ document: p.document, page: p.page, file: p.file })),
  textLayer: textFiles,
  out,
  ...(checker ? { candidateView: checker.view, candidateSha256: checker.candidateSha256, crops: checker.crops } : {}),
  ...(adj ? { candidates: adj.candidates.map(c => ({ view: c.view, candidateSha256: c.candidateSha256, crops: c.crops })), checks: adj.checks, reference: adj.reference, adjudication: adj.adjudication } : {}),
  validateCmd: stage === 'checker'
    ? `node -e "const o=JSON.parse(require('fs').readFileSync('${rel(out)}','utf8')); if(o.candidateSha256!=='${checker.candidateSha256}') throw new Error('candidateSha256 missing or wrong'); console.log('checker-output-ok', o.verdict, (o.defects||[]).length, 'defects')"`
    : validateFor(out),
  expectedProvenance: stage === 'reader' ? { 'tx.reader': { provider: 'agent', model, promptVersion: prompt.version, at: '<ISO time when finished>' } }
    : stage === 'checker' ? { candidateSha256: checker.candidateSha256, reviewer: `agent:${model}:<session or message id>` }
    : { 'tx.adjudicator': { provider: 'agent', model, promptVersion: prompt.version, at: '<ISO time>', basedOn: '<candidate view files>' } },
};
if (args.json) { console.log(JSON.stringify(task, null, 2)); process.exit(0); }

const lines = [];
let n = 0;
const h = title => { lines.push(`## ${++n}. ${title}`, ''); };
lines.push(`# Transcription task — ${stage} — ${paperId}`, '');
lines.push(`Model label: ${model}. Prompt: ${rel(prompt.file)} (v${prompt.version.replace(/^v/, '')}, sha256 ${prompt.sha256.slice(0, 12)}).`, '');
h('Read these page images with the Read tool, in this order');
for (const p of task.pages) lines.push(`- ${p.document} page ${p.page}: ${p.file}`);
lines.push('', 'Text layer (spelling cross-check only, never a source):', ...textFiles.map(f => `- ${f}`), '');
if (checker) {
  h('Read the SANITISED candidate (the reader\'s notes and identity are withheld on purpose)');
  lines.push(`- ${checker.view}`, '', `Its sha256 of the ORIGINAL candidate bytes, to copy into your output as "candidateSha256": ${checker.candidateSha256}`, '');
  h('Read every figure crop and judge the cut-out itself (whole figure? clipped? swallowed text?)');
  if (checker.crops.length) for (const c of checker.crops) lines.push(`- ${c.id} (${c.document} p.${c.page}, box ${JSON.stringify(c.bbox)}): ${c.file}${c.exists ? '' : '  [MISSING — report as a figure defect]'}`);
  else lines.push('- (the candidate proposes no figures — verify the pages really contain none a student needs)');
  lines.push('');
}
if (adj) {
  h('Read every candidate view (sanitised) and its crops');
  adj.candidates.forEach((c, i) => {
    lines.push(`- candidate ${i + 1} (reader ${c.reader}, sha256 ${c.candidateSha256.slice(0, 12)}): ${c.view}`);
    for (const cr of c.crops) lines.push(`  - crop ${cr.id} (${cr.document} p.${cr.page}): ${cr.file}${cr.exists ? '' : '  [MISSING]'}`);
  });
  lines.push('');
  h('Read every checker output (their findings are claims to verify, not facts)');
  if (adj.checks.length) for (const c of adj.checks) lines.push(`- ${c}`); else lines.push('- (no checker outputs available)');
  lines.push('');
  if (adj.reference) { h('Optional reference transcription (older workflow output; not gold — it may be wrong too)'); lines.push(`- ${adj.reference}`, ''); }
}
h('Follow this prompt');
lines.push(prompt.text.trim(), '', contextBlock(manifest), '');
if (stage === 'reader') lines.push(`Also set \`tx.reader = {"provider": "agent", "model": "${model}", "promptVersion": "${prompt.version}", "at": "<ISO time>"}\` in the top-level tx block.`, '');
if (stage === 'checker') lines.push(`Add \`"candidateSha256": "${checker.candidateSha256}"\` at the top level of your output (receipt.mjs refuses a check that does not name the bytes it checked).`, '');
if (stage === 'adjudicator') lines.push(`Set \`tx.adjudicator = {"provider": "agent", "model": "${model}", "promptVersion": "${prompt.version}", "at": "<ISO time>", "basedOn": [<candidate view files>]}\` in the gold JSON's top-level tx block, and keep \`tx.reader\` from the candidate you started from.`, '');
h(stage === 'adjudicator' ? 'Write the corrected gold JSON to' : 'Write the JSON object to');
lines.push(`- ${out}`, '');
if (adj) { h('Write the adjudication JSON (per-candidate defects, true/false positives per checker finding) to'); lines.push(`- ${adj.adjudication}`, ''); }
h('Then run');
lines.push('```', task.validateCmd, '```', '');
lines.push(stage === 'reader'
  ? 'Fix every error the validator reports (it checks schema, ids, points, LaTeX, figure boxes) and re-run until it exits 0. Do not upload figures, do not touch content/problems — the pipeline continues from the validated candidate.'
  : stage === 'checker'
    ? 'Do not edit the candidate. Your defects list is consumed by scripts/tx/receipt.mjs; repairs are made by scripts/tx/repair.mjs or the adjudicator, then a fresh checker run is required.'
    : 'Fix every validator error in the gold JSON and re-run until it exits 0. The gold JSON re-enters the pipeline at validate → figures → checker → receipt (node scripts/tx/run.mjs ' + paperId + ' --continue --repaired <gold file>).');
console.log(lines.join('\n'));
