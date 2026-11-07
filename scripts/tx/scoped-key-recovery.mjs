import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const sha256 = /^[a-f0-9]{64}$/;
export const scopeApprovalFile = 'scoped-key-recovery-approval.json';
export const scopeReadingFile = 'scoped-key-recovery-reading.json';
export const scopePhaseFile = index =>
  'scoped-key-recovery-phase-' + index + '.json';
export const exactBytes = raw => ({
  sha256: createHash('sha256').update(raw).digest('hex'),
  bytes: raw.length,
});
const payload = ref => ({ sha256: ref?.sha256, bytes: ref?.bytes });
const json = raw => JSON.parse(raw.toString('utf8'));
function exactPointer(value, pointer) {
  for (const segment of pointer.slice(1).split('/')) {
    const name = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    assert(
      value && Object.hasOwn(value, name),
      'Missing frozen key reader selector ' + pointer
    );
    value = value[name];
  }
  return value;
}

function exactOwn(before, after, field) {
  assert.equal(
    Object.hasOwn(after, field),
    Object.hasOwn(before, field),
    field
  );
  if (Object.hasOwn(before, field)) {
    assert.deepEqual(after[field], before[field], field);
  }
}

export function scopedKeyRecoveryInputs(io, row, candidate, manifest) {
  return {
    approval: io.bytes(row.scopedKeyRecoveryApproval),
    priorCanonical: io.bytes(row.currentCanonical),
    priorReceipt: io.bytes(row.currentReceipt),
    candidate: io.bytes(candidate),
    manifest: io.bytes(manifest),
    boundedReading: io.bytes(row.boundedRepairReading),
    phaseEvidence: row.scopedKeyRecoveryPhaseReports.map(io.bytes),
  };
}

export function qualifyScopedKeyRecovery(input) {
  const approval = json(input.approval);
  assert.equal(approval.kind, 'scoped-native-key-recovery-approval-v1');
  assert.equal(approval.issued, true);
  assert.equal(approval.solePublisher, '/root');
  assert.equal(approval.mode, 'repair-ancestry');
  for (const name of [
    'priorCanonical',
    'priorReceipt',
    'candidate',
    'manifest',
    'boundedReading',
  ]) {
    assert.deepEqual(
      exactBytes(input[name]),
      payload(approval[name]),
      'Exact frozen ' + name
    );
  }
  const before = json(input.priorCanonical),
    old = json(input.priorReceipt);
  const candidate = json(input.candidate),
    manifest = json(input.manifest);
  const id = approval.ownerId;
  assert.equal(typeof id, 'string');
  for (const owner of [
    before.paper.id,
    old.paperId,
    candidate.paper.id,
    manifest.paperId,
  ]) {
    assert.equal(owner, id);
  }
  assert.equal(old.verdict, 'pass');
  assert.equal(old.contentHash, approval.priorCanonical.sha256);
  assert(
    !Object.hasOwn(before.paper, 'solutionSource'),
    'Historical paper already records a key'
  );
  assert.deepEqual(Object.keys(manifest.documents).sort(), [
    'problems',
    'solutions',
  ]);
  const { problems: q, solutions: k } = manifest.documents;
  assert.deepEqual(old.sourceHashes, { problems: q.sha256 });
  assert.deepEqual(before.paper.transcription.sourceSha256, old.sourceHashes);
  assert.deepEqual(candidate.paper.source, before.paper.source);
  assert.equal(before.paper.source.archiveKey, q.key);
  assert.deepEqual(
    candidate.tx?.reader,
    old.reader,
    'Preserve exact historical Q reader'
  );
  assert(old.reader && typeof old.reader === 'object');
  for (const [field, value] of Object.entries(old.reader)) {
    if (
      field === 'promptSha256' &&
      value === null &&
      !Object.hasOwn(before.paper.transcription, field)
    ) {
      continue;
    }
    assert.deepEqual(
      before.paper.transcription[field],
      value,
      'Historical canonical reader ' + field
    );
  }
  const nominalDpi = before.paper.transcription.renderDpi;
  assert(Number.isFinite(nominalDpi) && nominalDpi > 0);
  assert.equal(manifest.renderDpi, nominalDpi);
  assert.equal(q.renderDpi, nominalDpi);
  if (Object.hasOwn(old, 'renderDpi')) assert.equal(old.renderDpi, nominalDpi);
  if (Object.hasOwn(old, 'documentRenderDpi')) {
    assert.deepEqual(old.documentRenderDpi, { problems: nominalDpi });
  }
  const oldScope = q.readScope
    ? {
        problems: {
          archiveKey: q.key,
          sourceSha256: q.sha256,
          totalPages: q.pages,
          ...q.readScope,
        },
      }
    : {};
  const oldConversion = q.converted ? { problems: q.converted } : {};
  assert.deepEqual(
    Object.hasOwn(old, 'sourceReadScopes') ? old.sourceReadScopes : {},
    oldScope
  );
  assert.deepEqual(
    Object.hasOwn(old, 'sourceConversions') ? old.sourceConversions : {},
    oldConversion
  );
  assert(!Object.hasOwn(k, 'converted') && !Object.hasOwn(k, 'archiveEntry'));
  assert(typeof k.key === 'string' && /\.pdf$/i.test(k.key));
  assert(
    sha256.test(k.sha256) &&
      k.sha256 !== q.sha256 &&
      k.key !== q.key &&
      k.file !== q.file
  );
  assert(k.fileSha256 === undefined || k.fileSha256 === k.sha256);
  assert(Number.isSafeInteger(k.bytes) && k.bytes > 0);
  assert(Number.isSafeInteger(k.pages) && k.pages > 0);
  assert(Number.isFinite(k.renderDpi) && k.renderDpi > 0);
  assert(typeof k.readScope?.reason === 'string' && k.readScope.reason.trim());
  const keyPages = k.readScope.pages;
  assert(
    Array.isArray(keyPages) &&
      keyPages.length > 0 &&
      keyPages.every(
        (page, i) =>
          Number.isSafeInteger(page) &&
          page > (keyPages[i - 1] ?? 0) &&
          page <= k.pages
      )
  );
  const key = candidate.paper.solutionSource;
  assert.equal(key.archiveKey, k.key);
  assert.deepEqual(key.pages, keyPages);
  const wholeIds = before.problems.map(problem => problem.id);
  assert(wholeIds.length && new Set(wholeIds).size === wholeIds.length);
  assert.deepEqual(
    candidate.problems.map(problem => problem.id),
    wholeIds
  );
  const coveredIds = Object.hasOwn(key, 'problemIds')
    ? key.problemIds
    : wholeIds;
  assert(
    Array.isArray(coveredIds) &&
      coveredIds.length &&
      new Set(coveredIds).size === coveredIds.length &&
      coveredIds.every(task => wholeIds.includes(task))
  );
  const reading = approval.keyReading;
  assert.deepEqual(reading.document, {
    archiveKey: k.key,
    sha256: k.sha256,
    bytes: k.bytes,
    totalPages: k.pages,
    renderDpi: k.renderDpi,
  });
  assert.deepEqual(reading.coveredProblemIds, coveredIds);
  assert(Array.isArray(reading.phases) && reading.phases.length > 0);
  const witnessedPages = [];
  assert.equal(input.phaseEvidence.length, reading.phases.length);
  for (const [index, phase] of reading.phases.entries()) {
    assert(Array.isArray(phase.pages) && phase.pages.length > 0);
    for (const field of ['provider', 'model']) {
      assert(
        typeof phase.reader?.[field] === 'string' && phase.reader[field].trim()
      );
    }
    assert(!/unknown|unspecified/i.test(phase.reader.model));
    assert(
      sha256.test(phase.attestation?.sha256) &&
        Number.isSafeInteger(phase.attestation.bytes) &&
        phase.attestation.bytes > 0
    );
    assert(
      Array.isArray(phase.selectors) &&
        phase.selectors.length &&
        phase.selectors.every(
          selector => typeof selector === 'string' && selector.startsWith('/')
        )
    );
    const raw = input.phaseEvidence[index];
    assert.deepEqual(exactBytes(raw), payload(phase.attestation));
    const report = json(raw);
    for (const selector of phase.selectors) exactPointer(report, selector);
    assert(
      phase.selectors.includes(phase.identitySelector),
      'Frozen identity selector'
    );
    const identity =
      phase.reader.requestId === null
        ? phase.reader.agent
        : phase.reader.requestId;
    assert(
      typeof identity === 'string' && identity.trim(),
      'Recorded agent or request identity is required'
    );
    assert.equal(
      exactPointer(report, phase.identitySelector),
      identity,
      'Exact identity from the original phase report'
    );
    witnessedPages.push(...phase.pages);
  }
  assert.deepEqual(
    witnessedPages.sort((a, b) => a - b),
    keyPages,
    'Exactly one approved key phase per scoped physical page'
  );
  return {
    approval: exactBytes(input.approval),
    old,
    candidate,
    manifest,
    nominalDpi,
    priorCanonical: payload(approval.priorCanonical),
    priorReceipt: payload(approval.priorReceipt),
    boundedReading: payload(approval.boundedReading),
    candidateRef: payload(approval.candidate),
    manifestRef: payload(approval.manifest),
    sourceHashes: { problems: q.sha256, solutions: k.sha256 },
    sourceReadScopes: {
      ...oldScope,
      solutions: {
        archiveKey: k.key,
        sourceSha256: k.sha256,
        totalPages: k.pages,
        ...k.readScope,
      },
    },
    sourceConversions: oldConversion,
    documentRenderDpi: { problems: nominalDpi, solutions: k.renderDpi },
  };
}

export function scopedKeyRecoveryRenderDpi(manifest, input) {
  const recovery = qualifyScopedKeyRecovery(input);
  assert.deepEqual(manifest, recovery.manifest);
  return recovery.nominalDpi;
}

export function qualifyScopedKeyRecoveryReceipt(recovery, receipt, proof) {
  const ancestry = receipt.repairAncestryEvidence;
  assert.equal(receipt.checkerMode, 'repair-ancestry');
  assert.deepEqual(ancestry.scopedKeyRecovery, recovery.approval);
  assert.deepEqual(
    payload(ancestry.currentBeforeCanonical),
    recovery.priorCanonical
  );
  assert.deepEqual(
    payload(ancestry.currentBeforeReceipt),
    recovery.priorReceipt
  );
  assert.deepEqual(
    payload(ancestry.boundedRepairReading),
    recovery.boundedReading
  );
  assert.deepEqual(
    payload(ancestry.selectedWorkingManifest),
    recovery.manifestRef
  );
  assert.equal(receipt.candidateSha256, recovery.candidateRef.sha256);
  for (const field of ['reader', 'coverage', 'readerEvidence']) {
    exactOwn(recovery.old, receipt, field);
  }
  assert.equal(receipt.renderDpi, recovery.nominalDpi);
  assert.deepEqual(receipt.documentRenderDpi, recovery.documentRenderDpi);
  for (const field of [
    'sourceHashes',
    'sourceReadScopes',
    'sourceConversions',
  ]) {
    assert.deepEqual(receipt[field], recovery[field], field);
    if (proof) {
      assert.deepEqual(
        proof[field],
        recovery[field],
        'Actual ordinary proof ' + field
      );
    }
  }
}
