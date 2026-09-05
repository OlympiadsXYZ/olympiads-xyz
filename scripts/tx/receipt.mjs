#!/usr/bin/env node
// receipt.mjs <paperId> --candidate <f> --defects <checker.json> --reviewer provider:model:requestId --prompt-version v1 [--out <file>]
// Turns a checker result into a publication receipt bound to the EXACT bytes
// promote.mjs will write. verdict: pass only with zero unresolved defects;
// escalate when the checker could not settle something; fail otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, fail, readJson, writeJson, readManifest, paperDir, buildFinalPaper, nowIso, sha256File } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const paperId = args._[0];
if (!paperId || !args.candidate || !args.defects || !args.reviewer) fail('usage: receipt.mjs <paperId> --candidate <f> --defects <checker.json> --reviewer provider:model:requestId --prompt-version v1 [--out <file>]');
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}`);
const candidate = readJson(path.resolve(args.candidate));
const checker = readJson(path.resolve(args.defects));
if (!candidate || !checker) fail('candidate or checker output not readable');
if (candidate.paper?.id !== paperId) fail(`candidate paper.id ${candidate.paper?.id} != ${paperId}`);
const [provider, model, ...rest] = String(args.reviewer).split(':');
const requestId = rest.join(':');
if (!provider || !model || !requestId) fail('--reviewer must be provider:model:requestId');
const promptVersion = args['prompt-version'] || 'v1';

const defects = Array.isArray(checker.defects) ? checker.defects : [];
const unresolved = defects.filter(d => d.severity !== 'info' && !d.resolved);
let verdict;
if (checker.verdict === 'escalate') verdict = 'escalate';
else if (unresolved.length === 0 && checker.verdict === 'pass') verdict = 'pass';
else if (unresolved.length === 0 && checker.verdict !== 'pass') verdict = checker.verdict === 'fail' ? 'fail' : 'escalate';
else verdict = 'fail';

const reader = candidate.tx?.reader || {};
const checkedAt = nowIso();
const prov = {
  provider: reader.provider || 'unknown', model: reader.model || 'unknown', promptVersion: reader.promptVersion || promptVersion,
  at: reader.at || candidate.tx?.at || checkedAt.slice(0, 10),
  sourceSha256: { problems: manifest.documents.problems.sha256, ...(manifest.documents.solutions ? { solutions: manifest.documents.solutions.sha256 } : {}) },
  verifiedBy: `${provider}:${model} (independent checker, prompt ${promptVersion})`,
  verifiedAt: checkedAt.slice(0, 10),
};
const final = buildFinalPaper(candidate, prov);
const receipt = {
  paperId, verdict,
  contentHash: final.contentHash,
  sourceHashes: prov.sourceSha256,
  reviewer: { provider, model, requestId },
  checkedAt, promptVersion,
  reader: { provider: prov.provider, model: prov.model, promptVersion: prov.promptVersion, requestId: reader.requestId || null },
  checkerVerdict: checker.verdict, summary: checker.summary || null, coverage: checker.coverage || null,
  defects: unresolved.map(d => ({ path: d.path, document: d.document, page: d.page, severity: d.severity, kind: d.kind, description: d.description, suggestedFix: d.suggestedFix ?? null, confidence: d.confidence })),
  informational: defects.filter(d => d.severity === 'info').length,
  resolvedDefects: defects.filter(d => d.resolved && d.severity !== 'info').length,
  droppedTranscriptionFields: final.droppedTranscriptionFields,
  candidate: path.resolve(args.candidate), candidateSha256: sha256File(path.resolve(args.candidate)),
};
const out = path.resolve(args.out || path.join(paperDir(paperId), 'receipt.json'));
writeJson(out, receipt);
console.log(JSON.stringify({ paperId, verdict, contentHash: receipt.contentHash, unresolved: unresolved.length, out }, null, 2));
process.exit(verdict === 'pass' ? 0 : verdict === 'escalate' ? 3 : 1);
