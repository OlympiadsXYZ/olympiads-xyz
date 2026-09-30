import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256, jsonText, readPapers } from '../lib/problem-data.mjs';
import { validateConsolidations } from '../lib/problem-consolidations.mjs';
import { assertPromotionNotRetired } from '../tx/replacement-links.mjs';
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
test('a fresh receipt cannot replace a retired or withdrawn source decision', () => {
  assert.throws(
    () => assertPromotionNotRetired('duplicate', { supersededBy: 'canonical' }),
    /source-reconciled/
  );
  assert.throws(
    () =>
      assertPromotionNotRetired('duplicate', {}, [
        { paper: { status: 'withdrawn' } },
      ]),
    /withdrawn/
  );
  assert.throws(
    () =>
      assertPromotionNotRetired('duplicate', {}, [
        { paper: { status: 'quarantined' } },
      ]),
    /quarantined/
  );
  assert.throws(
    () =>
      assertPromotionNotRetired('compilation', {
        consolidatedProblems: [{ fromId: 'compilation-p1' }],
      }),
    /duplicate tasks/
  );
  assert.doesNotThrow(() =>
    assertPromotionNotRetired('original', {}, [{ paper: { status: 'review' } }])
  );
});
function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'olympiads-consolidation-')
  );
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('olympiads-consolidation-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (name, d) => {
    const p = path.join(root, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, jsonText(d));
    return p;
  };
  const stored = id => ({
    paper: {
      id,
      subject: 'physics',
      competition: 'NOF',
      year: 2025,
      lang: 'bg',
      roundType: 'theory',
      status: 'review',
      source: { archiveKey: 'Физика/' + id + '.pdf' },
    },
    problems: [
      {
        id: id + '-p1',
        number: 1,
        statement: 'Same source problem.',
        sections: [
          { id: 'part-1', title: 'Part I', statement: 'Original task.' },
        ],
      },
    ],
  });
  const old = stored('duplicate'),
    target = stored('canonical');
  const oldFile = write(
      'content/problems/physics/NOF/2025/duplicate.json',
      old
    ),
    targetFile = write(
      'content/problems/physics/NOF/2025/canonical.json',
      target
    );
  const hash = f => sha256(fs.readFileSync(f)),
    records = () => readPapers(root);
  const ledger = {
    version: 1,
    papers: Object.fromEntries(
      [
        [old.paper.id, oldFile],
        [target.paper.id, targetFile],
      ].map(([id, f]) => [
        id,
        {
          kind: 'legacy',
          contentHash: hash(f),
          sourceCommit: 'a'.repeat(40),
          recordedAt: '2026-09-30',
        },
      ])
    ),
  };
  const config = {
    version: 1,
    papers: [
      {
        paperId: 'duplicate',
        contentHash: hash(oldFile),
        canonicalPaperId: 'canonical',
        canonicalContentHash: hash(targetFile),
        reason: 'Same original source question.',
        sourceAudit: {
          reader: {
            provider: 'fixture',
            model: 'test-reader',
            requestId: 'audit-fixture',
          },
          at: '2026-09-30',
          evidenceSha256: 'b'.repeat(64),
          sourceReferences: [
            {
              archiveKey: 'Физика/duplicate.pdf',
              sha256: 'c'.repeat(64),
              pagesRead: [1],
            },
          ],
        },
        problemMappings: [
          { fromId: 'duplicate-p1', toId: 'canonical-p1', sectionId: 'part-1' },
        ],
      },
    ],
  };
  const save = () => {
    write('content/problem-publication.json', ledger);
    write('content/problem-consolidations.json', config);
    write('content/extraProblems.json', { EXTRA_PROBLEMS: [] });
    write('content/problem-routes.json', {
      'duplicate-p1': '/problems/old-title',
      'canonical-p1': '/problems/original-title',
    });
  };
  return { root, oldFile, targetFile, records, ledger, config, save, write };
}
test('complete exact-source mapping is validated before an explicit retirement', t => {
  const f = fixture(t);
  assert.throws(
    () => validateConsolidations(f.config, f.records(), f.ledger),
    /not explicitly retired/
  );
  const aliases = validateConsolidations(f.config, f.records(), f.ledger, {
    beforeRetirement: true,
  });
  assert.deepEqual(aliases.get('canonical-p1'), [
    { id: 'duplicate-p1', sectionId: 'part-1' },
  ]);
});
test('content changes fail instead of silently retiring a new revision', t => {
  const f = fixture(t);
  f.config.papers[0].contentHash = 'f'.repeat(64);
  assert.throws(
    () =>
      validateConsolidations(f.config, f.records(), f.ledger, {
        beforeRetirement: true,
      }),
    /Stale/
  );
});
test('every former ID and the exact native target section are required', t => {
  const f = fixture(t);
  f.config.papers[0].problemMappings = [];
  assert.throws(
    () =>
      validateConsolidations(f.config, f.records(), f.ledger, {
        beforeRetirement: true,
      }),
    /every former/
  );
  f.config.papers[0].problemMappings = [
    { fromId: 'duplicate-p1', toId: 'canonical-p1', sectionId: 'missing' },
  ];
  assert.throws(
    () =>
      validateConsolidations(f.config, f.records(), f.ledger, {
        beforeRetirement: true,
      }),
    /Missing.*section/
  );
});
test('unapproved replacements and cycles cannot capture former routes', t => {
  const f = fixture(t);
  delete f.ledger.papers.canonical;
  assert.throws(
    () =>
      validateConsolidations(f.config, f.records(), f.ledger, {
        beforeRetirement: true,
      }),
    /not a final eligible/
  );
});
test('a similarity score without source-reading evidence cannot authorize consolidation', t => {
  const f = fixture(t);
  delete f.config.papers[0].sourceAudit;
  assert.throws(
    () =>
      validateConsolidations(f.config, f.records(), f.ledger, {
        beforeRetirement: true,
      }),
    /Missing source/
  );
});
test('explicit retirement retains both exact source files and creates all four stable old route forms', t => {
  const f = fixture(t);
  f.save();
  const originalOld = fs.readFileSync(f.oldFile),
    originalTarget = fs.readFileSync(f.targetFile);
  const apply = spawnSync(
    process.execPath,
    [
      path.join(repo, 'scripts/consolidate-papers.mjs'),
      '--root',
      f.root,
      '--apply',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(apply.status, 0, apply.stderr);
  const generated = spawnSync(
    process.execPath,
    [path.join(repo, 'scripts/problems-to-site.mjs'), '--root', f.root],
    { encoding: 'utf8' }
  );
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(fs.readFileSync(f.oldFile), originalOld);
  assert.deepEqual(fs.readFileSync(f.targetFile), originalTarget);
  const aliases = JSON.parse(
    fs.readFileSync(path.join(f.root, 'content/problem-aliases.json'), 'utf8')
  );
  for (const form of [
    '/problems/old-title',
    '/problems/old-title/solution',
    '/problems/duplicate-p1',
    '/problems/duplicate-p1/solution',
  ])
    assert.equal(aliases[form], '/problems/original-title/solution#part-1');
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(f.root, 'content/problem-generated.json'),
        'utf8'
      )
    ).problemIds,
    ['canonical-p1']
  );
  assert.equal(
    fs.existsSync(
      path.join(f.root, 'solutions/physics/duplicate/duplicate-p1.mdx')
    ),
    false
  );
});
test('partial compilation retirement redirects its duplicate task while preserving unique problems and receipt bytes', t => {
  const f = fixture(t),
    old = JSON.parse(fs.readFileSync(f.oldFile, 'utf8'));
  old.problems.push({
    id: 'duplicate-p2',
    number: 2,
    statement: 'Unique compilation problem.',
  });
  fs.writeFileSync(f.oldFile, jsonText(old));
  f.ledger.papers.duplicate.contentHash = sha256(fs.readFileSync(f.oldFile));
  f.config.papers[0].contentHash = f.ledger.papers.duplicate.contentHash;
  f.config.papers[0].mode = 'problems';
  f.save();
  const apply = spawnSync(
    process.execPath,
    [
      path.join(repo, 'scripts/consolidate-papers.mjs'),
      '--root',
      f.root,
      '--apply',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(apply.status, 0, apply.stderr);
  const generated = spawnSync(
    process.execPath,
    [path.join(repo, 'scripts/problems-to-site.mjs'), '--root', f.root],
    { encoding: 'utf8' }
  );
  assert.equal(generated.status, 0, generated.stderr);
  const ledger = JSON.parse(
    fs.readFileSync(
      path.join(f.root, 'content/problem-publication.json'),
      'utf8'
    )
  );
  assert.equal(ledger.papers.duplicate.kind, 'legacy');
  assert.equal(ledger.papers.duplicate.supersededBy, undefined);
  assert.equal(
    ledger.papers.duplicate.contentHash,
    f.ledger.papers.duplicate.contentHash
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(f.root, 'content/problem-generated.json'),
        'utf8'
      )
    ).problemIds,
    ['canonical-p1', 'duplicate-p2']
  );
  assert.equal(
    fs.existsSync(
      path.join(f.root, 'solutions/physics/duplicate/duplicate-p2.mdx')
    ),
    true
  );
  assert.match(
    fs.readFileSync(
      path.join(f.root, 'solutions/physics/duplicate/duplicate-p2.mdx'),
      'utf8'
    ),
    /Unique compilation problem/
  );
});
