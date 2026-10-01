import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo =
  process.env.OLYMPIADS_FRAGMENT_TEST_REPO ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const override = process.env.OLYMPIADS_FRAGMENT_PROPOSAL || repo;
const dataRoot = process.env.OLYMPIADS_FRAGMENT_TEST_DATA || repo;
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const { JSDOM } = require('jsdom');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const navigations = [];

// Exercise proposal/real modules directly. No Gatsby build, network, shared writes,
// MDX compiler, source rereading or scientific reviewer runs in this fixture.
function loadModules() {
  const cache = new Map();
  const load = relative => {
    const logical = path.join(repo, relative);
    if (cache.has(logical)) return cache.get(logical).exports;
    const proposed = path.join(override, relative);
    const source = fs.existsSync(proposed) ? proposed : logical;
    const module = { exports: {} };
    cache.set(logical, module);
    const localRequire = createRequire(logical);
    const dependency = specifier => {
      if (specifier === 'gatsby')
        return {
          graphql: strings => strings.join(''),
          Link: ({ to, children, ...props }) =>
            React.createElement('a', { ...props, href: to }, children),
          navigate: (url, options) => {
            navigations.push({ url, options });
            return Promise.resolve();
          },
        };
      if (specifier === 'child_process')
        return { execSync: () => Buffer.from('') };
      if (specifier === './src/gatsby/create-xdm-node')
        return {
          createXdmNode: () => {
            throw Error('Unexpected MDX compilation');
          },
        };
      if (specifier === './src/editor/index-node')
        return { writeEditorIndex: () => {} };
      if (specifier === './src/problems/index-node')
        return {
          writeProblemsIndex: (_root, nodes) => nodes.length,
          writeProblemsTree: (_root, nodes) => ({
            count: nodes.length,
            subjects: [],
          }),
          readProblemPapers: () => new Map(),
          readEditionProjection: () => ({
            primaryById: new Map(),
            membersById: new Map(),
            languageById: new Map(),
            suppressedIds: new Set(),
            issues: [],
          }),
        };
      if (specifier === './src/problems/fragment-routes-node') {
        const actual = load('src/problems/fragment-routes-node.ts');
        return {
          readProblemFragmentRoutes: (_root, urls) =>
            actual.readProblemFragmentRoutes(dataRoot, urls),
        };
      }
      if (specifier.startsWith('.')) {
        const base = path.resolve(path.dirname(logical), specifier);
        for (const ext of ['.ts', '.tsx']) {
          const rel = path.relative(repo, base + ext);
          if (
            fs.existsSync(path.join(override, rel)) ||
            fs.existsSync(base + ext)
          )
            return load(rel);
        }
      }
      return localRequire(specifier);
    };
    const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
      },
    });
    assert.equal(
      (compiled.diagnostics || []).filter(
        x => x.category === ts.DiagnosticCategory.Error
      ).length,
      0
    );
    new Function(
      'require',
      'module',
      'exports',
      '__filename',
      '__dirname',
      'process',
      compiled.outputText
    )(dependency, module, module.exports, logical, path.dirname(logical), {
      ...process,
      env: {
        ...process.env,
        CI: '',
        ARCHIVE_ENABLED: 'false',
        GATSBY_ARCHIVE_ENABLED: 'false',
        GATSBY_INCLUDE_DRAFTS: 'false',
      },
    });
    return module.exports;
  };
  return { load };
}
const { load } = loadModules();
const core = load('src/problems/fragment-routes.ts');
const node = load('src/problems/fragment-routes-node.ts');
const ui = load('src/components/markdown/ProblemFragmentRoutes.tsx');
const Spoiler = load('src/components/markdown/Spoiler.tsx').default;
const config = JSON.parse(
  fs.readFileSync(
    path.join(dataRoot, 'content/problem-fragment-routes.json'),
    'utf8'
  )
);
const papers = config.groups.map(g =>
  JSON.parse(fs.readFileSync(path.join(dataRoot, g.paper.path), 'utf8'))
);
const urls = new Map(
  papers.flatMap(p => p.problems.map(x => [x.id, `/problems/${x.id}/solution`]))
);
const expected = [
  [
    'belpho-2014-iii-3-etap-theoretical-p1',
    's12',
    'belpho-2014-iii-3-etap-theoretical-p10',
    's12',
  ],
  [
    'belpho-2014-iii-3-etap-theoretical-p2',
    's22',
    'belpho-2014-iii-3-etap-theoretical-p11',
    's22',
  ],
  ...[
    [1, 10],
    [4, 11],
    [7, 12],
  ].map(([a, b]) => [
    `belpho-2017-iv-theoretical-p${a}`,
    'native-section-2',
    `belpho-2017-iv-theoretical-p${b}`,
    'native-section-2',
  ]),
  ...[
    [1, 10, 11],
    [4, 12, 13],
    [7, 14, 15],
  ].flatMap(([a, b, c]) =>
    [
      [2, b],
      [3, c],
    ].flatMap(([n, to]) =>
      ['', 'solution-'].map(prefix => [
        `belpho-2016-iii-3-etap-theoretical-p${a}`,
        `${prefix}task-1-${n}`,
        `belpho-2016-iii-3-etap-theoretical-p${to}`,
        `${prefix}task-1-${n}`,
      ])
    )
  ),
];

test('all17 source-proven question/key mappings project against exact grouped canonical bytes', () => {
  const projection = node.readProblemFragmentRoutes(dataRoot, urls);
  assert.equal(config.groups.length, 3);
  assert.equal(
    [...projection.values()].reduce((n, x) => n + x.length, 0),
    17
  );
  for (const [from, fragment, to, target] of expected) {
    const route = projection.get(from).find(x => x.fromFragment === fragment);
    assert.equal(route.toUrl, `/problems/${to}/solution#${target}`);
    assert.ok(route.label.trim());
    assert.equal(
      core.movedFragmentTarget(projection.get(from), {
        pathname: `/problems/${from}/solution`,
        search: '?compare=1',
        hash: '#' + fragment,
      }),
      `/problems/${to}/solution?compare=1#${target}`
    );
  }
  for (const p of papers)
    for (const problem of p.problems)
      assert.ok(
        urls.has(problem.id),
        'Every retained/new whole route survives'
      );
});

test('absent optional config is empty and does not alter ordinary pages', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fragment-empty-'));
  try {
    assert.equal(node.readProblemFragmentRoutes(directory, new Map()).size, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unknown/unmapped/native first-task hashes remain on their retained page; percent-encoded known hash resolves', () => {
  const routes = node
    .readProblemFragmentRoutes(dataRoot, urls)
    .get('belpho-2016-iii-3-etap-theoretical-p1');
  const location = {
    pathname: '/problems/belpho-2016-iii-3-etap-theoretical-p1/solution',
    search: '',
  };
  for (const hash of [
    '',
    '#task-1-1',
    '#solution-task-1-1',
    '#unknown',
    '#%ZZ',
    '#task-1-20',
  ])
    assert.equal(core.movedFragmentTarget(routes, { ...location, hash }), null);
  assert.equal(
    core.movedFragmentTarget(routes, { ...location, hash: '#task%2D1%2D2' }),
    '/problems/belpho-2016-iii-3-etap-theoretical-p10/solution#task-1-2'
  );
  assert.equal(
    core.movedFragmentTarget(
      [
        {
          fromFragment: 'x',
          toUrl: 'https://outside.invalid/problemless/solution#x',
          label: 'x',
        },
      ],
      { ...location, hash: '#x' }
    ),
    null
  );
});

test('initial navigation, hashchange and back events resolve exact mappings and cleanup stops navigation', () => {
  const routes = node
      .readProblemFragmentRoutes(dataRoot, urls)
      .get('belpho-2016-iii-3-etap-theoretical-p1'),
    calls = [];
  const browser = new EventTarget();
  browser.location = {
    pathname: '/problems/belpho-2016-iii-3-etap-theoretical-p1/solution',
    search: '?from=old',
    hash: '#task-1-2',
  };
  const dispose = core.watchMovedFragments(routes, browser, url =>
    calls.push(url)
  );
  assert.deepEqual(calls, [
    '/problems/belpho-2016-iii-3-etap-theoretical-p10/solution?from=old#task-1-2',
  ]);
  browser.location.hash = '#solution-task-1-3';
  browser.dispatchEvent(new Event('hashchange'));
  assert.equal(
    calls[1],
    '/problems/belpho-2016-iii-3-etap-theoretical-p11/solution?from=old#solution-task-1-3'
  );
  browser.location.hash = '#task-1-1';
  browser.dispatchEvent(new Event('hashchange'));
  assert.equal(calls.length, 2);
  browser.location.hash = '#task-1-3';
  browser.dispatchEvent(new Event('popstate'));
  assert.equal(calls.length, 3);
  dispose();
  browser.location.hash = '#task-1-2';
  browser.dispatchEvent(new Event('hashchange'));
  assert.equal(calls.length, 3);
});

test('static fallback retains all17 exact old anchors as usable target links without browser execution', () => {
  const projection = node.readProblemFragmentRoutes(dataRoot, urls);
  for (const [from, routes] of projection) {
    const html = renderToStaticMarkup(
      React.createElement(
        ui.ProblemFragmentProvider,
        { routes },
        React.createElement(ui.MovedProblemSections, { routes })
      )
    );
    for (const row of routes) {
      assert.ok(html.includes(`id="${row.fromFragment}"`), from);
      assert.ok(html.includes(`href="${row.toUrl}"`));
    }
  }
});

function synthetic() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fragment-guard-')),
    relative = 'content/problems/physics/BelPhO/2000/paper.json';
  const paper = {
    paper: { id: 'paper' },
    problems: [
      { id: 'paper-p1', sections: [{ id: 'task-one' }] },
      {
        id: 'paper-p2',
        sections: [{ id: 'task-two' }],
        solution: { sections: [{ id: 'task-two' }] },
      },
    ],
  };
  const file = path.join(dir, relative),
    bytes = Buffer.from(JSON.stringify(paper));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  const config = {
    version: 1,
    groups: [
      {
        paper: { path: relative, sha256: hash(bytes) },
        previousCanonicalSha256: '1'.repeat(64),
        sourceReaderEvidence: {
          reference: 'native-source-proof',
          sha256: '2'.repeat(64),
        },
        mappings: [
          {
            fromProblemId: 'paper-p1',
            fromFragment: 'task-two',
            toProblemId: 'paper-p2',
            toFragment: 'task-two',
            label: 'Task2',
          },
        ],
      },
    ],
  };
  return {
    dir,
    file,
    config,
    urls: new Map([
      ['paper-p1', '/problems/paper-p1/solution'],
      ['paper-p2', '/problems/paper-p2/solution'],
    ]),
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
for (const [title, mutate, pattern] of [
  [
    'stale canonical SHA',
    f => {
      fs.appendFileSync(f.file, ' ');
    },
    /hash mismatch/,
  ],
  [
    'unsupported config version',
    f => {
      f.config.version = 2;
    },
    /version/,
  ],
  [
    'missing source reader proof',
    f => {
      delete f.config.groups[0].sourceReaderEvidence;
    },
    /evidence hashes/,
  ],
  [
    'unavailable retained route',
    f => {
      f.urls.delete('paper-p1');
    },
    /unavailable/,
  ],
  [
    'unavailable target route',
    f => {
      f.urls.delete('paper-p2');
    },
    /unavailable/,
  ],
  [
    'unknown task ID',
    f => {
      f.config.groups[0].mappings[0].toProblemId = 'paper-p3';
    },
    /retained IDs/,
  ],
  [
    'missing native target anchor',
    f => {
      f.config.groups[0].mappings[0].toFragment = 'invented-part-anchor';
    },
    /missing target/,
  ],
  [
    'retained native anchor shadow',
    f => {
      f.config.groups[0].mappings[0].fromFragment = 'task-one';
    },
    /shadows/,
  ],
  [
    'same-page mapping',
    f => {
      f.config.groups[0].mappings[0].toProblemId = 'paper-p1';
    },
    /retained IDs/,
  ],
  [
    'duplicate source mapping',
    f => {
      f.config.groups[0].mappings.push({ ...f.config.groups[0].mappings[0] });
    },
    /duplicate source/,
  ],
  [
    'unsafe target URL',
    f => {
      f.urls.set('paper-p2', '//outside.invalid/solution');
    },
    /unsafe target/,
  ],
  [
    'canonical traversal',
    f => {
      f.config.groups[0].paper.path = 'content/problems/../elsewhere.json';
    },
    /unsafe canonical/,
  ],
])
  test(`strict gate rejects ${title} without silently inventing or omitting mappings`, () => {
    const f = synthetic();
    try {
      mutate(f);
      assert.throws(
        () => node.readProblemFragmentRoutes(f.dir, f.urls, f.config),
        pattern
      );
    } finally {
      f.dispose();
    }
  });

test('native question and official-key anchors are distinct; valid key target projects', () => {
  const f = synthetic();
  try {
    f.config.groups[0].mappings[0].fromFragment = 'solution-task-two';
    f.config.groups[0].mappings[0].toFragment = 'solution-task-two';
    const projection = node.readProblemFragmentRoutes(f.dir, f.urls, f.config);
    assert.equal(
      projection.get('paper-p1')[0].toUrl,
      '/problems/paper-p2/solution#solution-task-two'
    );
  } finally {
    f.dispose();
  }
});

test('actual Gatsby hook retains all whole pages and injects the real17 fragment contexts', async () => {
  const hooks = load('gatsby-node.ts'),
    pages = [],
    redirects = [];
  const problems = papers.flatMap(p =>
    p.problems.map(problem => ({
      node: {
        uniqueId: problem.id,
        name: problem.title,
        url: 'https://www.olympiads.xyz/archive/physics/source.pdf',
        source: 'BelPhO ' + p.paper.year,
        solution: { kind: 'internal' },
        difficulty: '',
        tags: [],
        module: null,
      },
    }))
  );
  await hooks.createPages({
    graphql: async () => ({
      data: {
        modules: { edges: [] },
        problems: { edges: problems },
        solutions: {
          edges: problems.map(({ node }) => ({
            node: { frontmatter: { id: node.uniqueId, title: node.name } },
          })),
        },
      },
    }),
    actions: {
      createPage: p => pages.push(p),
      createRedirect: r => redirects.push(r),
    },
    reporter: {
      panicOnBuild: message => {
        throw Error(message);
      },
      error: message => {
        throw Error(message);
      },
    },
  });
  const solutionPages = pages.filter(p => p.path.endsWith('/solution'));
  assert.equal(solutionPages.length, urls.size);
  const byId = new Map(solutionPages.map(p => [p.context.id, p]));
  for (const paper of papers)
    for (let n = 1; n <= 9; n++)
      assert.ok(
        byId.has(paper.paper.id + '-p' + n),
        'Old whole problem page retained'
      );
  for (const [from, fragment, to, target] of expected) {
    const route = byId
      .get(from)
      .context.fragmentRoutes.find(x => x.fromFragment === fragment);
    assert.equal(route.toUrl, `/problems/${to}/solution#${target}`);
  }
  assert.equal(
    solutionPages.reduce((n, p) => n + p.context.fragmentRoutes.length, 0),
    17
  );
  assert.equal(
    redirects.some(r => r.fromPath.includes('#')),
    false,
    'Browser fragments never become server redirects'
  );
});

test('solution spoilers open/scroll exact initial and hashchange native targets; unrelated sections remain closed', async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://www.olympiads.xyz/problemless/solution#solution-task-1-2',
    pretendToBeVisual: true,
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const scrolls = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () {
    scrolls.push(this.id);
  };
  const root = createRoot(document.getElementById('root'));
  const element = routeHash =>
    React.createElement(
      ui.ProblemFragmentProvider,
      { routeHash },
      React.createElement('section', { id: 'task-1-1' }, 'Retained question'),
      React.createElement(
        Spoiler,
        { title: 'Key2' },
        React.createElement(
          'section',
          { id: 'solution-task-1-2' },
          'Native key2'
        )
      ),
      React.createElement(
        Spoiler,
        { title: 'Key3' },
        React.createElement(
          'section',
          { id: 'solution-task-1-3' },
          'Native key3'
        )
      )
    );
  try {
    await act(async () => {
      root.render(element('#solution-task-1-2'));
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 30));
    });
    let buttons = document.querySelectorAll('button');
    assert.equal(buttons[0].getAttribute('aria-expanded'), 'true');
    assert.equal(buttons[1].getAttribute('aria-expanded'), 'false');
    assert.ok(scrolls.includes('solution-task-1-2'));
    await act(async () => {
      window.history.replaceState(null, '', '#solution-task-1-3');
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 30));
    });
    assert.equal(buttons[1].getAttribute('aria-expanded'), 'true');
    assert.ok(scrolls.includes('solution-task-1-3'));
    await act(async () => {
      buttons[1].click();
    });
    assert.equal(
      buttons[1].getAttribute('aria-expanded'),
      'false',
      'Explicit close stays closed'
    );
    // Gatsby hash-only pushState does not emit hashchange: its location prop does.
    await act(async () => {
      window.history.pushState(null, '', '#task-1-1');
      root.render(element('#task-1-1'));
    });
    assert.equal(
      document.getElementById('task-1-1').textContent,
      'Retained question'
    );
    assert.equal(buttons[1].getAttribute('aria-expanded'), 'false');
    await act(async () => {
      window.history.pushState(null, '', '#solution-task-1-3');
      root.render(element('#solution-task-1-3'));
    });
    assert.equal(
      buttons[1].getAttribute('aria-expanded'),
      'true',
      'Gatsby location hash changes reopen exact native key'
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    Object.defineProperty(globalThis, 'navigator', {
      value: previous.navigator,
      configurable: true,
    });
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
