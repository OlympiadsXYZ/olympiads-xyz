// Synthetic partial-key scope fixtures; no original source reading or network.
import test, { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sourceDocumentFor } from '../lib/problem-source-document.mjs';
import { problemMetadataErrors } from '../lib/problem-classification.mjs';
import { solutionOriginalFor, problemMdx } from '../problems-to-site.mjs';
import { compileSchema, buildFinalPaper } from '../tx/lib.mjs';
import { assembleWindows } from '../tx/assemble.mjs';

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const questionKey = 'Астрономия/Fixture/questions.pdf';
const key = 'Астрономия/Fixture/key.pdf';
function fixture() {
  return {
    paper: {
      id: 'partial-fixture',
      subject: 'astronomy',
      competition: 'VsOA',
      year: 2018,
      roundType: 'test',
      lang: 'ru',
      status: 'review',
      source: { archiveKey: questionKey, pages: [1] },
      solutionSource: {
        archiveKey: key,
        pages: [2],
        problemIds: ['partial-fixture-p1'],
      },
    },
    problems: [1, 2].map(number => ({
      id: `partial-fixture-p${number}`,
      number,
      statement: `Synthetic question ${number}.`,
      sourceSpans: [
        { document: 'problems', page: 1 },
        { document: 'solutions', page: 2 },
      ],
      parts: [
        {
          label: 'a',
          statement: 'Synthetic part.',
          answer: { kind: 'text', value: 'Printed answer remains.' },
        },
      ],
      solution: {
        attribution: 'official',
        statement: `Synthetic supplied solution ${number}.`,
      },
    })),
  };
}
const render = (paper, problem) =>
  problemMdx(
    paper,
    problem,
    { quality: 'reviewed', singlePass: true },
    'fixture.json'
  );

test('partial key scope controls default source and footer without removing printed answers', () => {
  const data = fixture(),
    before = JSON.stringify(data);
  for (const [i, covered] of [true, false].entries()) {
    const problem = data.problems[i],
      mdx = render(data.paper, problem);
    assert.deepEqual(sourceDocumentFor(data.paper, problem, 'solutions'), {
      document: 'solutions',
      source: covered ? data.paper.solutionSource : null,
    });
    assert.equal(
      solutionOriginalFor(data.paper, problem),
      covered ? data.paper.solutionSource : null
    );
    assert.equal(mdx.includes('официални решения: [key.pdf]('), covered);
    assert(mdx.includes('Printed answer remains.'));
    assert(mdx.includes(problem.solution.statement));
    assert(mdx.includes('/questions.pdf#page=1'));
    if (covered) assert(mdx.includes('/key.pdf#page=2'));
    else assert(!mdx.includes('/key.pdf'));
  }
  assert.equal(JSON.stringify(data), before);
});

test('omitted scope keeps existing whole-paper behavior and explicit default pins respect the scope', () => {
  const { paper, problems } = fixture(),
    q = problems[1];
  for (const solutions of [
    { via: 'manual', page: 2 },
    { via: 'manual', document: 'solutions', page: 2 },
    { via: 'text', page: 2 },
  ]) {
    assert.equal(
      sourceDocumentFor(paper, q, 'solutions', { [q.id]: { solutions } })
        .source,
      null
    );
  }
  delete paper.solutionSource.problemIds;
  for (const problem of problems) {
    assert.equal(solutionOriginalFor(paper, problem), paper.solutionSource);
    assert(render(paper, problem).includes('официални решения: [key.pdf]('));
  }
});

test('named manual original selection keeps priority and registered-page validation', () => {
  const { paper, problems } = fixture(),
    q = problems[1];
  paper.supplementarySources = {
    'supplement-1': {
      archiveKey: 'Астрономия/Fixture/alternate.pdf',
      pages: [3],
    },
  };
  const overlay = {
    [q.id]: { solutions: { document: 'supplement-1', via: 'manual', page: 3 } },
  };
  assert.equal(
    solutionOriginalFor(paper, q, overlay),
    paper.supplementarySources['supplement-1']
  );
  overlay[q.id].solutions.page = 4;
  assert.throws(
    () => solutionOriginalFor(paper, q, overlay),
    /outside the registered/
  );
  overlay[q.id].solutions = { document: 'unknown', via: 'manual', page: 3 };
  assert.throws(() => solutionOriginalFor(paper, q, overlay), /Unregistered/);
});

test('an uncovered incomplete official solution does not promise a missing footer key', () => {
  const { paper, problems } = fixture(),
    q = problems[1];
  q.solution = { attribution: 'official', incomplete: true };
  const mdx = render(paper, q);
  assert(mdx.includes('В архива няма официално решение на тази задача.'));
  assert(!mdx.includes('вижте файла с решенията'));
  assert(!mdx.includes('/key.pdf'));
});

test('scope schema and shared metadata validation reject malformed, duplicate and unowned IDs', () => {
  const { validate } = compileSchema('final');
  for (const problemIds of [
    [],
    ['partial-fixture-p1', 'partial-fixture-p1'],
    [''],
    [null],
    'partial-fixture-p1',
    null,
  ]) {
    const data = fixture();
    data.paper.solutionSource.problemIds = problemIds;
    assert.equal(validate(data), false, JSON.stringify(problemIds));
    assert(problemMetadataErrors(data).length, JSON.stringify(problemIds));
  }
  for (const problemIds of [
    ['another-paper-p1'],
    ['partial-fixture-p3'],
    [' '],
  ]) {
    const data = fixture();
    data.paper.solutionSource.problemIds = problemIds;
    assert(
      problemMetadataErrors(data).some(e =>
        e.path.startsWith('/paper/solutionSource/problemIds')
      )
    );
  }
  const valid = fixture();
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  assert.deepEqual(problemMetadataErrors(valid), []);
  valid.paper.source.problemIds = ['partial-fixture-p1'];
  assert.equal(validate(valid), false, 'Scope belongs only on solutionSource');
});

test('final-paper construction preserves scope and refuses IDs outside the final owning paper', () => {
  const data = fixture(),
    prov = {
      provider: 'synthetic',
      model: 'synthetic-fixture',
      at: '2026-11-06T00:00:00Z',
      sourceSha256: { problems: 'a'.repeat(64), solutions: 'b'.repeat(64) },
    };
  const final = buildFinalPaper(data, prov).data;
  assert.deepEqual(final.paper.solutionSource, data.paper.solutionSource);
  const { validate } = compileSchema('final');
  assert.equal(validate(final), true, JSON.stringify(validate.errors));
  data.paper.solutionSource.problemIds = ['partial-fixture-p3'];
  assert.throws(() => buildFinalPaper(data, prov), /owning problem ID/);
});

test('window assembly preserves matching scopes and rejects incompatible or invalid scopes', () => {
  const first = fixture(),
    second = fixture();
  first.paper.source.pages = [1];
  second.paper.source.pages = [2];
  first.paper.solutionSource.pages = [2];
  second.paper.solutionSource.pages = [3];
  const assembled = assembleWindows([first, second], {}).data;
  assert.deepEqual(assembled.paper.solutionSource.problemIds, [
    'partial-fixture-p1',
  ]);
  assert.deepEqual(assembled.paper.solutionSource.pages, [2, 3]);
  for (const scope of [undefined, ['partial-fixture-p2'], null]) {
    second.paper.solutionSource.problemIds = scope;
    assert.throws(
      () => assembleWindows([first, second], {}),
      /Incompatible solutionSource.problemIds/
    );
  }
  first.paper.solutionSource.problemIds = ['partial-fixture-p3'];
  second.paper.solutionSource.problemIds = ['partial-fixture-p3'];
  assert.throws(
    () => assembleWindows([first, second], {}),
    /owning problem ID/
  );
});

function diskFixture(t) {
  const tmp = path.join(repo, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const root = fs.mkdtempSync(path.join(tmp, 'partial-solution-source-'));
  t.after(() => {
    assert(path.resolve(root).startsWith(path.resolve(tmp) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (name, data) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  };
  const setPaper = data => {
    const name = 'content/problems/astronomy/VsOA/2018/partial-fixture.json';
    write(name, data);
    write('content/problem-publication.json', {
      version: 1,
      papers: {
        [data.paper.id]: {
          kind: 'legacy',
          contentHash: createHash('sha256')
            .update(fs.readFileSync(path.join(root, name)))
            .digest('hex'),
          sourceCommit: 'a'.repeat(40),
          recordedAt: '2026-11-06T00:00:00Z',
        },
      },
    });
  };
  setPaper(fixture());
  write('content/extraProblems.json', { EXTRA_PROBLEMS: [] });
  return { root, write, setPaper };
}

nodeTest(
  'actual generator emits only covered key URLs and fails closed on unowned scope IDs',
  t => {
    const f = diskFixture(t),
      generator = path.join(repo, 'scripts/problems-to-site.mjs');
    const run = () =>
      spawnSync(process.execPath, [generator, '--root', f.root], {
        encoding: 'utf8',
      });
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const info = JSON.parse(
      fs.readFileSync(path.join(f.root, 'content/extraProblems.json'), 'utf8')
    ).EXTRA_PROBLEMS;
    for (const n of [1, 2]) {
      const mdx = fs.readFileSync(
        path.join(
          f.root,
          `solutions/astronomy/partial-fixture/partial-fixture-p${n}.mdx`
        ),
        'utf8'
      );
      assert(mdx.includes('Printed answer remains.'));
      assert.equal(mdx.includes('/key.pdf'), n === 1);
      assert.equal(
        Object.hasOwn(
          info.find(p => p.uniqueId === `partial-fixture-p${n}`),
          'solutionUrl'
        ),
        n === 1
      );
    }
    const invalid = fixture();
    invalid.paper.solutionSource.problemIds = ['partial-fixture-p3'];
    f.setPaper(invalid);
    const failed = run();
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /owning problem ID/);
  }
);

nodeTest(
  'repository Python validation also rejects scope IDs outside the owning paper',
  t => {
    const f = diskFixture(t);
    fs.copyFileSync(
      path.join(repo, 'content/problems/schema.json'),
      path.join(f.root, 'content/problems/schema.json')
    );
    const script =
      'import importlib.util, pathlib, sys; s=importlib.util.spec_from_file_location("paper_validator", sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); sys.exit(0 if m.validate(pathlib.Path(sys.argv[2])) else 1)';
    const run = () =>
      spawnSync(
        process.env.PYTHON ||
          (process.platform === 'win32' ? 'python' : 'python3'),
        ['-c', script, path.join(repo, 'scripts/validate-papers.py'), f.root],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONUTF8: '1',
          },
        }
      );
    const valid = run();
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    const invalid = fixture();
    invalid.paper.solutionSource.problemIds = ['another-paper-p1'];
    f.setPaper(invalid);
    const failed = run();
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stderr, /must match an owning problem id/);
  }
);
