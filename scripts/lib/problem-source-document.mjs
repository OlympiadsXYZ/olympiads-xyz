// Explicit manual navigation may select only an already registered original.
// No scientific fields, source references or schema are changed by this helper.
export function sourceDocumentFor(paper, problem, role, overlay = {}) {
  if (!['problems', 'solutions'].includes(role)) {
    throw new Error(`Unknown source navigation role: ${role}`);
  }
  const original = role === 'problems' ? paper.source : paper.solutionSource;
  const pinned = overlay?.[problem?.id]?.[role];
  const document = pinned?.document;
  // Existing pins retain their exact original source selection and priority.
  if (document === undefined || document === role) {
    return { document: role, source: original };
  }
  if (
    role !== 'solutions' ||
    pinned.via !== 'manual' ||
    typeof document !== 'string'
  ) {
    throw new Error(
      `A named key document requires an explicit manual solution pin: ${problem?.id}`
    );
  }
  const source = Object.hasOwn(paper.supplementarySources || {}, document)
    ? paper.supplementarySources[document]
    : null;
  if (!source?.archiveKey) {
    throw new Error(
      `Unregistered original key document ${document}: ${problem?.id}`
    );
  }
  if (
    !Number.isInteger(pinned.page) ||
    pinned.page < 1 ||
    !Array.isArray(source.pages) ||
    !source.pages.includes(pinned.page)
  ) {
    throw new Error(
      `Key page is outside the registered original scope ${document}: ${problem?.id}`
    );
  }
  return { document, source };
}
