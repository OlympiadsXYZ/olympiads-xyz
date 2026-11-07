import fs from 'node:fs';
import path from 'node:path';
import { publicationState, sha256 } from './problem-data.mjs';

// This is a display projection of two retained owners, not a source selector or
// a new transcription. The reviewed manifest pins bytes; these constants limit
// the mechanism to the one explicitly authorized same-language resource pair.
const BOOKLET = 'igeo-2008-mmtquestions-doc';
const SLIDES = 'igeo-2008-mmttest';
const GROUP = 'igeo-2008-mmt-companions';
const BOOKLET_ID = BOOKLET + '-p1';
const SLIDE_IDS = Array.from({ length: 30 }, (_, i) => `${SLIDES}-p${i + 1}`);
const IDS = [...SLIDE_IDS, BOOKLET_ID];
const ARCHIVE = 'География/iGeo/2008/MMT/';
const HASH = /^[a-f0-9]{64}$/;
const CAVEATS = {
  [BOOKLET]: 'a90a87595ec65cc4eae79102527ab5349e93c982e239211b5d23f6048c8dc377',
  [SLIDES]: 'f71738724f05e0116eec94a06a695869d3bf869bee444e1e3668ce1361fe5df0',
};
const AUDIT = {
  file: 'work/codex-transcription/production/sol61-stabilization-20261028/source-recovery-geo-burgas/igeo2008-question-booklet/H-thirty-existing-task-companion-presentation-proposal-r2.json',
  sha256: 'a0b3bd1e00c8bc13c7a8b724667678055fadb75ee7bc2b867bee18f99fcdd083',
  bytes: 108553,
};
const LINEAGE = {
  bookletQuestions: {
    archiveKey: ARCHIVE + '2008MMTQuestions.doc',
    nativeDocSha256:
      '273ddf9d7077a423056fce17b868552ac34211d0d12287b718b3b850a6cabbf0',
    nativeDocBytes: 115712,
    currentConvertedPdfSha256:
      'a07560eca4727ad0a4f3c8fb8fd052314fbb73111c50410f859714b071cbdd2a',
    currentConvertedPdfBytes: 169408,
    historicalCanonicalStamp:
      '4c9a3bf3cfb0aa02b6277af9fdacdb98a7e1db10e88cbd901e464b21443b0152',
  },
  slideQuestions: {
    archiveKey: ARCHIVE + '2008MMTTest.pdf',
    nativePdfSha256:
      '95e7704c5812e818f03d12066cede74daf273d79b4ca9001761bbd16bd1e22a6',
    nativePdfBytes: 3522633,
    historicalCanonicalStamp:
      '95e7704c5812e818f03d12066cede74daf273d79b4ca9001761bbd16bd1e22a6',
  },
  answers: {
    archiveKey: ARCHIVE + '2008MMTAnswers.doc',
    sharedNativeDocSha256:
      'ef08a8bc7d8dd749f28ccabd976af9a376cad764c0a3cdd78ae787c1ab83752c',
    sharedNativeDocBytes: 47616,
    bookletCurrentConvertedPdfSha256:
      'ae7a1266d9585c39253a82fba35fb12a6780773b5b1f7f7e1063963c66cb0716',
    slidesCurrentConvertedPdfSha256:
      '6a42ce93b3f7f4175bf0030fdafc05505592269a1133e826be6b402d2666e53a',
    currentConvertedPdfBytes: 16272,
    bookletHistoricalCanonicalStamp:
      'a65601baa52db11fa4a24494f960c79877b4ff32118c6b22ad5b2ce5860dfdba',
    slidesHistoricalCanonicalStamp:
      '75b842908d358160a26e1c6dd52fdebb4b90a09b0c08862ae6455439c3473f49',
  },
};

const object = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const compact = value => JSON.stringify(value);
const objectHash = value => sha256(compact(value));
function fail(message) {
  throw new Error('problem-companions: ' + message);
}
function fields(value, names, label) {
  if (
    !object(value) ||
    Object.keys(value).length !== names.length ||
    names.some(name => !Object.hasOwn(value, name))
  ) {
    fail('invalid ' + label + ' fields');
  }
}
function digest(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) {
    fail('invalid ' + label + ' SHA256');
  }
}
function exact(value, expected, label) {
  // Compare JSON objects structurally, without relying on manifest key order.
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length) {
      fail('invalid ' + label);
    }
    expected.forEach((item, i) => exact(value[i], item, label));
  } else if (object(expected)) {
    fields(value, Object.keys(expected), label);
    for (const key of Object.keys(expected)) {
      exact(value[key], expected[key], label);
    }
  } else if (value !== expected) fail('invalid ' + label);
}
function safeText(text, label) {
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    /[\0-\b\v\f\016-\037\x7f<>{}]/.test(text) ||
    /^\s*(?:import|export)\b/m.test(text) ||
    /(?:javascript|vbscript|data)\s*:/i.test(text)
  ) {
    fail('unsafe canonical ' + label);
  }
  // An explicit allow-list also rejects entity/percent/whitespace-obfuscated
  // script schemes before Markdown decodes a destination or reference link.
  if (
    /\]\s*\(\s*(?!https?:\/\/|\/problems\/)[^\s)]/i.test(text) ||
    /^\s{0,3}\[[^\]\n]+\]:\s*(?!https?:\/\/|\/problems\/)\S/im.test(text)
  ) {
    fail('unsafe Markdown destination in ' + label);
  }
  // No booklet figure is owned by these passages. Reject all image/figure
  // placeholders before sourceText can resolve them against a different owner.
  if (
    /!\s*\[|\[\[?\s*(?:figure|fig|фигура)(?=\s|:|\])|\b(?:figure|fig)\s*:|\bp\d+(?:-sol)?-fig\d+\b/iu.test(
      text
    )
  ) {
    fail('unexpected figure placeholder in ' + label);
  }
}
function hasNativeAnchor(value, anchor) {
  if (!value || typeof value !== 'object') return false;
  if (
    !Array.isArray(value) &&
    ['id', 'sectionId', 'anchor'].some(key => value[key] === anchor)
  ) {
    return true;
  }
  return Object.values(value).some(child => hasNativeAnchor(child, anchor));
}
function relativeFile(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    /[\\\0-\037]/.test(value) ||
    value.startsWith('/') ||
    /^[a-z]:/i.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    fail('unsafe frozen file path');
  }
  return value;
}
function checkedFile(root, descriptor, expected, label) {
  fields(descriptor, ['file', 'sha256', 'bytes'], label);
  relativeFile(descriptor.file);
  digest(descriptor.sha256, label);
  if (
    descriptor.file !== expected ||
    !Number.isSafeInteger(descriptor.bytes) ||
    descriptor.bytes <= 0
  ) {
    fail('wrong ' + label + ' path or size');
  }
  const rootPath = fs.realpathSync(root),
    file = path.resolve(rootPath, descriptor.file);
  const real = fs.realpathSync(file),
    relative = path.relative(rootPath, real);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    fail('frozen file escapes root');
  }
  const bytes = fs.readFileSync(real);
  if (
    bytes.length !== descriptor.bytes ||
    sha256(bytes) !== descriptor.sha256
  ) {
    fail('stale ' + label + ' bytes');
  }
  return { file, data: JSON.parse(bytes.toString('utf8')) };
}
function owner(root, descriptor, role, records, ledger) {
  fields(
    descriptor,
    [
      'paperId',
      'canonical',
      'receipt',
      'source',
      'caveatSha256',
      'problemIds',
      'figureCount',
    ],
    role
  );
  const id = role === 'booklet' ? BOOKLET : SLIDES;
  exact(descriptor.paperId, id, role + ' paper owner');
  exact(
    descriptor.source,
    {
      archiveKey:
        ARCHIVE +
        (role === 'booklet' ? '2008MMTQuestions.doc' : '2008MMTTest.pdf'),
      solutionArchiveKey: ARCHIVE + '2008MMTAnswers.doc',
      subject: 'geography',
      competition: 'iGeo',
      year: 2008,
      lang: 'en',
      round: null,
      roundType: 'test',
    },
    role + ' source identity'
  );
  exact(descriptor.caveatSha256, CAVEATS[id], role + ' caveat guard');
  exact(
    descriptor.problemIds,
    role === 'booklet' ? [BOOKLET_ID] : SLIDE_IDS,
    role + ' IDs'
  );
  exact(
    descriptor.figureCount,
    role === 'booklet' ? 0 : 36,
    role + ' figure count'
  );
  const canonical = checkedFile(
    root,
    descriptor.canonical,
    `content/problems/geography/iGeo/2008/${id}.json`,
    role + ' canonical'
  );
  const receipt = checkedFile(
    root,
    descriptor.receipt,
    `content/problem-receipts/${id}.json`,
    role + ' receipt'
  );
  const matches = records.filter(record => record?.data?.paper?.id === id);
  if (matches.length !== 1) fail('missing or duplicate ' + role + ' record');
  const record = matches[0];
  if (
    typeof record.file !== 'string' ||
    path.resolve(record.file) !== path.resolve(canonical.file) ||
    record.relativePath?.replaceAll('\\', '/') !== descriptor.canonical.file ||
    record.contentHash !== descriptor.canonical.sha256 ||
    compact(record.data) !== compact(canonical.data)
  ) {
    fail('record does not match frozen ' + role + ' bytes');
  }
  if (
    !publicationState(record, ledger).eligible ||
    ledger?.papers?.[id]?.kind !== 'reviewed' ||
    compact(ledger.papers[id].review) !== compact(receipt.data) ||
    receipt.data.paperId !== id ||
    receipt.data.contentHash !== record.contentHash ||
    receipt.data.verdict !== 'pass'
  ) {
    fail('invalid publicationState or receipt for ' + role);
  }
  const paper = record.data.paper;
  for (const key of [
    'subject',
    'competition',
    'year',
    'lang',
    'round',
    'roundType',
  ]) {
    if (paper[key] !== descriptor.source[key]) fail('wrong canonical ' + key);
  }
  if (
    paper.source?.archiveKey !== descriptor.source.archiveKey ||
    paper.solutionSource?.archiveKey !== descriptor.source.solutionArchiveKey
  ) {
    fail('wrong canonical source key');
  }
  if (
    typeof paper.caveat !== 'string' ||
    sha256(paper.caveat) !== CAVEATS[id]
  ) {
    fail('missing or changed canonical caveat');
  }
  const stamps =
    role === 'booklet'
      ? {
          problems: LINEAGE.bookletQuestions.historicalCanonicalStamp,
          solutions: LINEAGE.answers.bookletHistoricalCanonicalStamp,
        }
      : {
          problems: LINEAGE.slideQuestions.historicalCanonicalStamp,
          solutions: LINEAGE.answers.slidesHistoricalCanonicalStamp,
        };
  exact(paper.transcription?.sourceSha256, stamps, role + ' historical stamps');
  exact(receipt.data.sourceHashes, stamps, role + ' receipt historical stamps');
  exact(
    record.data.problems?.map(problem => problem.id),
    descriptor.problemIds,
    role + ' canonical IDs'
  );
  if (
    record.data.problems.reduce(
      (sum, problem) => sum + (problem.figures?.length || 0),
      0
    ) !== descriptor.figureCount
  ) {
    fail('wrong canonical figure count');
  }
  for (const problem of record.data.problems) {
    const owners = records
      .flatMap(other => other?.data?.problems || [])
      .filter(other => other.id === problem.id);
    if (owners.length !== 1) {
      fail('duplicate or out-of-scope problem ownership');
    }
  }
  return record.data;
}

/**
 * Offline, synchronous and read-only. Missing default config means no overlay;
 * any present/supplied config must validate completely before projections exist.
 * `config` is a parsed manifest, never a file path or a source-choice override.
 * Part indexes are zero-based. Returned strings are exact canonical strings.
 */
export function readProblemCompanions(
  root,
  records,
  ledger,
  routes,
  { config } = {}
) {
  if (config === undefined) {
    const file = path.join(root, 'content/problem-companions.json');
    if (!fs.existsSync(file)) return new Map();
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  fields(config, ['version', 'groups'], 'config');
  if (
    config.version !== 1 ||
    !Array.isArray(config.groups) ||
    config.groups.length !== 1 ||
    !Array.isArray(records) ||
    !object(ledger) ||
    !object(routes)
  ) {
    fail('invalid version, groups or generator inputs');
  }
  const group = config.groups[0];
  fields(
    group,
    [
      'id',
      'expectedProblemIds',
      'expectedFigureCount',
      'booklet',
      'slides',
      'sourceAudit',
      'lineage',
      'frozenRoutes',
      'bookletProblemSha256',
      'bookletStatementSha256',
      'mappings',
    ],
    'group'
  );
  exact(group.id, GROUP, 'group ID');
  exact(group.expectedProblemIds, IDS, 'all31 IDs');
  exact(group.expectedFigureCount, 36, 'all36 figures');
  fields(
    group.sourceAudit,
    [
      'kind',
      'evidence',
      'qualification',
      'historicalReaders',
      'newSourceReading',
      'independentScientificReview',
    ],
    'source audit'
  );
  exact(
    group.sourceAudit.kind,
    'recorded-canonical-companion-correspondence',
    'source audit kind'
  );
  // Reference-only: the ignored historical proof is not needed in a deployment
  // checkout. This binds its identity without claiming a new scientific check.
  exact(group.sourceAudit.evidence, AUDIT, 'r2 source audit proof');
  if (
    typeof group.sourceAudit.qualification !== 'string' ||
    !group.sourceAudit.qualification.trim()
  ) {
    fail('missing source audit qualification');
  }
  exact(
    group.sourceAudit.historicalReaders,
    {
      booklet: { provider: 'agent', model: 'opus-5-5', at: '2026-09-23' },
      slides: { provider: 'agent', model: 'opus-5-5', at: '2026-09-27' },
    },
    'historical readers'
  );
  exact(group.sourceAudit.newSourceReading, false, 'new source reading claim');
  exact(
    group.sourceAudit.independentScientificReview,
    false,
    'independent review claim'
  );
  exact(group.lineage, LINEAGE, 'distinct original/current/historical lineage');
  fields(group.frozenRoutes, IDS, 'all31 frozen routes');
  for (const id of IDS) {
    const frozen = '/problems/' + id;
    if (group.frozenRoutes[id] !== frozen || routes[id] !== frozen) {
      fail('changed or unsafe frozen route ' + id);
    }
  }
  const booklet = owner(root, group.booklet, 'booklet', records, ledger);
  const slides = owner(root, group.slides, 'slides', records, ledger);
  const whole = booklet.problems[0];
  digest(group.bookletProblemSha256, 'booklet problem');
  digest(group.bookletStatementSha256, 'booklet statement');
  if (
    whole.number !== 1 ||
    objectHash(whole) !== group.bookletProblemSha256 ||
    sha256(whole.statement) !== group.bookletStatementSha256 ||
    !Array.isArray(whole.parts) ||
    whole.parts.length !== 30 ||
    (whole.sections?.length || 0) !== 0 ||
    whole.figures.length !== 0
  ) {
    fail('invalid frozen booklet problem');
  }
  safeText(whole.statement, 'booklet introduction');
  if (!Array.isArray(group.mappings) || group.mappings.length !== 30) {
    fail('expected exactly30 mappings');
  }
  const result = new Map(),
    partAnchors = [],
    figureIds = new Set();
  for (let index = 0; index < 30; index++) {
    const mapping = group.mappings[index],
      number = index + 1;
    fields(
      mapping,
      [
        'index',
        'questionNumber',
        'slideProblemId',
        'slideProblemPointer',
        'slideProblemSha256',
        'slideStatementSha256',
        'slideLabel',
        'bookletProblemId',
        'bookletPartPointer',
        'bookletPartLabel',
        'bookletPartSha256',
        'bookletStatementSha256',
        'answerSha256',
        'figures',
        'anchor',
      ],
      'mapping'
    );
    const slide = slides.problems[index],
      part = whole.parts[index];
    const label = number === 24 ? '24' : number + '.',
      slideLabel = number === 7 ? '7' : 'Question ' + number;
    if (
      mapping.index !== index ||
      mapping.questionNumber !== number ||
      mapping.slideProblemId !== SLIDE_IDS[index] ||
      mapping.slideProblemPointer !== `/problems/${index}` ||
      mapping.bookletProblemId !== BOOKLET_ID ||
      mapping.bookletPartPointer !== `/problems/0/parts/${index}` ||
      mapping.bookletPartLabel !== label ||
      mapping.slideLabel !== slideLabel ||
      mapping.anchor !== `question-${number}`
    ) {
      fail('invalid index, label, anchor or owner mapping');
    }
    if (
      hasNativeAnchor(whole, mapping.anchor) ||
      hasNativeAnchor(slide, `companion-question-${number}`)
    ) {
      fail('companion anchor collides with a native ID');
    }
    for (const key of [
      'slideProblemSha256',
      'slideStatementSha256',
      'bookletPartSha256',
      'bookletStatementSha256',
      'answerSha256',
    ]) {
      digest(mapping[key], key);
    }
    if (
      slide.number !== number ||
      slide.title !== slideLabel ||
      slide.statement !== slideLabel ||
      (slide.parts?.length || 0) !== 0 ||
      (slide.sections?.length || 0) !== 0 ||
      part.label !== label ||
      objectHash(slide) !== mapping.slideProblemSha256 ||
      sha256(slide.statement) !== mapping.slideStatementSha256 ||
      objectHash(part) !== mapping.bookletPartSha256 ||
      sha256(part.statement) !== mapping.bookletStatementSha256
    ) {
      fail('changed canonical number, label, statement or part');
    }
    if (
      !object(part.answer) ||
      !object(slide.answer) ||
      compact(part.answer) !== compact(slide.answer) ||
      objectHash(part.answer) !== mapping.answerSha256
    ) {
      fail('unequal canonical answer objects');
    }
    safeText(part.statement, 'booklet part');
    safeText(slide.statement, 'slide heading');
    const count =
      number === 1 || number === 2 ? 3 : number === 17 || number === 23 ? 2 : 1;
    if (
      !Array.isArray(mapping.figures) ||
      mapping.figures.length !== count ||
      !Array.isArray(slide.figures) ||
      slide.figures.length !== count
    ) {
      fail('wrong mapped figure count');
    }
    mapping.figures.forEach((figure, i) => {
      fields(figure, ['id', 'sha256'], 'figure');
      digest(figure.sha256, 'figure');
      const id = `p${number}-fig${i + 1}`;
      if (
        figure.id !== id ||
        figureIds.has(id) ||
        slide.figures[i].id !== id ||
        objectHash(slide.figures[i]) !== figure.sha256
      ) {
        fail('changed or duplicate figure ID/object');
      }
      figureIds.add(id);
    });
    const slideSolutionUrl = group.frozenRoutes[slide.id] + '/solution';
    partAnchors.push(
      Object.freeze({
        index,
        id: mapping.anchor,
        label: part.label,
        slideSolutionUrl,
      })
    );
    result.set(
      slide.id,
      Object.freeze({
        role: 'slide',
        groupId: group.id,
        partIndex: index,
        partLabel: part.label,
        questionStatement: part.statement,
        bookletProblemId: BOOKLET_ID,
        bookletSolutionUrl:
          group.frozenRoutes[BOOKLET_ID] + '/solution#' + mapping.anchor,
        bookletArchiveKey: booklet.paper.source.archiveKey,
        subject: 'geography',
        suppressCaveat: true,
        slideStatementHash: mapping.slideStatementSha256,
      })
    );
  }
  if (figureIds.size !== 36 || result.size !== 30) {
    fail('incomplete companion coverage');
  }
  result.set(
    BOOKLET_ID,
    Object.freeze({
      role: 'booklet',
      groupId: group.id,
      partAnchors: Object.freeze(partAnchors),
    })
  );
  return result;
}
