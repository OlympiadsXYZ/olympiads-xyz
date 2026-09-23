// The problems navigation overlays (presentation layer only — published paper JSON is hash-bound to its receipt and
// is never edited to fix a label or a number):
//   content/round-labels.json     canonical Bulgarian round label per (competition, raw round, roundType), per-paper
//                                 labels where one raw combination mixes several events, grade names, and per-paper
//                                 suffixes that tell apart the papers of one round and grade (day 1 / day 2, test)
//   content/question-numbers.json display number per problem id where the stored number is not the printed one
// Read by scripts/problems-to-site.mjs (page title and source line), scripts/check-navigation.mjs (the gate) and
// scripts/derive-question-numbers.mjs. src/problems/tree.ts applies the same lookups on the Gatsby side (it cannot
// import this file); check-navigation.mjs verifies that both resolve every paper to the same label.
import fs from 'node:fs';
import path from 'node:path';

export const ROUND_LABELS_FILE = 'content/round-labels.json';
export const QUESTION_NUMBERS_FILE = 'content/question-numbers.json';

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

export function loadNavigation(root) {
  return {
    labels: readJson(path.join(root, ROUND_LABELS_FILE)) ?? { rounds: {}, papers: {}, grades: {} },
    numbers: readJson(path.join(root, QUESTION_NUMBERS_FILE)) ?? { problems: {} },
  };
}

/** The key of a (raw round, roundType) pair inside rounds[competition]: "theory|theory", "|observation". */
export const roundKey = paper => `${paper.round ?? ''}|${paper.roundType ?? ''}`;

/**
 * The canonical round label of a paper, or null when the overlay has none (the gate fails on null).
 * "" is a valid label: a competition with one round a year whose nodes are named by the grade alone (НЕСФ, НПСФ).
 */
export function roundLabel(paper, labels) {
  const own = labels?.papers?.[paper.id];
  if (typeof own === 'string') return own;
  const byRound = labels?.rounds?.[paper.competition];
  const label = byRound ? byRound[roundKey(paper)] : undefined;
  return typeof label === 'string' ? label : null;
}

// "9" -> "9. клас", "9-10" -> "9–10 клас"; group codes get their names (physics ST/SP = the special-theme group of
// НЕСФ/НПСФ; astronomy ML/ST = the age groups of НОА); a competition's own group names come from round-labels.json
// grades (IZhO ML/ST are age groups, IAO alpha/β are the α/β groups); anything else is left as printed.
const GROUP_NAMES = {
  physics: { ST: 'Специална тема', SP: 'Специална тема' },
  astronomy: { ML: 'Младша възраст', ST: 'Старша възраст' },
};
export function gradeLabel(grade, subject, competition, labels) {
  if (!grade) return null;
  const own = labels?.grades?.[competition]?.[String(grade)];
  if (typeof own === 'string') return own || null;
  const g = String(grade).replace(/\s*клас\.?$/u, '').trim().replace(/\s*-\s*/g, '–');
  if (/^\d+$/.test(g)) return `${g}. клас`;
  if (/^\d+–\d+$/.test(g)) return `${g} клас`;
  const named = GROUP_NAMES[subject]?.[g.toUpperCase()];
  return named ?? String(grade);
}

/** What round-labels.json suffixes[] appends after the grade: "първи ден", "тест", "друг препис" (or null). */
export function paperSuffix(paper, labels) {
  const own = labels?.suffixes?.[paper.id];
  return typeof own === 'string' && own ? own : null;
}

/** "III кръг (национален) · 10–12 клас · първи ден"; null when the round has no label (see roundLabel). */
export function paperNodeLabel(paper, labels) {
  const round = roundLabel(paper, labels);
  if (round == null) return null;
  return [round || null, gradeLabel(paper.grade, paper.subject, paper.competition, labels), paperSuffix(paper, labels)].filter(Boolean).join(' · ');
}

/** The number a problem is shown with: the overlay's, else the stored one. */
export function displayNumber(problem, numbers) {
  const own = numbers?.problems?.[problem.id];
  return own != null ? own : problem.number;
}

// ---------------------------------------------------------------------------
// Question numbers printed in a paper's masthead (paper.title).
//
// Only unambiguous forms count: "Q2", "T3", "E1", "Question 2", "Problem 3", "Problem No. 2", "Theoretical 2",
// "Задача 2", "Задание 2". A title naming two different numbers ("Problem 1 · Problem 2 …") proves nothing and
// yields null. "Problems 20-24 June" (plural) and "Q23S1D" (a code) do not match.
const TITLE_PATTERNS = [
  /(?<![\p{L}\p{N}])[QTEТЕ](\d{1,2})(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}])(?:Question|Problem|Task)\s*(?:No\.?|nr\.?|#)?\s*(\d{1,2})(?![\p{N}])/giu,
  /(?<![\p{L}])(?:Theoretical|Experimental)\s+(?:Problem\s+|Question\s+)?(?:No\.?\s*)?(\d{1,2})(?![\p{N}])/giu,
  /(?<![\p{L}])(?:Задача|Задание)\s*№?\s*(\d{1,2})(?![\p{N}])/giu,
];
export function printedNumbersIn(text) {
  const found = new Set();
  for (const re of TITLE_PATTERNS) for (const m of String(text ?? '').matchAll(re)) found.add(Number(m[1]));
  return [...found];
}
/** The one question number the title prints, or null (none, or several different ones). */
export function printedQuestionNumber(title) {
  const found = printedNumbersIn(title);
  return found.length === 1 ? found[0] : null;
}

// Proposals for scripts/derive-question-numbers.mjs: every place a paper states its question number. The derive
// script reports them side by side; a human settles each one against the title.
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
export function numberEvidence(paper, problems = []) {
  const out = [];
  const add = (source, n, text) => { if (Number.isInteger(n) && n > 0 && n < 100) out.push({ source, n, text }); };
  const title = String(paper.title ?? '').replace(/\s+/g, ' ');
  for (const n of printedNumbersIn(title)) add('title', n, title.slice(0, 120));
  // "Problem III", "Question II", "Question-I", "Q T-2", "Q E-II", "II. Sensing Electrical Signals"
  for (const m of title.matchAll(/(?<![\p{L}])(?:Problem|Question|Q\s?[TE])\s*[-–]?\s*(I{1,3}|IV|V|VI{0,3}|IX|X|\d{1,2})(?![\p{L}\p{N}])/gu)) add('title-roman', ROMAN[m[1]] ?? Number(m[1]), m[0]);
  const leadRoman = /^(?:[^—]*—\s*)?(I{1,3}|IV|V|VI{0,3}|IX|X)\.\s+\p{Lu}/u.exec(title);
  if (leadRoman) add('title-roman', ROMAN[leadRoman[1]], leadRoman[0]);
  // "Э-10.2" (Russian experimental task 2 of grade 10), "Первый тур, 8-2" (IEPhO: grade 8, problem 2)
  for (const m of title.matchAll(/(?<![\p{L}])Э-\d{1,2}\.(\d)(?![\p{N}])/gu)) add('title', Number(m[1]), m[0]);
  for (const m of title.matchAll(/тур,\s*(\d{1,2})-(\d{1,2})(?![\p{N}])/gu)) add('title', Number(m[2]), m[0]);
  if (problems.length === 1 && problems[0].title) {
    const t = String(problems[0].title).replace(/\s+/g, ' ');
    for (const n of printedNumbersIn(t)) add('problem-title', n, t.slice(0, 80));
    for (const m of t.matchAll(/(?<![\p{L}])Э-\d{1,2}\.(\d)(?![\p{N}])/gu)) add('problem-title', Number(m[1]), m[0]);
    const lead = /^\s*(\d{1,2})\s*[.:)]\s+\S/u.exec(t);
    if (lead) add('problem-title-lead', Number(lead[1]), t.slice(0, 60));
  }
  // paper id: …-q2, …-t3-eng, …-e2-massa, …-tq-10-q, …-theory-2, …-exp2, …-th-3, …-theoretical-2-question, …-pt3-…
  const id = String(paper.id);
  for (const m of id.matchAll(/-(?:q|t|e|tq|th|exp|pt|theory|theoretical|experimental|problem|question|task|p)-?(\d{1,2})(?=-|$)/g)) add('id', Number(m[1]), m[0]);
  // archive file name: Q2.pdf, T1-ENG.pdf, exp2.pdf, 3-ru.pdf, 2.pdf, Theoretical_Problem_2_Question.pdf, 10-E2.pdf
  const file = String(paper.source?.archiveKey ?? '').split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  if (file) {
    for (const m of file.matchAll(/(?:^|[_\-\s])(?:Q|T|E|exp|th|theory|theoretical|problem|question|task|PT)[_\-\s]?(\d{1,2})(?=$|[_\-\s.])/gi)) add('file', Number(m[1]), file);
    for (const m of file.matchAll(/(?:^|[_\-\s])(?:Theoretical|Experimental)_?Problem_?(\d{1,2})/gi)) add('file', Number(m[1]), file);
    const bare = /^(\d{1,2})(?:$|[-_](?:ru|en|eng|bg)$)/i.exec(file);
    if (bare) add('file', Number(bare[1]), file);
    // IEPhO: "10_2_2017_problem", "8_1_syringe_prob" (grade _ problem _ …)
    const graded = /^\d{1,2}_(\d)_/.exec(file);
    if (graded) add('file', Number(graded[1]), file);
  }
  return out;
}
