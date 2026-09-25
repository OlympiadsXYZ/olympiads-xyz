#!/usr/bin/env node
// single-pass-receipt.mjs <id> --candidate <file> --evidence <reader.json> --out <receipt>
// Explicit single-reader workflow. Automated gates are not a model checker.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { singlePassEvidenceProblems } from './single-pass-evidence.mjs';
import { sourceConversions, sourceConversionProblems } from './source-conversions.mjs';
import { supplementarySourceErrors } from './supplements.mjs';
import {
  ROOT, parseArgs, fail, readJson, writeJson, readManifest, paperDir,
  sha256File, buildFinalPaper, provenanceFor, compileSchema, figureEvidenceProblems, nowIso,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const paperId = args._[0];
if (!paperId || !args.candidate || !args.evidence || !args.out) fail('usage: single-pass-receipt.mjs <id> --candidate <file> --evidence <reader.json> --out <receipt>');
const manifest = readManifest(paperId);
const candidatePath = path.resolve(args.candidate);
const candidate = readJson(candidatePath, null);
const evidence = readJson(path.resolve(args.evidence), null);
if (!manifest || !candidate || !evidence) fail('manifest, candidate or reader evidence missing');
if (candidate.paper?.id !== paperId) fail('candidate paper id mismatch');
const candidateSha256 = sha256File(candidatePath);
const blockers = singlePassEvidenceProblems(evidence, candidate, manifest, candidateSha256);
blockers.push(...sourceConversionProblems(manifest, paperDir(paperId)));
for (const e of supplementarySourceErrors(candidate, manifest)) blockers.push(`${e.path}: ${e.message}`);
for (const e of figureEvidenceProblems(candidate)) blockers.push(`${e.path}: ${e.message}`);
const validationRun = spawnSync(process.execPath, [path.join(ROOT, 'scripts/tx/validate.mjs'), candidatePath, '--paper-id', paperId, '--manifest', path.join(paperDir(paperId), 'manifest.json')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
let validation;
try { validation = JSON.parse(validationRun.stdout); }
catch { blockers.push(`automated validation did not return a report: ${validationRun.stderr || validationRun.error || ''}`); }
if (validationRun.status !== 0 || validation?.ok !== true) blockers.push('automated schema/math/source validation failed');
if (validation?.errors) for (const e of validation.errors) blockers.push(`${e.path}: ${e.message}`);
const checkedAt = nowIso();
const reviewer = { provider: 'mechanical', model: 'single-pass-gates', requestId: candidateSha256 };
const sourceHashes = Object.fromEntries(Object.entries(manifest.documents).map(([id, d]) => [id, d.sha256]));
const promptVersion = candidate.tx?.reader?.promptVersion || 'v1';
const adjudicator = candidate.tx?.adjudicator ? {
  provider: candidate.tx.adjudicator.provider,
  model: candidate.tx.adjudicator.model,
  requestId: candidate.tx.adjudicator.requestId || 'source-adjudication',
} : null;
const prov = provenanceFor(candidate, { reviewer, promptVersion, checkedAt, sourceHashes, independent: false, adjudicator, mode: 'single-pass' });
const final = buildFinalPaper(candidate, prov);
const { validate } = compileSchema('final');
if (!validate(final.data)) for (const e of validate.errors) blockers.push(`final schema ${e.dataPath || '/'}: ${e.message}`);
const receipt = {
  paperId, verdict: blockers.length ? 'fail' : 'pass', contentHash: final.contentHash,
  sourceConversions: sourceConversions(manifest),
  sourceHashes, reviewer, checkedAt, promptVersion, checkerMode: 'single-pass',
  reader: { provider: prov.provider, model: prov.model, requestId: prov.requestId, at: prov.at, promptVersion: prov.promptVersion },
  adjudicator, independence: { independent: false, differentProvider: false, allowSameModel: true, separateChecker: false },
  checkerVerdict: null, summary: 'Single-pass source transcription with automated validation; no separate model checker.',
  readerEvidence: evidence, coverage: { pagesRead: evidence.pagesRead, problemsRead: evidence.problemsRead, figuresInspected: evidence.figuresInspected },
  automatedChecks: { schemaAndMath: validation?.ok === true, figureEvidence: figureEvidenceProblems(candidate).length === 0, warnings: validation?.warnings || [] },
  defects: [], blockers, informational: evidence.sourceGaps?.length || 0,
  candidate: candidatePath, candidateSha256, checkerCandidateSha256: null,
};
writeJson(path.resolve(args.out), receipt);
console.log(JSON.stringify({ paperId, verdict: receipt.verdict, mode: 'single-pass', contentHash: final.contentHash, blockers, out: path.resolve(args.out) }, null, 2));
process.exit(receipt.verdict === 'pass' ? 0 : 1);
