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
import { readPapers, publicationState } from '../lib/problem-data.mjs';

const require = createRequire(import.meta.url);
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const config = JSON.parse(
  fs.readFileSync(path.join(repo, 'vercel.json'), 'utf8')
);
// The path-to-regexp 6.3 that @vercel's builders install under this alias (the plain
// 'path-to-regexp' at the root can be an Express 0.1.x).
const { pathToRegexp, compile } = require('path-to-regexp-updated');

function sourceToRegex(source) {
  const keys = [];
  const re = pathToRegexp(source, keys, {
    strict: true,
    sensitive: true,
    delimiter: '/',
  });
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
    return {
      status: r.permanent ? 308 : 307,
      location: dest.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? ''),
    };
  }
  return null;
}

function cacheControl(pathname) {
  let value = null;
  for (const h of config.headers || []) {
    if (!sourceToRegex(h.source).re.test(pathname)) continue;
    for (const { key, value: v } of h.headers) {
      if (key.toLowerCase() === 'cache-control') value = v;
    }
  }
  return value;
}

test('a bare problem URL redirects permanently to its solution page', () => {
  assert.deepEqual(redirect('/problems/nof-2006-iv-x-p14/'), {
    status: 308,
    location: '/problems/nof-2006-iv-x-p14/solution/',
  });
  assert.deepEqual(redirect('/problems/nof-2006-iv-x-p14'), {
    status: 308,
    location: '/problems/nof-2006-iv-x-p14/solution/',
  });
});

test('the problem redirect handles Cyrillic slugs, raw or percent-encoded', () => {
  const slug = 'esf-2004-st-задача-2-уитстонов-мост';
  assert.equal(
    redirect(`/problems/${slug}/`).location,
    `/problems/${slug}/solution/`
  );
  const encoded = encodeURIComponent(slug);
  assert.equal(
    redirect(`/problems/${encoded}/`).location,
    `/problems/${encoded}/solution/`
  );
});

test('every generated problem route redirects from its bare form to its own /solution/', () => {
  const routes = JSON.parse(
    fs.readFileSync(path.join(repo, 'content/problem-routes.json'), 'utf8')
  );
  const urls = Object.values(routes);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.equal(redirect(url + '/')?.location, url + '/solution/', url);
    assert.equal(redirect(url + '/solution/'), null, url + '/solution/');
    assert.equal(redirect(url + '/solution'), null, url + '/solution');
  }
});

test('/faq ends on the home page FAQ anchor, with no slash after the hash', () => {
  // the meta redirect Gatsby writes for src/redirects.txt points at '/#faq/', which matches no id
  assert.deepEqual(redirect('/faq'), { status: 307, location: '/#faq' });
  assert.deepEqual(redirect('/faq/'), { status: 307, location: '/#faq' });
  assert.equal(redirect('/faqs/'), null);
});

test('the index, the data files and other sections are not redirected', () => {
  for (const p of [
    '/problems/',
    '/problems',
    '/problems-data/tree.json',
    '/problems-data/index.json',
    '/problems/index.html',
    '/problems/x/solution/',
    '/page-data/problems/page-data.json',
    '/archive/',
    '/mechanics/',
  ]) {
    assert.equal(redirect(p), null, p);
  }
});

function declaredNativePlainAliases(problems, routes, publishedIds) {
  const declared = new Map();
  for (const problem of problems) {
    for (const alias of problem.aliases || []) {
      assert(
        alias.preservePlainRoute === undefined ||
          typeof alias.preservePlainRoute === 'boolean',
        'Unsupported plain-route flag'
      );
      if (alias.preservePlainRoute !== true) continue;
      assert(
        publishedIds.has(problem.id),
        'Native alias survivor must be published'
      );
      assert(
        alias.id !== problem.id && !publishedIds.has(alias.id),
        'Native alias must identify a retired task'
      );
      assert(
        typeof alias.sectionId === 'string' && alias.sectionId.length > 0,
        'Native alias requires a declared section'
      );
      assert.equal(
        problem.sections?.filter(s => s.id === alias.sectionId).length,
        1,
        'Native alias section must exist exactly once'
      );
      const target = routes[problem.id];
      assert(
        typeof target === 'string' &&
          target.startsWith('/problems/') &&
          !/[#?]/.test(target),
        'Exact registered survivor route'
      );
      for (const from of new Set(
        [routes[alias.id], `/problems/${alias.id}`].filter(Boolean)
      )) {
        assert(!declared.has(from), 'Duplicate native alias declaration');
        declared.set(from, {
          plain: `${target}#${alias.sectionId}`,
          solution: `${target}/solution#${alias.sectionId}`,
        });
      }
    }
  }
  return declared;
}

function assertAliasPair(from, aliases, declared) {
  const native = declared.get(from);
  assert.equal(typeof aliases[from], 'string', 'Missing bare alias');
  assert.equal(
    typeof aliases[from + '/solution'],
    'string',
    'Missing solution alias'
  );
  if (native) {
    assert.equal(aliases[from], native.plain, from);
    assert.equal(aliases[from + '/solution'], native.solution, from);
  } else assert.equal(aliases[from + '/solution'], aliases[from], from);
}

test('bare aliases retain ordinary targets or the exact source-declared native plain and solution targets', () => {
  const aliasFile = path.join(repo, 'content/problem-aliases.json');
  if (!fs.existsSync(aliasFile)) return;
  const aliases = JSON.parse(fs.readFileSync(aliasFile, 'utf8'));
  const routes = JSON.parse(
    fs.readFileSync(path.join(repo, 'content/problem-routes.json'), 'utf8')
  );
  const publishedIds = new Set(
    JSON.parse(
      fs.readFileSync(path.join(repo, 'content/problem-generated.json'), 'utf8')
    ).problemIds
  );
  const ledger = JSON.parse(
    fs.readFileSync(path.join(repo, 'content/problem-publication.json'), 'utf8')
  );
  const problems = readPapers(repo)
    .filter(r => publicationState(r, ledger).eligible)
    .flatMap(r => r.data.problems);
  const declared = declaredNativePlainAliases(problems, routes, publishedIds);
  for (const from of Object.keys(aliases)) {
    if (/\/solution\/?$/.test(from)) continue;
    assert.equal(redirect(from + '/')?.location, from + '/solution/', from);
    assertAliasPair(from, aliases, declared);
  }
  // Require both targets even when an incorrectly generated pair happens to be equal.
  for (const from of declared.keys()) assertAliasPair(from, aliases, declared);
});

const nativeProblem = {
  id: 'survivor',
  sections: [{ id: 'section-2' }],
  aliases: [
    { id: 'retired', sectionId: 'section-2', preservePlainRoute: true },
  ],
};
const nativeRoutes = {
  survivor: '/problems/frozen-survivor',
  retired: '/problems/frozen-retired',
};
const nativePublished = new Set(['survivor']);

test('a declared native alias preserves the exact frozen survivor and section in both forms', () => {
  const declared = declaredNativePlainAliases(
    [nativeProblem],
    nativeRoutes,
    nativePublished
  );
  for (const from of ['/problems/frozen-retired', '/problems/retired']) {
    assertAliasPair(
      from,
      {
        [from]: '/problems/frozen-survivor#section-2',
        [from + '/solution']: '/problems/frozen-survivor/solution#section-2',
      },
      declared
    );
  }
});

test('ordinary aliases still require equal targets and a paired solution entry', () => {
  assertAliasPair(
    '/problems/old',
    {
      '/problems/old': '/problems/new/solution',
      '/problems/old/solution': '/problems/new/solution',
    },
    new Map()
  );
  assert.throws(() =>
    assertAliasPair(
      '/problems/old',
      {
        '/problems/old': '/problems/new#section',
        '/problems/old/solution': '/problems/new/solution#section',
      },
      new Map()
    )
  );
  assert.throws(() =>
    assertAliasPair(
      '/problems/old',
      { '/problems/old': '/problems/new/solution' },
      new Map()
    )
  );
});

test('native alias missing section, unsupported flag or unpublished survivor is rejected', () => {
  for (const problem of [
    { ...nativeProblem, sections: [] },
    {
      ...nativeProblem,
      aliases: [{ id: 'retired', preservePlainRoute: true }],
    },
    {
      ...nativeProblem,
      aliases: [
        { id: 'retired', sectionId: 'section-2', preservePlainRoute: 'true' },
      ],
    },
    {
      ...nativeProblem,
      aliases: [
        { id: 'retired', sectionId: 'section-2', preservePlainRoute: null },
      ],
    },
  ]) {
    assert.throws(() =>
      declaredNativePlainAliases([problem], nativeRoutes, nativePublished)
    );
  }
  assert.throws(() =>
    declaredNativePlainAliases([nativeProblem], nativeRoutes, new Set())
  );
});

test('native aliases reject equal-but-wrong pairs, wrong survivor/section and missing entries', () => {
  const declared = declaredNativePlainAliases(
      [nativeProblem],
      nativeRoutes,
      nativePublished
    ),
    from = '/problems/retired';
  for (const pair of [
    {
      plain: '/problems/frozen-survivor/solution#section-2',
      solution: '/problems/frozen-survivor/solution#section-2',
    },
    {
      plain: '/problems/foreign#section-2',
      solution: '/problems/foreign/solution#section-2',
    },
    {
      plain: '/problems/frozen-survivor#missing',
      solution: '/problems/frozen-survivor/solution#missing',
    },
  ]) {
    assert.throws(() =>
      assertAliasPair(
        from,
        { [from]: pair.plain, [from + '/solution']: pair.solution },
        declared
      )
    );
  }
  assert.throws(() => assertAliasPair(from, {}, declared));
});

test('the old section redirects keep working', () => {
  assert.equal(redirect('/beginner').location, '/mechanics');
  assert.equal(redirect('/physics/kinematics').location, '/mechanics');
});

test('hashed bundles, /static and self-hosted fonts are immutable; HTML and data revalidate', () => {
  const immutable = 'public, max-age=31536000, immutable';
  for (const p of [
    '/app-0e5e8275a51b97090665.js',
    '/framework-f5c8b911440bf8efb322.js',
    '/webpack-runtime-f2067939bce1660c9e22.js',
    '/3a2a4a7e-573e7fe96e497e48a54a.js',
    '/8c94476aecfffef8bb188161ebc5955ec9aac41a-997cf53f95c9b3912d2f.js',
    '/component---src-templates-solution-template-tsx-1a2b3c4d5e6f7a8b9c0d.js',
    '/styles.11f8762e663009a137d3.css',
    '/static/KaTeX_Main-Regular-f8a7f19f45060f7a177b.woff2',
    '/static/d2f5f3c7a1b0e9d8c7b6a5f4e3d2c1b0/figure.png',
    '/fonts/inter-4.1-roman-core.woff2',
  ]) {
    assert.equal(cacheControl(p), immutable, p);
  }
  for (const p of [
    '/',
    '/problems/',
    '/problems/nof-2006-iv-x-p14/solution/',
    '/page-data/app-data.json',
    '/page-data/problems/page-data.json',
    '/problems-data/index.json',
    '/problems-data/tree.json',
    '/sitemap-index.xml',
    '/robots.txt',
    '/app.js',
    '/problems/x/app-0e5e8275a51b97090665.js',
  ]) {
    assert.equal(cacheControl(p), null, p);
  }
});
