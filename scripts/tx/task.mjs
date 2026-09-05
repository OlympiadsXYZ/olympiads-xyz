#!/usr/bin/env node
// task.mjs <paperId> --stage reader|checker [--candidate <file>] --out <file> [--model <label>] [--prompt-version v1] [--json]
// Prints a self-contained task for a harness agent (Claude-tier reader without
// API keys): the prompt, the exact page images to Read in order, the output
// path and the validate command to run afterwards. Nothing is executed here.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, fail, readManifest, loadPrompt, pageImages, contextBlock, paperDir, ROOT, nowIso } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['json'] });
const paperId = args._[0];
const stage = args.stage;
if (!paperId || !['reader', 'checker'].includes(stage) || !args.out) fail('usage: task.mjs <paperId> --stage reader|checker [--candidate <file>] --out <file> [--model <label>]');
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}; run prepare.mjs first`);
const pages = pageImages(manifest);
if (pages.some(p => !fs.existsSync(p.file))) fail('rendered pages are missing (prepare.mjs --gc was run?); re-run prepare.mjs');
const prompt = loadPrompt(stage, args['prompt-version'] || 'v1');
const out = path.resolve(args.out);
const model = args.model || 'agent';
let candidate = null;
if (stage === 'checker') {
  if (!args.candidate) fail('--candidate is required for the checker stage');
  candidate = path.resolve(args.candidate);
  if (!fs.existsSync(candidate)) fail(`candidate not found: ${candidate}`);
}
const textFiles = Object.values(manifest.documents).map(d => path.join(paperDir(paperId), d.text));
const validateCmd = stage === 'reader'
  ? `node scripts/tx/validate.mjs ${path.relative(ROOT, out)} --paper-id ${paperId} --manifest ${path.relative(ROOT, path.join(paperDir(paperId), 'manifest.json'))}`
  : `node -e "JSON.parse(require('fs').readFileSync('${path.relative(ROOT, out)}','utf8'))" && echo checker-output-parses`;

const task = {
  paperId, stage, model, promptVersion: prompt.version, promptSha256: prompt.sha256, createdAt: nowIso(),
  pages: pages.map(p => ({ document: p.document, page: p.page, file: p.file })),
  textLayer: textFiles,
  candidate, out, validateCmd,
  expectedProvenance: stage === 'reader'
    ? { 'tx.reader': { provider: 'agent', model, promptVersion: prompt.version, at: '<ISO time when finished>' } }
    : { 'reviewer': `agent:${model}:<session or message id>` },
};
if (args.json) { console.log(JSON.stringify(task, null, 2)); process.exit(0); }

const lines = [];
lines.push(`# Transcription task — ${stage} — ${paperId}`, '');
lines.push(`Model label: ${model}. Prompt: ${path.relative(ROOT, prompt.file)} (v${prompt.version.replace(/^v/, '')}, sha256 ${prompt.sha256.slice(0, 12)}).`, '');
lines.push('## 1. Read these page images with the Read tool, in this order', '');
for (const p of task.pages) lines.push(`- ${p.document} page ${p.page}: ${p.file}`);
lines.push('', 'Text layer (spelling cross-check only, never a source):', ...textFiles.map(f => `- ${f}`), '');
if (candidate) lines.push('## 2. Read the candidate transcription', '', `- ${candidate}`, '');
lines.push(`## ${candidate ? 3 : 2}. Follow this prompt`, '', prompt.text.trim(), '', contextBlock(manifest), '');
if (stage === 'reader') lines.push(`Also set \`tx.reader = {"provider": "agent", "model": "${model}", "promptVersion": "${prompt.version}", "at": "<ISO time>"}\` in the top-level tx block.`, '');
lines.push(`## ${candidate ? 4 : 3}. Write the JSON object to`, '', `- ${out}`, '');
lines.push(`## ${candidate ? 5 : 4}. Then run`, '', '```', validateCmd, '```', '');
lines.push(stage === 'reader'
  ? 'Fix every error the validator reports (it checks schema, ids, points, LaTeX, figure boxes) and re-run until it exits 0. Do not upload figures, do not touch content/problems — the pipeline continues from the validated candidate.'
  : 'Do not edit the candidate. Your defects list is consumed by scripts/tx/receipt.mjs.');
console.log(lines.join('\n'));
