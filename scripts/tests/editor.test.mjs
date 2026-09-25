import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const matter = require('gray-matter');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function load(relative) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(repo, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', 'module', compiled)(require, module.exports, module);
  return module.exports;
}
const { editorFileURL, fetchFileContent } = load('src/components/Editor/editorUtils.ts');

test('editor sends existing and new files to this repository and rejects traversal', () => {
  assert.equal(editorFileURL('content/1_General/Файл.mdx'), 'https://github.com/OlympiadsXYZ/olympiads-xyz/edit/master/content/1_General/%D0%A4%D0%B0%D0%B9%D0%BB.mdx');
  assert.equal(editorFileURL('solutions/physics/new.mdx', true), 'https://github.com/OlympiadsXYZ/olympiads-xyz/new/master/solutions/physics?filename=new.mdx');
  for (const file of ['../secrets', 'content/../secrets', 'content//bad', 'https://evil.example/file']) assert.throws(() => editorFileURL(file));
});

test('adding a catalogue problem preserves its metadata and emits supported solution metadata', () => {
  const { editorProblemMetadata } = load('src/components/Editor/editorUtils.ts');
  const problem = { uniqueId: 'p1', name: 'Problem', url: 'https://example.org/problem', source: 'NOF', difficulty: 'Easy', tags: ['Механика'], solution: { kind: 'link', url: 'https://example.org/solution', label: 'Solution' } };
  const metadata = editorProblemMetadata(problem);
  assert.equal(metadata.difficulty, 'Easy');
  assert.deepEqual(metadata.tags, ['Механика']);
  assert.deepEqual(metadata.solutionMetadata, { kind: 'link', url: 'https://example.org/solution' });
  assert.deepEqual(editorProblemMetadata({ ...problem, solution: { kind: 'label', label: 'Check source' } }).solutionMetadata, { kind: 'none' });
});

test('editor never turns failed HTTP responses into drafts; missing optional problem lists are allowed', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  await assert.rejects(fetchFileContent('solutions/physics/missing.mdx'), /404/);
  globalThis.fetch = async url => new Response(url.endsWith('.mdx') ? 'draft' : 'missing', { status: url.endsWith('.mdx') ? 200 : 404 });
  assert.deepEqual(await fetchFileContent('content/1_General/draft.mdx'), { markdown: 'draft', problems: '' });
  globalThis.fetch = async url => new Response('error', { status: url.endsWith('.mdx') ? 200 : 503 });
  await assert.rejects(fetchFileContent('content/1_General/draft.mdx'), /не са заредени/);
});

test('new module and solution metadata survives punctuation and multi-line user input', () => {
  const { moduleTemplate, solutionTemplate } = load('src/components/Editor/editorTemplates.ts');
  const input = { id: 'new-file', title: 'A: "B"\nC', source: 'Book: Volume 2', description: "It's a test: yes", section: 'physics' };
  for (const template of [moduleTemplate, solutionTemplate]) {
    const { data } = matter(template(input));
    assert.equal(data.title, input.title);
    assert.equal(data.id, input.id);
  }
  const { data } = matter(moduleTemplate(input));
  assert.equal(data.description, input.description);
  assert.equal(data.frequency, 0);
  assert.deepEqual(data.prerequisites, []);
});

test('local editor index includes authored files and excludes generated transcriptions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'olympiads-editor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'content/physics'), { recursive: true });
  fs.mkdirSync(path.join(root, 'solutions/physics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'content/physics/m.mdx'), '---\nid: m\ntitle: Module\n---\nText');
  fs.writeFileSync(path.join(root, 'solutions/physics/s.mdx'), '---\nid: s\ntitle: Solution\n---\nText');
  fs.writeFileSync(path.join(root, 'solutions/physics/generated.mdx'), '---\nid: g\ncanonicalSource: content/problems/g.json\n---\nText');
  const { writeEditorIndex } = load('src/editor/index-node.ts');
  assert.equal(writeEditorIndex(root), 2);
  const files = JSON.parse(fs.readFileSync(path.join(root, 'static/editor-data/files.json')));
  assert.deepEqual(files.map(f => [f.id, f.kind]), [['m', 'module'], ['s', 'solution']]);
});

test('archive label reader handles Prettier-formatted Cyrillic identifiers', async () => {
  const { readArchiveLabels } = await import('../lib/labels.mjs');
  const { competitionShort, roundLabels } = readArchiveLabels();
  assert.equal(competitionShort['Всерусийска'], 'ВсОШ');
  assert.equal(competitionShort.NOF, 'НОФ');
  assert.equal(roundLabels.III, 'III кръг (национален)');
});
