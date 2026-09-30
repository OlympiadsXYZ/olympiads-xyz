#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readJson,
  readPapers,
  atomicWrite,
  jsonText,
} from './lib/problem-data.mjs';
import { withFileLockSync } from './lib/file-lock.mjs';
import { readConsolidations } from './lib/problem-consolidations.mjs';
const args = process.argv.slice(2),
  rootAt = args.indexOf('--root');
const root =
  rootAt >= 0
    ? path.resolve(args[rootAt + 1])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'content/problem-publication.json');
withFileLockSync(file + '.lock', () => {
  const ledger = readJson(file, { version: 1, papers: {} }),
    records = readPapers(root);
  const { config } = readConsolidations(root, records, ledger, {
    beforeRetirement: true,
  });
  if (!args.includes('--apply')) {
    console.log(
      JSON.stringify({ validated: config.papers.length, applied: false })
    );
    return;
  }
  for (const entry of config.papers) {
    const old = ledger.papers[entry.paperId];
    const evidence = {
      contentHash: entry.contentHash,
      canonicalContentHash: entry.canonicalContentHash,
      sourceAudit: entry.sourceAudit,
      problemMappings: entry.problemMappings,
      kind: 'source-correspondence-audit',
      independentModelCheck: false,
    };
    if ((entry.mode || 'paper') === 'paper') {
      old.supersededBy = entry.canonicalPaperId;
      old.supersededReason = entry.reason;
      old.supersededAt ||= new Date().toISOString();
      old.consolidationEvidence = evidence;
    } else {
      old.consolidatedProblems ||= [];
      for (const m of entry.problemMappings) {
        const previous = old.consolidatedProblems.findIndex(
          p => p.fromId === m.fromId
        );
        const record = {
          ...m,
          canonicalPaperId: entry.canonicalPaperId,
          canonicalContentHash: entry.canonicalContentHash,
          sourceContentHash: entry.contentHash,
          reason: entry.reason,
          sourceAudit: entry.sourceAudit,
          kind: evidence.kind,
          independentModelCheck: false,
        };
        if (previous >= 0) old.consolidatedProblems[previous] = record;
        else old.consolidatedProblems.push(record);
      }
    }
  }
  atomicWrite(file, jsonText(ledger));
  console.log(
    JSON.stringify({
      validated: config.papers.length,
      applied: true,
      sourceAndReceiptFilesPreserved: true,
    })
  );
});
