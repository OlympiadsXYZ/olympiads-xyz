// The problems navigation: round labels (content/round-labels.json), display numbers
// (content/question-numbers.json), the sidebar merge rule (src/problems/tree.ts) and the gate
// (scripts/check-navigation.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256, jsonText } from '../lib/problem-data.mjs';
import { roundLabel, gradeLabel, paperNodeLabel, displayNumber, printedQuestionNumber, numberEvidence } from '../lib/navigation.mjs';
import { loadTreeModule } from '../lib/load-tree.mjs';
import { checkNavigation } from '../check-navigation.mjs';
import { problemName } from '../problems-to-site.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tree = loadTreeModule(repo);

const LABELS = {
  rounds: {
    IPhO: { 'theory|theory': 'Теория', '|theory': 'Теория', '|experiment': 'Експеримент' },
    NAO: { 'III кръг (национален)|theory': 'III кръг (национален)', 'III|test': 'III кръг (национален)', '|theory': 'I кръг (общински)' },
    ESF: { '|theory': '' },
    IZhO: { '|theory': 'Теория' },
  },
  papers: { 'nao-2023-special': 'Купа „Урания“' },
  suffixes: { 'nao-2023-iii-9-10-d2': 'втори ден' },
  grades: { IZhO: { ST: 'Старша група' }, IPhO: { '8-9': '' } },
};

let seq = 0;
function paper(fields, numbers = [1], extra = {}) {
  const id = fields.id ?? `x-${++seq}`;
  return {
    paper: { subject: 'physics', year: 2016, lang: 'en', title: '', ...fields, id },
    problems: numbers.map((n, i) => ({ id: `${id}-p${i + 1}`, number: n, title: `T${i + 1}`, ...extra })),
  };
}
const urlsFor = files => new Map(files.flatMap(f => f.problems.map(p => [p.id, `/problems/${p.id}/solution`])));
const nodesOf = (files, overlays) => tree.assembleProblemsTree(files, urlsFor(files), undefined, overlays).subjects[0].competitions[0].years[0].papers;

// ---------------------------------------------------------------------------
// label lookup

test('round label: combination, per-paper label, "" for one-round competitions, null when missing', () => {
  assert.equal(roundLabel({ id: 'a', competition: 'IPhO', round: 'theory', roundType: 'theory' }, LABELS), 'Теория');
  assert.equal(roundLabel({ id: 'b', competition: 'IPhO', round: null, roundType: 'theory' }, LABELS), 'Теория');
  assert.equal(roundLabel({ id: 'c', competition: 'NAO', round: 'III', roundType: 'test' }, LABELS), 'III кръг (национален)');
  assert.equal(roundLabel({ id: 'nao-2023-special', competition: 'NAO', round: 'IV кръг', roundType: 'theory' }, LABELS), 'Купа „Урания“');
  assert.equal(roundLabel({ id: 'd', competition: 'ESF', round: null, roundType: 'theory' }, LABELS), '');
  assert.equal(roundLabel({ id: 'e', competition: 'IPhO', round: 'Theory round', roundType: 'theory' }, LABELS), null);
  assert.equal(roundLabel({ id: 'f', competition: 'EuPhO', round: null, roundType: 'theory' }, LABELS), null);
});

test('node label: round · grade · suffix; competition grade names beat the subject defaults', () => {
  assert.equal(paperNodeLabel({ id: 'nao-2023-iii-9-10-d2', subject: 'astronomy', competition: 'NAO', round: 'III кръг (национален)', roundType: 'theory', grade: '9-10' }, LABELS), 'III кръг (национален) · 9–10 клас · втори ден');
  assert.equal(paperNodeLabel({ id: 'g', subject: 'physics', competition: 'ESF', round: null, roundType: 'theory', grade: '8' }, LABELS), '8. клас');
  // physics ST is the НЕСФ special theme, but IZhO's ST is its senior group
  assert.equal(gradeLabel('ST', 'physics', 'ESF', LABELS), 'Специална тема');
  assert.equal(gradeLabel('ST', 'physics', 'IZhO', LABELS), 'Старша група');
  // '' drops a grade that is not one (IPhO 2012 '8-9' is the file date 2012-08-09)
  assert.equal(paperNodeLabel({ id: 'h', subject: 'physics', competition: 'IPhO', round: 'theory', roundType: 'theory', grade: '8-9' }, LABELS), 'Теория');
});

test('the sidebar (tree.ts) and the pages (navigation.mjs) resolve labels and numbers the same way', () => {
  const papers = [
    { id: 'nao-2023-iii-9-10-d2', subject: 'astronomy', competition: 'NAO', round: 'III кръг (национален)', roundType: 'theory', grade: '9-10' },
    { id: 'i', subject: 'physics', competition: 'IZhO', round: null, roundType: 'theory', grade: 'ST' },
    { id: 'j', subject: 'physics', competition: 'ESF', round: null, roundType: 'theory', grade: '11-12' },
  ];
  for (const p of papers) assert.equal(tree.paperLabel(p, LABELS), paperNodeLabel(p, LABELS));
  const numbers = { problems: { 'q-p1': '2A' } };
  assert.equal(tree.displayNumber({ id: 'q-p1', number: 1 }, numbers), displayNumber({ id: 'q-p1', number: 1 }, numbers));
  assert.equal(displayNumber({ id: 'q-p2', number: 1 }, numbers), 1);
});

// ---------------------------------------------------------------------------
// merge rule

test('IPhO 2016: the two theory questions merge into one "Теория" node numbered 1, 2; the experiment has its own', () => {
  const files = [
    paper({ id: 'ipho-2016-theory-2', competition: 'IPhO', round: null, roundType: 'theory', title: 'Theory · Q2 — Nonlinear Dynamics in Electric Circuits' }, [1]),
    paper({ id: 'ipho-2016-theory-1', competition: 'IPhO', round: 'theory', roundType: 'theory', title: 'IPhO 2016 — Theory Q1 — Two Problems in Mechanics' }, [1]),
    paper({ id: 'ipho-2016-experiment-exp2', competition: 'IPhO', round: null, roundType: 'experiment' }, [1]),
  ];
  const numbers = { problems: { 'ipho-2016-theory-2-p1': 2, 'ipho-2016-experiment-exp2-p1': 2 } };
  const nodes = nodesOf(files, { labels: LABELS, numbers });
  assert.deepEqual(nodes.map(n => n.label), ['Теория', 'Експеримент']);
  assert.deepEqual(nodes[0].problems.map(p => p.number), [1, 2]);
  assert.deepEqual(nodes[0].problems.map(p => p.id), ['ipho-2016-theory-1-p1', 'ipho-2016-theory-2-p1']);
  assert.equal(tree.problemLabel(nodes[0].problems[1]), 'Задача 2. T1');
  // without the overlay the two stored "Задача 1" collide and cannot share a node
  const raw = nodesOf(files, { labels: LABELS });
  assert.equal(raw.filter(n => n.label.startsWith('Теория')).length, 2);
});

test('colliding papers of one label split by tour, then by language; the rest keep their id', () => {
  const nao = (id, type, numbers, lang = 'bg') => paper({ id, subject: 'astronomy', competition: 'NAO', year: 2023, round: 'III кръг (национален)', roundType: type, grade: '7-8', lang }, numbers);
  const byTour = nodesOf([nao('nao-t', 'theory', [1, 2, 3, 4]), { ...nao('nao-x', 'test', [1, 2, 3]), paper: { ...nao('nao-x', 'test', []).paper, round: 'III' } }], { labels: LABELS });
  assert.deepEqual(byTour.map(n => n.label), ['III кръг (национален) · 7–8 клас · теория', 'III кръг (национален) · 7–8 клас · тест']);
  const byLang = nodesOf([nao('nao-bg', 'theory', [1, 2]), nao('nao-en', 'theory', [1, 2], 'en')], { labels: LABELS });
  assert.deepEqual(byLang.map(n => n.label), ['III кръг (национален) · 7–8 клас · на български', 'III кръг (национален) · 7–8 клас · на английски']);
  const leftover = nodesOf([nao('nao-a', 'theory', [1]), nao('nao-b', 'theory', [1])], { labels: LABELS });
  assert.deepEqual(leftover.map(n => n.label), ['III кръг (национален) · 7–8 клас (nao-a)', 'III кръг (национален) · 7–8 клас (nao-b)']);
  // a tour label that is already the round label is not repeated: IPhO papers are only split by language / id
  const ipho = nodesOf([paper({ id: 'ip-a', competition: 'IPhO', round: null, roundType: 'theory' }, [1]), paper({ id: 'ip-b', competition: 'IPhO', round: null, roundType: 'theory' }, [1])], { labels: LABELS });
  assert.deepEqual(ipho.map(n => n.label), ['Теория (ip-a)', 'Теория (ip-b)']);
});

test('display numbers sort in reading order and the tree is deterministic', () => {
  const files = [
    paper({ id: 'w-1', competition: 'IPhO', round: null, roundType: 'theory' }, [1, 2, 3]),
    paper({ id: 'w-2', competition: 'IPhO', round: null, roundType: 'theory' }, [1]),
    paper({ id: 'w-10', competition: 'IPhO', round: null, roundType: 'theory' }, [1]),
  ];
  const numbers = { problems: { 'w-1-p1': '1.1', 'w-1-p2': '1.2', 'w-1-p3': '1.10', 'w-2-p1': 2, 'w-10-p1': 10 } };
  const [node] = nodesOf(files, { labels: LABELS, numbers });
  assert.deepEqual(node.problems.map(p => p.number), ['1.1', '1.2', '1.10', 2, 10]);
  const again = tree.assembleProblemsTree([...files].reverse(), urlsFor(files), undefined, { labels: LABELS, numbers });
  assert.deepEqual(again, tree.assembleProblemsTree(files, urlsFor(files), undefined, { labels: LABELS, numbers }));
});

// ---------------------------------------------------------------------------
// printed numbers, page titles

test('printed question numbers: unambiguous forms only', () => {
  assert.equal(printedQuestionNumber('IPhO 2016 — Theory Q1 — Two Problems in Mechanics (10 points)'), 1);
  assert.equal(printedQuestionNumber('ISPhO Theory Q2-1 — Air shower'), 2);
  assert.equal(printedQuestionNumber('Romanian Master of Physics 2013 — Theoretical Problem No. 3 - Star Trek Watching'), 3);
  assert.equal(printedQuestionNumber('Задача 3: «В далекой-далекой галактике…»'), 3);
  assert.equal(printedQuestionNumber('Eka Tjipta Foundation Problem. Theoretical 1: Motion of a Rolling Rod'), 1);
  assert.equal(printedQuestionNumber('BPO6 Problems 20-24 June 2024. Montenegro'), null);
  assert.equal(printedQuestionNumber('Q23S1D'), null);
  assert.equal(printedQuestionNumber('Problem 1: Resistor circuit · Problem 2: The descent of a skier'), null);
  const evidence = numberEvidence({ id: 'ioaa-2021-theory-tq-10-q', title: 'Theory — Q10-1, English (Official)', source: { archiveKey: 'IOAA/2021/Theory/TQ-10-Q.pdf' } }, [{ number: 1 }]);
  assert.deepEqual([...new Set(evidence.map(e => e.n))], [10]);
  const iepho = numberEvidence({ id: 'iepho-2019-experiment-8-1-woodpecker', title: 'IEPhO – 2019, Belarus. Первый тур, 8-2. Дятел', source: { archiveKey: 'd1/8_1_woodpecker.pdf' } }, [{ number: 1 }]);
  assert.deepEqual(iepho.filter(e => e.source === 'title').map(e => e.n), [2]);
});

test('page title uses the display number and drops a repeated one', () => {
  const numbers = { problems: { 'a-p1': 2, 'b-p1': '2A', 'c-p1': 3 } };
  assert.equal(problemName({ id: 'a-p1', number: 1, title: 'Nonlinear Dynamics' }, numbers), 'Задача 2. Nonlinear Dynamics');
  assert.equal(problemName({ id: 'b-p1', number: 1, title: '2A. Optical properties' }, numbers), 'Задача 2A. Optical properties');
  assert.equal(problemName({ id: 'c-p1', number: 'III', title: null }, numbers), 'Задача 3');
  assert.equal(problemName({ id: 'd-p1', number: 'Практически 1', title: 'Капела' }, numbers), 'Практически 1. Капела');
  assert.equal(problemName({ id: 'e-p1', number: 4, title: 'Задача 4. Звезди' }, numbers), 'Задача 4. Звезди');
});

// ---------------------------------------------------------------------------
// the gate

const records = files => files.map(data => ({ data }));

test('gate passes a consistent corpus', () => {
  const files = [
    paper({ id: 'ipho-2016-theory-1', competition: 'IPhO', round: 'theory', roundType: 'theory', title: 'Theory Q1' }, [1]),
    paper({ id: 'ipho-2016-theory-2', competition: 'IPhO', round: null, roundType: 'theory', title: 'Theory Q2' }, [1]),
  ];
  const result = checkNavigation(records(files), { labels: LABELS, numbers: { problems: { 'ipho-2016-theory-2-p1': 2 } } }, tree);
  assert.deepEqual(result.failures, []);
});

test('gate fails on a missing label, a number the title contradicts and a duplicate inside a node', () => {
  const files = [
    paper({ id: 'eupho-2020-theory-x', competition: 'EuPhO', round: null, roundType: 'theory' }, [1, 2]),
    paper({ id: 'ipho-2016-theory-2', competition: 'IPhO', round: null, roundType: 'theory', title: 'Theory · Q2 — Nonlinear Dynamics' }, [1]),
    paper({ id: 'ipho-2016-theory-3', competition: 'IPhO', round: null, roundType: 'theory', title: 'Theory Q3' }, [3, 4]),
    paper({ id: 'esf-2016-x', competition: 'ESF', round: null, roundType: 'theory', grade: null }, [1]),
  ];
  const nav = { labels: LABELS, numbers: { problems: { 'ipho-2016-theory-3-p2': 3 } } };
  const { failures } = checkNavigation(records(files), nav, tree);
  assert.ok(failures.some(f => f.startsWith("eupho-2020-theory-x: no round label for EuPhO '|theory'")), failures.join('\n'));
  assert.ok(failures.some(f => f.startsWith('ipho-2016-theory-2-p1: shown as 1 but paper.title prints question 2')), failures.join('\n'));
  assert.ok(failures.some(f => f.includes("'Теория': Задача 3 twice")), failures.join('\n'));
  assert.ok(failures.some(f => f.startsWith('esf-2016-x: empty sidebar label')), failures.join('\n'));
  assert.equal(failures.length, 4);
});

test('generator: the page title and source line use the overlays; the printed masthead lead line stays', t => {
  fs.mkdirSync(path.join(repo, 'tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(repo, 'tmp/navigation-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : jsonText(value)); };
  const data = { paper: { id: 'ipho-2016-theory-2', subject: 'physics', competition: 'IPhO', year: 2016, round: null, roundType: 'theory', lang: 'en', title: 'Theory · English (Official) · Q2 — Nonlinear Dynamics in Electric Circuits (10 points)', source: { archiveKey: 'Физика/Състезания/IPhO/2016/Theory/2.pdf' }, status: 'draft' },
    problems: [{ id: 'ipho-2016-theory-2-p1', number: 1, title: 'Nonlinear Dynamics in Electric Circuits', statement: 'Statement' }] };
  const file = 'content/problems/physics/IPhO/2016/ipho-2016-theory-2.json';
  write(file, data);
  write('content/problem-publication.json', { version: 1, papers: { [data.paper.id]: { kind: 'legacy', contentHash: sha256(fs.readFileSync(path.join(root, file))), sourceCommit: 'a'.repeat(40), recordedAt: new Date().toISOString() } } });
  write('content/round-labels.json', LABELS);
  write('content/question-numbers.json', { problems: { 'ipho-2016-theory-2-p1': 2 } });
  const run = spawnSync(process.execPath, [path.join(repo, 'scripts/problems-to-site.mjs'), '--root', root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const mdx = fs.readFileSync(path.join(root, 'solutions/physics/ipho-2016-theory-2/ipho-2016-theory-2-p1.mdx'), 'utf8');
  assert.match(mdx, /^title: 'Задача 2\. Nonlinear Dynamics in Electric Circuits'$/m);
  assert.match(mdx, /^source: 'IPhO 2016, Теория'$/m);
  assert.match(mdx, /^\*Theory · English \(Official\) · Q2 — Nonlinear Dynamics in Electric Circuits \(10 points\)\*$/m);
  const extra = JSON.parse(fs.readFileSync(path.join(root, 'content/extraProblems.json'), 'utf8')).EXTRA_PROBLEMS.find(p => p.uniqueId === 'ipho-2016-theory-2-p1');
  assert.equal(extra.name, 'Задача 2. Nonlinear Dynamics in Electric Circuits');
  assert.equal(extra.source, 'IPhO 2016 Теория');
});
