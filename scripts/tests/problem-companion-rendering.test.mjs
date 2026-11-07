import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { problemMdx } from '../problems-to-site.mjs';
import { publicationState, sha256 } from '../lib/problem-data.mjs';
import { readProblemCompanions } from '../lib/problem-companions.mjs';

const codeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const dataRoot = process.env.OLYMPIADS_COMPANION_TEST_REPO || codeRoot;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const ids = ['igeo-2008-mmttest', 'igeo-2008-mmtquestions-doc'];
const records = ids.map(id => {
  const relativePath = `content/problems/geography/iGeo/2008/${id}.json`;
  const file = path.join(dataRoot, relativePath),
    bytes = fs.readFileSync(file);
  return {
    file,
    relativePath,
    contentHash: sha256(bytes),
    data: JSON.parse(bytes),
  };
});
const ledger = read(path.join(dataRoot, 'content/problem-publication.json'));
const routes = read(path.join(dataRoot, 'content/problem-routes.json'));
const config = read(path.join(codeRoot, 'content/problem-companions.json'));
const companions = readProblemCompanions(dataRoot, records, ledger, routes, {
  config,
});
const slides = records[0],
  booklet = records[1],
  whole = booklet.data.problems[0];
const render = (record, problem, overlay = new Map()) =>
  problemMdx(
    record.data.paper,
    problem,
    publicationState(record, ledger),
    record.relativePath,
    { companions: overlay }
  );
const originalBooklet = render(booklet, whole);
const shownBooklet = render(booklet, whole, companions);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const figureBlocks = value => value.match(/<figure\b[\s\S]*?<\/figure>/g) || [];

function originalPart(index) {
  const start = new RegExp(
    `^\\*\\*${escape(whole.parts[index].label)}\\*\\*`,
    'm'
  ).exec(originalBooklet);
  assert.ok(start, `original part ${index + 1}`);
  let end;
  if (index < 29) {
    const next = new RegExp(
      `^\\*\\*${escape(whole.parts[index + 1].label)}\\*\\*`,
      'm'
    ).exec(originalBooklet);
    assert.ok(next);
    end = next.index;
  } else {
    const next = /^## /gm;
    next.lastIndex = start.index + start[0].length;
    end = next.exec(originalBooklet)?.index;
    assert.ok(end > start.index);
  }
  return originalBooklet.slice(start.index, end).trim();
}

nodeTest(
  'all thirty display operations reuse the exact already-rendered booklet text/options',
  () => {
    for (const [index, problem] of slides.data.problems.entries()) {
      const shown = render(slides, problem, companions);
      const tag = `<ProblemSection id="companion-question-${index + 1}">`;
      const start = shown.indexOf(tag),
        close = shown.indexOf('</ProblemSection>', start);
      assert.ok(start >= 0 && close > start);
      const section = shown.slice(start + tag.length, close);
      const body = section
        .replace(/^\s*### Въпрос от брошурата\s*\n/, '')
        .trim();
      assert.equal(
        body,
        originalPart(index),
        `exact existing question ${index + 1}`
      );
      assert.equal(shown.split(tag).length - 1, 1);
      assert.ok(
        shown.includes(routes[whole.id] + `/solution#question-${index + 1}`)
      );
      assert.ok(
        shown.includes(
          'Оригинал на брошурата](https://www.olympiads.xyz/archive/geography/iGeo/2008/MMT/2008MMTQuestions.doc)'
        )
      );
    }
  }
);

nodeTest(
  'all thirty slide pages change only by bound operations, source links and the stale caveat removal',
  () => {
    for (const [index, problem] of slides.data.problems.entries()) {
      const original = render(slides, problem),
        shown = render(slides, problem, companions);
      const expected = original.replace(
        /<Warning title="Бележка към темата">\n[\s\S]*?<\/Warning>\n\n/,
        ''
      );
      const reduced = shown.replace(
        new RegExp(
          `<ProblemSection id="companion-question-${
            index + 1
          }">[\\s\\S]*?<\\/ProblemSection>\\n\\n\\[Брошура с въпросите\\]\\([^\\n]*\\n\\n`
        ),
        ''
      );
      assert.equal(reduced, expected, problem.id);
      assert.deepEqual(
        figureBlocks(shown),
        figureBlocks(original),
        problem.id + ' figure order/content'
      );
      const firstFigure = shown.indexOf('<figure');
      assert.ok(
        shown.indexOf(`<ProblemSection id="companion-question-${index + 1}">`) <
          firstFigure
      );
      assert.ok(original.includes('<Warning title="Бележка към темата">'));
      assert.ok(!shown.includes('<Warning title="Бележка към темата">'));
      assert.equal(shown.match(/^id: (.+)$/m)[1], problem.id);
    }
  }
);

nodeTest(
  'only this booklet receives thirty noncolliding anchors and exact return links',
  () => {
    let reduced = shownBooklet;
    for (let index = 0; index < 30; index++) {
      const open = `<ProblemSection id="question-${index + 1}">\n\n`;
      const link = `[Слайдове към въпрос ${index + 1}](${
        routes[slides.data.problems[index].id]
      }/solution)\n\n</ProblemSection>\n\n`;
      assert.equal(shownBooklet.split(open).length - 1, 1);
      assert.equal(shownBooklet.split(link).length - 1, 1);
      reduced = reduced.replace(open, '').replace(link, '');
    }
    assert.equal(reduced, originalBooklet);
    assert.ok(shownBooklet.includes('<Warning title="Бележка към темата">'));
    assert.equal(shownBooklet.match(/^id: (.+)$/m)[1], whole.id);
  }
);

nodeTest(
  'unmapped iGeo 1996 nine-example owner and empty overlays keep exact prior display',
  () => {
    const relativePath =
      'content/problems/geography/iGeo/1996/igeo-1996-mmtquestions.json';
    const file = path.join(dataRoot, relativePath),
      bytes = fs.readFileSync(file);
    const record = {
      file,
      relativePath,
      data: JSON.parse(bytes),
      contentHash: sha256(bytes),
    };
    assert.equal(
      record.data.problems.reduce((sum, p) => sum + p.parts.length, 0),
      9
    );
    for (const p of record.data.problems) {
      assert.equal(render(record, p, companions), render(record, p));
      assert.ok(!render(record, p, companions).includes('companion-question-'));
    }
    for (const p of slides.data.problems) {
      assert.equal(render(slides, p), render(slides, p, new Map()));
    }
  }
);

nodeTest(
  'rendering preserves both current C/receipt bytes and all existing IDs/routes',
  () => {
    const before = JSON.stringify(records);
    for (const record of records) {
      for (const p of record.data.problems) render(record, p, companions);
    }
    assert.equal(JSON.stringify(records), before);
    assert.equal(companions.size, 31);
    for (const record of records) {
      assert.equal(sha256(fs.readFileSync(record.file)), record.contentHash);
      const receipt = read(
        path.join(
          dataRoot,
          `content/problem-receipts/${record.data.paper.id}.json`
        )
      );
      assert.equal(receipt.contentHash, record.contentHash);
      for (const p of record.data.problems) {
        assert.equal(routes[p.id], `/problems/${p.id}`);
      }
    }
  }
);

for (const refused of ['stale-part', 'changed-old-route']) {
  nodeTest(
    `private generator refuses ${refused} before writing any generated artifact`,
    t => {
      const root = fs.mkdtempSync(
        path.join(codeRoot, 'fixture-companion-render-')
      );
      t.after(() => {
        const resolved = path.resolve(root);
        assert.equal(path.dirname(resolved), path.resolve(codeRoot));
        assert.match(
          path.basename(resolved),
          /^fixture-companion-render-[a-zA-Z0-9]+$/
        );
        fs.rmSync(resolved, { recursive: true, force: true });
      });
      const write = (relative, bytes) => {
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes, { flag: 'wx' });
      };
      const scopedLedger = { version: 1, papers: {} };
      for (const record of records) {
        write(record.relativePath, fs.readFileSync(record.file));
        const receipt = `content/problem-receipts/${record.data.paper.id}.json`;
        write(receipt, fs.readFileSync(path.join(dataRoot, receipt)));
        scopedLedger.papers[record.data.paper.id] =
          ledger.papers[record.data.paper.id];
      }
      const selectedRoutes = structuredClone(config.groups[0].frozenRoutes);
      const selectedConfig = structuredClone(config);
      if (refused === 'stale-part') {
        selectedConfig.groups[0].mappings[0].bookletStatementSha256 =
          '0'.repeat(64);
      } else {
        selectedRoutes['igeo-2008-mmttest-p1'] = '/problems/replaced-old-route';
      }
      for (const [relative, value] of [
        ['content/problem-routes.json', selectedRoutes],
        ['content/problem-companions.json', selectedConfig],
        ['content/problem-publication.json', scopedLedger],
      ]) {
        write(relative, JSON.stringify(value) + '\n');
      }
      const result = spawnSync(
        process.execPath,
        [path.join(codeRoot, 'scripts/problems-to-site.mjs'), '--root', root],
        { encoding: 'utf8' }
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /problem-companions:/);
      assert.ok(!fs.existsSync(path.join(root, 'solutions')));
      assert.ok(
        !fs.existsSync(path.join(root, 'content/problem-generated.json'))
      );
      assert.ok(!fs.existsSync(path.join(root, 'content/extraProblems.json')));
      for (const record of records) {
        assert.equal(
          sha256(fs.readFileSync(path.join(root, record.relativePath))),
          record.contentHash
        );
      }
    }
  );
}
