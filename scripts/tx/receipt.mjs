#!/usr/bin/env node
// receipt.mjs <paperId> --candidate <f> --defects <checker.json> --reviewer provider:model:requestId
//   [--prompt-version v1] [--out <file>] [--allow-same-model] [--adjudicator provider:model:id]
// Turns a checker result into a publication receipt bound to the EXACT bytes
// promote.mjs will write. A receipt is `pass` only when ALL of these hold:
//   - the checker's verdict is pass and it lists no critical/major/minor defect
//     (a `resolved` flag on a defect means nothing here — repairs are followed by
//     a fresh checker run, never by editing the defect list);
//   - the checker output names the sha256 of the candidate bytes it looked at and
//     it equals the candidate given (so a repaired candidate cannot ride on an
//     older check);
//   - every figure was cropped, uploaded and HEAD-verified by figures.mjs (no
//     --dry-run leftovers, no bare boxes);
//   - the final bytes pass the committed schema (promote-proof);
//   - reader and checker are different models (or --allow-same-model was given,
//     which is recorded and makes the page say "same-model checker").
// Otherwise verdict is fail (or escalate when the checker said so) and the
// blockers are listed. Exit 0 pass / 3 escalate / 1 fail.
import path from 'node:path';
import { checkerEvidenceProblems } from './evidence.mjs';
import {
  parseArgs, fail, readJson, writeJson, readManifest, paperDir, buildFinalPaper, provenanceFor, compileSchema, figureEvidenceProblems,
  independence, nowIso, sha256File,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['allow-same-model'] });
const paperId = args._[0];
if (!paperId || !args.candidate || !args.defects || !args.reviewer) fail('usage: receipt.mjs <paperId> --candidate <f> --defects <checker.json> --reviewer provider:model:requestId [--prompt-version v1] [--out <file>] [--allow-same-model] [--adjudicator provider:model:id]');
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}`);
const candFile = path.resolve(args.candidate);
const candidate = readJson(candFile, null);
const checker = readJson(path.resolve(args.defects), null);
if (!candidate || !checker) fail('candidate or checker output not readable');
if (candidate.paper?.id !== paperId) fail(`candidate paper.id ${candidate.paper?.id} != ${paperId}`);
const parseWho = (s, what) => { const [provider, model, ...rest] = String(s).split(':'); const id = rest.join(':'); if (!provider || !model || !id) fail(`--${what} must be provider:model:id`); return { provider, model, requestId: id }; };
const reviewer = parseWho(args.reviewer, 'reviewer');
const promptVersion = args['prompt-version'] || checker.checker?.promptVersion || 'v1';
const adjudicator = args.adjudicator ? parseWho(args.adjudicator, 'adjudicator') : (candidate.tx?.adjudicator ? { provider: candidate.tx.adjudicator.provider || 'agent', model: candidate.tx.adjudicator.model || 'unknown', requestId: candidate.tx.adjudicator.requestId || candidate.tx.adjudicator.at || 'n/a' } : null);

const candidateSha256 = sha256File(candFile);
const blockers = checkerEvidenceProblems(checker, candidate, manifest, candidateSha256);
const claimedSha = checker.candidateSha256 || checker.checker?.candidateSha256 || null;

const defects = Array.isArray(checker.defects) ? checker.defects : [];
const unresolved = defects.filter(d => d.severity !== 'info');
const ignoredResolvedFlags = unresolved.filter(d => d.resolved).length;

for (const p of figureEvidenceProblems(candidate)) blockers.push(`${p.path}: ${p.message}`);

const reader = candidate.tx?.reader || {};
const indep = independence(reader, reviewer);
const allowSame = !!args['allow-same-model'];
if (!indep.independent && !allowSame) blockers.push(`reader ${reader.provider}:${reader.model} and checker ${reviewer.provider}:${reviewer.model} are the same model; pass --allow-same-model to accept a same-model check (recorded on the page)`);

const checkedAt = nowIso();
const sourceHashes = { problems: manifest.documents.problems.sha256, ...(manifest.documents.solutions ? { solutions: manifest.documents.solutions.sha256 } : {}) };
const prov = provenanceFor(candidate, { reviewer, promptVersion, checkedAt, sourceHashes, independent: indep.independent, adjudicator });
const final = buildFinalPaper(candidate, prov);
const { validate } = compileSchema('final');
if (!validate(final.data)) for (const e of validate.errors.slice(0, 10)) blockers.push(`final bytes fail schema at ${e.dataPath || '/'}: ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);

let verdict;
if (checker.verdict === 'escalate') verdict = 'escalate';
else if (checker.verdict === 'pass' && unresolved.length === 0 && blockers.length === 0) verdict = 'pass';
else verdict = 'fail';

const receipt = {
  paperId, verdict,
  contentHash: final.contentHash,
  sourceHashes,
  reviewer, checkedAt, promptVersion,
  reader: { provider: prov.provider, model: prov.model, promptVersion: prov.promptVersion, promptSha256: prov.promptSha256 ?? null, requestId: prov.requestId, at: prov.at },
  independence: { ...indep, allowSameModel: allowSame },
  adjudicator,
  checkerVerdict: checker.verdict ?? null, summary: checker.summary || null, coverage: checker.coverage || null,
  defects: unresolved.map(d => ({ path: d.path, document: d.document, page: d.page, severity: d.severity, kind: d.kind, description: d.description, suggestedFix: d.suggestedFix ?? null, confidence: d.confidence })),
  informational: defects.filter(d => d.severity === 'info').length,
  ignoredResolvedFlags,
  blockers,
  candidate: candFile, candidateSha256, checkerCandidateSha256: claimedSha,
  checkerCrops: checker.checker?.crops ?? null,
};
const out = path.resolve(args.out || path.join(paperDir(paperId), 'receipt.json'));
writeJson(out, receipt);
console.log(JSON.stringify({ paperId, verdict, contentHash: receipt.contentHash, unresolved: unresolved.length, blockers, independent: indep.independent, out }, null, 2));
process.exit(verdict === 'pass' ? 0 : verdict === 'escalate' ? 3 : 1);
