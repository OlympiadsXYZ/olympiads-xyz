#!/usr/bin/env node
// Turn transcribed papers (content/problems/**/<paper>.json) into the two
// artefacts the site already knows how to render:
//   1. solutions/<subject>/<paper-id>/<problem-id>.mdx  — statement, figures,
//      parts and the official solution, rendered by solutionTemplate.tsx
//   2. entries in content/extraProblems.json            — ProblemInfo nodes, so
//      the problems appear in the existing lists and can be pulled into a
//      module with <Problems problems="…" />
//
// Nothing new is rendered: this only produces input for the inherited UI.
//
//   node scripts/problems-to-site.mjs [--check] [--root DIR]
//
// Publication gate (docs/Problems-Decisions-2026-09.md, D-P1): a paper is
// emitted only when content/problem-publication.json holds an entry for its
// exact content hash. Everything the generator writes is listed in
// content/problem-generated.json, so withdrawn/quarantined papers lose their
// pages and index entries on the next run. --check exits 1 on any drift.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { readPapers, readJson, publicationState, atomicWrite, jsonText, sha256, controlledTopics, walkJson } from './lib/problem-data.mjs';

const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBLEMS_DIR = path.join(ROOT, 'content', 'problems');
const SOLUTIONS_DIR = path.join(ROOT, 'solutions');
const EXTRA = path.join(ROOT, 'content', 'extraProblems.json');
const ARCHIVE_BASE = 'https://olympiads-xyz.vercel.app/archive';
const check = process.argv.includes('--check');

const SCIENCE_PREFIX = {
  physics: 'Физика/',
  astronomy: 'Астрономия/',
  chemistry: 'Химия/',
  geography: 'География/',
  mathematics: 'Математика/',
  informatics: 'Информатика/',
};

// archive bucket key -> the site URL that proxies it
function archiveUrl(subject, key) {
  const prefix = SCIENCE_PREFIX[subject];
  const rest = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
  return `${ARCHIVE_BASE}/${subject}/${rest.split('/').map(encodeURIComponent).join('/')}`;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && e.name.endsWith('.json') && e.name !== 'schema.json' ? [p] : [];
  });
}

function figureMarkdown(fig) {
  const alt = (fig.alt || fig.caption || '').replace(/"/g, "'");
  const cap = fig.caption ? `\n<figcaption>${fig.caption}</figcaption>` : '';
  return `<figure>\n<img src="${fig.url}" alt="${alt}" />${cap}\n</figure>`;
}

// Some transcriptions place a figure inline in the text (![…](url)) AND list it
// in figures[]; emitting both rendered the figure twice. Only emit the block
// for figures the surrounding text does not already show.
function figuresNotInline(figs, ...texts) {
  const joined = texts.filter(Boolean).join('\n');
  return (figs ?? []).filter(f => !(f.url && joined.includes(f.url)));
}

// Short Bulgarian names, same as the archive's COMPETITION_META (src/archive/labels.ts).
const COMPETITION_SHORT = { NOF: 'НОФ', NAO: 'НОА', ESF: 'НЕСФ', PSF: 'НПСФ' };
const MONTHS_BG = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

// "9" -> "9. клас", "9-10 клас" -> "9–10 клас"; group codes get their names
// (physics ST/SP = the special-theme group; astronomy ML/ST = age groups);
// anything else is left as printed.
const GROUP_NAMES = {
  physics: { ST: 'Специална тема', SP: 'Специална тема' },
  astronomy: { ML: 'Младша възраст', ST: 'Старша възраст' },
};
function gradeLabel(grade, subject) {
  if (!grade) return null;
  const g = String(grade).replace(/\s*клас\.?$/u, '').trim().replace(/\s*-\s*/g, '–');
  if (/^\d+$/.test(g)) return `${g}. клас`;
  if (/^\d+–\d+$/.test(g)) return `${g} клас`;
  const named = GROUP_NAMES[subject]?.[g.toUpperCase()];
  return named ?? String(grade);
}

function dateBg(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS_BG[Number(m[2]) - 1]} ${m[1]} г.`;
}

// "НОА 2026, II кръг (областен), 9–10 клас" — what the page heading leads with.
function paperDescriptor(paper) {
  return [
    `${COMPETITION_SHORT[paper.competition] ?? paper.competition} ${paper.year}`,
    paper.round || null,
    gradeLabel(paper.grade, paper.subject),
  ].filter(Boolean).join(', ');
}

function yamlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// Prose inequalities like "φ<90-|δ|<68º" make MDX try to parse a JSX tag and
// the build fails ("Unexpected character `9` before name"). A `<` directly
// followed by a digit or a minus is escaped as `\<` — but only outside
// $…$ / $$…$$ math, where KaTeX needs the bare character. ("a < b" with a
// space is already plain text to MDX and is left alone.)
// Braces outside math are JSX expressions to MDX: "(23^{h}56^{m})" compiled
// fine and then crashed the static build with "h is not defined". They are
// escaped as \{ \} so the page shows the text as written; validate.mjs rejects
// them upstream so the pipeline puts such LaTeX into $…$ instead.
function mdText(s) {
  if (s == null) return s;
  return String(s)
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/)
    .map((seg, i) => (i % 2 ? seg : seg.replace(/<(?=[\d-])/g, '\\<').replace(/(?<!\\)[{}]/g, m => '\\' + m)))
    .join('');
}

function problemMdx(paper, problem, state, sourceFile) {
  const lines = [];
  lines.push('---');
  lines.push(`id: ${problem.id}`);
  lines.push(`source: ${yamlStr(paperDescriptor(paper))}`);
  lines.push(`title: ${yamlStr(problemName(problem))}`);
  lines.push(`author: 'Olympiads XYZ · транскрипция на официалните материали'`);
  lines.push(`canonicalSource: ${yamlStr(String(sourceFile).split(path.sep).join('/'))}`); // repo-relative with forward slashes on every OS
  lines.push(`verification: ${yamlStr(state.quality)}`);
  if (state.quality === 'reviewed' && state.verifiedAt) lines.push(`verifiedAt: ${yamlStr(state.verifiedAt)}`);
  // the page must not claim an independent model when the receipt records a same-model check (D-P7, D-P10)
  if (state.quality === 'reviewed') lines.push(`verifier: ${yamlStr(state.independent === false ? 'same-model' : 'independent')}`);
  lines.push('---');
  lines.push('');
  // Lead line: the paper's printed masthead (ground truth), the date and the points.
  const lead = [
    paper.title || null,
    paper.held?.from ? dateBg(paper.held.from) : null,
    problem.points != null ? `${String(problem.points).replace('.', ',')} т.` : null,
  ].filter(Boolean);
  if (lead.length) lines.push(`*${lead.join(' · ')}*`, '');
  if (paper.caveat) lines.push('<Warning title="Бележка към темата">', mdText(paper.caveat), '</Warning>', '');
  lines.push(`## Условие`);
  lines.push('');
  lines.push(mdText(problem.statement));
  lines.push('');
  const partTexts = (problem.parts ?? []).map(p => p.statement);
  for (const fig of figuresNotInline(problem.figures, problem.statement, ...partTexts)) lines.push(figureMarkdown(fig), '');
  if (problem.parts?.length) {
    for (const part of problem.parts) {
      const pts = part.points != null ? ` **[${String(part.points).replace('.', ',')} т.]**` : '';
      // a reader that left the printed "[3 т.]" in the text would show the points twice; the points field is canonical
      const text = part.points != null ? String(part.statement).replace(/\s*(\*\*)?\[\s*\d+(?:[.,]\d+)?\s*т\.?\s*\](\*\*)?\s*$/u, '') : part.statement;
      lines.push(`**${part.label}** ${mdText(text)}${pts}`);
      lines.push('');
      for (const fig of figuresNotInline(part.figures, part.statement)) lines.push(figureMarkdown(fig), '');
    }
  }
  const answers = [
    ...(problem.answer ? [{ label: '', answer: problem.answer }] : []),
    ...(problem.parts ?? []).filter(p => p.answer),
  ].map(p => ({ label: p.label, shown: renderAnswer(p.answer) })).filter(p => p.shown);
  if (answers.length) {
    lines.push('## Отговори', '');
    lines.push('<Spoiler title="Покажи отговорите">', '');
    for (const p of answers) {
      lines.push(`- ${p.label ? `**${p.label}** ` : ''}${p.shown}`);
    }
    lines.push('', '</Spoiler>', '');
  }
  const sol = problem.solution;
  if (sol?.statement || sol?.incomplete) {
    lines.push('## Решение', '');
    if (sol.incomplete) {
      lines.push('<Warning title="Непълно решение">', mdText(sol.incompleteReason) || 'Решението предстои да бъде довършено.', '</Warning>', '');
    }
    if (sol.statement) lines.push('<Spoiler title="Покажи официалното решение">', '', mdText(sol.statement), '');
    for (const fig of figuresNotInline(sol.figures, sol.statement)) lines.push(figureMarkdown(fig), '');
    if (sol.statement) lines.push('', '</Spoiler>', '');
  }
  const src = paper.source?.archiveKey;
  if (src) {
    lines.push('---', '');
    lines.push(`Оригинал в Архива: [${src.split('/').pop()}](${archiveUrl(paper.subject, src)})`);
    if (paper.solutionSource?.archiveKey) {
      const s = paper.solutionSource.archiveKey;
      lines.push(`· официални решения: [${s.split('/').pop()}](${archiveUrl(paper.subject, s)})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// "III Национален кръг" -> "III"; keeps the slug short while staying unique
// across the rounds and grades of one competition-year.
function shortRound(round) {
  const m = String(round).match(/^(I{1,3}V?|IV|\d+)/);
  return m ? m[1] : String(round).split(' ')[0];
}

// "Задача 3. Title"; a title that already starts with "Задача" is used as is,
// and a non-numeric number ("Практически 1") is used as the label itself.
function problemName(problem) {
  if (problem.title && /^Задача\b/u.test(problem.title)) return problem.title;
  const label = Number.isInteger(problem.number) ? `Задача ${problem.number}` : String(problem.number);
  return `${label}${problem.title ? '. ' + problem.title : ''}`;
}

function problemInfo(paper, problem) {
  const grade = gradeLabel(paper.grade, paper.subject);
  return {
    uniqueId: problem.id,
    // Kept short on purpose: getProblemURL() slugifies source + name, so a
    // verbose name produces an unreadable URL. Round and grade live in tags.
    name: problemName(problem),
    url: withPage(archiveUrl(paper.subject, paper.source.archiveKey), problem.sourceSpans?.find(s => s.document === 'problems')?.page),
    // The official solutions PDF, when the paper has one; the problem page's
    // compare panel offers it next to the problems PDF.
    ...(paper.solutionSource?.archiveKey
      ? { solutionUrl: withPage(archiveUrl(paper.subject, paper.solutionSource.archiveKey), problem.sourceSpans?.find(s => s.document === 'solutions')?.page) }
      : {}),
    source: `${paper.competition} ${paper.year}${paper.round ? ' ' + shortRound(paper.round) : ''}${paper.grade ? ' ' + paper.grade : ''}`,
    difficulty: problem.difficulty ?? 'Normal',
    isStarred: (problem.importance ?? 0) >= 3,
    tags: [...controlledTopics(problem.topics, taxonomy).map(id => taxonomy.topics.find(t => t.id === id).label), ...(grade ? [grade] : []), paper.roundType].filter(Boolean),
    solutionMetadata: { kind: 'internal' },
  };
}

function withPage(url, page) { return Number.isInteger(page) && page > 0 ? `${url}#page=${page}` : url; }
function renderAnswer(answer) {
  if (answer.latex) return `$${answer.latex}$`;
  if (answer.value != null) return mdText(String(answer.value)) + (answer.unit ? ` ${answer.unit}` : '');
  // An integer choice index is zero-based only when the source explicitly
  // includes the choices array; otherwise preserve the printed identifier.
  if (answer.kind === 'choice' && answer.correct != null) {
    const choice = Number.isInteger(answer.correct) && answer.choices?.[answer.correct] != null ? answer.choices[answer.correct] : answer.correct;
    return mdText(String(choice));
  }
  return answer.note ? mdText(answer.note) : '';
}

const records = readPapers(ROOT);
const ledger = readJson(path.join(ROOT, 'content/problem-publication.json'), { papers: {} });
const taxonomy = readJson(path.join(ROOT, 'content/problem-topics.json'), { topics: [] });
const curation = readJson(path.join(ROOT, 'content/problem-curation.json'), { modules: {} });
const manifestFile = path.join(ROOT, 'content/problem-generated.json');
const prior = readJson(manifestFile, { version: 1, files: {}, problemIds: [], moduleTables: [] });
const extra = readJson(EXTRA, { EXTRA_PROBLEMS: [] });
const routesFile = path.join(ROOT, 'content/problem-routes.json');
const routes = readJson(routesFile, {});
const allIds = new Set(records.flatMap(r => r.data.problems.map(p => p.id)));
const owned = new Set(prior.problemIds);
const planned = new Map(), generated = new Map(), excluded = [];

// Bootstrap ownership only from the exact generator signature. Never sweep
// arbitrary authored solutions merely because they live under solutions/.
if (!fs.existsSync(manifestFile)) {
  const scan = dir => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) scan(file);
      else if (e.name.endsWith('.mdx')) {
        const bytes = fs.readFileSync(file), text = bytes.toString('utf8');
        const id = /^id: ([^\n]+)$/m.exec(text)?.[1];
        if (id && text.includes("author: 'Olympiads XYZ · транскрипция на официалните материали'")) {
          prior.files[path.relative(ROOT, file)] = sha256(bytes);
          owned.add(id);
        }
      }
    }
  };
  scan(SOLUTIONS_DIR);
}
const oldMetadata = new Map(extra.EXTRA_PROBLEMS.map(p => [p.uniqueId, p]));
const moduleFiles = walkJson(path.join(ROOT, 'content')).filter(f => f.endsWith('.problems.json'));
const modules = moduleFiles.map(file => ({ file, data: readJson(file) }));
for (const { data } of modules) for (const [key, entries] of Object.entries(data)) if (key !== 'MODULE_ID' && Array.isArray(entries)) for (const p of entries) oldMetadata.set(p.uniqueId, p);
for (const record of records) {
  const state = publicationState(record, ledger);
  if (!state.eligible) { excluded.push(`${record.data.paper.id}: ${state.reason}`); continue; }
  const { paper, problems } = record.data;
  for (const problem of problems) {
    const relative = `solutions/${paper.subject}/${paper.id}/${problem.id}.mdx`;
    planned.set(relative, problemMdx(paper, problem, state, record.relativePath));
    generated.set(problem.id, problemInfo(paper, problem));
    // D-P5: ids that were live before the route freeze keep their slug URL
    // (content/problem-routes.json, bootstrapped from production); any id not
    // in the frozen map is new and gets a stable id-based route.
    if (!routes[problem.id]) routes[problem.id] = `/problems/${problem.id}`;
  }
}
// Keep routes reserved after withdrawal, so a title edit or later restoration
// cannot change bookmarks or accidentally give an old route to another ID.
const routeOwners = new Map();
for (const [id, route] of Object.entries(routes)) {
  if (!route.startsWith('/problems/') || route.includes('..')) throw new Error(`Invalid route for ${id}`);
  if (routeOwners.has(route) && routeOwners.get(route) !== id) throw new Error(`Route collision: ${id}, ${routeOwners.get(route)}`);
  routeOwners.set(route, id);
}
const inModules = new Set(), moduleTables = [];
for (const { file, data } of modules) {
  const selected = curation.modules[data.MODULE_ID];
  if (selected || prior.moduleTables.includes(path.relative(ROOT, file))) {
    data.archivePractice = (selected || []).filter(item => generated.has(item.problemId)).map(item => generated.get(item.problemId));
    moduleTables.push(path.relative(ROOT, file));
    planned.set(path.relative(ROOT, file), jsonText(data));
  }
  for (const [key, entries] of Object.entries(data)) if (key !== 'MODULE_ID' && Array.isArray(entries)) for (const item of entries) {
    if (allIds.has(item.uniqueId) && !generated.has(item.uniqueId)) throw new Error(`Ineligible paper referenced by authored module table: ${file}:${item.uniqueId}`);
    inModules.add(item.uniqueId);
  }
}
const unmanaged = extra.EXTRA_PROBLEMS.filter(p => !owned.has(p.uniqueId) && !allIds.has(p.uniqueId));
const metadata = [...unmanaged, ...[...generated.values()].filter(p => !inModules.has(p.uniqueId))].sort((a, b) => a.uniqueId.localeCompare(b.uniqueId));
planned.set('content/extraProblems.json', jsonText({ ...extra, EXTRA_PROBLEMS: metadata }));
planned.set('content/problem-routes.json', jsonText(Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)))));
const manifest = { version: 1, files: Object.fromEntries([...planned].filter(([p]) => p.startsWith('solutions/')).map(([p, text]) => [p, sha256(text)])), problemIds: [...generated.keys()].sort(), moduleTables };
planned.set('content/problem-generated.json', jsonText(manifest));
let stale = 0;
for (const [relative, digest] of Object.entries(prior.files)) {
  if (planned.has(relative)) continue;
  if (!relative.startsWith('solutions/') || relative.includes('..') || path.isAbsolute(relative)) throw new Error('Unsafe owned path: ' + relative);
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) continue;
  stale++;
  if (!check) {
    if (sha256(fs.readFileSync(file)) !== digest) throw new Error(`Refusing to remove edited generated file: ${relative}; move the edit to canonical JSON first.`);
    fs.unlinkSync(file);
  }
}
let changed = 0;
for (const [relative, text] of planned) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
    changed++;
    if (!check) atomicWrite(file, text);
  }
}
console.log(`${records.length} papers; ${generated.size} eligible problems; ${excluded.length} excluded papers; ${changed} ${check ? 'stale' : 'updated'} artifacts; ${stale} obsolete pages${check ? '' : ' removed'}.`);
if (excluded.length) console.log(excluded.join('\n'));
if (check && (changed || stale)) process.exitCode = 1;
