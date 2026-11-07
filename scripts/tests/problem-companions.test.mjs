import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readProblemCompanions } from '../lib/problem-companions.mjs';

// Every fixture has exactly the authorized30 slide tasks, one30-part booklet,
// and36 synthetic figures. No original source document is opened by these tests.
const candidate = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const template = JSON.parse(
  fs.readFileSync(
    path.join(candidate, 'content/problem-companions.json'),
    'utf8'
  )
);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const compact = value => JSON.stringify(value);
const objectHash = value => hash(compact(value));
const clone = value => structuredClone(value);
const caveats = {
  booklet:
    'The photographs, maps, films and slides the questions refer to were shown as a PowerPoint presentation during the test and are not part of the question booklet in the archive.',
  slides:
    'Слайдовете съдържат само снимки и карти без текста на въпросите, който е в отделната брошура с въпроси (igeo-2008-mmtquestions-doc).',
};
function frozen(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(candidate, 'fixture-companions-'));
  t.after(() => {
    const resolved = path.resolve(root),
      parent = path.resolve(candidate);
    assert.equal(path.dirname(resolved), parent);
    assert.match(path.basename(resolved), /^fixture-companions-[a-zA-Z0-9]+$/);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const config = clone(template),
    group = config.groups[0],
    data = {};
  for (const role of ['booklet', 'slides']) {
    const descriptor = group[role],
      source = descriptor.source;
    const sourceHashes =
      role === 'booklet'
        ? {
            problems: group.lineage.bookletQuestions.historicalCanonicalStamp,
            solutions: group.lineage.answers.bookletHistoricalCanonicalStamp,
          }
        : {
            problems: group.lineage.slideQuestions.historicalCanonicalStamp,
            solutions: group.lineage.answers.slidesHistoricalCanonicalStamp,
          };
    data[role] = {
      paper: {
        id: descriptor.paperId,
        subject: source.subject,
        competition: source.competition,
        year: source.year,
        lang: source.lang,
        round: source.round,
        roundType: source.roundType,
        source: { archiveKey: source.archiveKey },
        solutionSource: { archiveKey: source.solutionArchiveKey },
        status: 'review',
        caveat: caveats[role],
        transcription: { sourceSha256: sourceHashes },
      },
      problems: [],
    };
  }
  const parts = Array.from({ length: 30 }, (_, index) => ({
    label: index === 23 ? '24' : `${index + 1}.`,
    statement:
      index === 0
        ? 'Choose one.\n\n| Option | Value |\n| --- | --- |\n| A | Example |\n\n[Reference](https://example.invalid/) and [Booklet](/problems/igeo-2008-mmtquestions-doc-p1).'
        : `Synthetic question ${index + 1}.\n\nA. Example\nB. Another example`,
    points: null,
    answer: { kind: 'single-choice', correct: ['A'] },
  }));
  data.booklet.problems.push({
    id: group.booklet.problemIds[0],
    number: 1,
    title: 'Booklet',
    statement:
      'Synthetic instructions.\n\n| Item | Rule |\n| --- | --- |\n| Answer | Choose one |',
    figures: [],
    parts,
  });
  data.slides.problems = group.mappings.map((mapping, index) => ({
    id: mapping.slideProblemId,
    number: index + 1,
    title: mapping.slideLabel,
    statement: mapping.slideLabel,
    figures: mapping.figures.map(figure => ({
      id: figure.id,
      url: `https://example.invalid/${figure.id}.png`,
      width: 10,
      height: 10,
    })),
    parts: [],
    answer: clone(parts[index].answer),
  }));
  const f = {
    root,
    config,
    group,
    data,
    records: [],
    ledger: { version: 1, papers: {} },
    routes: clone(group.frozenRoutes),
  };
  f.refresh = () => {
    f.records = [];
    for (const role of ['booklet', 'slides']) {
      const descriptor = group[role],
        paperData = data[role],
        canonical = compact(paperData) + '\n';
      const canonicalFile = path.join(root, descriptor.canonical.file);
      fs.mkdirSync(path.dirname(canonicalFile), { recursive: true });
      fs.writeFileSync(canonicalFile, canonical);
      descriptor.canonical.sha256 = hash(canonical);
      descriptor.canonical.bytes = Buffer.byteLength(canonical);
      const receipt = {
        paperId: paperData.paper.id,
        contentHash: descriptor.canonical.sha256,
        verdict: 'pass',
        sourceHashes: clone(paperData.paper.transcription.sourceSha256),
        reviewer: {
          provider: 'mechanical',
          model: 'fixture',
          requestId: 'fixture-only',
        },
        checkedAt: '2026-10-28',
        defects: [],
        blockers: [],
      };
      const receiptText = compact(receipt) + '\n',
        receiptFile = path.join(root, descriptor.receipt.file);
      fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
      fs.writeFileSync(receiptFile, receiptText);
      descriptor.receipt.sha256 = hash(receiptText);
      descriptor.receipt.bytes = Buffer.byteLength(receiptText);
      f.records.push({
        file: canonicalFile,
        relativePath: descriptor.canonical.file,
        contentHash: descriptor.canonical.sha256,
        data: paperData,
      });
      f.ledger.papers[paperData.paper.id] = {
        kind: 'reviewed',
        contentHash: descriptor.canonical.sha256,
        recordedAt: '2026-10-28',
        review: clone(receipt),
      };
    }
    group.bookletProblemSha256 = objectHash(data.booklet.problems[0]);
    group.bookletStatementSha256 = hash(data.booklet.problems[0].statement);
    group.mappings.forEach((mapping, index) => {
      const slide = data.slides.problems[index],
        part = data.booklet.problems[0].parts[index];
      mapping.slideProblemSha256 = objectHash(slide);
      mapping.slideStatementSha256 = hash(slide.statement);
      mapping.bookletPartSha256 = objectHash(part);
      mapping.bookletStatementSha256 = hash(part.statement);
      mapping.answerSha256 = objectHash(part.answer);
      mapping.figures = slide.figures.map(figure => ({
        id: figure.id,
        sha256: objectHash(figure),
      }));
    });
  };
  f.run = () =>
    readProblemCompanions(root, f.records, f.ledger, f.routes, {
      config: f.config,
    });
  f.refresh();
  return f;
}

nodeTest(
  'all31 projections preserve routes, exact strings, Markdown tables and originals',
  t => {
    const f = fixture(t),
      before = compact({
        config: f.config,
        records: f.records,
        ledger: f.ledger,
        routes: f.routes,
      });
    [f.config, f.records, f.ledger, f.routes].forEach(frozen);
    const projections = f.run();
    assert.equal(projections.size, 31);
    const bookletId = f.group.booklet.problemIds[0],
      booklet = projections.get(bookletId);
    assert.equal(booklet.role, 'booklet');
    assert.equal(booklet.partAnchors.length, 30);
    for (let index = 0; index < 30; index++) {
      const id = f.group.slides.problemIds[index],
        slide = projections.get(id),
        part = f.data.booklet.problems[0].parts[index];
      assert.deepEqual(
        Object.keys(slide).sort(),
        [
          'role',
          'groupId',
          'partIndex',
          'partLabel',
          'questionStatement',
          'bookletProblemId',
          'bookletSolutionUrl',
          'bookletArchiveKey',
          'subject',
          'suppressCaveat',
          'slideStatementHash',
        ].sort()
      );
      assert.equal(slide.questionStatement, part.statement);
      assert.equal(slide.partLabel, part.label);
      assert.equal(slide.partIndex, index);
      assert.equal(
        slide.bookletSolutionUrl,
        f.routes[bookletId] + `/solution#question-${index + 1}`
      );
      assert.equal(
        slide.slideStatementHash,
        hash(f.data.slides.problems[index].statement)
      );
      assert.equal(slide.suppressCaveat, true);
      assert.deepEqual(booklet.partAnchors[index], {
        index,
        id: `question-${index + 1}`,
        label: part.label,
        slideSolutionUrl: f.routes[id] + '/solution',
      });
      assert.ok(Object.isFrozen(slide));
    }
    assert.match(
      projections.get(f.group.slides.problemIds[0]).questionStatement,
      /\| Option \| Value \|/
    );
    assert.equal(
      compact({
        config: f.config,
        records: f.records,
        ledger: f.ledger,
        routes: f.routes,
      }),
      before
    );
  }
);

nodeTest(
  'missing config is empty; malformed, null and wrong-shape configs throw',
  t => {
    const f = fixture(t);
    assert.equal(readProblemCompanions(f.root, [], {}, {}).size, 0);
    fs.mkdirSync(path.join(f.root, 'content'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'content/problem-companions.json'), '{');
    assert.throws(() => readProblemCompanions(f.root, [], {}, {}));
    for (const config of [
      null,
      {},
      { version: 2, groups: [] },
      { version: 1, groups: [] },
      { version: 1, groups: [f.group, f.group] },
      { ...f.config, sourceChoice: 'another-owner' },
    ]) {
      assert.throws(() =>
        readProblemCompanions(f.root, f.records, f.ledger, f.routes, { config })
      );
    }
  }
);

const configCases = [
  [
    'wrong owner',
    f => {
      f.group.slides.paperId = 'another-owner';
    },
  ],
  [
    'wrong source key',
    f => {
      f.group.booklet.source.archiveKey = 'another-owner.doc';
    },
  ],
  [
    'changed source lineage',
    f => {
      f.group.lineage.bookletQuestions.currentConvertedPdfSha256 =
        f.group.lineage.bookletQuestions.historicalCanonicalStamp;
    },
  ],
  [
    'missing source audit',
    f => {
      delete f.group.sourceAudit;
    },
  ],
  [
    'changed proof hash',
    f => {
      f.group.sourceAudit.evidence.sha256 = '0'.repeat(64);
    },
  ],
  [
    'invented reading credit',
    f => {
      f.group.sourceAudit.independentScientificReview = true;
    },
  ],
  [
    'missing caveat guard',
    f => {
      delete f.group.slides.caveatSha256;
    },
  ],
  [
    'changed caveat guard',
    f => {
      f.group.slides.caveatSha256 = '0'.repeat(64);
    },
  ],
  [
    'wrong count',
    f => {
      f.group.mappings.pop();
    },
  ],
  [
    'wrong expected IDs',
    f => {
      f.group.expectedProblemIds.pop();
    },
  ],
  [
    'wrong figure count',
    f => {
      f.group.expectedFigureCount = 35;
    },
  ],
  [
    'duplicate mapping',
    f => {
      f.group.mappings[1] = clone(f.group.mappings[0]);
    },
  ],
  [
    'wrong index',
    f => {
      f.group.mappings[0].index = 1;
    },
  ],
  [
    'wrong question number',
    f => {
      f.group.mappings[0].questionNumber = 2;
    },
  ],
  [
    'wrong exact part label',
    f => {
      f.group.mappings[23].bookletPartLabel = '24.';
    },
  ],
  [
    'out-of-scope pointer',
    f => {
      f.group.mappings[0].bookletPartPointer = '/problems/1/parts/0';
    },
  ],
  [
    'unsafe anchor',
    f => {
      f.group.mappings[0].anchor = 'question-1" onClick="x';
    },
  ],
  [
    'supplied question payload',
    f => {
      f.group.mappings[0].questionStatement = '<script />';
    },
  ],
  [
    'stale part hash',
    f => {
      f.group.mappings[0].bookletPartSha256 = '0'.repeat(64);
    },
  ],
  [
    'stale string hash',
    f => {
      f.group.mappings[0].bookletStatementSha256 = '0'.repeat(64);
    },
  ],
  [
    'stale figure hash',
    f => {
      f.group.mappings[0].figures[0].sha256 = '0'.repeat(64);
    },
  ],
  [
    'unsafe canonical path',
    f => {
      f.group.booklet.canonical.file = '../foreign.json';
    },
  ],
  [
    'changed old route',
    f => {
      f.routes[f.group.slides.problemIds[0]] = '/problems/changed';
    },
  ],
  [
    'unsafe frozen route',
    f => {
      const id = f.group.slides.problemIds[0];
      f.group.frozenRoutes[id] = f.routes[id] = 'javascript:alert(1)';
    },
  ],
  [
    'missing frozen route',
    f => {
      delete f.routes[f.group.booklet.problemIds[0]];
    },
  ],
];
for (const [name, change] of configCases) {
  nodeTest('rejects ' + name, t => {
    const f = fixture(t);
    change(f);
    assert.throws(f.run, /problem-companions:/);
  });
}

const canonicalCases = [
  [
    'wrong canonical number',
    f => {
      f.data.slides.problems[0].number = 2;
    },
  ],
  [
    'wrong canonical label',
    f => {
      f.data.booklet.problems[0].parts[23].label = '24.';
    },
  ],
  [
    'unequal answer',
    f => {
      f.data.slides.problems[0].answer.correct = ['B'];
    },
  ],
  [
    'changed figure ID',
    f => {
      f.data.slides.problems[0].figures[0].id = 'foreign-fig1';
    },
  ],
  [
    'duplicate figure ID',
    f => {
      f.data.slides.problems[0].figures[1].id = 'p1-fig1';
    },
  ],
  [
    'changed figure count',
    f => {
      f.data.slides.problems[0].figures.pop();
    },
  ],
  [
    'wrong canonical source key',
    f => {
      f.data.booklet.paper.source.archiveKey = 'foreign.doc';
    },
  ],
  [
    'wrong subject',
    f => {
      f.data.booklet.paper.subject = 'physics';
    },
  ],
  [
    'wrong competition',
    f => {
      f.data.slides.paper.competition = 'Other';
    },
  ],
  [
    'wrong year',
    f => {
      f.data.slides.paper.year = 2009;
    },
  ],
  [
    'wrong language',
    f => {
      f.data.slides.paper.lang = 'bg';
    },
  ],
  [
    'wrong round',
    f => {
      f.data.slides.paper.round = 'final';
    },
  ],
  [
    'changed caveat',
    f => {
      f.data.slides.paper.caveat += ' changed';
    },
  ],
  [
    'missing caveat',
    f => {
      delete f.data.slides.paper.caveat;
    },
  ],
  [
    'withdrawn owner',
    f => {
      f.data.slides.paper.status = 'withdrawn';
    },
  ],
  [
    'native booklet anchor collision',
    f => {
      f.data.booklet.problems[0].solution = {
        sections: [{ id: 'question-1', statement: 'Existing section' }],
      };
    },
  ],
  [
    'native slide anchor collision',
    f => {
      f.data.slides.problems[0].solution = {
        sections: [
          { id: 'companion-question-1', statement: 'Existing section' },
        ],
      };
    },
  ],
];
for (const [name, change] of canonicalCases) {
  nodeTest('rejects ' + name + ' even with refreshed byte pins', t => {
    const f = fixture(t);
    change(f);
    f.refresh();
    assert.throws(f.run, /problem-companions:/);
  });
}

for (const text of [
  '<img src=x onerror="x" />',
  '<Component />',
  '{process.exit()}',
  'import X from "x"',
  '[x](javascript:alert(1))',
  '[x](data:text/html,test)',
  '[x](java&#x73;cript:alert(1))',
  '[x](java%73cript:alert(1))',
  '[x](java\nscript:alert(1))',
  '[x][ref]\n\n[ref]: java&#115;cript:alert(1)',
  '![map](#p1-fig1)',
  '[FIGURE:missing]',
  '[фигура:foreign]',
  'figure:p1-fig1',
]) {
  nodeTest(
    'rejects unsafe reused canonical text ' + JSON.stringify(text),
    t => {
      const f = fixture(t);
      f.data.booklet.problems[0].parts[0].statement = text;
      f.refresh();
      assert.throws(
        f.run,
        /unsafe canonical|unsafe Markdown destination|unexpected figure placeholder/
      );
    }
  );
}

nodeTest('rejects stale canonical and receipt bytes independently', t => {
  for (const role of ['booklet', 'slides']) {
    for (const kind of ['canonical', 'receipt']) {
      const f = fixture(t);
      fs.appendFileSync(path.join(f.root, f.group[role][kind].file), ' ');
      assert.throws(f.run, /stale .* bytes/);
    }
  }
});
nodeTest(
  'rejects altered in-memory records, wrong paths and duplicate ownership',
  t => {
    const changes = [
      f => {
        f.records[0].data = clone(f.records[0].data);
        f.records[0].data.problems[0].statement += ' changed';
      },
      f => {
        f.records[0].contentHash = '0'.repeat(64);
      },
      f => {
        f.records[0].file = path.join(f.root, 'foreign.json');
      },
      f => {
        f.records.push(f.records[0]);
      },
      f => {
        f.records.push({
          data: {
            paper: { id: 'foreign' },
            problems: [{ id: f.group.slides.problemIds[0] }],
          },
        });
      },
    ];
    for (const change of changes) {
      const f = fixture(t);
      change(f);
      assert.throws(f.run, /problem-companions:/);
    }
  }
);
nodeTest(
  'rejects ineligible, retired or receipt-divergent publication state',
  t => {
    for (const change of [
      entry => {
        entry.kind = 'legacy';
      },
      entry => {
        entry.supersededBy = 'foreign';
      },
      entry => {
        entry.contentHash = '0'.repeat(64);
      },
      entry => {
        entry.review.verdict = 'fail';
      },
      entry => {
        entry.review.summary = 'different receipt';
      },
    ]) {
      const f = fixture(t);
      change(f.ledger.papers[f.group.slides.paperId]);
      assert.throws(f.run, /publicationState/);
    }
  }
);

nodeTest(
  'present default config uses the same strict loader without an audit-file read',
  t => {
    const f = fixture(t);
    fs.writeFileSync(
      path.join(f.root, 'content/problem-companions.json'),
      compact(f.config)
    );
    assert.equal(
      fs.existsSync(path.join(f.root, f.group.sourceAudit.evidence.file)),
      false
    );
    assert.equal(
      readProblemCompanions(f.root, f.records, f.ledger, f.routes).size,
      31
    );
  }
);
