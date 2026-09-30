import path from 'node:path';
import { readJson, publicationState } from './problem-data.mjs';

// Editorial source correspondence is kept apart from transcription receipts:
// retiring a duplicate does not re-label unchanged text as newly model-reviewed.
export function validateConsolidations(
  config,
  records,
  ledger,
  { beforeRetirement = false } = {}
) {
  if (config?.version !== 1 || !Array.isArray(config.papers))
    throw Error('Invalid problem-consolidations config');
  const byPaper = new Map(records.map(r => [r.data.paper.id, r]));
  const retiring = new Set(
    config.papers
      .filter(e => (e.mode || 'paper') === 'paper')
      .map(e => e.paperId)
  );
  const retiredProblemIds = new Set(
      config.papers.flatMap(e => (e.problemMappings || []).map(m => m.fromId))
    ),
    seen = new Set(),
    seenProblems = new Set(),
    additions = new Map();
  for (const entry of config.papers) {
    const old = byPaper.get(entry.paperId),
      target = byPaper.get(entry.canonicalPaperId);
    const mode = entry.mode || 'paper',
      key = entry.paperId + '|' + entry.canonicalPaperId;
    if (
      !['paper', 'problems'].includes(mode) ||
      !old ||
      !target ||
      old === target ||
      seen.has(key)
    )
      throw Error('Invalid consolidation paper ' + entry.paperId);
    seen.add(key);
    if (
      old.contentHash !== entry.contentHash ||
      target.contentHash !== entry.canonicalContentHash
    )
      throw Error('Stale consolidation content hash ' + entry.paperId);
    if (
      retiring.has(entry.canonicalPaperId) ||
      !publicationState(target, ledger).eligible
    )
      throw Error(
        'Consolidation target is not a final eligible paper ' +
          entry.canonicalPaperId
      );
    const previous = ledger.papers?.[entry.paperId];
    if (!previous || previous.contentHash !== old.contentHash)
      throw Error(
        'Consolidation has no exact former publication record ' + entry.paperId
      );
    if (
      previous.supersededBy &&
      previous.supersededBy !== entry.canonicalPaperId
    )
      throw Error('Conflicting retirement ' + entry.paperId);
    if (
      !beforeRetirement &&
      mode === 'paper' &&
      previous.supersededBy !== entry.canonicalPaperId
    )
      throw Error('Consolidation not explicitly retired ' + entry.paperId);
    const audit = entry.sourceAudit;
    if (
      !entry.reason?.trim() ||
      !audit?.reader?.provider ||
      !audit?.reader?.model ||
      !audit?.reader?.requestId ||
      !audit.at ||
      !/^[a-f0-9]{64}$/.test(audit.evidenceSha256 || '') ||
      !Array.isArray(audit.sourceReferences) ||
      !audit.sourceReferences.length
    )
      throw Error('Missing source correspondence evidence ' + entry.paperId);
    for (const source of audit.sourceReferences) {
      if (
        !source.archiveKey ||
        !/^[a-f0-9]{64}$/.test(source.sha256 || '') ||
        !Array.isArray(source.pagesRead) ||
        !source.pagesRead.length ||
        source.pagesRead.some(p => !Number.isInteger(p) || p < 1)
      )
        throw Error('Invalid original source reference ' + entry.paperId);
    }
    if (
      !Array.isArray(entry.problemMappings) ||
      !entry.problemMappings.length ||
      (mode === 'paper' &&
        entry.problemMappings.length !== old.data.problems.length)
    )
      throw Error(
        'Consolidation must preserve every former problem ' + entry.paperId
      );
    const fromIds = new Set(),
      targetProblems = new Map(target.data.problems.map(p => [p.id, p]));
    for (const mapping of entry.problemMappings) {
      const problem = targetProblems.get(mapping.toId);
      if (
        fromIds.has(mapping.fromId) ||
        seenProblems.has(mapping.fromId) ||
        !old.data.problems.some(p => p.id === mapping.fromId) ||
        !problem ||
        retiredProblemIds.has(mapping.toId)
      )
        throw Error('Invalid consolidation problem mapping ' + entry.paperId);
      fromIds.add(mapping.fromId);
      seenProblems.add(mapping.fromId);
      if (
        !beforeRetirement &&
        mode === 'problems' &&
        !previous.consolidatedProblems?.some(
          m =>
            m.fromId === mapping.fromId &&
            m.toId === mapping.toId &&
            m.canonicalContentHash === entry.canonicalContentHash &&
            m.sourceContentHash === entry.contentHash &&
            m.sectionId === mapping.sectionId
        )
      )
        throw Error(
          'Problem consolidation not explicitly recorded ' + mapping.fromId
        );
      if (
        mapping.sectionId != null &&
        !problem.sections?.some(s => s.id === mapping.sectionId)
      )
        throw Error('Missing consolidation target section ' + mapping.toId);
      const aliases = additions.get(mapping.toId) || [];
      aliases.push({
        id: mapping.fromId,
        ...(mapping.sectionId != null ? { sectionId: mapping.sectionId } : {}),
      });
      additions.set(mapping.toId, aliases);
    }
  }
  return additions;
}

export function readConsolidations(root, records, ledger, options) {
  const config = readJson(
    path.join(root, 'content/problem-consolidations.json'),
    { version: 1, papers: [] }
  );
  return {
    config,
    aliases: validateConsolidations(config, records, ledger, options),
    retiredProblemIds: new Set(
      config.papers.flatMap(e => e.problemMappings.map(m => m.fromId))
    ),
  };
}
