import { allFigures } from './lib.mjs';
import { sourceReadScopeProblems } from './source-read-scope.mjs';

// This checks the completeness of a reader's claim, not transcription accuracy.
// Single-pass receipts never claim an independent source comparison.
export function singlePassEvidenceProblems(evidence, candidate, manifest, hash) {
  const errors = [];
  if (evidence?.candidateSha256 !== hash) errors.push('reader evidence names different candidate bytes');
  const who = evidence?.reader;
  const known = who?.provider && who?.model && !/unknown|unspecified/i.test(who.model) && who?.requestId;
  if (!known) errors.push('reader evidence must identify the source reader');
  const same = person => person?.provider === who?.provider && person?.model === who?.model && person?.requestId === who?.requestId;
  if (!same(candidate.tx?.reader) && !same(candidate.tx?.adjudicator)) errors.push('evidence reader does not match candidate reader or adjudicator');
  errors.push(...sourceReadScopeProblems(manifest, candidate, evidence?.sourceReadScopes || {}));
  const expected = new Set(Object.entries(manifest.documents).flatMap(([document, d]) => (Array.isArray(d.readScope?.pages) ? d.readScope.pages : Array.from({ length: d.pages }, (_, i) => i + 1)).map(page => `${document}:${page}`)));
  const seen = new Set();
  if (!Array.isArray(evidence?.pagesRead)) errors.push('reader pagesRead must be an array');
  else for (const p of evidence.pagesRead) {
    const key = `${p?.document}:${p?.page}`;
    if (!Number.isInteger(p?.page) || !expected.has(key)) errors.push(`reader claims unknown page ${key}`);
    if (seen.has(key)) errors.push(`reader repeats page ${key}`);
    seen.add(key);
  }
  const missing = [...expected].filter(p => !seen.has(p));
  if (missing.length) errors.push(`reader has not covered source pages: ${missing.join(', ')}`);
  if (evidence?.problemsRead !== candidate.problems.length) errors.push('reader problemsRead does not match candidate');
  if (evidence?.figuresInspected !== allFigures(candidate).length) errors.push('reader figuresInspected does not match candidate');
  if (typeof evidence?.summary !== 'string' || !evidence.summary.trim()) errors.push('reader summary is required');
  if (!Array.isArray(evidence?.sourceGaps) || evidence.sourceGaps.some(gap => typeof gap !== 'string' || !gap.trim())) errors.push('reader sourceGaps must be an explicit array of descriptions');
  return errors;
}
