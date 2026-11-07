// Synthetic metadata fixtures for standalone exports and the current-root catalog.
import test, { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { problemInfo } from '../problems-to-site.mjs';

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const fixture = () => ({
  paper: {
    id: 'topic-helper-fixture',
    subject: 'physics',
    competition: 'NOF',
    year: 2019,
    roundType: 'theory',
    lang: 'bg',
    status: 'review',
    source: { archiveKey: 'Физика/Fixture/questions.pdf', pages: [1] },
  },
  problems: [
    {
      id: 'topic-helper-fixture-p1',
      number: 1,
      statement: 'Synthetic statement.',
      topics: ['physics/mechanics/newton-laws', 'Кинематика'],
    },
  ],
});

test('standalone imported problemInfo retains committed labels for a legacy topic and current display label', () => {
  const data = fixture(),
    before = JSON.stringify(data);
  const info = problemInfo(data.paper, data.problems[0]);
  assert(info.tags.includes('Сили и динамика'));
  assert(info.tags.includes('Кинематика'));
  assert.equal(info.tags.filter(tag => tag === 'Сили и динамика').length, 1);
  assert.equal(JSON.stringify(data), before);
});

nodeTest(
  'generator current-root topic catalog takes priority over the standalone fallback',
  t => {
    const tmp = path.join(repo, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const root = fs.mkdtempSync(path.join(tmp, 'topic-helper-test-'));
    t.after(() => {
      assert(path.resolve(root).startsWith(path.resolve(tmp) + path.sep));
      fs.rmSync(root, { recursive: true, force: true });
    });
    const write = (relative, data) => {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    };
    const data = fixture(),
      relative = 'content/problems/physics/NOF/2019/topic-helper-fixture.json';
    write(relative, data);
    write('content/extraProblems.json', { EXTRA_PROBLEMS: [] });
    write('content/problem-topics.json', {
      topics: [
        {
          id: 'mechanics/dynamics',
          label: 'Current-root catalog label',
          aliases: ['mechanics/newton-laws'],
        },
      ],
    });
    write('content/problem-publication.json', {
      version: 1,
      papers: {
        [data.paper.id]: {
          kind: 'legacy',
          contentHash: createHash('sha256')
            .update(fs.readFileSync(path.join(root, relative)))
            .digest('hex'),
          sourceCommit: 'a'.repeat(40),
          recordedAt: '2026-11-06T00:00:00Z',
        },
      },
    });
    const result = spawnSync(
      process.execPath,
      [path.join(repo, 'scripts/problems-to-site.mjs'), '--root', root],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const info = JSON.parse(
      fs.readFileSync(path.join(root, 'content/extraProblems.json'), 'utf8')
    ).EXTRA_PROBLEMS[0];
    assert(info.tags.includes('Current-root catalog label'));
    assert(!info.tags.includes('Сили и динамика'));
    assert(!info.tags.includes('Кинематика'));
  }
);
