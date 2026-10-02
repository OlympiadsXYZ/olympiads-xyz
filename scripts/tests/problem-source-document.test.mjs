import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sourceDocumentFor } from '../lib/problem-source-document.mjs';

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const key = name => `Физика/Състезания/APhO/2009/Theory/${name}`;
const paper = {
  source: { archiveKey: key('th_problems.pdf'), pages: [1, 2, 3, 4, 5, 6] },
  solutionSource: {
    archiveKey: key('1_sol.pdf'),
    pages: [1, 2, 3, 4, 5, 6, 7],
  },
  supplementarySources: {
    'supplement-1': { archiveKey: key('2_sol.pdf'), pages: [1, 2, 3] },
    'supplement-2': { archiveKey: key('3_sol.pdf'), pages: [1, 2, 3] },
  },
};
const p = { id: 'x-p2' };
const pin = (document, page = 1, via = 'manual') => ({
  [p.id]: { solutions: { document, page, via } },
});

nodeTest(
  'ordinary source selection and existing manual/text pins remain unchanged',
  () => {
    const before = JSON.stringify(paper);
    for (const overlay of [
      {},
      { [p.id]: { solutions: { page: 2, via: 'manual' } } },
      { [p.id]: { solutions: { page: 2, via: 'text' } } },
    ]) {
      assert.deepEqual(sourceDocumentFor(paper, p, 'solutions', overlay), {
        document: 'solutions',
        source: paper.solutionSource,
      });
    }
    assert.deepEqual(sourceDocumentFor(paper, p, 'problems', {}), {
      document: 'problems',
      source: paper.source,
    });
    assert.equal(
      JSON.stringify(paper),
      before,
      'Selection must not mutate source metadata'
    );
  }
);
nodeTest('each explicit registered key selects its own native PDF', () => {
  for (const document of ['supplement-1', 'supplement-2']) {
    assert.deepEqual(sourceDocumentFor(paper, p, 'solutions', pin(document)), {
      document,
      source: paper.supplementarySources[document],
    });
  }
});
nodeTest('unknown, external and inherited document names are refused', () => {
  for (const document of [
    'absent',
    'https://example.org/fake.pdf',
    '__proto__',
  ]) {
    assert.throws(
      () => sourceDocumentFor(paper, p, 'solutions', pin(document)),
      /Unregistered/
    );
  }
});
nodeTest('computed pins cannot select a different document', () => {
  assert.throws(
    () =>
      sourceDocumentFor(paper, p, 'solutions', pin('supplement-1', 1, 'text')),
    /explicit manual/
  );
});
nodeTest(
  'named-key page must be a positive page in the declared original scope',
  () => {
    for (const page of [0, -1, 4, 1.5, '1']) {
      assert.throws(
        () =>
          sourceDocumentFor(paper, p, 'solutions', pin('supplement-1', page)),
        /outside/
      );
    }
    assert.throws(
      () =>
        sourceDocumentFor(
          {
            ...paper,
            supplementarySources: {
              'supplement-1': { archiveKey: key('2_sol.pdf') },
            },
          },
          p,
          'solutions',
          pin('supplement-1')
        ),
      /outside/
    );
  }
);
nodeTest(
  'question navigation cannot be redirected to a supplementary key',
  () => {
    assert.throws(
      () =>
        sourceDocumentFor(paper, p, 'problems', {
          [p.id]: {
            problems: { document: 'supplement-1', page: 1, via: 'manual' },
          },
        }),
      /explicit manual/
    );
  }
);

function fixture(t) {
  const tmp = path.join(repo, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const root = fs.mkdtempSync(path.join(tmp, 'source-document-test-'));
  t.after(() => {
    assert(path.resolve(root).startsWith(path.resolve(tmp) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
  };
  const data = {
    paper: {
      id: 'source-nav-fixture',
      subject: 'physics',
      competition: 'APhO',
      year: 2009,
      roundType: 'theory',
      lang: 'en',
      status: 'review',
      ...paper,
    },
    problems: [1, 2, 3].map(n => ({
      id: `source-nav-fixture-p${n}`,
      number: n,
      title: `Navigation fixture ${n}`,
      statement: 'Synthetic navigation test statement.',
      solution: {
        statement: 'Synthetic navigation test solution.',
        attribution: 'archive',
      },
    })),
  };
  const file = 'content/problems/physics/APhO/2009/source-nav-fixture.json';
  write(file, data);
  write('content/extraProblems.json', { EXTRA_PROBLEMS: [] });
  const bytes = fs.readFileSync(path.join(root, file));
  write('content/problem-publication.json', {
    version: 1,
    papers: {
      'source-nav-fixture': {
        kind: 'legacy',
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        sourceCommit: 'a'.repeat(40),
        recordedAt: '2009-01-01T00:00:00.000Z',
      },
    },
  });
  const generator =
    process.env.SOURCE_DOC_TEST_GENERATOR ||
    path.join(repo, 'scripts/problems-to-site.mjs');
  const run = () =>
    spawnSync(process.execPath, [generator, '--root', root], {
      encoding: 'utf8',
    });
  return {
    root,
    write,
    run,
    mdx: n =>
      fs.readFileSync(
        path.join(
          root,
          `solutions/physics/source-nav-fixture/source-nav-fixture-p${n}.mdx`
        ),
        'utf8'
      ),
    entries: () =>
      JSON.parse(
        fs.readFileSync(path.join(root, 'content/extraProblems.json'), 'utf8')
      ).EXTRA_PROBLEMS,
  };
}
nodeTest(
  'actual generator delivers native2_sol/3_sol footer AND compare URLs, keeps ordinary1_sol',
  t => {
    const f = fixture(t);
    f.write('content/problem-source-pages.json', {
      version: 1,
      problems: {
        'source-nav-fixture-p1': { solutions: { page: 2, via: 'manual' } },
        'source-nav-fixture-p2': {
          solutions: { page: 1, via: 'manual', document: 'supplement-1' },
        },
        'source-nav-fixture-p3': {
          solutions: { page: 1, via: 'manual', document: 'supplement-2' },
        },
      },
    });
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const [n, name, page] of [
      [1, '1_sol.pdf', 2],
      [2, '2_sol.pdf', 1],
      [3, '3_sol.pdf', 1],
    ]) {
      const info = f
        .entries()
        .find(x => x.uniqueId === `source-nav-fixture-p${n}`);
      assert(info);
      assert(
        info.solutionUrl.endsWith(`/${name}#page=${page}`),
        info.solutionUrl
      );
      assert(f.mdx(n).includes(`решение от архива: [${name}](`));
      assert(f.mdx(n).includes(`${name}#page=${page}`));
      if (n > 1) {
        assert(
          !f.mdx(n).includes('решение от архива: [1_sol.pdf]('),
          'Never label the unrelated first key as this task solution'
        );
      }
    }
  }
);
nodeTest('actual generator refuses an unregistered original selection', t => {
  const f = fixture(t);
  f.write('content/problem-source-pages.json', {
    version: 1,
    problems: {
      'source-nav-fixture-p2': {
        solutions: { page: 1, via: 'manual', document: 'foreign-key' },
      },
    },
  });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unregistered original key document/);
});
