import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problemMdx, problemAliases } from '../problems-to-site.mjs';
import { allFigures, compileSchema, stripTx } from '../tx/lib.mjs';
import { compile } from 'xdm';
import gfm from 'remark-gfm';
import math from 'remark-math';
const fig = id => ({ id, url: `https://example.org/${id}.png`, alt: id, width: 100, height: 80 });
const paper = { id: 'test-2026', subject: 'physics', competition: 'EuPhO', year: 2026, roundType: 'experiment', lang: 'en', source: { archiveKey: 'test.pdf' }, status: 'draft' };
const problem = { id: 'test-2026-p1', number: 1, statement: 'Shared introduction.', sections: [
  { id: 'e1', title: 'Task E1', points: 1, statement: 'Setup.', figures: [fig('setup')], parts: [{ label: 'a)', statement: 'Question.', points: 1, figures: [fig('part')] }] },
  { id: 'e2', title: 'Task E2', statement: 'Second task.' }
], solution: { sections: [{ id: 'e1', title: 'Task E1', statement: 'Answer.\n\n![](answer)', figures: [fig('answer')] }] }, aliases: [{ id: 'test-2026-p2', sectionId: 'e2' }] };
test('sections preserve source order, scoped figures and stable fragment targets in one MDX page', async () => {
  const mdx = problemMdx(paper, problem, { quality: 'reviewed', singlePass: true }, 'test.json');
  assert.match(mdx, /verifier: 'single-pass'/);
  assert.match(mdx, /\[Task E2\]\(#e2\)/);
  assert.match(mdx, /<ProblemSection id="e2">/);
  assert.ok(mdx.indexOf('Question.') < mdx.indexOf('Second task.'));
  assert.equal((mdx.match(/src="https:\/\/example.org\/answer.png"/g) || []).length, 1);
  assert.ok(mdx.indexOf('src="https://example.org/answer.png"') > mdx.indexOf('<Spoiler'));
  await compile(mdx, { remarkPlugins: [gfm, math] });
});
test('figure and schema traversal covers section and nested part figures', () => {
  assert.deepEqual(allFigures({ problems: [problem] }).map(x => x.path), ['/problems/0/sections/0/figures/0', '/problems/0/sections/0/parts/0/figures/0', '/problems/0/solution/sections/0/figures/0']);
  const validate = compileSchema('final').validate;
  assert.equal(validate(stripTx({ paper, problems: [problem] })), true, JSON.stringify(validate.errors));
});
test('native section bracket placeholders render each figure once at its printed position', async () => {
  const p = { id: 'test-2026-p1', number: 1, statement: 'Introduction.', sections: [{
    id: 'part-1', title: 'Part 1', statement: 'Before setup.\n\n[[figure:p1-fig1]]\n\nAfter setup.',
    figures: [fig('p1-fig1'), fig('p1-fig2')], parts: [{ label: '1.', statement: 'Question.',
      statementAfter: 'Before continuation.\n\n[Figure: p1-fig2]\n\nAfter continuation.\n\n[[figure:p1-fig3]]', figures: [fig('p1-fig3')] }]
  }], solution: { sections: [{ id: 'part-1', title: 'Part 1', statement: 'Before answer.\n\n[[figure:p1-sol-fig1]]\n\nAfter answer.', figures: [fig('p1-sol-fig1')] }] } };
  const mdx = problemMdx(paper, p, { quality: 'legacy' }, 'test.json');
  for (const id of ['p1-fig1', 'p1-fig2', 'p1-fig3', 'p1-sol-fig1']) {
    assert.equal(mdx.split(`src="https://example.org/${id}.png"`).length - 1, 1, id);
  }
  for (const [id, before, after] of [['p1-fig1', 'Before setup.', 'After setup.'], ['p1-fig2', 'Before continuation.', 'After continuation.'], ['p1-sol-fig1', 'Before answer.', 'After answer.']]) {
    const position = mdx.indexOf(`src="https://example.org/${id}.png"`);
    assert.ok(position > mdx.indexOf(before) && position < mdx.indexOf(after), id);
  }
  await compile(mdx, { remarkPlugins: [gfm, math] });
});
test('old frozen and id-based URLs both reach the canonical solution section', () => {
  const aliases = problemAliases(problem, { 'test-2026-p1': '/problems/acoustic-levitation', 'test-2026-p2': '/problems/old-task-e2' });
  for (const base of ['/problems/old-task-e2', '/problems/test-2026-p2']) {
    assert.equal(aliases[base], '/problems/acoustic-levitation/solution#e2');
    assert.equal(aliases[`${base}/solution`], '/problems/acoustic-levitation/solution#e2');
  }
  assert.throws(() => problemAliases(problem, {}, new Set(['test-2026-p2'])), /Invalid alias/);
  assert.throws(() => problemAliases({ ...problem, aliases: [{ id: 'retired', sectionId: 'missing' }] }, {}), /Invalid alias/);
});

test('native section questions keep labels and points outside figure and table blocks', async () => {
  const p = structuredClone(problem);
  p.sections[0].parts = [
    { label: 'a)', statement: 'Question.\n\n[[figure:p1-fig1]]', points: 1.5, figures: [fig('p1-fig1')] },
    { label: 'b)', statement: '| A | B |\n| --- | --- |\n| 1 | 2 |', points: 2 }
  ];
  const mdx = problemMdx(paper, p, { quality: 'legacy' }, 'test.json');
  assert.match(mdx, /<\/figure>\n\n\*\*\[1,5\sт\.\]\*\*/);
  assert.match(mdx, /\*\*b\)\*\*\n\n\| A \| B \|/);
  assert.match(mdx, /\| 1 \| 2 \|\n\n\*\*\[2\sт\.\]\*\*/);
  await compile(mdx, { remarkPlugins: [gfm, math] });
});

import { problemMetadataErrors } from '../lib/problem-classification.mjs';
test('underlining validates and renders section introduction, question and solution text', () => {
  const p = structuredClone(problem);
  p.sourceLayout = { underlines: ['Task E1', 'Setup.', 'Question.', 'Answer.'] };
  assert.deepEqual(problemMetadataErrors({ paper, problems: [p] }), []);
  const mdx = problemMdx(paper, p, { quality: 'legacy' }, 'test.json');
  for (const text of p.sourceLayout.underlines) assert.ok(mdx.includes(`<u>${text}</u>`));
  p.sourceLayout.underlines.push('Unprinted');
  assert.match(problemMetadataErrors({ paper, problems: [p] })[0].message, /Unprinted/);
});

test('section part answers retain their section labels inside the answer spoiler', () => {
  const p = structuredClone(problem);
  p.sections[0].parts[0].answer = { kind: 'numeric', value: 42, unit: 'm' };
  const mdx = problemMdx(paper, p, { quality: 'legacy' }, 'test.json');
  const answer = mdx.indexOf('**Task E1, a)** 42 m');
  assert.ok(answer > mdx.indexOf('<Spoiler title="Покажи отговорите">'));
  assert.ok(answer < mdx.indexOf('</Spoiler>'));
});

test('overlapping global and scoped underlines render each printed label once', async () => {
  const p = structuredClone(problem);
  p.statement = 'I вариант. II вариант.';
  p.sourceLayout = { underlines: ['I вариант', 'II вариант'], scopedUnderlines: [{ passage: 'II вариант', context: 'II вариант.' }] };
  assert.deepEqual(problemMetadataErrors({ paper, problems: [p] }), []);
  const mdx = problemMdx(paper, p, { quality: 'legacy' }, 'test.json');
  assert.ok(mdx.includes('<u>I вариант</u>. <u>II вариант</u>.'));
  assert.equal((mdx.match(/<u>/g) || []).length, 2);
  await compile(mdx, { remarkPlugins: [gfm, math] });
});

test('scoped underlining marks the printed occurrence without changing repeated table text', async () => {
  const p = structuredClone(problem);
  p.statement = '| Item |\n| --- |\n| Flask for titration |';
  p.sections[0].parts[0].statement = 'd) Fill the burette with the solution for titration.';
  p.sourceLayout = { scopedUnderlines: [{ passage: 'for titration', context: 'Fill the burette with the solution for titration.' }] };
  assert.deepEqual(problemMetadataErrors({ paper, problems: [p] }), []);
  const validate = compileSchema('final').validate;
  assert.equal(validate(stripTx({ paper, problems: [p] })), true, JSON.stringify(validate.errors));
  const mdx = problemMdx(paper, p, { quality: 'legacy' }, 'test.json');
  assert.equal((mdx.match(/<u>for titration<\/u>/g) || []).length, 1);
  assert.ok(mdx.includes('| Flask for titration |'));
  await compile(mdx, { remarkPlugins: [gfm, math] });
  p.sourceLayout.scopedUnderlines[0].context = 'for titration';
  assert.match(problemMetadataErrors({ paper, problems: [p] })[0].message, /unique source context/);
});
import fs from 'node:fs';
import { createRequire } from 'node:module';
import slug from 'remark-slug';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function componentModule(file, dependencies = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', 'module', compiled)(id => dependencies[id] || require(id), module.exports, module);
  return module.exports;
}
test('matching heading slug and section anchor render one stable DOM id', async () => {
  const section = componentModule('src/components/markdown/ProblemSection.tsx');
  const html = componentModule('src/components/markdown/HTMLComponents.tsx', {
    './ProblemSection': section, '../../archive/links': { archiveHref: x => x }, '../../context/DarkModeContext': { useDarkMode: () => ({ isDarkMode: false }) },
  });
  const mdx = await compile('<ProblemSection id="equipment">\n\n### Equipment\n\nText.\n\n</ProblemSection>', { remarkPlugins: [slug] });
  assert.match(String(mdx), /id: "equipment"/);
  const rendered = renderToStaticMarkup(React.createElement(section.default, { id: 'equipment' }, React.createElement(html.default.h3, { id: 'equipment' }, 'Equipment')));
  assert.equal((rendered.match(/id="equipment"/g) || []).length, 1);
  const other = renderToStaticMarkup(React.createElement(section.default, { id: 'e1' }, React.createElement(html.default.h3, { id: 'task-e1' }, 'Task E1')));
  assert.match(other, /id="e1"/);
  assert.match(other, /id="task-e1"/);
});

import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('large printed totals require a complete matching native section score breakdown', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'section-score-'));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('section-score-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'paper.json');
  const p = { id: 'test-2026-p1', number: 1, points: 480, statement: 'Shared instructions.', sections: Array.from({ length: 6 }, (_, i) => ({ id: `map-${i + 1}`, title: `Map ${i + 1}`, statement: 'Source map.', points: 80 })) };
  const run = () => {
    fs.writeFileSync(file, JSON.stringify({ paper: { ...paper, totalPoints: 480 }, problems: [p] }));
    return spawnSync(process.execPath, [fileURLToPath(new URL('../tx/validate.mjs', import.meta.url)), file, '--mode', 'final'], { encoding: 'utf8' });
  };
  let result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /accounted for by all native section scores/);
  p.sections[5].points = 79;
  result = run(); assert.equal(result.status, 1); assert.match(result.stdout, /implausible points 480/);
  p.sections[5].points = 80; delete p.sections[0].points;
  result = run(); assert.equal(result.status, 1); assert.match(result.stdout, /implausible points 480/);
});
