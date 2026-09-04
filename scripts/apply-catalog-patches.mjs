#!/usr/bin/env node
// Applies the archive-fix patches to archive-catalog/*.json.
//
//   node scripts/apply-catalog-patches.mjs [--dir tmp/archive-fix] [--dry-run] [--json]
//
// Patch files: <dir>/*.patch.json, each an array of
//   { id, set: { field: value, ... }, evidence, decision }
// applied in file-name order (so `unicode-and-labels` lands before
// `vocabulary`, as vocabulary.decisions.md requires), patch order within a file.
//
// Rules:
//   - `set` fields are written onto the catalog entry with that `id`. A patch
//     whose id is unknown, or any of whose values falls outside the vocabulary
//     of archive-catalog/schema.json (kind/round/type/lang/group enums, year
//     range, id/competition patterns, string bounds), is refused as a whole.
//   - `set.id_new` renames the entry's `id`, only if nothing else references
//     the old id (other catalog entries, or any text file under src/, docs/,
//     scripts/, content/ and the repo root). A file that names both the old
//     and the new id is recording the rename (e.g. the decisions log), not
//     consuming the old id, and does not block it. Later patches that still
//     name the old id are resolved through the rename map.
//   - `duplicateOf` must point at an existing id (after renames) and never at
//     the entry itself.
//   - Deterministic and idempotent: re-running reports every patch as no-op and
//     rewrites nothing. Catalog files are re-serialised with the indentation
//     they already use; untouched files are not written.
//
// Exit code: 0 when every patch applied (or was already applied), 1 when at
// least one patch was refused (the valid ones are still applied), 2 on I/O.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = path.join(ROOT, 'archive-catalog');
const SCHEMA_PATH = path.join(CATALOG_DIR, 'schema.json');

const argv = process.argv.slice(2);
const argOf = name => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const PATCH_DIR = path.resolve(ROOT, argOf('--dir') ?? 'tmp/archive-fix');
const DRY = argv.includes('--dry-run');
const AS_JSON = argv.includes('--json');

/* ------------------------------------------------------------------ */
/* Vocabulary from schema.json                                         */
/* ------------------------------------------------------------------ */

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const defs = schema.$defs;
const props = defs.entry.properties;

const enumOf = def => {
  const out = new Set(def.enum ?? []);
  for (const o of def.oneOf ?? []) for (const v of o.enum ?? []) out.add(v);
  return out;
};
const isNullable = def => (def.oneOf ?? []).some(o => o.type === 'null');
const VOCAB = {
  kind: enumOf(defs.kind),
  round: enumOf(defs.round),
  type: enumOf(defs.type),
  lang: enumOf(defs.lang),
  group: enumOf(defs.group),
};
const GROUP_RE = new RegExp(defs.group.oneOf.find(o => o.pattern).pattern, 'u');
const COMP = props.competition.oneOf.find(o => o.type === 'string');
const YEAR = props.year.oneOf.find(o => o.type === 'integer');

const len = s => [...s].length;
const strCheck = (value, prop, name) => {
  if (typeof value !== 'string') return `${name}: очаква се string`;
  if (prop.minLength !== undefined && len(value) < prop.minLength) return `${name}: по-къс от ${prop.minLength}`;
  if (prop.maxLength !== undefined && len(value) > prop.maxLength) return `${name}: по-дълъг от ${prop.maxLength}`;
  if (prop.pattern !== undefined && !new RegExp(prop.pattern, 'u').test(value)) return `${name}: не отговаря на ${prop.pattern}`;
  return null;
};

// Returns an error string or null. `knownIds` are ids valid as duplicateOf targets.
function checkField(field, value, selfId, knownIds) {
  switch (field) {
    case 'kind':
    case 'round':
    case 'type':
    case 'lang': {
      if (value === null) return isNullable(defs[field]) ? null : `${field}: null не е позволено`;
      return VOCAB[field].has(value) ? null : `${field}: стойност извън речника: ${JSON.stringify(value)}`;
    }
    case 'group':
      if (value === null) return null;
      if (typeof value !== 'string') return 'group: очаква се string|null';
      return GROUP_RE.test(value) || VOCAB.group.has(value) ? null : `group: извън речника: ${value}`;
    case 'year':
      if (value === null) return null;
      if (!Number.isInteger(value) || value < YEAR.minimum || value > YEAR.maximum) {
        return `year: извън ${YEAR.minimum}–${YEAR.maximum}: ${value}`;
      }
      return null;
    case 'competition':
      if (value === null) return null;
      return strCheck(value, COMP, 'competition');
    case 'title':
      return strCheck(value, props.title, 'title');
    case 'note':
      return strCheck(value, props.note, 'note');
    case 'hidden':
      return typeof value === 'boolean' ? null : 'hidden: очаква се boolean';
    case 'duplicateOf': {
      const e = strCheck(value, props.duplicateOf ?? props.id, 'duplicateOf');
      if (e) return e;
      if (value === selfId) return 'duplicateOf: сочи самия запис';
      return knownIds.has(value) ? null : `duplicateOf: непознат id ${value}`;
    }
    case 'id_new':
      return strCheck(value, props.id, 'id_new');
    case 'sourceUrl':
    case 'source':
    case 'addedAt':
      return strCheck(value, props[field], field);
    case 'unparsed':
      return typeof value === 'boolean' ? null : 'unparsed: очаква се boolean';
    default:
      return `${field}: полето не е в схемата`;
  }
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

const serialise = cat => JSON.stringify(cat.data, null, cat.indent) + (cat.newline ? '\n' : '');

function loadCatalog() {
  const files = readdirSync(CATALOG_DIR)
    .filter(f => f.endsWith('.json') && f !== 'schema.json')
    .sort();
  const catalogs = [];
  const index = new Map(); // id -> { cat, entry }
  for (const name of files) {
    const abs = path.join(CATALOG_DIR, name);
    const text = readFileSync(abs, 'utf8');
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error(`${name}: коренът не е масив`);
    const m = text.match(/^\[\r?\n( +)/);
    const cat = {
      name,
      abs,
      data,
      indent: m ? m[1].length : 2,
      newline: text.endsWith('\n'),
      text,
      touched: new Set(),
      roundtrip: false,
    };
    cat.roundtrip = serialise(cat) === text;
    catalogs.push(cat);
    for (const entry of data) {
      if (entry && typeof entry.id === 'string' && !index.has(entry.id)) {
        // `orig` is the on-disk state: the per-patch verdict (applied / no-op /
        // overridden) is judged against it, so a re-run reports 0 applied.
        index.set(entry.id, { cat, entry, orig: JSON.parse(JSON.stringify(entry)) });
      }
    }
  }
  return { catalogs, index };
}

/* ------------------------------------------------------------------ */
/* Reference scan for id renames                                       */
/* ------------------------------------------------------------------ */

const SCAN_DIRS = ['src', 'docs', 'scripts', 'content'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'public', 'tmp', 'archive-catalog']);
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx',
  '.yml', '.yaml', '.txt', '.html', '.css',
]);

let repoTexts = null;
function repoFiles() {
  if (repoTexts) return repoTexts;
  const found = [];
  const walk = dir => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (TEXT_EXT.has(path.extname(d.name).toLowerCase())) found.push(p);
    }
  };
  for (const d of readdirSync(ROOT, { withFileTypes: true })) {
    if (d.isFile() && TEXT_EXT.has(path.extname(d.name).toLowerCase())) found.push(path.join(ROOT, d.name));
  }
  for (const d of SCAN_DIRS) if (existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  repoTexts = found.map(p => ({ p: path.relative(ROOT, p), text: readFileSync(p, 'utf8') }));
  return repoTexts;
}

function referencesTo(oldId, newId, catalogs) {
  const blocks = text => text.includes(oldId) && !text.includes(newId);
  const refs = [];
  for (const cat of catalogs) {
    for (const entry of cat.data) {
      if (!entry || entry.id === oldId) continue;
      const { id: _id, ...rest } = entry;
      if (blocks(JSON.stringify(rest))) refs.push(`${cat.name}:${entry.id}`);
    }
  }
  for (const f of repoFiles()) if (blocks(f.text)) refs.push(f.p);
  return refs;
}

/* ------------------------------------------------------------------ */

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function main() {
  if (!existsSync(PATCH_DIR)) {
    console.error(`Няма директория с патчове: ${PATCH_DIR}`);
    process.exit(2);
  }
  const patchFiles = readdirSync(PATCH_DIR).filter(f => f.endsWith('.patch.json')).sort();
  if (patchFiles.length === 0) {
    console.error(`Няма *.patch.json в ${PATCH_DIR}`);
    process.exit(2);
  }

  const { catalogs, index } = loadCatalog();
  const patchSets = patchFiles.map(name => {
    const data = JSON.parse(readFileSync(path.join(PATCH_DIR, name), 'utf8'));
    if (!Array.isArray(data)) throw new Error(`${name}: коренът не е масив`);
    return { name, patches: data };
  });

  // Rename map from every id_new instruction, so later patches naming the
  // old id resolve — on this run and on re-runs after the rename happened.
  const renames = new Map();
  for (const { patches } of patchSets) {
    for (const p of patches) if (p?.set && typeof p.set.id_new === 'string') renames.set(p.id, p.set.id_new);
  }
  const resolveId = id => {
    if (index.has(id)) return id;
    const n = renames.get(id);
    return n && index.has(n) ? n : null;
  };
  const knownIds = new Set([...index.keys(), ...renames.values()]);

  const summary = [];
  const overrides = [];
  const pendingRenames = [];
  const accepted = []; // { file, summary, id, set, slot, rename? }
  const fieldOwner = new Map(); // `${id} ${field}` -> { file, value }

  for (const { name, patches } of patchSets) {
    const s = {
      file: name,
      patches: patches.length,
      applied: 0,
      fieldsChanged: 0,
      overridden: 0,
      noop: 0,
      rejected: [],
    };
    patches.forEach((p, i) => {
      const reject = why => s.rejected.push({ id: p?.id ?? `#${i}`, why });
      if (!p || typeof p.id !== 'string' || !p.set || typeof p.set !== 'object') return reject('невалиден патч');
      const id = resolveId(p.id);
      if (!id) return reject('непознат id');
      const errors = Object.entries(p.set)
        .map(([k, v]) => checkField(k, v, id, knownIds))
        .filter(Boolean);
      if (errors.length) return reject(errors.join('; '));
      if (typeof p.set.id_new === 'string' && p.set.id_new !== id && index.has(p.set.id_new)) {
        return reject(`id_new: ${p.set.id_new} вече съществува`);
      }

      const slot = index.get(id);
      const acc = { file: name, summary: s, id, set: p.set, slot, rename: null };
      for (const [k, v] of Object.entries(p.set)) {
        if (k === 'id_new') {
          if (id !== v) {
            acc.rename = { file: name, oldId: id, newId: v, done: false, acc };
            pendingRenames.push(acc.rename);
          }
          continue;
        }
        const key = `${id} ${k}`;
        const prev = fieldOwner.get(key);
        if (prev && !deepEqual(prev.value, v)) overrides.push({ id, field: k, from: prev.file, to: name });
        fieldOwner.set(key, { file: name, value: v });
        if (deepEqual(slot.entry[k], v)) continue;
        slot.entry[k] = v;
      }
      accepted.push(acc);
    });
    summary.push(s);
  }

  // Renames last: every `set` (including other files' references to the old
  // id) is already resolved; refuse when anything else still names the old id.
  const renamed = [];
  for (const r of pendingRenames) {
    const refs = referencesTo(r.oldId, r.newId, catalogs);
    if (refs.length) {
      r.acc.summary.rejected.push({
        id: r.oldId,
        why: `id_new отказано — старото id се реферира от: ${refs.join(', ')}`,
      });
      continue;
    }
    const slot = index.get(r.oldId);
    slot.entry.id = r.newId;
    index.delete(r.oldId);
    index.set(r.newId, slot);
    r.done = true;
    renamed.push({ file: r.file, oldId: r.oldId, newId: r.newId });
  }

  // Verdict per accepted patch, against the on-disk original: a field counts as
  // applied when the final value is the patch's value and differs from the
  // original; as overridden when a later patch set a different final value.
  for (const acc of accepted) {
    const { entry, orig } = acc.slot;
    let applied = 0;
    let overridden = 0;
    for (const [k, v] of Object.entries(acc.set)) {
      if (k === 'id_new') continue;
      if (!deepEqual(entry[k], v)) overridden += 1;
      else if (!deepEqual(orig[k], v)) applied += 1;
    }
    if (acc.rename && acc.rename.done) applied += 1;
    if (applied > 0) {
      acc.summary.applied += 1;
      acc.summary.fieldsChanged += applied;
    } else if (overridden > 0) {
      acc.summary.overridden += 1;
    } else {
      acc.summary.noop += 1;
    }
  }
  for (const cat of catalogs) {
    for (const entry of cat.data) {
      const slot = entry && index.get(entry.id);
      if (slot && !deepEqual(slot.entry, slot.orig)) cat.touched.add(entry.id);
    }
  }

  let totalApplied = 0;
  let totalNoop = 0;
  let totalOverridden = 0;
  let totalRejected = 0;
  for (const s of summary) {
    totalApplied += s.applied;
    totalNoop += s.noop;
    totalOverridden += s.overridden;
    totalRejected += s.rejected.length;
  }

  // Write only catalogs with changed entries, in their own indentation.
  const written = [];
  for (const cat of catalogs) {
    if (cat.touched.size === 0) continue;
    const out = serialise(cat);
    if (out === cat.text) continue;
    if (!DRY) writeFileSync(cat.abs, out, 'utf8');
    written.push({ file: cat.name, entries: cat.touched.size, reformatted: !cat.roundtrip });
  }

  let hidden = 0;
  for (const cat of catalogs) for (const e of cat.data) if (e && e.hidden === true) hidden += 1;

  const result = {
    patchDir: path.relative(ROOT, PATCH_DIR),
    dryRun: DRY,
    perFile: summary,
    overrides,
    renamed,
    written,
    totals: {
      applied: totalApplied,
      noop: totalNoop,
      overridden: totalOverridden,
      rejected: totalRejected,
      hiddenEntries: hidden,
    },
  };

  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Патчове от ${result.patchDir}${DRY ? '  (dry-run, нищо не се записва)' : ''}`);
    for (const s of summary) {
      console.log(
        `  ${s.file}: ${s.patches} патча — приложени ${s.applied} (${s.fieldsChanged} полета), ` +
          `без ефект ${s.noop}, презаписани от по-късен патч ${s.overridden}, отказани ${s.rejected.length}`
      );
      for (const r of s.rejected) console.log(`      x ${r.id}: ${r.why}`);
    }
    if (overrides.length) {
      console.log(`Полета, презаписани от по-късен патч (${overrides.length}):`);
      for (const o of overrides) console.log(`  ${o.id}.${o.field}: ${o.from} -> ${o.to}`);
    }
    for (const r of renamed) console.log(`Преименувано id: ${r.oldId} -> ${r.newId}`);
    if (written.length) {
      console.log('Записани каталози:');
      for (const w of written) {
        console.log(`  ${w.file}: ${w.entries} записа${w.reformatted ? '  (форматът на файла се променя)' : ''}`);
      }
    } else {
      console.log('Нищо за записване — каталогът вече е в целевото състояние.');
    }
    console.log(
      `Общо: приложени ${totalApplied}, без ефект ${totalNoop}, презаписани ${totalOverridden}, ` +
        `отказани ${totalRejected}; скрити записи в каталога: ${hidden}`
    );
  }
  process.exit(totalRejected > 0 ? 1 : 0);
}

main();
