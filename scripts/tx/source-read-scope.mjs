import {isDeepStrictEqual} from 'node:util';

export function readScopeErrors(scope, pages) {
  if (!scope || Object.keys(scope).some(key => !['pages','reason'].includes(key)) || typeof scope.reason !== 'string' || !scope.reason.trim()
    || !Array.isArray(scope.pages) || !scope.pages.length
    || scope.pages.some((p, i) => !Number.isInteger(p) || p < 1 || p > pages || (i > 0 && p <= scope.pages[i - 1]))) {
    return ['read scope needs sorted distinct original page numbers within the document and a source-boundary reason'];
  }
  return [];
}

export function sourceReadScopes(manifest) {
  return Object.fromEntries(Object.entries(manifest.documents || {}).filter(([, doc]) => doc.readScope)
    .map(([id, doc]) => [id, {archiveKey: doc.key, sourceSha256: doc.sha256, totalPages: doc.pages, ...structuredClone(doc.readScope)}]));
}

export function sourceReadScopeProblems(manifest, candidate, recorded) {
  const errors = [];
  const scopes = sourceReadScopes(manifest);
  if (recorded !== undefined && !isDeepStrictEqual(recorded, scopes)) errors.push('prepared source read scope differs from the recorded scope');
  for (const [id, doc] of Object.entries(manifest.documents || {})) {
    if (!doc.readScope) continue;
    const invalid = readScopeErrors(doc.readScope, doc.pages);
    if (invalid.length) { errors.push(...invalid.map(x => `${id}: ${x}`)); continue; }
    const source = id === 'problems' ? candidate.paper?.source : id === 'solutions' ? candidate.paper?.solutionSource : candidate.paper?.supplementarySources?.[id];
    if (source?.archiveKey !== doc.key || !isDeepStrictEqual(source?.pages, doc.readScope.pages)) {
      errors.push(`${id}: paper source must cite exactly the prepared read scope using original page numbers`);
    }
    const allowed = new Set(doc.readScope.pages);
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (value.document === id && Number.isInteger(value.page) && !allowed.has(value.page)) errors.push(`${id}: candidate references page ${value.page} outside its prepared read scope`);
      for (const child of Object.values(value)) visit(child);
    };
    visit(candidate);
  }
  return errors;
}
