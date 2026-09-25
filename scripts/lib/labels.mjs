// The archive's Bulgarian labels (src/archive/labels.ts), read by the Node scripts without a TypeScript toolchain.
// The maps there are plain object literals of strings; this reads exactly those two and fails loudly if the file
// changes shape, so a problem page never quietly falls back to the Latin code again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABELS_TS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'archive', 'labels.ts');

function objectLiteral(source, name) {
  const start = source.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`${LABELS_TS}: no ${name}`);
  const open = source.indexOf('= {', start);
  const close = source.indexOf('\n};', open);
  if (open < 0 || close < 0) throw new Error(`${LABELS_TS}: cannot find the body of ${name}`);
  // full-line comments only; the values themselves hold no "//"
  return source.slice(open + 3, close).replace(/^\s*\/\/.*$/gm, '');
}

const KEY = String.raw`(?:'([^']+)'|([A-Za-z][\w-]*))`;

export function readArchiveLabels(file = LABELS_TS) {
  const source = fs.readFileSync(file, 'utf8');

  const metaBody = objectLiteral(source, 'COMPETITION_META');
  const competitionShort = {};
  for (const m of metaBody.matchAll(new RegExp(`${KEY}\\s*:\\s*\\{([^{}]*)\\}`, 'g'))) {
    const short = /\bshort:\s*'([^']*)'/.exec(m[3]);
    if (!short) throw new Error(`${file}: COMPETITION_META.${m[1] ?? m[2]} has no short name`);
    competitionShort[m[1] ?? m[2]] = short[1];
  }
  const entries = (metaBody.match(/\bslug:/g) || []).length;
  if (Object.keys(competitionShort).length !== entries || competitionShort.NOF !== 'НОФ') {
    throw new Error(`${file}: read ${Object.keys(competitionShort).length} of ${entries} COMPETITION_META entries`);
  }

  const roundLabels = {};
  for (const m of objectLiteral(source, 'ROUND_LABELS').matchAll(new RegExp(`${KEY}\\s*:\\s*'([^']*)'`, 'g'))) {
    roundLabels[m[1] ?? m[2]] = m[3];
  }
  if (roundLabels.III !== 'III кръг (национален)' || roundLabels.theory !== 'Теоретичен тур') {
    throw new Error(`${file}: ROUND_LABELS did not read as expected`);
  }
  return { competitionShort, roundLabels };
}
