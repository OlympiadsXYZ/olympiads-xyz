// Read the same TypeScript maps used by the archive and sidebar. Transpiling avoids
// fragile source regexes (Prettier removes quotes from Cyrillic object keys).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const LABELS_TS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'archive', 'labels.ts');

export function readArchiveLabels(file = LABELS_TS) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('exports', 'module', compiled)(module.exports, module);
  const { COMPETITION_META, ROUND_LABELS } = module.exports;
  if (!COMPETITION_META || !ROUND_LABELS) throw new Error(`${file}: missing label maps`);
  const competitionShort = Object.fromEntries(Object.entries(COMPETITION_META).map(([key, value]) => {
    if (typeof value.short !== 'string') throw new Error(`${file}: ${key} has no short name`);
    return [key, value.short];
  }));
  return { competitionShort, roundLabels: ROUND_LABELS };
}
