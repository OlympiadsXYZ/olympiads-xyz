// A source repair may regroup problems, but must not silently remove bookmarks.
// Cross-paper retirement uses publication.mjs supersede; --replace retains IDs
// locally as real problems or aliases directly to surviving native sections.
export function assertPromotionNotRetired(
  paperId,
  publicationEntry,
  existingPapers = []
) {
  if (publicationEntry?.supersededBy)
    throw new Error(
      `${paperId} was source-reconciled into ${publicationEntry.supersededBy}; preserve its existing redirects and promote the canonical replacement instead.`
    );
  if (publicationEntry?.consolidatedProblems?.length)
    throw new Error(
      `${paperId} contains source-reconciled duplicate tasks; update its exact consolidation evidence before replacing this compilation.`
    );
  for (const stored of existingPapers) {
    if (['withdrawn', 'quarantined'].includes(stored?.paper?.status))
      throw new Error(
        `${paperId} is ${stored.paper.status}; its recorded source decision must be resolved before any candidate replaces its bytes.`
      );
  }
}

export function assertReplacementLinks(previous, replacement) {
  const problems = replacement.problems || [];
  const retained = new Set(problems.map(p => p.id));
  for (const problem of problems) {
    for (const alias of problem.aliases || []) {
      if (retained.has(alias.id))
        throw new Error(
          `Replacement alias conflicts with a problem or another alias: ${alias.id}`
        );
      if (
        alias.sectionId != null &&
        !problem.sections?.some(section => section.id === alias.sectionId)
      ) {
        throw new Error(
          `Replacement alias ${alias.id} targets missing section ${alias.sectionId}`
        );
      }
      retained.add(alias.id);
    }
  }
  const missing = [];
  for (const problem of previous.problems || []) {
    for (const id of [
      problem.id,
      ...(problem.aliases || []).map(alias => alias.id),
    ]) {
      if (!retained.has(id)) missing.push(id);
    }
  }
  if (missing.length) {
    throw new Error(
      `Replacement would remove existing problem links: ${[
        ...new Set(missing),
      ].join(
        ', '
      )}. Retain each ID as a problem or an explicit alias on a surviving problem.`
    );
  }
}
