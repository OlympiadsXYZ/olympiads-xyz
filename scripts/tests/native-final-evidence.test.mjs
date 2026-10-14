import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeNativeImageCrop } from '../tx/native-image-crop.mjs';
import { IMAGE_RENDERER_FINGERPRINT } from '../tx/image-source.mjs';
import {
  R2_PUBLIC,
  sha256File,
  stripTx,
  buildFinalPaper,
  provenanceFor,
} from '../tx/lib.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const nativePointer = '/problems/0/figures/0';
const writeJson = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
const python = args => {
  const actual = spawnSync('python3', args, { encoding: 'utf8' });
  assert.equal(actual.status, 0, actual.stderr + actual.stdout);
  return actual.stdout;
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-final-evidence-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('native-final-evidence-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const paperId = 'zz-2099-native';
  const directory = path.join(root, paperId);
  fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
  const source = path.join(directory, 'src/problems.png');
  const pdf = path.join(directory, 'src/problems.pdf');
  // Synthetic RGBA pixels, using the same real conversion path as native-image-crop.test.mjs.
  python([
    '-c',
    'from PIL import Image\nimport sys\nim=Image.new("RGBA",(321,239));im.putdata([((x*19)%256,(x*31)%256,(x*43)%256,0 if x%3==0 else 255) for x in range(321*239)]);im.save(sys.argv[1])',
    source,
  ]);
  const converted = JSON.parse(
    python([path.join(repo, 'scripts/tx/image-to-pdf.py'), source, pdf])
  );
  Object.assign(converted, {
    sourceFile: 'src/problems.png',
    rendererFingerprint: IMAGE_RENDERER_FINGERPRINT,
  });
  const manifest = {
    paperId,
    documents: {
      problems: {
        key: 'archive/photo.png',
        file: 'src/problems.pdf',
        sha256: sha256File(pdf),
        pages: 1,
        pageSizes: [
          {
            widthPt: (converted.pages[0].widthPx * 72) / 150,
            heightPt: (converted.pages[0].heightPx * 72) / 150,
          },
        ],
        converted,
      },
    },
  };
  const manifestFile = path.join(directory, 'manifest.json');
  writeJson(manifestFile, manifest);
  const cropFile = path.join(directory, 'crop.webp');
  const proposal = {
    id: 'photo',
    alt: 'Synthetic native crop fixture.',
    tx: {
      extraction: 'native-image-crop',
      document: 'problems',
      page: 1,
      bbox: [101, 203, 899, 901],
      rotation: 90,
    },
  };
  const info = writeNativeImageCrop(proposal, manifest, directory, cropFile);
  const remoteKey = 'problems/' + paperId + '/photo.webp';
  const figure = {
    ...proposal,
    width: info.px[0],
    height: info.px[1],
    url: R2_PUBLIC + '/' + remoteKey,
    source: {
      page: 1,
      pdfRect: info.pdfRect,
      dpi: info.dpi,
      rotation: 90,
      nativeImageCrop: info.nativeImageCrop,
    },
    tx: {
      ...proposal.tx,
      file: 'crop.webp',
      sha256: info.sha256,
      remoteKey,
      public200: true,
      dryRun: false,
    },
  };
  const candidate = {
    paper: {
      id: paperId,
      subject: 'physics',
      competition: 'Test',
      year: 2099,
      roundType: 'theory',
      lang: 'en',
      source: { archiveKey: manifest.documents.problems.key, pages: [1] },
      status: 'draft',
    },
    problems: [
      {
        id: paperId + '-p1',
        number: 1,
        statement: 'Use the supplied photograph.',
        figures: [figure],
      },
    ],
    tx: {
      reader: {
        provider: 'fixture',
        model: 'synthetic-native',
        requestId: 'native-final-regression',
        promptVersion: 'regression',
        at: '2099-01-01',
      },
    },
  };
  const final = buildFinalPaper(
    candidate,
    provenanceFor(candidate, {
      reviewer: {
        provider: 'mechanical',
        model: 'regression',
        requestId: 'native-final-regression',
      },
      promptVersion: 'regression',
      checkedAt: '2099-01-01T00:00:00.000Z',
      sourceHashes: { problems: manifest.documents.problems.sha256 },
      independent: false,
      adjudicator: null,
      mode: 'single-pass',
      renderDpi: 160,
    })
  ).data;
  assert.deepEqual(stripTx(figure), final.problems[0].figures[0]);
  assert.equal(Object.hasOwn(final.problems[0].figures[0], 'tx'), false);
  const candidateFile = path.join(directory, 'candidate.json');
  const finalFile = path.join(directory, 'final.json');
  return {
    root,
    directory,
    paperId,
    cropFile,
    candidate,
    final,
    candidateFile,
    finalFile,
    manifestFile,
  };
}

function validate(f, { companion = true } = {}) {
  writeJson(f.candidateFile, f.candidate);
  writeJson(f.finalFile, f.final);
  const args = [
    path.join(repo, 'scripts/tx/validate.mjs'),
    f.finalFile,
    '--paper-id',
    f.paperId,
    '--manifest',
    f.manifestFile,
    '--mode',
    'final',
  ];
  if (companion) args.push('--candidate-evidence', f.candidateFile);
  const actual = spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, OLYMPIADS_TX_DIR: f.root },
  });
  assert.equal(actual.error, undefined);
  let report;
  try {
    report = JSON.parse(actual.stdout);
  } catch {
    assert.fail(actual.stdout + actual.stderr);
  }
  return { actual, report };
}

function rejected(result, message) {
  assert.equal(
    result.actual.status,
    1,
    result.actual.stdout + result.actual.stderr
  );
  assert.equal(result.report.ok, false);
  assert.equal(result.report.finalNativeEvidenceVerified, false);
  assert(
    result.report.errors.some(
      issue => issue.path === nativePointer && message.test(issue.message)
    ),
    JSON.stringify(result.report.errors)
  );
}

nodeTest(
  'final native figure validates against its exact working companion',
  t => {
    const f = fixture(t);
    const { actual, report } = validate(f);
    assert.equal(actual.status, 0, actual.stdout + actual.stderr);
    assert.equal(report.ok, true);
    assert.equal(report.mode, 'final');
    assert.deepEqual(report.errors, []);
    assert.equal(report.finalNativeEvidenceVerified, true);
    assert.deepEqual(report.nativeFinalEvidence.companion, {
      file: f.candidateFile,
      sha256: sha256File(f.candidateFile),
      bytes: fs.statSync(f.candidateFile).size,
    });
    assert.deepEqual(report.nativeFinalEvidence.nativePointers, [
      nativePointer,
    ]);
    assert.equal(report.nativeFinalEvidence.exactStrippedNativeFigures, true);
    assert.equal(report.nativeFinalEvidence.unchangedFinalSchema, true);
    assert.equal(report.nativeFinalEvidence.unchangedNativeHelper, true);
    assert.equal(report.nativeFinalEvidence.bindings.length, 1);
    assert.equal(
      report.nativeFinalEvidence.bindings[0].unchangedNativeHelperVerified,
      true
    );
    assert.equal(
      report.nativeFinalEvidence.bindings[0].sha256,
      sha256File(f.cropFile)
    );
  }
);

nodeTest('final native figure without a working companion fails closed', t => {
  const f = fixture(t);
  const { actual, report } = validate(f, { companion: false });
  assert.equal(actual.status, 1, actual.stdout + actual.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.finalNativeEvidenceVerified, false);
  assert(
    report.errors.some(
      issue =>
        issue.path === '/candidate-evidence' &&
        /requires --candidate-evidence/.test(issue.message)
    )
  );
});

nodeTest(
  'matching companion and final with bad native geometry fail the real native helper',
  t => {
    const f = fixture(t);
    f.candidate.problems[0].figures[0].source.pdfRect[2] += 1;
    f.final.problems[0].figures[0].source.pdfRect[2] += 1;
    assert.deepEqual(
      stripTx(f.candidate.problems[0].figures[0]),
      f.final.problems[0].figures[0]
    );
    rejected(
      validate(f),
      /dimensions, bytes, URL or source provenance mismatch/
    );
  }
);

nodeTest(
  'changed retained native payload bytes fail the real native helper',
  t => {
    const f = fixture(t);
    const before = sha256File(f.cropFile);
    fs.appendFileSync(f.cropFile, 'changed');
    assert.notEqual(sha256File(f.cropFile), before);
    rejected(validate(f), /bytes|pixel extraction\/verification failed/);
  }
);

nodeTest(
  'final native figure drift fails full stripped-companion equality',
  t => {
    const f = fixture(t);
    f.final.problems[0].figures[0].alt += ' changed';
    rejected(validate(f), /stripped native figure differs from the final/);
  }
);
