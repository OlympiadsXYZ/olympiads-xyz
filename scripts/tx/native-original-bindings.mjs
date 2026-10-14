// INERT on import. Extra native originals supplement, never replace, stock PDF coverage.
// Read only exact file bytes and recorded metadata; no converter, model, or source renderer.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const SHA = /^[a-f0-9]{64}$/;
const WORD_VERSION = '16.0.14334.20918';
const CONVERTER_SHA =
  '6b188df50c0191c5438758f500e2991043d76c0bb5b79f4751b9ad24158b45a6';
const CONVERTER_BYTES = 1269;
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const requireThat = (ok, message) => {
  if (!ok) throw new Error(message);
};
const fileRef = v =>
  object(v) &&
  typeof v.file === 'string' &&
  path.isAbsolute(v.file) &&
  SHA.test(v.sha256) &&
  Number.isSafeInteger(v.bytes) &&
  v.bytes > 0;
const sameRef = (a, b) =>
  fileRef(a) &&
  fileRef(b) &&
  path.resolve(a.file) === path.resolve(b.file) &&
  a.sha256 === b.sha256 &&
  a.bytes === b.bytes;
function exactBytes(ref) {
  requireThat(fileRef(ref), 'needs an absolute exact-byte file descriptor');
  const raw = fs.readFileSync(ref.file);
  requireThat(
    raw.length === ref.bytes &&
      createHash('sha256').update(raw).digest('hex') === ref.sha256,
    'file bytes differ from the registered native descriptor'
  );
  return raw;
}
const exactJson = ref => JSON.parse(exactBytes(ref).toString('utf8'));
const core = (v, keys) => Object.fromEntries(keys.map(k => [k, v?.[k]]));
const TXT_FIELDS = [
  'role',
  'nativeOriginalKind',
  'archiveKey',
  'registeredCatalogueId',
  'nativeOriginal',
];
const OFFICE_FIELDS = [
  'role',
  'nativeOriginalKind',
  'archiveKey',
  'nativeOriginal',
  'derivedPDF',
  'actualLineage',
  'actualReadingJournal',
  'actualNativeJournalSelector',
];
const textRegistration = manifest =>
  manifest?.privateOriginalSourceQualification
    ?.additionalRegisteredInstructions;
const officeRegistration = manifest =>
  manifest?.privateGenuineNativeOfficeQualification?.documents?.filter(
    d => d.role === 'solutions' && d.nativeOriginalKind === 'DOCX'
  ) || [];
function exactKeys(value, keys) {
  requireThat(
    object(value) &&
      isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()),
    'native binding has missing or unsupported fields'
  );
}
function checkTxt(binding, reads, manifest, reader) {
  exactKeys(binding, TXT_FIELDS);
  const registered = textRegistration(manifest);
  requireThat(
    registered?.role === 'instructions' &&
      registered.nativeOriginalKind === 'TXT',
    'TXT is not registered as a separate native instructions companion'
  );
  const expected = {
    role: 'instructions',
    nativeOriginalKind: 'TXT',
    archiveKey: registered.archiveKey,
    registeredCatalogueId: registered.registeredCatalogueId,
    nativeOriginal: {
      file: registered.sourceFile,
      sha256: registered.sha256,
      bytes: registered.bytes,
    },
  };
  requireThat(
    binding.role === expected.role &&
      binding.nativeOriginalKind === expected.nativeOriginalKind &&
      binding.archiveKey === expected.archiveKey &&
      binding.registeredCatalogueId === expected.registeredCatalogueId &&
      sameRef(binding.nativeOriginal, expected.nativeOriginal),
    'TXT binding differs from its registered original'
  );
  requireThat(
    /\.txt$/i.test(binding.archiveKey) &&
      /\.txt$/i.test(binding.nativeOriginal.file) &&
      typeof binding.registeredCatalogueId === 'string' &&
      binding.registeredCatalogueId.trim(),
    'native TXT requires its actual TXT archive key, file and catalogue registration'
  );
  requireThat(
    registered.fullTextReadingRequired === true,
    'registered TXT full-read requirement is missing'
  );
  exactBytes(binding.nativeOriginal);
  exactBytes(registered.acquisitionEvidence);
  requireThat(
    Array.isArray(reads) && reads.length === 1,
    'registered TXT needs exactly one explicit native full-read record'
  );
  const read = reads[0];
  exactKeys(read, [
    'binding',
    'fullDocument',
    'fullReadingPassCount',
    'actualReadingEvidence',
  ]);
  requireThat(
    read.binding === 'instructions' &&
      read.fullDocument === true &&
      read.fullReadingPassCount === 1,
    'TXT coverage must record one full native-file pass, with no invented page'
  );
  const recorded = exactJson(read.actualReadingEvidence);
  requireThat(
    recorded.owner === manifest.paperId &&
      recorded.actualReader === reader?.requestId &&
      recorded.model === reader?.model &&
      recorded.reasoningEffort === 'ultra',
    'TXT reading record differs from the actual owner/reader/model'
  );
  requireThat(
    recorded.fullTextPersonallyRead === true &&
      recorded.fullReadingPassCount === 1 &&
      recorded.wholeEncodedSha256 === binding.nativeOriginal.sha256 &&
      recorded.wholeEncodedBytes === binding.nativeOriginal.bytes,
    'TXT record does not attest the exact whole native file once'
  );
  requireThat(
    recorded.original?.role === 'instructions' &&
      recorded.original.nativeOriginalKind === 'TXT' &&
      recorded.original.archiveKey === binding.archiveKey &&
      recorded.original.registeredCatalogueId ===
        binding.registeredCatalogueId &&
      sameRef(
        {
          file: recorded.original.sourceFile,
          sha256: recorded.original.sha256,
          bytes: recorded.original.bytes,
        },
        binding.nativeOriginal
      ),
    'TXT reading record names a different registered original'
  );
}
function checkOffice(binding, evidence, manifest, sourceDirectory) {
  exactKeys(binding, OFFICE_FIELDS);
  const registered = officeRegistration(manifest);
  requireThat(
    registered.length === 1,
    'Office binding needs one registered native DOCX solutions role'
  );
  const native = registered[0],
    doc = manifest.documents?.solutions;
  requireThat(
    binding.role === 'solutions' &&
      binding.nativeOriginalKind === 'DOCX' &&
      binding.archiveKey === native.archiveKey &&
      /\.docx$/i.test(binding.archiveKey) &&
      sameRef(binding.nativeOriginal, native.nativeOriginal) &&
      sameRef(binding.derivedPDF, {
        file: native.sourceFile,
        sha256: native.sha256,
        bytes: native.bytes,
      }) &&
      sameRef(binding.actualLineage, native.actualConversionLineage),
    'Office binding differs from the registered native DOCX and actual new PDF'
  );
  exactBytes(binding.nativeOriginal);
  exactBytes(binding.derivedPDF);
  requireThat(
    doc?.key === binding.archiveKey &&
      doc.sha256 === binding.nativeOriginal.sha256 &&
      doc.bytes === binding.nativeOriginal.bytes &&
      doc.file === 'src/solutions.pdf' &&
      doc.fileSha256 === binding.derivedPDF.sha256 &&
      doc.fileBytes === binding.derivedPDF.bytes &&
      doc.pages === native.genuineDerivedPDFPageCount,
    'operative Office manifest must distinguish original DOCX hash/bytes from the actual new PDF hash/bytes'
  );
  const converted = doc.converted;
  requireThat(
    converted?.from === 'docx' &&
      converted.sourceFile === 'src/solutions.docx' &&
      converted.sourceSha256 === binding.nativeOriginal.sha256 &&
      converted.pdfSha256 === binding.derivedPDF.sha256 &&
      sameRef(converted.actualLineage, binding.actualLineage) &&
      converted.converterScriptSha256 === CONVERTER_SHA &&
      converted.wordFileVersion === WORD_VERSION,
    'Office provenance must bind the native DOCX, actual lineage, converter and observed Word recipe'
  );
  requireThat(
    typeof sourceDirectory === 'string' && path.isAbsolute(sourceDirectory),
    'Office staged source directory is required'
  );
  exactBytes({
    file: path.join(sourceDirectory, doc.file),
    sha256: doc.fileSha256,
    bytes: doc.fileBytes,
  });
  exactBytes({
    file: path.join(sourceDirectory, converted.sourceFile),
    sha256: doc.sha256,
    bytes: doc.bytes,
  });
  const lineage = exactJson(binding.actualLineage);
  requireThat(
    lineage.ownerId === manifest.paperId &&
      lineage.originalSourceArchiveKey === binding.archiveKey &&
      sameRef(lineage.originalInput, binding.nativeOriginal) &&
      sameRef(lineage.privateInput, {
        ...binding.nativeOriginal,
        file: lineage.privateInput?.file,
      }) &&
      sameRef(lineage.newDerivedPDF, binding.derivedPDF) &&
      lineage.pageCount === doc.pages &&
      lineage.pdfinfoExit === 0,
    'actual Office lineage names different native DOCX, new PDF or page count'
  );
  exactBytes(lineage.privateInput);
  exactBytes(lineage.converter);
  requireThat(
    lineage.converter.sha256 === CONVERTER_SHA &&
      lineage.converter.bytes === CONVERTER_BYTES &&
      lineage.exitCode === 0 &&
      Number.isInteger(lineage.converterPID) &&
      lineage.converterPID > 0 &&
      Array.isArray(lineage.wordProcessesObserved) &&
      lineage.wordProcessesObserved.length > 0 &&
      lineage.wordProcessesObserved.every(
        p =>
          Number.isInteger(p.pid) &&
          p.pid > 0 &&
          p.fileVersion === WORD_VERSION &&
          p.productVersion === WORD_VERSION &&
          /[\\/]WINWORD\.EXE$/i.test(p.executable || '')
      ),
    'actual Office conversion must retain its successful process and observed Word version'
  );
  requireThat(
    lineage.newPDFNotClaimedOldRecipe === true &&
      lineage.newPDFHasOldSHA === false &&
      native.newSHAEqualsOldSHA === false &&
      native.notOriginallyPrintedNativePDF === true &&
      lineage.allPreservedExact === true &&
      Array.isArray(lineage.preservedBefore) &&
      lineage.preservedBefore.length > 0 &&
      isDeepStrictEqual(lineage.preservedBefore, lineage.preservedAfter),
    'Office history preservation/new-recipe qualification is missing or changed'
  );
  requireThat(
    binding.actualNativeJournalSelector === '/viewedPagesNew',
    'unsupported Office native page journal selector'
  );
  const journal = exactJson(binding.actualReadingJournal);
  requireThat(
    journal.owner === manifest.paperId &&
      journal.actualReader === evidence.reader?.requestId &&
      journal.model === evidence.reader?.model &&
      journal.reasoningEffort === 'ultra' &&
      Array.isArray(journal.remainingPages) &&
      journal.remainingPages.length === 0 &&
      Array.isArray(journal.viewedPagesNew),
    'Office full-page journal is incomplete or names another actual reader'
  );
  const rows = journal.viewedPagesNew.filter(row => row.role === 'solutions');
  const expected = Array.from({ length: doc.pages }, (_, i) => i + 1);
  requireThat(
    isDeepStrictEqual(
      rows.map(row => row.page).sort((a, b) => a - b),
      expected
    ) && isDeepStrictEqual(native.expectedPages, expected),
    'Office journal must cover every current new-PDF key page exactly once'
  );
  const claimed = (evidence.pagesRead || [])
    .filter(row => row.document === 'solutions')
    .map(row => row.page)
    .sort((a, b) => a - b);
  requireThat(
    isDeepStrictEqual(claimed, expected),
    'Office evidence key pages differ from the genuine full-page journal'
  );
  for (const row of rows) {
    const original = row.nativeOriginalDOCX ?? row.originalNativeDOCX;
    requireThat(
      row.nativeOriginalKind === 'DOCX' &&
        row.personallyOpened === true &&
        row.actualReader === journal.actualReader &&
        row.notOriginallyPrintedNativePDF === true &&
        sameRef(row.source, binding.derivedPDF) &&
        sameRef(original, binding.nativeOriginal) &&
        sameRef(row.actualConversionLineage, binding.actualLineage) &&
        (row.sourceSha256 === undefined ||
          row.sourceSha256 === binding.derivedPDF.sha256),
      'Office journal row does not bind the actually opened current key page to native DOCX/new PDF/actual lineage'
    );
  }
}

// Bounded read-only ZIP member byte check: no extraction paths, model or converter.
export function rtfZipMemberMatchesNative(archive, native, member) {
  requireThat(
    Buffer.isBuffer(archive) &&
      Buffer.isBuffer(native) &&
      native.length > 0 &&
      native.length <= 64 * 1024 * 1024 &&
      member === 'SPESTU_I.rtf',
    'invalid bounded RTF ZIP inputs'
  );
  const eocds = [];
  for (
    let i = archive.length - 22;
    i >= Math.max(0, archive.length - 65557);
    i--
  ) {
    if (
      archive.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + archive.readUInt16LE(i + 20) === archive.length
    ) {
      eocds.push(i);
    }
  }
  requireThat(eocds.length === 1, 'missing or ambiguous ZIP end record');
  const end = eocds[0],
    count = archive.readUInt16LE(end + 10);
  const centralSize = archive.readUInt32LE(end + 12),
    centralStart = archive.readUInt32LE(end + 16);
  requireThat(
    archive.readUInt16LE(end + 4) === 0 &&
      archive.readUInt16LE(end + 6) === 0 &&
      archive.readUInt16LE(end + 8) === count &&
      count > 0 &&
      count !== 0xffff &&
      centralSize !== 0xffffffff &&
      centralStart !== 0xffffffff &&
      centralStart + centralSize === end &&
      !(end >= 20 && archive.readUInt32LE(end - 20) === 0x07064b50),
    'multidisk/ZIP64 or malformed central directory'
  );
  const noZip64Extra = extra => {
    for (let i = 0; i < extra.length; ) {
      requireThat(i + 4 <= extra.length, 'truncated ZIP extra header');
      const id = extra.readUInt16LE(i),
        size = extra.readUInt16LE(i + 2);
      requireThat(
        id !== 1 && i + 4 + size <= extra.length,
        'ZIP64 or truncated ZIP extra data'
      );
      i += 4 + size;
    }
  };
  const matches = [];
  let at = centralStart;
  for (let n = 0; n < count; n++) {
    requireThat(
      at + 46 <= end && archive.readUInt32LE(at) === 0x02014b50,
      'invalid ZIP central entry'
    );
    const flags = archive.readUInt16LE(at + 8),
      method = archive.readUInt16LE(at + 10);
    const compressed = archive.readUInt32LE(at + 20),
      uncompressed = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28),
      extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32),
      local = archive.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    requireThat(
      next <= end &&
        archive.readUInt16LE(at + 34) === 0 &&
        compressed !== 0xffffffff &&
        uncompressed !== 0xffffffff &&
        local !== 0xffffffff,
      'ZIP64/multidisk or truncated ZIP member'
    );
    const nameBytes = archive.subarray(at + 46, at + 46 + nameLength);
    const name = nameBytes.toString(flags & 0x800 ? 'utf8' : 'latin1');
    requireThat(
      name &&
        !/[\\:\0]/.test(name) &&
        name
          .replace(/\/$/, '')
          .split('/')
          .every(p => p && p !== '.' && p !== '..') &&
        (!(flags & 0x800) || Buffer.from(name, 'utf8').equals(nameBytes)),
      'unsafe or ambiguous ZIP member path'
    );
    noZip64Extra(
      archive.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength)
    );
    if (name.toLowerCase() === member.toLowerCase()) {
      matches.push({
        name,
        nameBytes,
        flags,
        method,
        compressed,
        uncompressed,
        local,
      });
    }
    at = next;
  }
  requireThat(
    at === end && matches.length === 1 && matches[0].name === member,
    'duplicate, case-ambiguous or missing exact RTF member'
  );
  const entry = matches[0],
    local = entry.local;
  requireThat(
    !(entry.flags & 0x41) &&
      [0, 8].includes(entry.method) &&
      entry.uncompressed === native.length &&
      local + 30 <= centralStart &&
      archive.readUInt32LE(local) === 0x04034b50 &&
      archive.readUInt16LE(local + 6) === entry.flags &&
      archive.readUInt16LE(local + 8) === entry.method,
    'encrypted/unsupported RTF member or mismatched local header'
  );
  const nameLength = archive.readUInt16LE(local + 26),
    extraLength = archive.readUInt16LE(local + 28);
  const bodyStart = local + 30 + nameLength + extraLength,
    bodyEnd = bodyStart + entry.compressed;
  requireThat(
    bodyStart <= centralStart &&
      bodyEnd <= centralStart &&
      archive
        .subarray(local + 30, local + 30 + nameLength)
        .equals(entry.nameBytes),
    'RTF local name/body bounds differ'
  );
  noZip64Extra(archive.subarray(local + 30 + nameLength, bodyStart));
  if (!(entry.flags & 8)) {
    requireThat(
      archive.readUInt32LE(local + 18) === entry.compressed &&
        archive.readUInt32LE(local + 22) === entry.uncompressed,
      'RTF local sizes differ from the central directory'
    );
  }
  const compressed = archive.subarray(bodyStart, bodyEnd);
  const body =
    entry.method === 0
      ? compressed
      : inflateRawSync(compressed, { maxOutputLength: native.length });
  requireThat(
    body.length === entry.uncompressed && body.equals(native),
    'actual ZIP member body differs from the exact native RTF bytes'
  );
  return true;
}

const rtfRegistration = manifest =>
  manifest?.privateNativeWordCompanionQualification;
const RTF_FIELDS = [
  'role',
  'document',
  'nativeOriginalKind',
  'archiveKey',
  'nativeOriginal',
  'archiveOriginal',
  'acquisitionURL',
  'archiveEntry',
  'derivedPDF',
  'actualLineage',
  'archiveKeyIssuance',
  'principalReceipt',
];
const RTF_READER =
  '/root/resume_source_blocker_recovery_20261013/italian_rtf_thirteen_source';
function sameRtfSourceBinding(source, binding) {
  return (
    sameRef(source?.originalRTF, binding.nativeOriginal) &&
    sameRef(source?.originalContainerZIP, binding.archiveOriginal) &&
    sameRef(source?.derivedWholePDF, binding.derivedPDF) &&
    sameRef(source?.actualSuccessfulHelperH, binding.actualLineage) &&
    source?.exactZIPMember?.member === binding.archiveEntry &&
    source.exactZIPMember.exactOriginalRTFMatch === true &&
    source.exactZIPMember.sha256 === binding.nativeOriginal.sha256 &&
    source.exactZIPMember.bytes === binding.nativeOriginal.bytes
  );
}
function checkRtfCompanion(
  binding,
  evidence,
  manifest,
  sourceDirectory,
  candidate
) {
  exactKeys(binding, RTF_FIELDS);
  requireThat(
    isDeepStrictEqual(binding, rtfRegistration(manifest)) &&
      binding.role === 'supplement' &&
      binding.document === 'supplement-3' &&
      binding.nativeOriginalKind === 'RTF' &&
      manifest.paperId === 'ipho-1999-experiment-exp' &&
      /\.pdf$/i.test(binding.archiveKey) &&
      binding.acquisitionURL ===
        'https://www.olifis.it/problemi/xxxipho2.zip' &&
      binding.archiveEntry === 'SPESTU_I.rtf',
    'RTF companion differs from its exact declared native/source destination binding'
  );
  const issuance = exactJson(binding.archiveKeyIssuance);
  requireThat(
    issuance.kind ===
      'ROOT actual five fullpage Italian response form view acceptance and bounded release decision' &&
      issuance.issuer === '/root' &&
      issuance.ownerId === manifest.paperId &&
      issuance.approvedSupplementRole === binding.document &&
      issuance.approvedPublicDerivedPDFArchiveKey === binding.archiveKey &&
      issuance.derivedPDFSHA256 === binding.derivedPDF.sha256 &&
      issuance.derivedPDFBytes === binding.derivedPDF.bytes &&
      issuance.canonicalScientificBodiesAndEnglishQuestionKeyUnchanged ===
        true &&
      issuance.noWholeOldQKReadingCredit === true &&
      issuance.independentScientificCheckerCredit === 0,
    'RTF companion destination still needs explicit exact ROOT archive-key issuance'
  );
  const rawRTF = exactBytes(binding.nativeOriginal),
    rawZIP = exactBytes(binding.archiveOriginal);
  requireThat(
    /\.rtf$/i.test(binding.nativeOriginal.file) &&
      rawRTF.subarray(0, 5).toString('ascii') === '{\\rtf' &&
      /\.zip$/i.test(binding.archiveOriginal.file),
    'native RTF/container kinds differ'
  );
  rtfZipMemberMatchesNative(rawZIP, rawRTF, binding.archiveEntry);
  const rawPDF = exactBytes(binding.derivedPDF);
  requireThat(
    rawPDF.subarray(0, 5).toString('ascii') === '%PDF-',
    'RTF actual export is not a PDF file'
  );
  const doc = manifest.documents?.[binding.document],
    original = doc?.original,
    converted = doc?.converted;
  requireThat(
    doc?.key === binding.archiveKey &&
      doc.file === 'src/supplement-3.pdf' &&
      doc.sha256 === binding.derivedPDF.sha256 &&
      doc.bytes === binding.derivedPDF.bytes &&
      doc.pages === 13 &&
      original?.format === 'rtf' &&
      original.file === 'src/supplement-3.rtf' &&
      original.sha256 === binding.nativeOriginal.sha256 &&
      original.bytes === binding.nativeOriginal.bytes &&
      original.sourceFinalUrl === binding.acquisitionURL &&
      original.archiveEntry === binding.archiveEntry &&
      original.containerFile === 'src/supplement-3.original.zip' &&
      original.containerSha256 === binding.archiveOriginal.sha256 &&
      original.containerBytes === binding.archiveOriginal.bytes,
    'prepared supplement-3 must preserve actual PDF identity and separate native RTF/ZIP lineage'
  );
  requireThat(
    converted?.from === 'rtf' &&
      converted.sourceFile === original.file &&
      converted.sourceSha256 === original.sha256 &&
      converted.sourceBytes === original.bytes &&
      converted.pdfSha256 === doc.sha256 &&
      converted.pdfBytes === doc.bytes &&
      converted.sourceContainerFile === original.containerFile &&
      converted.sourceContainerSha256 === original.containerSha256 &&
      converted.sourceContainerBytes === original.containerBytes &&
      converted.exactZipMember === binding.archiveEntry &&
      sameRef(converted.actualWordExportHelperH, binding.actualLineage) &&
      converted.actualExitCode === 0 &&
      converted.actualPDFPages === 13 &&
      converted.conversionRepeated === false,
    'RTF actual conversion fields do not match the preserved source/member/PDF identities'
  );
  requireThat(
    typeof sourceDirectory === 'string' && path.isAbsolute(sourceDirectory),
    'RTF staged source directory is required'
  );
  for (const [relative, ref] of [
    [doc.file, binding.derivedPDF],
    [original.file, binding.nativeOriginal],
    [original.containerFile, binding.archiveOriginal],
  ]) {
    exactBytes({ ...ref, file: path.join(sourceDirectory, relative) });
  }
  const lineage = exactJson(binding.actualLineage);
  requireThat(
    sameRef(lineage.sourceAfter, binding.nativeOriginal) &&
      sameRef(lineage.exactOriginalContainer, binding.archiveOriginal) &&
      lineage.member === binding.archiveEntry &&
      lineage.memberLineage?.sha256 === binding.nativeOriginal.sha256 &&
      lineage.memberLineage.bytes === binding.nativeOriginal.bytes &&
      lineage.actualExitCode === 0 &&
      lineage.actualSuccessfulOutput === true &&
      Number.isInteger(lineage.helperPid) &&
      lineage.helperPid > 0 &&
      lineage.helperPid === converted.actualHelperPID &&
      sameRef(lineage.documentStructure?.wholePDF, binding.derivedPDF) &&
      lineage.documentStructure.pageCount === 13 &&
      lineage.documentStructure.PDFMetadata?.creator ===
        'Microsoft® Word 2021' &&
      lineage.documentStructure.PDFMetadata?.producer ===
        'Microsoft® Word 2021',
    'RTF actual Word conversion record names another source/member/export/process'
  );
  exactBytes(lineage.helper);
  requireThat(
    lineage.helper.sha256 === CONVERTER_SHA &&
      lineage.helper.bytes === CONVERTER_BYTES &&
      Array.isArray(lineage.actualObservedWordProcesses) &&
      lineage.actualObservedWordProcesses.length > 0 &&
      lineage.actualObservedWordProcesses.every(
        p =>
          Number.isInteger(p.pid) &&
          p.pid > 0 &&
          p.name === 'WINWORD.EXE' &&
          /[\\/]WINWORD\.EXE$/i.test(p.exe || '')
      ) &&
      lineage.actualObservedWordProcesses.some(
        p => p.pid === converted.actualWordPID
      ),
    'RTF actual helper/observed Word process is missing or different; no DOCX version/privateInput inferred'
  );
  const reads = evidence.nativeWordCompanionReads;
  requireThat(
    Array.isArray(reads) && reads.length === 1,
    'RTF companion needs exactly one separate actual native page-reading record'
  );
  const read = reads[0];
  exactKeys(read, [
    'binding',
    'document',
    'pages',
    'actualReader',
    'actualReadingH',
    'actualPageCoverage',
    'fullDocument',
    'fullReadingPassCount',
    'actualDerivedPagesRead',
    'figuresInspected',
    'actualFigureViewQualification',
    'rootActualFiveFigureView',
  ]);
  const pages = Array.from({ length: 13 }, (_, i) => i + 1);
  requireThat(
    read.binding === 'rtfCompanion' &&
      read.document === binding.document &&
      isDeepStrictEqual(read.pages, pages) &&
      read.fullDocument === true &&
      read.fullReadingPassCount === 1 &&
      isDeepStrictEqual(read.actualDerivedPagesRead, pages) &&
      read.actualReader?.provider === 'agent' &&
      read.actualReader.model === 'gpt-6.1-sol' &&
      read.actualReader.requestId === RTF_READER &&
      !(evidence.pagesRead || []).some(p => p.document === binding.document),
    'RTF 13-page reader must remain separate from main Q/K reader coverage'
  );
  const h = exactJson(read.actualReadingH),
    coverage = exactJson(read.actualPageCoverage);
  requireThat(
    h.owner === manifest.paperId &&
      sameRef(h.wholeThirteenPageCoverage, read.actualPageCoverage) &&
      coverage.sourceReaderModel === read.actualReader.model &&
      coverage.wholeOriginalCoverageComplete === true &&
      isDeepStrictEqual(coverage.physicalPagesActuallyViewed, pages) &&
      sameRtfSourceBinding(coverage.sourceBinding, binding) &&
      Array.isArray(coverage.journalRefs) &&
      coverage.journalRefs.length === 13,
    'RTF whole-page coverage/H does not bind the exact full native companion'
  );
  const sourceH = exactJson(h.sourceH);
  requireThat(
    sourceH.owner === manifest.paperId &&
      sourceH.sourceModel === read.actualReader.model &&
      sameRtfSourceBinding(sourceH.sourceBinding, binding),
    'RTF final H does not retain the original actual source-reading metadata'
  );
  const seen = [];
  for (const ref of coverage.journalRefs) {
    const journal = exactJson(ref),
      page = journal.pagePNG?.physicalPage;
    requireThat(
      journal.owner === manifest.paperId &&
        journal.actuallyViewedWholePageOnce === true &&
        journal.original300dpiRGB === true &&
        journal.separateChecker === false &&
        journal.oldNativeOrPadovaNinePageView === false &&
        sameRtfSourceBinding(journal.sourceBinding, binding) &&
        Number.isInteger(page) &&
        pages.includes(page),
      'RTF actual page journal must preserve a genuine once-viewed native Word page and exact ZIP/RTF/export lineage'
    );
    seen.push(page);
  }
  requireThat(
    isDeepStrictEqual(
      seen.sort((a, b) => a - b),
      pages
    ),
    'RTF actual page journals omit or repeat a physical page'
  );
  checkRtfCompanionFigures(
    binding,
    read,
    evidence,
    manifest,
    sourceDirectory,
    candidate,
    issuance,
    coverage
  );
}

function checkRtfCompanionFigures(
  binding,
  read,
  evidence,
  manifest,
  sourceDirectory,
  candidate,
  rootView,
  coverage
) {
  const principal = exactJson(binding.principalReceipt).readerEvidence;
  requireThat(
    object(principal) &&
      principal.figuresInspected === 10 &&
      Array.isArray(principal.pagesRead) &&
      principal.pagesRead.length === 28,
    'RTF principal receipt must retain its original 28-page/10-figure workflow'
  );
  for (const [key, value] of Object.entries(principal)) {
    if (key !== 'candidateSha256') {
      requireThat(
        isDeepStrictEqual(evidence[key], value),
        'principal reader evidence changed: ' + key
      );
    }
  }
  requireThat(
    read.figuresInspected === 5 &&
      sameRef(read.rootActualFiveFigureView, binding.archiveKeyIssuance),
    'five RTF inspections need their separate exact ROOT final-view witness'
  );
  const qualification = exactJson(read.actualFigureViewQualification);
  requireThat(
    sameRef(
      qualification.actualPriorGrantedThirteenPageSourceH,
      read.actualReadingH
    ) &&
      isDeepStrictEqual(
        qualification.allThirteenPhysicalSourcePagesPreviouslyActuallyRead,
        read.pages
      ) &&
      qualification.modelViewedDuringThisPreparation === false &&
      qualification.actuallyViewedOnceInPriorGranted13PageSourcePass === true &&
      qualification.newSourceCreditClaimedDuringThisPreparation === false &&
      Array.isArray(qualification.fiveAssets) &&
      qualification.fiveAssets.length === 5,
    'RTF five-asset qualification must retain actual prior full-source views without new credit'
  );
  const figs = candidate?.paper?.documentNotes?.[1]?.figures;
  requireThat(
    Array.isArray(figs) &&
      figs.length === 5 &&
      Array.isArray(rootView.rows) &&
      rootView.rows.length === 5,
    'RTF five final figures must stay in the separate companion document note'
  );
  const pages = [8, 9, 10, 11, 12],
    seen = [];
  for (const asset of qualification.fiveAssets) {
    const page = asset.physicalPage,
      rootRow = rootView.rows.find(row => row.sourcePhysicalPage === page);
    const fig = figs.find(value => value.id === asset.id),
      journalRef = coverage.journalRefs.find(ref =>
        sameRef(ref, asset.priorActualViewJournal)
      );
    requireThat(
      pages.includes(page) &&
        rootRow?.ROOTPersonallyViewed === true &&
        fig &&
        journalRef &&
        asset.modelViewedDuringThisPreparation === false &&
        asset.actuallyViewedOnceInPriorGranted13PageSourcePass === true &&
        isDeepStrictEqual(rootRow.dimensions, [2481, 3508]) &&
        rootRow.dpi === 300 &&
        isDeepStrictEqual(rootRow.pixelRect, [0, 0, 2481, 3508]) &&
        isDeepStrictEqual(rootRow.pdfRect, [0, 0, 595.32, 841.92]),
      'RTF asset is missing its actual source/ROOT view or full-page geometry'
    );
    const journal = exactJson(journalRef);
    requireThat(
      journal.pagePNG?.physicalPage === page &&
        sameRef(journal.pagePNG, rootRow.actualPNG),
      'RTF final asset differs from its actually read original page'
    );
    const saved = exactBytes(asset.fullPagePNG),
      viewed = exactBytes(rootRow.actualPNG);
    requireThat(
      saved.equals(viewed) &&
        saved.length >= 26 &&
        saved
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        saved.readUInt32BE(16) === 2481 &&
        saved.readUInt32BE(20) === 3508 &&
        saved[25] === 2,
      'RTF final PNG must equal the exact actually viewed complete RGB source page'
    );
    requireThat(
      fig.sourceOriginal === 'derivedWord' &&
        fig.source?.document === binding.document &&
        fig.source.page === page &&
        fig.source.dpi === 300 &&
        isDeepStrictEqual(fig.source.pdfRect, rootRow.pdfRect) &&
        fig.width === 2481 &&
        fig.height === 3508 &&
        fig.tx?.document === binding.document &&
        fig.tx.page === page &&
        isDeepStrictEqual(fig.tx.bbox, [0, 0, 1000, 1000]) &&
        isDeepStrictEqual(fig.tx.pixelBox, rootRow.pixelRect) &&
        fig.tx.sha256 === asset.fullPagePNG.sha256 &&
        typeof fig.tx.file === 'string' &&
        !path.isAbsolute(fig.tx.file) &&
        !/[\\\0]/.test(fig.tx.file) &&
        fig.tx.file.split('/').every(p => p && p !== '.' && p !== '..'),
      'RTF candidate final figure is not the exact saved full native Word page'
    );
    exactBytes({
      ...asset.fullPagePNG,
      file: path.join(sourceDirectory, fig.tx.file),
    });
    seen.push(page);
  }
  requireThat(
    isDeepStrictEqual(
      seen.sort((a, b) => a - b),
      pages
    ),
    'RTF final figure view coverage repeats or omits a page'
  );
}
export function nativeWordCompanionFiguresInspected(evidence) {
  return (evidence?.nativeWordCompanionReads || []).reduce(
    (n, read) => n + read.figuresInspected,
    0
  );
}

// This is used only after the native predicate passed; no primary Q/K claim is supplied.
export function nativeWordCompanionPageClaims(evidence) {
  return (evidence?.nativeWordCompanionReads || []).flatMap(read =>
    read.pages.map(page => ({ document: read.document, page }))
  );
}
export function nativeOriginalCoverageFields(evidence) {
  const text = nativeTextCoverageFields(evidence),
    reads = evidence?.nativeWordCompanionReads;
  if (
    !Array.isArray(reads) ||
    !reads.length ||
    reads.some(read => !Array.isArray(read?.pages))
  ) {
    return text;
  }
  return {
    ...text,
    nativeWordCompanionReads: structuredClone(reads),
    nativeWordCompanionDocumentsRead: reads.length,
    nativeWordCompanionPagesRead: reads.reduce(
      (n, read) => n + read.pages.length,
      0
    ),
    nativeWordCompanionFiguresInspected:
      nativeWordCompanionFiguresInspected(evidence),
    principalFiguresInspected: evidence.figuresInspected,
    combinedFiguresInspected:
      evidence.figuresInspected + nativeWordCompanionFiguresInspected(evidence),
  };
}

// With no registered extras and no claims, this preserves the existing stock behavior.
export function nativeOriginalBindingProblems(
  evidence,
  manifest,
  sourceDirectory,
  candidate
) {
  const errors = [],
    bindings = evidence?.nativeOriginalBindings;
  const txt = textRegistration(manifest),
    office = officeRegistration(manifest),
    rtf = rtfRegistration(manifest);
  const rtfDocs = Object.entries(manifest?.documents || {}).filter(
    ([, doc]) =>
      doc?.original?.format === 'rtf' || doc?.converted?.from === 'rtf'
  );
  if (
    rtfDocs.length &&
    (!rtf || rtfDocs.length !== 1 || rtfDocs[0][0] !== 'supplement-3')
  ) {
    errors.push('RTF document needs its exact separate companion registration');
  }
  if (
    Object.values(manifest?.documents || {}).some(doc =>
      /\.txt$/i.test(doc?.key || '')
    )
  ) {
    errors.push(
      'native TXT must remain a separate registered companion, never a zero-page manifest document'
    );
  }
  const expected = [
    ...(txt ? ['instructions'] : []),
    ...(office.length ? ['solutions'] : []),
    ...(rtf ? ['rtfCompanion'] : []),
  ];
  if (
    !expected.length &&
    bindings === undefined &&
    evidence?.nativeTextReads === undefined &&
    evidence?.nativeWordCompanionReads === undefined
  ) {
    return errors;
  }
  if (
    !object(bindings) ||
    !isDeepStrictEqual(Object.keys(bindings).sort(), expected.sort())
  ) {
    errors.push(
      'native original bindings must match every registered TXT/Office/RTF companion, without omissions or extras'
    );
    return errors;
  }
  const attempt = (name, action) => {
    try {
      action();
    } catch (error) {
      errors.push(name + ': ' + error.message);
    }
  };
  if (txt) {
    attempt('instructions', () =>
      checkTxt(
        bindings.instructions,
        evidence.nativeTextReads,
        manifest,
        evidence.reader
      )
    );
  } else if (
    evidence?.nativeTextReads !== undefined &&
    !isDeepStrictEqual(evidence.nativeTextReads, [])
  ) {
    errors.push('native TXT reads must not claim an unregistered companion');
  }
  if (office.length) {
    attempt('solutions', () =>
      checkOffice(bindings.solutions, evidence, manifest, sourceDirectory)
    );
  }
  if (rtf) {
    attempt('rtfCompanion', () =>
      checkRtfCompanion(
        bindings.rtfCompanion,
        evidence,
        manifest,
        sourceDirectory,
        candidate
      )
    );
  } else if (
    evidence?.nativeWordCompanionReads !== undefined &&
    !isDeepStrictEqual(evidence.nativeWordCompanionReads, [])
  ) {
    errors.push('RTF page reads claim an unregistered companion');
  }
  return errors;
}

// Serialization only; these fields certify no success. A failed receipt keeps raw claims in readerEvidence.
export function nativeOriginalReceiptFields(evidence) {
  if (!object(evidence?.nativeOriginalBindings)) return {};
  return {
    nativeOriginalBindings: structuredClone(evidence.nativeOriginalBindings),
    nativeOriginalSourceHashes: Object.fromEntries(
      Object.entries(evidence.nativeOriginalBindings).map(([id, binding]) => [
        id,
        binding?.nativeOriginal?.sha256,
      ])
    ),
    ...(evidence.nativeTextReads !== undefined
      ? { nativeTextReads: structuredClone(evidence.nativeTextReads) }
      : {}),
    ...(evidence.nativeWordCompanionReads !== undefined
      ? {
          nativeWordCompanionReads: structuredClone(
            evidence.nativeWordCompanionReads
          ),
        }
      : {}),
    ...(evidence.nativeOriginalBindings.rtfCompanion?.archiveOriginal
      ? {
          nativeOriginalArchiveHashes: {
            rtfCompanion:
              evidence.nativeOriginalBindings.rtfCompanion.archiveOriginal
                .sha256,
          },
        }
      : {}),
  };
}
export function nativeTextCoverageFields(evidence) {
  if (
    !Array.isArray(evidence?.nativeTextReads) ||
    !evidence.nativeTextReads.length ||
    evidence.nativeTextReads.some(
      read =>
        read?.fullDocument !== true ||
        read.fullReadingPassCount !== 1 ||
        !Number.isSafeInteger(
          evidence?.nativeOriginalBindings?.[read.binding]?.nativeOriginal
            ?.bytes
        )
    )
  ) {
    return {};
  }
  return {
    nativeTextReads: structuredClone(evidence.nativeTextReads),
    nativeTextDocumentsRead: evidence.nativeTextReads.length,
    nativeTextFullReadPasses: evidence.nativeTextReads.reduce(
      (n, read) => n + read.fullReadingPassCount,
      0
    ),
    nativeTextBytesRead: evidence.nativeTextReads.reduce(
      (n, read) =>
        n + evidence.nativeOriginalBindings[read.binding].nativeOriginal.bytes,
      0
    ),
  };
}

// Nominal Q/K rendering remains 160; only the separately proved native companion is 300.
// This reuses the sole native original/conversion/13-page/5-crop predicate above.
export function mixedDocumentRenderDpiProblems(
  evidence,
  manifest,
  sourceDirectory,
  candidate,
  renderWitness
) {
  const errors = nativeOriginalBindingProblems(
    evidence,
    manifest,
    sourceDirectory,
    candidate
  );
  if (errors.length) return errors;
  try {
    if (
      evidence?.nativeOriginalBindings?.solutions?.nativeOriginalKind === 'DOCX'
    ) {
      checkOfficeDocumentRenderDpi(
        evidence,
        manifest,
        sourceDirectory,
        candidate,
        renderWitness
      );
      return errors;
    }
    const roles = [
      'problems',
      'solutions',
      'supplement-1',
      'supplement-2',
      'supplement-3',
    ];
    requireThat(
      manifest?.paperId === 'ipho-1999-experiment-exp' &&
        manifest.renderDpi === 160 &&
        isDeepStrictEqual(
          Object.keys(manifest.documents || {}).sort(),
          [...roles].sort()
        ) &&
        roles
          .slice(0, 4)
          .every(role => manifest.documents[role].renderDpi === 160) &&
        manifest.documents['supplement-3'].renderDpi === 300,
      'mixed DPI requires the unchanged four 160-DPI originals and sole 300-DPI RTF companion'
    );
    const binding = evidence?.nativeOriginalBindings?.rtfCompanion;
    requireThat(
      binding?.document === 'supplement-3' &&
        binding.nativeOriginalKind === 'RTF' &&
        candidate?.paper?.id === manifest.paperId &&
        sameRef(evidence.nativeCompanionRenderWitness, renderWitness),
      'mixed DPI needs its exact candidate and declared native companion render witness'
    );
    const render = exactJson(renderWitness);
    const read = evidence.nativeWordCompanionReads[0],
      coverage = exactJson(read.actualPageCoverage);
    const pages = Array.from({ length: 13 }, (_, i) => i + 1);
    requireThat(
      render.actualExitCode === 0 &&
        render.nativeGeometryPreserved === true &&
        render.noReconstructedGlyphsOrImageEditing === true &&
        sameRtfSourceBinding(render.sourceBinding, binding) &&
        Array.isArray(render.pages) &&
        render.pages.length === 13 &&
        isDeepStrictEqual(
          render.pages.map(page => page.physicalPage).sort((a, b) => a - b),
          pages
        ),
      'mixed DPI render witness must retain the successful exact original thirteen-page RGB rendering'
    );
    const doc = manifest.documents[binding.document];
    requireThat(
      Array.isArray(doc.pageSizes) && doc.pageSizes.length === 13,
      'mixed DPI companion needs all thirteen actual PDF page geometries'
    );
    const byPage = new Map(render.pages.map(page => [page.physicalPage, page]));
    for (const journalRef of coverage.journalRefs) {
      const journal = exactJson(journalRef),
        page = byPage.get(journal.pagePNG?.physicalPage);
      requireThat(
        page &&
          sameRef(journal.renderManifest, renderWitness) &&
          sameRef(journal.pagePNG, page) &&
          page.dpi === 300 &&
          page.mode === 'RGB' &&
          journal.pagePNG.dpi === 300 &&
          journal.pagePNG.mode === 'RGB' &&
          journal.pagePNG.widthPx === page.widthPx &&
          journal.pagePNG.heightPx === page.heightPx,
        'mixed DPI page coverage and native rendering must bind the same exact 300-DPI RGB page'
      );
      const size = doc.pageSizes[page.physicalPage - 1];
      requireThat(
        size?.page === page.physicalPage &&
          Number.isFinite(size.widthPt) &&
          Number.isFinite(size.heightPt) &&
          page.widthPx === Math.ceil((size.widthPt * 300) / 72 - 1e-8) &&
          page.heightPx === Math.ceil((size.heightPt * 300) / 72 - 1e-8),
        'mixed DPI page pixels must match the original PDF geometry at 300 DPI'
      );
      const png = exactBytes(page);
      requireThat(
        png.length >= 29 &&
          png
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          png.toString('ascii', 12, 16) === 'IHDR' &&
          png[24] === 8 &&
          png[25] === 2 &&
          png.readUInt32BE(16) === page.widthPx &&
          png.readUInt32BE(20) === page.heightPx,
        'mixed DPI witness is not the exact preserved complete native RGB PNG'
      );
    }
    // The existing predicate verifies the five candidate frames, file bytes and crop/view coverage.
    // This adds no alternate crop implementation and changes no manifest or candidate value.
  } catch (error) {
    errors.push('mixed native document render DPI: ' + error.message);
  }
  return errors;
}

// Called only after the unchanged native DOCX/conversion/full-journal predicate succeeds.
// Office pages use their existing page journals; they have no RTF render witness.
function checkOfficeDocumentRenderDpi(
  evidence,
  manifest,
  sourceDirectory,
  candidate,
  renderWitness
) {
  const specs = {
    'nao-2023-iii-11-12': {
      pages: 17,
      dpi: 300,
      pngField: 'PNG',
      nativeField: 'nativeOriginalDOCX',
    },
    'nao-2023-iii-7-8': {
      pages: 16,
      dpi: 250,
      pngField: 'png',
      nativeField: 'originalNativeDOCX',
    },
  };
  const spec = specs[manifest?.paperId],
    doc = manifest?.documents?.solutions;
  requireThat(
    spec &&
      manifest.renderDpi === 160 &&
      candidate?.paper?.id === manifest.paperId &&
      isDeepStrictEqual(Object.keys(manifest.documents || {}).sort(), [
        'problems',
        'solutions',
      ]) &&
      manifest.documents.problems.renderDpi === 160 &&
      doc.renderDpi === spec.dpi &&
      doc.pages === spec.pages,
    'mixed Office DPI requires the exact native solutions pages and unchanged 160-DPI question document'
  );
  requireThat(
    renderWitness === undefined &&
      evidence.nativeCompanionRenderWitness === undefined,
    'Office mixed DPI must use its actual native page journal, without an invented render witness'
  );
  const binding = evidence.nativeOriginalBindings.solutions;
  requireThat(
    binding.role === 'solutions' &&
      binding.nativeOriginalKind === 'DOCX' &&
      binding.actualNativeJournalSelector === '/viewedPagesNew',
    'mixed Office DPI requires the existing native DOCX solutions binding'
  );
  const journal = exactJson(binding.actualReadingJournal);
  const rows = journal.viewedPagesNew.filter(row => row.role === 'solutions');
  const expected = Array.from({ length: spec.pages }, (_, i) => i + 1);
  const paths = expected.map(
    page =>
      'actual-reader-pages/solutions-' + String(page).padStart(2, '0') + '.png'
  );
  requireThat(
    isDeepStrictEqual(
      rows.map(row => row.page),
      expected
    ) &&
      isDeepStrictEqual(doc.pageImages, paths) &&
      Array.isArray(doc.pageSizes) &&
      doc.pageSizes.length === spec.pages,
    'mixed Office DPI needs every actual key page once in order, with its exact staged page-image path'
  );
  for (const [index, row] of rows.entries()) {
    const size = doc.pageSizes[index],
      png = row[spec.pngField],
      native = row[spec.nativeField];
    const width = spec.pngField === 'PNG' ? png?.width : row.width;
    const height = spec.pngField === 'PNG' ? png?.height : row.height;
    requireThat(
      size?.page === row.page &&
        size.widthPt === 612 &&
        size.heightPt === 792 &&
        isDeepStrictEqual(row.rectPt, [0, 0, size.widthPt, size.heightPt]) &&
        row.dpi === spec.dpi &&
        width === Math.ceil((size.widthPt * spec.dpi) / 72 - 1e-8) &&
        height === Math.ceil((size.heightPt * spec.dpi) / 72 - 1e-8) &&
        (spec.pngField === 'PNG'
          ? row.colorspace === 'RGB' &&
            row.alpha === false &&
            row.png === undefined &&
            row.originalNativeDOCX === undefined &&
            (row.rotationDegrees === undefined || row.rotationDegrees === 0)
          : row.rotationDegrees === 0 &&
            row.PNG === undefined &&
            row.nativeOriginalDOCX === undefined),
      'mixed Office DPI page metadata must retain its exact complete native PDF geometry and original field spelling'
    );
    requireThat(
      row.nativeOriginalKind === 'DOCX' &&
        row.personallyOpened === true &&
        row.actualReader === journal.actualReader &&
        journal.actualReader === evidence.reader?.requestId &&
        journal.model === evidence.reader?.model &&
        journal.reasoningEffort === 'ultra' &&
        sameRef(row.source, binding.derivedPDF) &&
        sameRef(native, binding.nativeOriginal) &&
        sameRef(row.actualConversionLineage, binding.actualLineage) &&
        row.notOriginallyPrintedNativePDF === true,
      'mixed Office DPI page must bind the recorded reader, original DOCX, derived PDF and actual conversion'
    );
    const raw = exactBytes(png);
    requireThat(
      raw.length >= 33 &&
        raw
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        raw.readUInt32BE(8) === 13 &&
        raw.toString('ascii', 12, 16) === 'IHDR' &&
        raw[24] === 8 &&
        raw[25] === 2 &&
        raw[26] === 0 &&
        raw[27] === 0 &&
        raw[28] === 0 &&
        raw.readUInt32BE(16) === width &&
        raw.readUInt32BE(20) === height,
      'mixed Office DPI saved page is not the exact complete native RGB PNG'
    );
    const staged = exactBytes({
      file: path.join(sourceDirectory, paths[index]),
      sha256: png.sha256,
      bytes: png.bytes,
    });
    requireThat(
      raw.equals(staged),
      'mixed Office DPI staged page bytes differ from the actually opened native PNG'
    );
  }
}
