#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPapers, readJson, sha256, atomicWrite, jsonText, publicationState } from './lib/problem-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...args] = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const file = path.join(root, 'content/problem-publication.json');
const ledger = readJson(file, { version: 1, papers: {} });

if (command === 'adopt-legacy') {
  // Explicit, one-time migration of already released content. This records
  // history; it never pretends a model or human reviewed these bytes today.
  if (!args.includes('--source-ref')) throw new Error('--source-ref is required');
  const commit = execFileSync('git', ['rev-parse', '--verify', option('--source-ref') + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
  let adopted = 0;
  for (const record of readPapers(root)) {
    if (ledger.papers[record.data.paper.id]) continue;
    let historical;
    try { historical = execFileSync('git', ['show', `${commit}:${record.relativePath}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { continue; }
    if (sha256(historical) !== record.contentHash) continue;
    ledger.papers[record.data.paper.id] = { kind: 'legacy', contentHash: record.contentHash, sourceCommit: commit, recordedAt: new Date().toISOString() };
    adopted++;
  }
  atomicWrite(file, jsonText(ledger));
  console.log(`Recorded ${adopted} legacy revisions from ${commit}; no verification was claimed.`);
} else if (command === 'approve') {
  if (!args.includes('--paper') || !args.includes('--receipt')) throw new Error('--paper and --receipt are required');
  const record = readPapers(root).find(p => p.data.paper.id === option('--paper'));
  if (!record) throw new Error('Paper not found');
  const review = JSON.parse(fs.readFileSync(option('--receipt'), 'utf8'));
  const entry = { kind: 'reviewed', contentHash: record.contentHash, recordedAt: new Date().toISOString(), review };
  if (!publicationState(record, { papers: { [record.data.paper.id]: entry } }).eligible) throw new Error('Receipt must pass for these exact bytes, identify reviewer and sources, and have no unresolved defects; draft papers cannot be approved.');
  ledger.papers[record.data.paper.id] = entry;
  atomicWrite(file, jsonText(ledger));
  console.log(`Approved ${record.data.paper.id} at ${record.contentHash}`);
} else if (command === 'attach-evidence') {
  // Historical provenance mined from agent journals (transcriber/verifier
  // identity, verdict, defect counts). It documents how a legacy revision came
  // to be; it never changes kind, contentHash or eligibility (D-P2).
  if (!args.includes('--file')) throw new Error('--file is required');
  const input = JSON.parse(fs.readFileSync(option('--file'), 'utf8'));
  const byPaper = input.papers && typeof input.papers === 'object' ? input.papers : input;
  let attached = 0, missing = 0, notLegacy = 0;
  for (const [paperId, evidence] of Object.entries(byPaper)) {
    if (paperId === 'version' || paperId === 'generatedAt' || paperId === 'summary') continue;
    const entry = ledger.papers[paperId];
    if (!entry) { missing++; continue; }
    if (entry.kind !== 'legacy') { notLegacy++; continue; }
    const { transcriber = null, verifier = null, postVerificationEdits = null, note = null, ...rest } = evidence || {};
    // machine-local paths mean nothing in the repository
    for (const actor of [transcriber, verifier]) if (actor && typeof actor === 'object') delete actor.jsonFile;
    entry.evidence = { transcriber, verifier, postVerificationEdits, ...(note ? { note } : {}), ...rest, attachedAt: new Date().toISOString() };
    attached++;
  }
  atomicWrite(file, jsonText(ledger));
  console.log(`Attached evidence to ${attached} legacy entries (${missing} paper ids not in ledger, ${notLegacy} non-legacy entries left untouched). Eligibility and quality unchanged.`);
} else if (command === 'status') {
  const counts = {};
  for (const record of readPapers(root)) {
    const state = publicationState(record, ledger), key = state.quality || state.reason;
    counts[key] = (counts[key] || 0) + 1;
    if (!state.eligible) console.log(`${record.data.paper.id}: ${key}`);
  }
  console.log(JSON.stringify(counts));
} else {
  console.log('publication.mjs adopt-legacy --source-ref COMMIT | approve --paper ID --receipt FILE | attach-evidence --file FILE | status');
  process.exitCode = 1;
}
