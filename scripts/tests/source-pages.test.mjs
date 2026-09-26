// scripts/backfill-source-pages.mjs: which page of the original each legacy problem is printed on, from the text layer
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesFromLayout, pagesFromTsv, letters, textKey, locate, paperPages } from '../backfill-source-pages.mjs';

test('text layers split into pages: -layout form feeds and -tsv page rows', () => {
  assert.deepEqual(pagesFromLayout('one\ftwo\f'), ['one', 'two']);
  const row = (level, page, top, text) => [level, page, 0, 0, 0, 0, 0, top, 0, 0, -1, text].join('\t');
  const tsv = ['level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    row(1, 1, 0, '###PAGE###'), row(4, 1, 200, ''), row(5, 1, 200, 'second'), row(4, 1, 100, ''), row(5, 1, 100, 'first'), row(5, 1, 100, 'line'),
    row(1, 2, 0, '###PAGE###'), row(1, 3, 0, '###PAGE###'), row(4, 3, 50, ''), row(5, 3, 50, 'third')].join('\n');
  assert.deepEqual(pagesFromTsv(tsv), ['first line\nsecond', '', 'third']);
});

test('comparison form: letters only, Cyrillic look-alikes folded; the key skips the printed number and math', () => {
  assert.equal(letters('Задача 3. Ел-ек-трон!'), letters('ЗАДАЧА ЕЛЕКТРОН'));
  assert.equal(letters('Cветлина'), letters('Светлина')); // a Latin C in a Cyrillic word
  assert.equal(textKey('**Задача 3.** $x=1$ Две еднакви успоредни метални пластинки'), letters('Две еднакви успоредни метални пластинки').slice(0, 30));
  assert.equal(textKey('![Снимка](https://x/p.png)\n\nПеперудата монарх извършва удивителна миграция'), letters('Пеперудата монарх извършва удивителна миграция').slice(0, 30));
  assert.equal(textKey('$E = mc^2$ и $x$'), null);
});

test('problems are placed in printed order; a heading decides a text found one page later; nothing is guessed', () => {
  const pages = [
    'Задача 1. Махало\nМахалото с дължина l се отклонява на малък ъгъл',
    'Задача 2. Леща\nСъбирателна леща с фокусно разстояние f дава образ\n\nЗадача 3. Топлина',
    'Газ в цилиндър с бутало се нагрява бавно при постоянно налягане',
    'Решения\nЗадача 1. Махалото с дължина l се отклонява на малък ъгъл',
  ];
  const found = locate(pages, [
    { id: 'p1', number: 1, text: 'Махалото с дължина $l$ се отклонява на малък ъгъл' },
    { id: 'p2', number: 2, text: 'Събирателна леща с фокусно разстояние $f$ дава образ' },
    { id: 'p3', number: 3, text: 'Газ в цилиндър с бутало се нагрява бавно при постоянно налягане' },
    { id: 'p4', number: 4, text: 'Текст, който го няма в текстовия слой на документа' },
  ]);
  assert.deepEqual(Object.fromEntries(found), { p1: { page: 1, via: 'text' }, p2: { page: 2, via: 'text' }, p3: { page: 2, via: 'heading' } });
  // a page before the problem's own figure, or outside the paper's pages, is refused
  assert.equal(locate(pages, [{ id: 'p3', number: 3, text: 'Газ в цилиндър с бутало се нагрява', figurePages: [1] }]).size, 0);
  assert.equal(locate(pages, [{ id: 'p2', number: 2, text: 'Събирателна леща с фокусно разстояние' }], [1]).size, 0);
});

test('paperPages places only the problems without a span, in both documents, and only in PDFs', () => {
  const layers = { problems: ['Задача 1. Първата задача има достатъчно дълъг текст', 'Задача 2. Втората задача също има дълъг текст'], solutions: ['Решение 1. Решението на първата задача е кратко', 'Решение 2. Решението на втората задача също'] };
  const problems = [
    { id: 'a-p1', number: 1, statement: 'Първата задача има достатъчно дълъг текст', sourceSpans: [{ document: 'problems', page: 1 }], solution: { statement: 'Решението на първата задача е кратко' } },
    { id: 'a-p2', number: 2, statement: 'Втората задача също има дълъг текст', solution: { statement: 'Решението на втората задача също' } },
  ];
  const paper = { source: { archiveKey: 'x.pdf', pages: [1, 2] }, solutionSource: { archiveKey: 's.pdf' } };
  const r = paperPages(paper, problems, layers);
  assert.deepEqual([...r.problems], [['a-p2', { page: 2, via: 'text' }]]);
  assert.deepEqual(Object.fromEntries(r.solutions), { 'a-p1': { page: 1, via: 'text' }, 'a-p2': { page: 2, via: 'text' } });
  assert.deepEqual(paperPages({ source: { archiveKey: 'x.doc' } }, problems, layers), {});
});
