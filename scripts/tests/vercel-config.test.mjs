// vercel.json redirects and cache headers, matched the way Vercel compiles them
// (@vercel/routing-utils: path-to-regexp 6, strict + case-sensitive, '/' delimiter,
// destination params substituted as $1, $2, ...). The deploy tree copies this file
// with jq (.github/workflows/deploy-prebuilt.yml), so what is checked here ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(fs.readFileSync(path.join(repo, 'vercel.json'), 'utf8'));
// The path-to-regexp 6.3 that @vercel's builders install under this alias (the plain
// 'path-to-regexp' at the root can be an Express 0.1.x).
const { pathToRegexp, compile } = require('path-to-regexp-updated');

function sourceToRegex(source) {
  const keys = [];
  const re = pathToRegexp(source, keys, { strict: true, sensitive: true, delimiter: '/' });
  return { re, names: keys.map(k => k.name) };
}

// First redirect whose source matches, with its Location resolved; null when none does.
function redirect(pathname) {
  for (const r of config.redirects) {
    const { re, names } = sourceToRegex(r.source);
    const m = re.exec(pathname);
    if (!m) continue;
    const indexes = Object.fromEntries(names.map((n, i) => [n, '$' + (i + 1)]));
    const dest = compile(r.destination, { validate: false })(indexes);
    return { status: r.permanent ? 308 : 307, location: dest.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? '') };
  }
  return null;
}

function cacheControl(pathname) {
  let value = null;
  for (const h of config.headers || []) {
    if (!sourceToRegex(h.source).re.test(pathname)) continue;
    for (const { key, value: v } of h.headers) if (key.toLowerCase() === 'cache-control') value = v;
  }
  return value;
}

test('a bare problem URL redirects permanently to its solution page', () => {
  assert.deepEqual(redirect('/problems/nof-2006-iv-x-p14/'), { status: 308, location: '/problems/nof-2006-iv-x-p14/solution/' });
  assert.deepEqual(redirect('/problems/nof-2006-iv-x-p14'), { status: 308, location: '/problems/nof-2006-iv-x-p14/solution/' });
});

test('the problem redirect handles Cyrillic slugs, raw or percent-encoded', () => {
  const slug = 'esf-2004-st-задача-2-уитстонов-мост';
  assert.equal(redirect(`/problems/${slug}/`).location, `/problems/${slug}/solution/`);
  const encoded = encodeURIComponent(slug);
  assert.equal(redirect(`/problems/${encoded}/`).location, `/problems/${encoded}/solution/`);
});

test('every generated problem route redirects from its bare form to its own /solution/', () => {
  const routes = JSON.parse(fs.readFileSync(path.join(repo, 'content/problem-routes.json'), 'utf8'));
  const urls = Object.values(routes);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.equal(redirect(url + '/')?.location, url + '/solution/', url);
    assert.equal(redirect(url + '/solution/'), null, url + '/solution/');
    assert.equal(redirect(url + '/solution'), null, url + '/solution');
  }
});

test('the index, the data files and other sections are not redirected', () => {
  for (const p of ['/problems/', '/problems', '/problems-data/tree.json', '/problems-data/index.json',
    '/problems/index.html', '/problems/x/solution/', '/page-data/problems/page-data.json', '/archive/', '/mechanics/']) {
    assert.equal(redirect(p), null, p);
  }
});

test('bare aliases still end on their alias target: every one has a /solution alias with the same target', () => {
  const aliasFile = path.join(repo, 'content/problem-aliases.json');
  if (!fs.existsSync(aliasFile)) return;
  const aliases = JSON.parse(fs.readFileSync(aliasFile, 'utf8'));
  for (const [from, to] of Object.entries(aliases)) {
    if (/\/solution\/?$/.test(from)) continue;
    // Vercel redirects run before the filesystem, so /problems/<alias>/ goes to
    // /problems/<alias>/solution/, whose meta redirect must lead to the same place.
    assert.equal(redirect(from + '/')?.location, from + '/solution/', from);
    assert.equal(aliases[from + '/solution'], to, from);
  }
});

test('the old section redirects keep working', () => {
  assert.equal(redirect('/beginner').location, '/mechanics');
  assert.equal(redirect('/physics/kinematics').location, '/mechanics');
});

test('hashed bundles, /static and self-hosted fonts are immutable; HTML and data revalidate', () => {
  const immutable = 'public, max-age=31536000, immutable';
  for (const p of ['/app-0e5e8275a51b97090665.js', '/framework-f5c8b911440bf8efb322.js',
    '/webpack-runtime-f2067939bce1660c9e22.js', '/3a2a4a7e-573e7fe96e497e48a54a.js',
    '/8c94476aecfffef8bb188161ebc5955ec9aac41a-997cf53f95c9b3912d2f.js',
    '/component---src-templates-solution-template-tsx-1a2b3c4d5e6f7a8b9c0d.js',
    '/styles.11f8762e663009a137d3.css', '/static/KaTeX_Main-Regular-f8a7f19f45060f7a177b.woff2',
    '/static/d2f5f3c7a1b0e9d8c7b6a5f4e3d2c1b0/figure.png', '/fonts/inter-4.1-roman-core.woff2']) {
    assert.equal(cacheControl(p), immutable, p);
  }
  for (const p of ['/', '/problems/', '/problems/nof-2006-iv-x-p14/solution/', '/page-data/app-data.json',
    '/page-data/problems/page-data.json', '/problems-data/index.json', '/problems-data/tree.json',
    '/sitemap-index.xml', '/robots.txt', '/app.js', '/problems/x/app-0e5e8275a51b97090665.js']) {
    assert.equal(cacheControl(p), null, p);
  }
});
