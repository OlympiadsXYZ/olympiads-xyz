#!/usr/bin/env node
// Read-only gate for the source-audited discovery overlay. No paper, route,
// receipt or generated-content mutation belongs here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPapers, readJson, publicationState } from './lib/problem-data.mjs';
import { loadTsModule } from './lib/load-tree.mjs';
import { readConsolidations } from './lib/problem-consolidations.mjs';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function inspectPrimaryEditions(
  root = REPO,
  records = readPapers(root),
  availableIds
) {
  const file = path.join(root, 'content/problem-editions.json');
  const config = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : null;
  const api = loadTsModule(path.join(root, 'src/problems/editions.ts'), root);
  const ids =
    availableIds ??
    new Set(records.flatMap(r => r.data.problems.map(p => p.id)));
  const projection = api.buildEditionProjection(
    config,
    records.map(r => r.data),
    ids,
    new Map(records.map(r => [r.data.paper.id, r.contentHash]))
  );
  return { config, projection, api };
}

function main() {
  const arg = process.argv.indexOf('--root');
  const root = arg < 0 ? REPO : path.resolve(process.argv[arg + 1]);
  const records = readPapers(root),
    ledger = readJson(
      path.join(root, 'content/problem-publication.json'),
      null
    );
  const eligible = records.filter(r => publicationState(r, ledger).eligible);
  const storedIds = new Set(
    eligible.flatMap(r => r.data.problems.map(p => p.id))
  );
  const { retiredProblemIds } = readConsolidations(root, records, ledger);
  const ids = new Set([...storedIds].filter(id => !retiredProblemIds.has(id)));
  const { config, projection } = inspectPrimaryEditions(root, records, ids);
  for (const issue of projection.issues) console.error(issue);
  console.log(
    `primary-editions: ${config?.groups?.length ?? 0} audited groups; ${
      storedIds.size
    } eligible stored problem editions; ${
      storedIds.size - ids.size
    } consolidated duplicate problems excluded; ${
      ids.size - projection.suppressedIds.size
    } primary discovery problems; ${
      projection.suppressedIds.size
    } alternate editions remain on their existing routes; ${
      projection.issues.length
    } failure(s).`
  );
  if (projection.issues.length) process.exitCode = 1;
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
  main();
