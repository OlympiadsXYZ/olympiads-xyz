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
test('old frozen and id-based URLs both reach the canonical solution section', () => {
  const aliases = problemAliases(problem, { 'test-2026-p1': '/problems/acoustic-levitation', 'test-2026-p2': '/problems/old-task-e2' });
  for (const base of ['/problems/old-task-e2', '/problems/test-2026-p2']) {
    assert.equal(aliases[base], '/problems/acoustic-levitation/solution#e2');
    assert.equal(aliases[`${base}/solution`], '/problems/acoustic-levitation/solution#e2');
  }
  assert.throws(() => problemAliases(problem, {}, new Set(['test-2026-p2'])), /Invalid alias/);
  assert.throws(() => problemAliases({ ...problem, aliases: [{ id: 'retired', sectionId: 'missing' }] }, {}), /Invalid alias/);
});

import { problemMetadataErrors } from '../lib/problem-classification.mjs';
test('underlining validates and renders section introduction, question and solution text', () => {
  const p = structuredClone(problem);
  p.sourceLayout = { underlines: ['Setup.', 'Question.', 'Answer.'] };
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
