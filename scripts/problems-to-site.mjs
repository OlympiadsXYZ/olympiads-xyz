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
//   node scripts/problems-to-site.mjs [--check]
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
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

// Short Bulgarian names, same as the archive's COMPETITION_META (src/archive/labels.ts).
const COMPETITION_SHORT = { NOF: 'НОФ', NAO: 'НОА', ESF: 'НЕСФ', PSF: 'НПСФ' };
const MONTHS_BG = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

// "9" -> "9. клас", "9-10 клас" -> "9–10 клас"; anything else is left as printed.
function gradeLabel(grade) {
  if (!grade) return null;
  const g = String(grade).replace(/\s*клас\.?$/u, '').trim().replace(/\s*-\s*/g, '–');
  if (/^\d+$/.test(g)) return `${g}. клас`;
  if (/^\d+–\d+$/.test(g)) return `${g} клас`;
  return String(grade);
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
    gradeLabel(paper.grade),
  ].filter(Boolean).join(', ');
}

function yamlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function problemMdx(paper, problem) {
  const lines = [];
  lines.push('---');
  lines.push(`id: ${problem.id}`);
  lines.push(`source: ${yamlStr(paperDescriptor(paper))}`);
  lines.push(`title: ${yamlStr(`Задача ${problem.number}${problem.title ? '. ' + problem.title : ''}`)}`);
  lines.push(`author: 'Olympiads XYZ · транскрипция на официалните материали'`);
  lines.push('---');
  lines.push('');
  // Lead line: the paper's printed masthead (ground truth), the date and the points.
  const lead = [
    paper.title || null,
    paper.held?.from ? dateBg(paper.held.from) : null,
    problem.points != null ? `${String(problem.points).replace('.', ',')} т.` : null,
  ].filter(Boolean);
  if (lead.length) lines.push(`*${lead.join(' · ')}*`, '');
  lines.push(`## Условие`);
  lines.push('');
  lines.push(problem.statement);
  lines.push('');
  for (const fig of problem.figures ?? []) lines.push(figureMarkdown(fig), '');
  if (problem.parts?.length) {
    for (const part of problem.parts) {
      const pts = part.points != null ? ` **[${String(part.points).replace('.', ',')} т.]**` : '';
      lines.push(`**${part.label}** ${part.statement}${pts}`);
      lines.push('');
      for (const fig of part.figures ?? []) lines.push(figureMarkdown(fig), '');
    }
  }
  const answers = (problem.parts ?? []).filter(p => p.answer && (p.answer.value != null || p.answer.latex));
  if (answers.length) {
    lines.push('## Отговори', '');
    lines.push('<Spoiler title="Покажи отговорите">', '');
    for (const p of answers) {
      const a = p.answer;
      const shown = a.latex ? `$${a.latex}$` : `${a.value}${a.unit ? ' ' + a.unit : ''}`;
      lines.push(`- **${p.label}** ${shown}`);
    }
    lines.push('', '</Spoiler>', '');
  }
  const sol = problem.solution;
  if (sol?.statement) {
    lines.push('## Решение', '');
    if (sol.incomplete) {
      lines.push('<Warning title="Непълно решение">', sol.incompleteReason || 'Решението предстои да бъде довършено.', '</Warning>', '');
    }
    lines.push(sol.statement, '');
    for (const fig of sol.figures ?? []) lines.push(figureMarkdown(fig), '');
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

function problemInfo(paper, problem) {
  const grade = paper.grade ? `${paper.grade}. клас` : null;
  return {
    uniqueId: problem.id,
    // Kept short on purpose: getProblemURL() slugifies source + name, so a
    // verbose name produces an unreadable URL. Round and grade live in tags.
    name: `Задача ${problem.number}${problem.title ? '. ' + problem.title : ''}`,
    url: archiveUrl(paper.subject, paper.source.archiveKey),
    source: `${paper.competition} ${paper.year}${paper.round ? ' ' + shortRound(paper.round) : ''}${paper.grade ? ' ' + paper.grade : ''}`,
    difficulty: problem.difficulty ?? 'Normal',
    isStarred: (problem.importance ?? 0) >= 3,
    tags: [...(problem.topics ?? []), ...(grade ? [grade] : []), paper.roundType].filter(Boolean),
    solutionMetadata: { kind: 'internal' },
  };
}

const papers = walk(PROBLEMS_DIR);
const extra = JSON.parse(fs.readFileSync(EXTRA, 'utf8'));
const existing = new Map(extra.EXTRA_PROBLEMS.map(p => [p.uniqueId, p]));
let written = 0, added = 0, skipped = 0;

for (const file of papers) {
  const { paper, problems } = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const problem of problems) {
    const dir = path.join(SOLUTIONS_DIR, paper.subject, paper.id);
    const out = path.join(dir, `${problem.id}.mdx`);
    const mdx = problemMdx(paper, problem);
    if (check) {
      if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== mdx) skipped++;
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(out, mdx);
      written++;
    }
    const info = problemInfo(paper, problem);
    if (!existing.has(info.uniqueId)) added++;
    existing.set(info.uniqueId, info);
  }
}

if (!check) {
  extra.EXTRA_PROBLEMS = [...existing.values()];
  fs.writeFileSync(EXTRA, JSON.stringify(extra, null, 2) + '\n');
}
console.log(
  check
    ? `${papers.length} papers, ${skipped} MDX files out of date`
    : `${papers.length} papers → ${written} solution MDX written, ${added} new problems in extraProblems.json (${existing.size} total)`
);
