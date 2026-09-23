#!/usr/bin/env node
// queue-start.mjs <queue.json> <paperId> [run.mjs options...]
// Starts run.mjs for one paper of a queue file ({papers: [{id, problemsKey, solutionsKey}]}) with the
// archive keys taken from the queue, so no agent or orchestrator ever retypes a key. Options after the id
// go to run.mjs unchanged; without any, the agent-route defaults apply. Exits with run.mjs's code.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [queueFile, paperId, ...rest] = process.argv.slice(2);
if (!queueFile || !paperId) {
  console.error(
    'usage: queue-start.mjs <queue.json> <paperId> [run.mjs options...]'
  );
  process.exit(1);
}
const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
const entry = (queue.papers || queue).find(p => p.id === paperId);
if (!entry) {
  console.error(`queue-start: ${paperId} is not in ${queueFile}`);
  process.exit(1);
}
if (!entry.problemsKey) {
  console.error(`queue-start: ${paperId} has no problemsKey in ${queueFile}`);
  process.exit(1);
}
const options = rest.length
  ? rest
  : [
      '--reader',
      'agent:opus-5-5',
      '--checker',
      'mechanical:textlayer+regions',
      '--max-rounds',
      '2',
      '--window-pages',
      '8',
    ];
const args = [
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'run.mjs'),
  paperId,
  ...options,
  '--problems',
  entry.problemsKey,
];
if (entry.solutionsKey) args.push('--solutions', entry.solutionsKey);
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
