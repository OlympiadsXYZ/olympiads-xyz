import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const base = 'https://archive.example.test';

function loadLinks(baseUrl = base) {
  const load = relative => {
    const file = path.join(repo, relative);
    const module = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    new Function('require', 'module', 'exports', 'process', compiled)(
      () => load('src/archive/labels.ts'), module, module.exports,
      { env: { GATSBY_ARCHIVE_BASE_URL: baseUrl } }
    );
    return module.exports;
  };
  return load('src/archive/links.ts');
}

const { archiveHref } = loadLinks();
const hosted = key => base + '/' + key.split('/').map(encodeURIComponent).join('/');

test('server-rendered Markdown anchors point directly to hosted PDFs', () => {
  const file = path.join(repo, 'src/components/markdown/HTMLComponents.tsx');
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(specifier => {
    if (specifier === 'react') return require('react');
    if (specifier === '../../archive/links') return { archiveHref };
    return {};
  }, module, module.exports);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const href = '/archive/physics/Книги/Handouts/Zhou/Mechanics/M1.pdf#page=7';
  const html = renderToStaticMarkup(React.createElement(module.exports.default.a, { href }, 'Handout'));
  assert.ok(html.includes(`href="${hosted('Физика/Книги/Handouts/Zhou/Mechanics/M1.pdf')}#page=7"`));
  assert.ok(!html.includes('href="/archive/'));
});

test('legacy PDFs use exact hosted object keys with query and page fragment intact', () => {
  const key = 'Физика/Книги/Сборници/Англии\u0306ски/cavendish.pdf';
  const local = '/archive/physics/' + key.split('/').slice(1).map(encodeURIComponent).join('/');
  assert.equal(archiveHref(local + '?download=1#page=9'), hosted(key) + '?download=1#page=9');
  assert.equal(archiveHref('/archive/math/Книги/one.pdf'), hosted('Математика/Книги/one.pdf'));
  assert.equal(archiveHref('/archive/chemistry/Книги/one.pdf'), hosted('Химия/Книги/one.pdf'));
});

test('page navigation, external URLs and malformed file paths remain unchanged', () => {
  for (const href of [undefined, '', '#page=9', '/archive/physics/', '/archive/mathematics',
    '/archive/physics/nof/2024/', 'https://example.test/archive/physics/a.pdf',
    '/archive/physics/%ZZ.pdf', '/archive/physics/../a.pdf',
    '/archive/physics/a%2Fb.pdf', '/archive/unknown/a.pdf']) {
    assert.equal(archiveHref(href), href);
  }
  const href = '/archive/physics/Книги/a.pdf';
  assert.equal(loadLinks('').archiveHref(href), href);
});

test('every legacy PDF in published learning modules resolves to an exact catalog key', () => {
  const keys = new Set(fs.readdirSync(path.join(repo, 'archive-catalog'))
    .filter(name => name.endsWith('.json') && name !== 'schema.json')
    .flatMap(name => JSON.parse(fs.readFileSync(path.join(repo, 'archive-catalog', name), 'utf8')))
    .map(row => row.file));
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'problems' || entry.name === 'problem-receipts') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.mdx')) files.push(file);
    }
  };
  walk(path.join(repo, 'content'));
  walk(path.join(repo, 'solutions/1_General'));
  let checked = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    // This captures both Markdown links and Resource.url attributes; parentheses
    // in real book filenames are part of the object key.
    for (const match of source.matchAll(/(?<![\w:/])\/archive\/[a-z]+\/[^\s"<>]+?\.pdf/g)) {
      const href = archiveHref(match[0]);
      assert.ok(href.startsWith(base + '/'), `${file}: ${match[0]}`);
      const key = new URL(href).pathname.slice(1).split('/').map(decodeURIComponent).join('/');
      assert.ok(keys.has(key), `${file}: missing exact archive key ${key}`);
      checked++;
    }
  }
  assert.ok(checked >= 30, `Expected the learning-module PDF corpus, found ${checked}`);
});
