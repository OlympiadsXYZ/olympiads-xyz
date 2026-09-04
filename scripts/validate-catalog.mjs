#!/usr/bin/env node
// Validates every archive-catalog/*.json against archive-catalog/schema.json.
//
//   node scripts/validate-catalog.mjs [--bucket <listing>] [--examples N] [--json]
//
// The listing passed to --bucket is "size;key" per line (the same format the
// bucket audit produces); when given, entries whose `file` is missing from the
// bucket are reported too.
//
// No npm dependencies: the JSON Schema subset used by schema.json is
// interpreted here (type, enum, const, oneOf, allOf, if/then, properties,
// required, additionalProperties, items, $ref/$defs, pattern, minLength,
// maxLength, minimum, maximum).
//
// Exits 1 when any entry violates the schema or a cross-file invariant.

import { readFileSync, readdirSync } from 'node:fs';
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
const EXAMPLES = Number(argOf('--examples') ?? 3);
const AS_JSON = argv.includes('--json');
const BUCKET = argOf('--bucket');

/* ------------------------------------------------------------------ */
/* Minimal JSON Schema (draft 2020-12 subset) evaluator                */
/* ------------------------------------------------------------------ */

const typeOf = v => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v; // string | number | boolean | object
};

const matchesType = (v, t) => {
  const a = typeOf(v);
  if (t === 'number') return a === 'number' || a === 'integer';
  if (t === 'object') return a === 'object';
  return a === t;
};

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const resolveRef = (ref, root) => {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`);
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    node = node[key];
    if (node === undefined) throw new Error(`broken $ref: ${ref}`);
  }
  return node;
};

const reCache = new Map();
const test = (pattern, str) => {
  let re = reCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern, 'u');
    reCache.set(pattern, re);
  }
  return re.test(str);
};

// Returns a list of { field, keyword, message }.
function validate(value, schema, root, field) {
  const errs = [];
  const push = (keyword, message) => errs.push({ field, keyword, message });

  if (schema.$ref) return validate(value, resolveRef(schema.$ref, root), root, field);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => matchesType(value, t))) {
      push('type', `очаква се ${types.join('|')}, а не ${typeOf(value)}`);
      return errs; // further keywords are meaningless on a wrong type
    }
  }

  if (schema.enum !== undefined && !schema.enum.some(e => deepEqual(e, value))) {
    push('enum', `стойност извън речника: ${short(value)}`);
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    push('const', `очаква се ${short(schema.const)}, а е ${short(value)}`);
  }

  if (typeof value === 'string') {
    if (schema.pattern !== undefined && !test(schema.pattern, value)) {
      push('pattern', `не отговаря на ${schema.pattern}: ${short(value)}`);
    }
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      push('minLength', `по-къс от ${schema.minLength} знака: ${short(value)}`);
    }
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) {
      push('maxLength', `по-дълъг от ${schema.maxLength} знака`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      push('minimum', `по-малко от ${schema.minimum}: ${value}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      push('maximum', `повече от ${schema.maximum}: ${value}`);
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errs.push(...validate(item, schema.items, root, field ?? `[${i}]`));
    });
  }

  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errs.push({ field: key, keyword: 'required', message: 'липсващо задължително поле' });
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          errs.push(...validate(value[key], sub, root, key));
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
          errs.push({ field: key, keyword: 'additionalProperties', message: 'непознато поле' });
        }
      }
    }
  }

  if (schema.oneOf) {
    const ok = schema.oneOf.filter(s => validate(value, s, root, field).length === 0);
    if (ok.length !== 1) {
      push('oneOf', `невалидна стойност: ${short(value)}`);
    }
  }

  for (const sub of schema.allOf ?? []) {
    errs.push(...validate(value, sub, root, field));
  }

  if (schema.if) {
    const branch = validate(value, schema.if, root, field).length === 0 ? schema.then : schema.else;
    if (branch) {
      const sub = validate(value, branch, root, field);
      const label = schema.$comment;
      errs.push(...sub.map(e => (label ? { ...e, rule: label } : e)));
    }
  }

  return errs;
}

const short = v => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

/* ------------------------------------------------------------------ */
/* Cross-file invariants                                              */
/* ------------------------------------------------------------------ */

const ALLOWED_EXT = new Set([
  'pdf', 'djvu', 'doc', 'docx', 'rtf', 'txt', 'html', 'note',
  'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'ppsx', 'nb',
  'jpg', 'jpeg', 'png', 'gif', 'mp4', 'wmv', 'zip', 'rar',
  // изпълними файлове към практически кръгове (D8, docs/Archive-Decisions-2026-09.md)
  'exe', 'linux', 'macos',
]);
// Файл без разширение се допуска (EuPhO 2021 програми, D8); схемата ограничава
// такива записи до kind: "misc", type: "data".

/* ------------------------------------------------------------------ */

function main() {
  let schema;
  try {
    schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (e) {
    console.error(`Не мога да прочета ${SCHEMA_PATH}: ${e.message}`);
    process.exit(2);
  }

  const files = readdirSync(CATALOG_DIR)
    .filter(f => f.endsWith('.json') && f !== 'schema.json')
    .sort();

  if (files.length === 0) {
    console.error(`Няма каталожни файлове в ${CATALOG_DIR}`);
    process.exit(2);
  }

  let bucket = null;
  if (BUCKET) {
    bucket = new Set();
    for (const line of readFileSync(BUCKET, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const i = line.indexOf(';');
      bucket.add(i === -1 ? line.trim() : line.slice(i + 1).trim());
    }
  }

  const violations = []; // { kind, catalog, id, file, message }
  const seenId = new Map();
  const seenFile = new Map();
  let total = 0;

  const record = (kind, ctx, message) =>
    violations.push({ kind, catalog: ctx.catalog, id: ctx.id, file: ctx.file, message });

  for (const name of files) {
    const abs = path.join(CATALOG_DIR, name);
    let data;
    try {
      data = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (e) {
      record('невалиден JSON', { catalog: name, id: '—', file: '—' }, e.message);
      continue;
    }
    if (!Array.isArray(data)) {
      record('коренът не е масив', { catalog: name, id: '—', file: '—' }, `корен: ${typeOf(data)}`);
      continue;
    }

    data.forEach((entry, i) => {
      total += 1;
      const ctx = {
        catalog: name,
        id: (entry && entry.id) || `#${i}`,
        file: (entry && entry.file) || '—',
      };

      for (const err of validate(entry, schema.$defs.entry, schema, null)) {
        const kind = err.rule
          ? `${err.field ?? '(запис)'}: ${err.rule}`
          : `${err.field ?? '(запис)'}: ${err.keyword}`;
        record(kind, ctx, err.message);
      }

      if (entry && typeof entry.id === 'string') {
        const prev = seenId.get(entry.id);
        if (prev) record('id: дублиран', ctx, `вече е в ${prev}`);
        else seenId.set(entry.id, name);
      }
      if (entry && typeof entry.file === 'string') {
        const prev = seenFile.get(entry.file);
        if (prev) record('file: дублиран ключ', ctx, `вече е в ${prev}`);
        else seenFile.set(entry.file, name);

        const base = entry.file.split('/').pop() ?? '';
        const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
        if (ext && !ALLOWED_EXT.has(ext)) {
          record('file: непознато разширение', ctx, `.${ext}`);
        }
        if (bucket && !bucket.has(entry.file)) {
          record('file: липсва в кофата', ctx, entry.file);
        }
      }
    });
  }

  report({ files, total, violations });
  process.exit(violations.length > 0 ? 1 : 0);
}

function report({ files, total, violations }) {
  const byKind = new Map();
  for (const v of violations) {
    if (!byKind.has(v.kind)) byKind.set(v.kind, []);
    byKind.get(v.kind).push(v);
  }
  const ranked = [...byKind.entries()].sort((a, b) => b[1].length - a[1].length);
  const badEntries = new Set(violations.map(v => `${v.catalog} ${v.id}`));

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          catalogs: files.length,
          entries: total,
          entriesWithViolations: badEntries.size,
          violations: violations.length,
          byKind: ranked.map(([kind, list]) => ({ kind, count: list.length })),
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Каталози: ${files.length}   Записи: ${total}`);
  if (violations.length === 0) {
    console.log('Няма нарушения. Каталогът отговаря на archive-catalog/schema.json.');
    return;
  }
  console.log(
    `Нарушения: ${violations.length} в ${badEntries.size} записа ` +
      `(${((badEntries.size / total) * 100).toFixed(1)}% от архива)\n`
  );

  const pad = String(ranked[0][1].length).length;
  for (const [kind, list] of ranked) {
    console.log(`${String(list.length).padStart(pad)}  ${kind}`);
    for (const v of list.slice(0, EXAMPLES)) {
      console.log(`${' '.repeat(pad)}    ${v.id} [${v.catalog}] — ${v.message}`);
    }
    if (list.length > EXAMPLES) {
      console.log(`${' '.repeat(pad)}    … и още ${list.length - EXAMPLES}`);
    }
  }

  const perCatalog = new Map();
  for (const v of violations) perCatalog.set(v.catalog, (perCatalog.get(v.catalog) ?? 0) + 1);
  console.log('\nПо каталожен файл:');
  for (const [name, n] of [...perCatalog].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(pad)}  ${name}`);
  }
}

main();
