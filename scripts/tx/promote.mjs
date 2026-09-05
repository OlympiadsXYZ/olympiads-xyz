#!/usr/bin/env node
// promote.mjs <paperId> --candidate <f> --receipt <r> [--replace] [--no-approve]
// The sole publisher: writes content/problems/<subject>/<COMP>/<year>/<paperId>.json
// from the candidate (tx stripped, provenance stamped, status review), runs
// normalise-papers, stores the receipt under content/problem-receipts/, then
// records approval through scripts/publication.mjs. Refuses on verdict != pass
// or on any hash mismatch between receipt and the bytes actually written.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, fail, readJson, readManifest, buildFinalPaper, sha256File, contentPathFor, run, ROOT, nowIso, writeJson,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['replace', 'no-approve'] });
const paperId = args._[0];
if (!paperId || !args.candidate || !args.receipt) fail('usage: promote.mjs <paperId> --candidate <f> --receipt <r> [--replace] [--no-approve]');
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}`);
const candidate = readJson(path.resolve(args.candidate));
const receipt = readJson(path.resolve(args.receipt));
if (!candidate || !receipt) fail('candidate or receipt not readable');
if (receipt.paperId !== paperId || candidate.paper?.id !== paperId) fail('paper id mismatch between arguments, candidate and receipt');
if (receipt.verdict !== 'pass') fail(`receipt verdict is "${receipt.verdict}", not pass — nothing promoted`);
if (receipt.defects?.length) fail(`receipt lists ${receipt.defects.length} unresolved defect(s) — nothing promoted`);
if (sha256File(path.resolve(args.candidate)) !== receipt.candidateSha256) fail('candidate bytes changed since the receipt was written');
for (const doc of ['problems', 'solutions']) {
  if (receipt.sourceHashes?.[doc] && manifest.documents[doc]?.sha256 !== receipt.sourceHashes[doc]) fail(`source hash mismatch for ${doc} document`);
}

const prov = {
  provider: receipt.reader?.provider || 'unknown', model: receipt.reader?.model || 'unknown', promptVersion: receipt.reader?.promptVersion || receipt.promptVersion,
  at: candidate.tx?.reader?.at || candidate.tx?.at || receipt.checkedAt.slice(0, 10),
  sourceSha256: receipt.sourceHashes,
  verifiedBy: `${receipt.reviewer.provider}:${receipt.reviewer.model} (independent checker, prompt ${receipt.promptVersion})`,
  verifiedAt: receipt.checkedAt.slice(0, 10),
};
const final = buildFinalPaper(candidate, prov);
if (final.contentHash !== receipt.contentHash) fail(`content hash mismatch: receipt ${receipt.contentHash.slice(0, 12)}… vs rebuilt ${final.contentHash.slice(0, 12)}… (schema or candidate changed since the receipt)`);

const target = contentPathFor(paperId, { subject: final.data.paper.subject, competition: final.data.paper.competition, year: final.data.paper.year });
if (fs.existsSync(target) && !args.replace) fail(`${path.relative(ROOT, target)} already exists; pass --replace to overwrite (the publication ledger will then need a new approval)`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, final.bytes);

// normalise must be a no-op on what we wrote; if it changes bytes the receipt no longer applies
run('node', [path.join(ROOT, 'scripts', 'normalise-papers.mjs')]);
const onDisk = sha256File(target);
if (onDisk !== receipt.contentHash) {
  fs.rmSync(target);
  fail('normalise-papers.mjs changed the promoted bytes; receipt no longer matches — fix canonicalisation in scripts/tx/lib.mjs and re-run receipt.mjs');
}
// schema check of the final artefact
const { compileSchema } = await import('./lib.mjs');
const { validate } = compileSchema('final');
if (!validate(final.data)) { fs.rmSync(target); fail(`promoted paper fails schema: ${JSON.stringify(validate.errors.slice(0, 3))}`); }

const receiptDir = path.join(ROOT, 'content', 'problem-receipts');
const storedReceipt = path.join(receiptDir, `${paperId}.json`);
writeJson(storedReceipt, { ...receipt, promotedAt: nowIso(), promotedFile: path.relative(ROOT, target) });

let approved = false;
if (!args['no-approve']) {
  const pub = path.join(ROOT, 'scripts', 'publication.mjs');
  if (!fs.existsSync(pub)) fail(`scripts/publication.mjs is missing — promoted ${path.relative(ROOT, target)} and stored the receipt, but the publication ledger was NOT updated. Port publication.mjs (Codex worktree) and run: node scripts/publication.mjs approve --paper ${paperId} --receipt ${path.relative(ROOT, storedReceipt)}`);
  const r = run('node', [pub, 'approve', '--paper', paperId, '--receipt', storedReceipt], { allowFail: true });
  if (r.status !== 0) fail(`publication.mjs approve failed: ${(r.stderr || r.stdout).slice(0, 500)}`);
  approved = true;
  process.stdout.write(r.stdout);
}
console.log(JSON.stringify({ paperId, file: path.relative(ROOT, target), contentHash: onDisk, receipt: path.relative(ROOT, storedReceipt), approved, droppedTranscriptionFields: final.droppedTranscriptionFields }, null, 2));
