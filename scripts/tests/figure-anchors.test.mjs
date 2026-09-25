// scripts/figure-anchors.mjs: where each figure belongs in the text, from where it is printed in the PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPapers } from '../lib/problem-data.mjs';
import { wordsOf, textWords, splitParagraphs, pickAfter, parseTsv, alignWords, anchorPaper, captionNumber, entryError } from '../figure-anchors.mjs';

// a pdftotext -tsv text layer: pages of [y, text] lines (x from 60, 6 pt per character, 12 pt high) or
// [y, text, x] lines
function tsv(pages) {
  const rows = ['level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'];
  pages.forEach((lines, i) => {
    const page = i + 1;
    rows.push(`1\t${page}\t0\t0\t0\t0\t0\t0\t595\t842\t-1\t###PAGE###`);
    lines.forEach(([y, text, x0 = 60], n) => {
      rows.push(`4\t${page}\t0\t${n}\t0\t0\t${x0}\t${y}\t${text.length * 6}\t12\t-1\t###LINE###`);
      let x = x0;
      for (const w of text.split(' ')) { rows.push(`5\t${page}\t0\t${n}\t0\t0\t${x}\t${y}\t${w.length * 6}\t12\t100\t${w}`); x += (w.length + 1) * 6; }
    });
  });
  return rows.join('\n') + '\n';
}
const R2 = 'https://pub-43290baaaff14857b5dd59610ea438c7.r2.dev/problems/x-2000';
const fig = (id, page, rect, extra = {}) => ({ id, url: `${R2}/${id}.png`, alt: id, source: { page, pdfRect: rect, dpi: 300, ...extra.source }, ...(extra.caption ? { caption: extra.caption } : {}) });
// the renderer's rule: the paragraph whose end is the first boundary at or after the end of the first occurrence
function paragraphAfter(text, after) {
  if (after == null) return -1;
  const o = text.indexOf(after);
  assert.ok(o >= 0, `"${after}" is not in the field`);
  return splitParagraphs(text).findIndex(p => o + after.length <= p.end);
}
const paperOf = (problems, extra = {}) => ({ paper: { id: 'x-2000', subject: 'physics', competition: 'X', year: 2000, lang: 'en', source: { archiveKey: 'x.pdf' }, ...extra }, problems });

test('words: NFKC math letters, homoglyphs, stress marks, soft hyphens and LaTeX reduce to the printed words', () => {
  assert.deepEqual(wordsOf('Сила 𝐹 = 𝑚𝑎, ёж'), ['сила', 'f', 'ma', 'еж']);
  assert.deepEqual(wordsOf('Cилa'), ['сила']); // Latin C and a inside a Cyrillic word
  assert.deepEqual(wordsOf('ex' + String.fromCharCode(0xad) + 'am r1'), ['exam', 'r', '1']);
  assert.deepEqual(textWords(String.raw`$\omega_{ss} = \sqrt{g/R}$, see ![x](u.png) and \textbf{Fig. 2}`), ['ω', 'ss', 'g', 'r', 'see', 'and', 'fig', '2']);
});

test('paragraphs: blank lines inside $$…$$ and ``` fences are not boundaries', () => {
  const text = 'One two.\n\n$$\na = b\n\nc = d\n$$\n\n```\nx\n\ny\n```\n\nLast line.';
  const paras = splitParagraphs(text).map(p => text.slice(p.start, p.end));
  assert.deepEqual(paras, ['One two.', '$$\na = b\n\nc = d\n$$', '```\nx\n\ny\n```', 'Last line.']);
});

test('pickAfter quotes a window whose first occurrence ends inside the paragraph', () => {
  const field = 'We measure the angle of the cylinder here.\n\n**A.6 (cont.)**\n\nMore text about the cylinder and its angle.\n\n**A.6 (cont.)**\n\nFinal words.';
  const paras = splitParagraphs(field);
  const after = pickAfter(field, paras[0]);
  assert.ok(after.split(' ').length >= 6 && field.slice(0, paras[0].end).endsWith(after), after);
  // the repeated heading alone would anchor at its first copy: the window reaches back into the paragraph before it
  const second = pickAfter(field, paras[3]);
  const end = field.indexOf(second) + second.length;
  assert.ok(end > paras[3].start && end <= paras[3].end, second);
  // a trailing printed points mark is left out (the page strips it)
  const part = 'Find the period of small oscillations of the pendulum. **[3 т.]**';
  const quoted = pickAfter(part, splitParagraphs(part)[0]);
  assert.ok(quoted.endsWith('oscillations of the pendulum.') && quoted.split(' ').length >= 6, quoted);
  // a window never starts or ends inside inline math
  const math = 'The ring of mass $m$ slides on a rod $AB$ of length $L = 2\\,\\mathrm{m}$';
  const q = pickAfter(math, splitParagraphs(math)[0]);
  assert.equal((q.match(/\$/g) || []).length % 2, 0, q);
});

test('alignment keeps long unique runs and drops stray trigrams', () => {
  const T = 'a wooden cylinder of radius r rolls down an inclined plane without slipping'.split(' ');
  const P = ['header', 'x', ...T.slice(0, 8), 'figure', '1', ...T.slice(8)];
  const A = alignWords(P, T);
  assert.equal(A[2], 0);
  assert.equal(A[9], 7);
  assert.equal(A[10], -1);
  assert.equal(A[12], 8);
});

const STATEMENT = [
  'A small ball of mass $m$ hangs on a light thread of length $L$ from a fixed point above the table.',
  'The ball is deflected by a small angle and released without any initial velocity at all.',
  'Find the period of the oscillations of the ball and the tension in the thread at the lowest point.',
].join('\n\n');
const PAGE1 = [
  [60, 'Problem 1. Pendulum (10 points)'],
  [80, 'A small ball of mass m hangs on a light thread of length L from a'],
  [94, 'fixed point above the table.'],
  // figure 1: 110 .. 300, full width
  [306, 'Figure 1: the pendulum'],
  [330, 'The ball is deflected by a small angle and released without any'],
  [344, 'initial velocity at all.'],
  // figures 2 and 3 side by side: 360 .. 480
  [500, 'Find the period of the oscillations of the ball and the tension in'],
  [514, 'the thread at the lowest point.'],
];

test('a figure follows the paragraph printed above it; side-by-side figures share a row', () => {
  const problem = {
    id: 'x-2000-p1', number: 1, statement: STATEMENT,
    figures: [
      fig('p1-fig1', 1, [100, 110, 500, 300], { caption: 'Figure 1: the pendulum' }),
      fig('p1-fig2', 1, [80, 360, 280, 480]),
      fig('p1-fig3', 1, [320, 362, 520, 478]),
    ],
  };
  const { anchors } = anchorPaper(paperOf([problem]), { problems: parseTsv(tsv([PAGE1])) });
  const a = anchors['x-2000-p1'];
  assert.equal(a['p1-fig1'].field, 'statement');
  assert.equal(a['p1-fig1'].method, 'position');
  assert.equal(paragraphAfter(STATEMENT, a['p1-fig1'].after), 0);
  assert.equal(paragraphAfter(STATEMENT, a['p1-fig2'].after), 1);
  assert.equal(a['p1-fig2'].row, 'p1-fig2');
  assert.equal(a['p1-fig3'].row, 'p1-fig2');
  assert.equal(a['p1-fig1'].row, undefined);
});

test('a figure at the top of a page goes before the paragraph below it; page furniture in between moves nothing', () => {
  const problem = {
    id: 'x-2000-p1', number: 1, statement: STATEMENT,
    figures: [fig('p1-fig1', 2, [100, 90, 500, 300])],
  };
  const page1 = PAGE1.filter(([y]) => y < 400).concat([[800, 'Page 1 of 2']]);
  const page2 = [[40, 'Olympiad 2000, theory'], [310, 'Figure 1'], ...PAGE1.filter(([y]) => y >= 500).map(([y, t]) => [y - 150, t]), [800, 'Page 2 of 2']];
  page1.unshift([40, 'Olympiad 2000, theory']);
  const { anchors } = anchorPaper(paperOf([problem]), { problems: parseTsv(tsv([page1, page2])) });
  assert.equal(paragraphAfter(STATEMENT, anchors['x-2000-p1']['p1-fig1'].after), 1);
});

test('a figure printed before the first line of the problem anchors before the field (after: null)', () => {
  const problem = { id: 'x-2000-p1', number: 1, statement: STATEMENT, figures: [fig('p1-fig1', 1, [100, 70, 500, 200])] };
  const page = [[40, 'Problem 1'], ...PAGE1.slice(1).map(([y, t]) => [y + 150, t])];
  const { anchors } = anchorPaper(paperOf([problem]), { problems: parseTsv(tsv([page])) });
  assert.deepEqual(anchors['x-2000-p1']['p1-fig1'], { field: 'statement', after: null, method: 'position' });
});

test('solution figures anchor in the solution; inline figures, moved solution drawings and scans get no entry', () => {
  const solution = [
    'The period of small oscillations follows from the equation of motion of the ball.',
    'The tension at the lowest point is found from the energy conservation law.',
  ].join('\n\n');
  const problem = {
    id: 'x-2000-p1', number: 1, statement: STATEMENT + '\n\n![inline](' + `${R2}/p1-fig2.png` + ')',
    figures: [fig('p1-fig2', 1, [100, 110, 500, 300]), fig('p1-sol-fig9', 1, [100, 110, 500, 300])],
    solution: { statement: solution, figures: [fig('p1-sol-fig1', 1, [100, 110, 500, 300], { source: { document: 'solutions' } }), fig('p1-sol-fig2', 1, [100, 110, 500, 300], { source: { document: 'solutions' } })] },
  };
  const sol = [[60, 'Solution 1'], [80, 'The period of small oscillations follows from the equation of motion of'], [94, 'the ball.'], [320, 'The tension at the lowest point is found from the energy conservation'], [334, 'law.']];
  const docs = { problems: parseTsv(tsv([PAGE1])), solutions: parseTsv(tsv([sol])) };
  const { anchors, report } = anchorPaper(paperOf([problem]), docs);
  const a = anchors['x-2000-p1'];
  assert.deepEqual(Object.keys(a).sort(), ['p1-sol-fig1', 'p1-sol-fig2']);
  assert.equal(a['p1-sol-fig1'].field, 'solution/statement');
  assert.equal(paragraphAfter(solution, a['p1-sol-fig1'].after), 0);
  assert.equal(a['p1-sol-fig1'].row, 'p1-sol-fig1'); // same box = printed side by side as far as the page knows
  const why = Object.fromEntries(report.map(r => [r.figId, r.reason]));
  assert.equal(why['p1-fig2'], 'inline');
  assert.equal(why['p1-sol-fig9'], 'moved-to-solution');
  // no text layer on the page: skipped, not guessed
  const scan = anchorPaper(paperOf([{ ...problem, statement: STATEMENT, figures: [fig('p1-fig1', 1, [100, 110, 500, 300])], solution: undefined }]), { problems: parseTsv(tsv([[[30, 'scan']]])) });
  assert.deepEqual(scan.anchors, {});
  assert.equal(scan.report[0].reason, 'no-text-layer');
});

test('the numbered caption is only a fallback', () => {
  assert.equal(captionNumber('Figure 3: Suspended system.'), '3');
  assert.equal(captionNumber('Рис. 2. Схема'), '2');
  assert.equal(captionNumber('Фиг. 4'), '4');
  assert.equal(captionNumber('Suspended system'), null);
  // a figure alone on a page of other text: no position, the paragraph that first refers to it
  const problem = {
    id: 'x-2000-p1', number: 1, statement: STATEMENT.replace('released without', 'released (see Fig. 7) without'),
    figures: [fig('p1-fig7', 3, [100, 100, 500, 400], { caption: 'Fig. 7. The pendulum' })],
  };
  const other = [[60, 'Completely unrelated text of another problem is printed on this page so that'], [74, 'nothing here aligns with the pendulum problem at all whatsoever, not a word']];
  const { anchors } = anchorPaper(paperOf([problem]), { problems: parseTsv(tsv([PAGE1, other, other])) });
  assert.equal(anchors['x-2000-p1']['p1-fig7'].method, 'reference');
  assert.equal(paragraphAfter(problem.statement, anchors['x-2000-p1']['p1-fig7'].after), 1);
});

test('entryError holds anchors to the contract', () => {
  const problem = { id: 'x-2000-p1', statement: STATEMENT, figures: [fig('p1-fig1', 1, [0, 0, 1, 1])], solution: { statement: 'Solved.\n\nDone.', figures: [fig('p1-sol-fig1', 1, [0, 0, 1, 1])] } };
  assert.equal(entryError(problem, 'p1-fig1', { field: 'statement', after: 'above the table.', method: 'position' }), null);
  assert.equal(entryError(problem, 'p1-fig1', { field: 'statement', after: null, method: 'reference' }), null);
  assert.match(entryError(problem, 'p1-fig1', { field: 'solution/statement', after: null, method: 'position' }), /statement figure/);
  assert.match(entryError(problem, 'p1-sol-fig1', { field: 'statement', after: null, method: 'position' }), /solution figure/);
  assert.match(entryError(problem, 'p1-fig1', { field: 'statement', after: 'not printed', method: 'position' }), /not in the field/);
  assert.match(entryError(problem, 'p1-fig1', { field: 'parts/3/statement', after: null, method: 'position' }), /not a text/);
  assert.match(entryError(problem, 'p1-fig9', { field: 'statement', after: null, method: 'position' }), /no figure/);
});

test('every committed anchor names a figure of its problem and resolves in its field', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const anchors = JSON.parse(fs.readFileSync(path.join(root, 'content/figure-anchors.json'), 'utf8'));
  assert.equal(anchors.version, 1);
  const problems = new Map(readPapers(root).flatMap(r => r.data.problems.map(p => [p.id, p])));
  const errors = [];
  for (const [problemId, figs] of Object.entries(anchors.problems)) {
    const problem = problems.get(problemId);
    if (!problem) { errors.push(`${problemId}: no such problem`); continue; }
    for (const [figId, entry] of Object.entries(figs)) {
      const error = entryError(problem, figId, entry);
      if (error) errors.push(`${problemId} ${figId}: ${error}`);
    }
  }
  assert.deepEqual(errors.slice(0, 20), []);
});

test('PDF-reviewed chemistry anchors persist in the generated overlay with their evidence', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const reviewed = JSON.parse(fs.readFileSync(path.join(root, 'content/figure-anchor-overrides.json'), 'utf8'));
  const generated = JSON.parse(fs.readFileSync(path.join(root, 'content/figure-anchors.json'), 'utf8'));
  let count = 0;
  for (const [id, figures] of Object.entries(reviewed.problems)) for (const [fig, entry] of Object.entries(figures)) {
    assert.deepEqual(generated.problems[id][fig], entry, `${id} ${fig}`);
    assert.equal(entry.reviewed.document, 'solutions');
    assert.ok(entry.reviewed.page > 0);
    count++;
  }
  assert.ok(count >= 57);
});
