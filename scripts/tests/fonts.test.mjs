// The self-hosted Inter: the @font-face rules in src/html.js and the subsets that
// scripts/subset-inter.py writes to static/fonts/ must describe the same files and
// the same unicode ranges, or a browser downloads a file for characters it lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(repo, 'src/html.js'), 'utf8');
const script = fs.readFileSync(path.join(repo, 'scripts/subset-inter.py'), 'utf8');

// Adjacent string literals (JS '+'-free continuation or Python implicit concatenation) joined.
const joined = body => [...body.matchAll(/'([^']*)'/g)].map(m => m[1]).join('');

function htmlRanges() {
  const block = /const INTER_RANGES = \{([\s\S]*?)\};/.exec(html)[1];
  return Object.fromEntries([...block.matchAll(/(\w+):\s*((?:'[^']*'\s*)+),/g)].map(m => [m[1], joined(m[2])]));
}

function scriptRanges() {
  const block = /RANGES = \{([\s\S]*?)\n\}/.exec(script)[1];
  return Object.fromEntries([...block.matchAll(/'(\w+)':\s*((?:'[^']*'\s*)+),/g)].map(m => [m[1], joined(m[2])]));
}

function codepoints(range) {
  const out = [];
  for (const part of range.split(',')) {
    const [a, b = a] = part.replace(/^U\+/, '').split('-');
    for (let c = parseInt(a, 16); c <= parseInt(b, 16); c++) out.push(c);
  }
  return out;
}

test('html.js and subset-inter.py agree on version and unicode ranges', () => {
  const version = /const INTER_VERSION = '([^']+)'/.exec(html)[1];
  assert.equal(/VERSION = '([^']+)'/.exec(script)[1], version);
  const a = htmlRanges();
  assert.deepEqual(Object.keys(a).sort(), ['core', 'ext', 'symbols']);
  assert.deepEqual(a, scriptRanges());
});

test('the unicode ranges do not overlap and cover Bulgarian text in core', () => {
  const seen = new Map();
  for (const [part, range] of Object.entries(htmlRanges())) {
    for (const c of codepoints(range)) {
      assert.ok(!seen.has(c), `U+${c.toString(16)} in both ${seen.get(c)} and ${part}`);
      seen.set(c, part);
    }
  }
  for (const ch of 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯабвгдежзийклмнопрстуфхцчшщъьюяѝ„“–—…°№«»×±−0123456789') {
    assert.equal(seen.get(ch.codePointAt(0)), 'core', ch);
  }
  for (const ch of 'αβγΔΩμπ≈≤→√²₁') assert.equal(seen.get(ch.codePointAt(0)), ch === '²' ? 'core' : 'symbols', ch);
});

test('every font file html.js refers to exists, and the rsms.me and Algolia stylesheets are gone', () => {
  const version = /const INTER_VERSION = '([^']+)'/.exec(html)[1];
  for (const style of ['roman', 'italic']) {
    for (const part of ['core', 'symbols', 'ext']) {
      const file = path.join(repo, 'static/fonts', `inter-${version}-${style}-${part}.woff2`);
      assert.ok(fs.existsSync(file), file);
      assert.equal(fs.readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', file);
    }
  }
  assert.ok(fs.existsSync(path.join(repo, 'static/fonts/Inter-LICENSE.txt')));
  assert.doesNotMatch(html, /rsms\.me|instantsearch\.css|algolia-min/);
});
