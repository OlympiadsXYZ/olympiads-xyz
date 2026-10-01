import fs from 'node:fs';
import path from 'node:path';
import { publicationState, sha256 } from './problem-data.mjs';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOST = 'pub-43290baaaff14857b5dd59610ea438c7.r2.dev';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(message) { throw new Error('problem-media: ' + message); }
function fields(value, expected, label) {
  if (!object(value) || Object.keys(value).some(key => !expected.includes(key)) || expected.some(key => !(key in value))) fail('invalid ' + label + ' fields');
}
function hash(value, label) { if (!HASH.test(value || '')) fail('invalid ' + label + ' SHA256'); }
function relativeFile(value) {
  if (typeof value !== 'string' || !value || /[\\\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..') || /^[a-z]:/i.test(value)) fail('unsafe evidence file');
  return value;
}
function assetUrl(value, paperId, digest, extension) {
  hash(digest, 'asset');
  let url;
  try { url = new URL(value); } catch { fail('invalid media URL'); }
  if (typeof value !== 'string' || url.href !== value || url.protocol !== 'https:' || url.hostname !== HOST || url.port || url.username || url.password || url.search || url.hash || url.pathname !== `/problems/${paperId}/media/${digest}.${extension}`) fail('unsafe or unbound media URL');
}
function archiveKey(value) {
  if (typeof value !== 'string' || !value || /[\\\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) fail('unsafe original archive key');
}
function validateEvidence(entry, proof) {
  if (!proof || proof.sha256 !== entry.provenance.evidence.sha256 || proof.data?.paperId !== entry.paperId || !Array.isArray(proof.data.entries)) fail('missing or stale source evidence');
  const rows = proof.data.entries.filter(row => row.problemId === entry.problemId && row.question === entry.provenance.question);
  const original = rows.find(row => row.kind === 'native-original');
  const browser = rows.find(row => row.kind === 'browser-compatible');
  for (const [row, source, mime] of [[original, entry.nativeOriginal, 'video/x-ms-wmv'], [browser, entry, 'video/webm']]) {
    if (!row || row.url !== source.url || row.sha256 !== source.sha256 || row.publicStatus !== 200 || row.publicSha256 !== source.sha256 || row.contentType !== mime || row.originalArchiveKey !== entry.nativeOriginal.archiveKey || row.nativeOriginal?.sha256 !== entry.nativeOriginal.sha256) fail('media/source proof mismatch');
  }
  if (browser.videoFrameEquality?.visualDecodedYuv420PixelsEqualEveryFrame !== true || browser.videoFrameEquality.count !== entry.provenance.videoFrames.count || browser.audioNativeBytesRetained !== true || browser.audioDerivativeEncoding !== 'Opus128kbps, not native byte identity') fail('conversion evidence mismatch');
}

/** Validate an editorial overlay against exact, eligible canonical problem ownership. */
export function validateProblemMedia(config, records, ledger, { retiredProblemIds = new Set(), evidenceByFile = new Map() } = {}) {
  fields(config, ['version', 'problems'], 'config');
  if (config.version !== 1 || !object(config.problems)) fail('expected version 1 and problems map');
  const owners = new Map();
  for (const record of records) for (const problem of record.data.problems) {
    if (owners.has(problem.id)) fail('ambiguous problem owner ' + problem.id);
    owners.set(problem.id, { record, problem });
  }
  const result = new Map(), seenMedia = new Set();
  for (const [problemId, entries] of Object.entries(config.problems)) {
    const owner = owners.get(problemId);
    if (!ID.test(problemId) || !owner || retiredProblemIds.has(problemId) || !publicationState(owner.record, ledger).eligible) fail('unknown, retired or unpublished problem ' + problemId);
    if (!Array.isArray(entries) || entries.length === 0) fail('empty media list ' + problemId);
    const { record, problem } = owner, paper = record.data.paper;
    for (const entry of entries) {
      fields(entry, ['id', 'paperId', 'paperContentHash', 'problemId', 'kind', 'role', 'url', 'mimeType', 'sha256', 'caption', 'width', 'height', 'nativeOriginal', 'provenance'], 'video');
      if (!ID.test(entry.id) || seenMedia.has(entry.id)) fail('duplicate or unsafe media id');
      seenMedia.add(entry.id);
      hash(entry.paperContentHash, 'paper');
      if (entry.paperId !== paper.id || entry.problemId !== problemId || entry.paperContentHash !== record.contentHash || entry.kind !== 'video' || entry.role !== 'statement' || entry.mimeType !== 'video/webm') fail('wrong source owner, role or MIME');
      if (typeof entry.caption !== 'string' || !entry.caption.trim() || /[\x00-\x1f]/.test(entry.caption) || !Number.isInteger(entry.width) || !Number.isInteger(entry.height) || entry.width <= 0 || entry.height <= 0 || entry.width > 8192 || entry.height > 8192) fail('invalid video caption or dimensions');
      assetUrl(entry.url, paper.id, entry.sha256, 'webm');
      fields(entry.nativeOriginal, ['archiveKey', 'url', 'mimeType', 'sha256'], 'native original');
      archiveKey(entry.nativeOriginal.archiveKey);
      if (entry.nativeOriginal.mimeType !== 'video/x-ms-wmv' || !entry.nativeOriginal.archiveKey.endsWith('.wmv')) fail('invalid native original MIME');
      assetUrl(entry.nativeOriginal.url, paper.id, entry.nativeOriginal.sha256, 'wmv');
      fields(entry.provenance, ['kind', 'question', 'sourceDocumentArchiveKey', 'sourcePdfSha256', 'evidence', 'videoFrames', 'audio', 'sourceGap'], 'provenance');
      const provenance = entry.provenance;
      hash(provenance.sourcePdfSha256, 'source PDF');
      if (provenance.kind !== 'browser-compatible-copy' || provenance.question !== problem.number || provenance.sourceDocumentArchiveKey !== paper.source?.archiveKey || provenance.sourcePdfSha256 !== paper.transcription?.sourceSha256?.problems || path.posix.dirname(entry.nativeOriginal.archiveKey) !== path.posix.dirname(provenance.sourceDocumentArchiveKey)) fail('wrong question or original provenance');
      fields(provenance.evidence, ['file', 'sha256'], 'evidence');
      relativeFile(provenance.evidence.file); hash(provenance.evidence.sha256, 'evidence');
      fields(provenance.videoFrames, ['unchanged', 'count'], 'video frame provenance');
      if (provenance.videoFrames.unchanged !== true || !Number.isInteger(provenance.videoFrames.count) || provenance.videoFrames.count < 1) fail('unproven video frames');
      fields(provenance.audio, ['nativeOriginalRetained', 'derivativeEncoding', 'nativeByteIdentity', 'personallyHeard'], 'audio provenance');
      if (provenance.audio.nativeOriginalRetained !== true || provenance.audio.derivativeEncoding !== 'opus' || provenance.audio.nativeByteIdentity !== false || provenance.audio.personallyHeard !== false || typeof provenance.sourceGap !== 'string' || !provenance.sourceGap.trim()) fail('invalid audio/source qualification');
      if (!problem.statement?.includes(entry.url) || !problem.statement?.includes(entry.nativeOriginal.url)) fail('media is not bound to the owned statement links');
      validateEvidence(entry, evidenceByFile.get(provenance.evidence.file));
    }
    result.set(problemId, entries);
  }
  return result;
}

/** Builds are offline: validate frozen GET/provenance evidence, never fetch during generation. */
export function readProblemMedia(root, records, ledger, options = {}) {
  const file = path.join(root, 'content/problem-media.json');
  if (!fs.existsSync(file)) return new Map();
  const config = JSON.parse(fs.readFileSync(file, 'utf8')), evidenceByFile = new Map();
  // Shape validation occurs before any untrusted evidence path can reach the filesystem.
  if (config?.version !== 1 || !object(config.problems)) fail('invalid media config');
  for (const entries of Object.values(config.problems)) {
    if (!Array.isArray(entries)) fail('invalid media list');
    for (const entry of entries) {
      const evidence = entry?.provenance?.evidence;
      relativeFile(evidence?.file); hash(evidence?.sha256, 'evidence');
      if (!evidenceByFile.has(evidence.file)) {
        const bytes = fs.readFileSync(path.join(root, evidence.file));
        evidenceByFile.set(evidence.file, { sha256: sha256(bytes), data: JSON.parse(bytes.toString('utf8')) });
      }
    }
  }
  return validateProblemMedia(config, records, ledger, { ...options, evidenceByFile });
}

const expression = value => JSON.stringify(value).replace(/</g, '\\u003c');
/** Only validated entries reach generation; JSON expressions keep captions out of executable JSX. */
export function problemVideoMarkdown(entry) {
  return `<ProblemVideo mediaId={${expression(entry.id)}} src={${expression(entry.url)}} mimeType={${expression(entry.mimeType)}} caption={${expression(entry.caption)}} originalUrl={${expression(entry.nativeOriginal.url)}} originalFilename={${expression(path.posix.basename(entry.nativeOriginal.archiveKey))}} width={${entry.width}} height={${entry.height}} />`;
}
export function problemMediaLines(problemId, media = new Map()) {
  return (media.get(problemId) || []).flatMap(entry => [problemVideoMarkdown(entry), '']);
}
