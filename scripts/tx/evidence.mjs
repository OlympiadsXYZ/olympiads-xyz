// Structural checks for verification evidence. These cannot establish that the
// model actually read a page; they prevent incomplete/malformed claims passing.
import { allFigures } from './lib.mjs';
import path from 'node:path';

// Evidence files name each other by the absolute paths task.mjs printed on the
// machine that wrote them; the same bundle is inventoried elsewhere (Mac -> PC),
// so two paths are the same file when their repo-relative tail below tmp/ agrees.
export function evidenceKey(file, root) {
  if (typeof file !== 'string' || !file) return '';
  const posix = file.replace(/\\/g, '/');
  const i = posix.lastIndexOf('/tmp/');
  if (i >= 0) return posix.slice(i + 1);
  if (posix.startsWith('tmp/')) return posix;
  return path.resolve(root, file).replace(/\\/g, '/');
}

export function checkerEvidenceProblems(check, candidate, manifest, candidateSha256) {
  const errors = [];
  const claimed = check?.candidateSha256 || check?.checker?.candidateSha256;
  if (!claimed) errors.push('checker output does not state candidateSha256');
  else if (claimed !== candidateSha256) errors.push('checker checked different candidate bytes: candidateSha256 mismatch');
  if (check?.checker?.candidateSha256 && check.checker.candidateSha256 !== candidateSha256) errors.push('checker transport candidateSha256 mismatch');
  if (!['pass', 'fail', 'escalate'].includes(check?.verdict)) errors.push('checker verdict must be pass, fail or escalate');
  if (typeof check?.summary !== 'string' || !check.summary.trim()) errors.push('checker summary is missing');
  const expected = new Set(Object.entries(manifest.documents).flatMap(([document, d]) => Array.from({ length: d.pages }, (_, i) => `${document}:${i + 1}`)));
  const seen = new Set();
  if (!Array.isArray(check?.coverage?.pagesRead)) errors.push('checker coverage.pagesRead must be an array');
  else for (const p of check.coverage.pagesRead) {
    const key = `${p?.document}:${p?.page}`;
    if (!Number.isInteger(p?.page) || !expected.has(key)) errors.push(`checker claims an unknown page ${key}`);
    if (seen.has(key)) errors.push(`checker repeats coverage of ${key}`);
    seen.add(key);
  }
  const missing = [...expected].filter(p => !seen.has(p));
  if (missing.length) errors.push(`checker has not covered ${missing.length} source page(s): ${missing.join(', ')}`);
  if (check?.coverage?.problemsChecked !== candidate.problems.length) errors.push('checker problemsChecked does not match the candidate');
  if (check?.coverage?.figuresChecked !== allFigures(candidate).length) errors.push('checker figuresChecked does not match the candidate');
  if (!Array.isArray(check?.defects)) errors.push('checker defects must be an array (missing is not empty)');
  else {
    for (const [i, d] of check.defects.entries()) {
      if (!d || !['critical', 'major', 'minor', 'info'].includes(d.severity)) errors.push(`checker defect ${i} has an invalid severity`);
      if (typeof d?.path !== 'string' || !d.path.startsWith('/')) errors.push(`checker defect ${i} has no JSON pointer`);
      if (typeof d?.description !== 'string' || !d.description.trim()) errors.push(`checker defect ${i} has no description`);
      if (!['omission', 'wrong-value', 'wrong-unit', 'reworded', 'latex', 'table', 'figure', 'points', 'metadata', 'pairing', 'source-error', 'other'].includes(d?.kind)) errors.push(`checker defect ${i} has an invalid kind`);
      if (!Number.isInteger(d?.page) || !expected.has(`${d?.document}:${d?.page}`)) errors.push(`checker defect ${i} has no valid source page`);
      if (typeof d?.confidence !== 'number' || d.confidence < 0 || d.confidence > 1) errors.push(`checker defect ${i} has an invalid confidence`);
    }
    if (check.verdict === 'pass' && check.defects.some(d => d?.severity !== 'info')) errors.push('checker says pass while listing defects');
  }
  return errors;
}

// Binding is transport metadata. A model cannot calculate the file hash from
// its sanitised view, and its echoed string is never the source of authority.
export function bindCheckerResult(result, identity) {
  const claimed = result.candidateSha256;
  return {
    ...result,
    ...(claimed && claimed !== identity.candidateSha256 ? { modelClaimedCandidateSha256: claimed } : {}),
    candidateSha256: identity.candidateSha256,
    checker: identity,
  };
}

export function adjudicationEvidenceProblems(adjudication, candidates, checks, root) {
  const errors = [];
  if (!adjudication || !Array.isArray(adjudication.candidates)) return ['adjudication is missing or incomplete'];
  const resolved = file => evidenceKey(file, root);
  for (const c of candidates) {
    const matches = adjudication.candidates.filter(a => resolved(a.view) === resolved(c.view));
    if (matches.length !== 1) { errors.push(`need exactly one adjudication for ${c.view}`); continue; }
    const a = matches[0];
    if (a.candidateSha256 !== c.sha256) errors.push(`adjudication names stale candidate bytes: ${c.view}`);
    if (!Array.isArray(a.defects) || !['pass', 'fail'].includes(a.verdict)) errors.push(`incomplete candidate verdict: ${c.view}`);
    else {
      for (const d of a.defects) if (!['critical', 'major', 'minor'].includes(d.severity) || !d.path || !d.description) errors.push(`malformed adjudicated defect: ${c.view}`);
      // A historical adjudicator used "pass" to mean only cosmetic defects.
      // The report can safely tighten that to fail from its explicit list.
      // The reverse (fail with no explanation) is incomplete evidence.
      if (a.verdict === 'fail' && !a.defects.length) errors.push(`adjudication says fail without explaining defects: ${c.view}`);
    }
  }
  if (adjudication.candidates.length !== candidates.length) errors.push('adjudication candidate count differs from available inputs');
  if (!Array.isArray(adjudication.checkerFindings)) return [...errors, 'checker findings are missing'];
  const expected = new Set();
  for (const check of checks) {
    if (!Array.isArray(check.data?.defects)) { errors.push(`checker defects unavailable: ${check.file}`); continue; }
    check.data.defects.forEach((_, i) => expected.add(`${resolved(check.file)}#${i}`));
  }
  const seen = new Set();
  for (const f of adjudication.checkerFindings) {
    const key = `${resolved(f.check)}#${f.index}`;
    if (!Number.isInteger(f.index) || !expected.has(key)) errors.push(`unknown checker finding: ${key}`);
    if (seen.has(key)) errors.push(`duplicate checker finding: ${key}`);
    if (typeof f.truePositive !== 'boolean' || !f.note) errors.push(`unsettled checker finding: ${key}`);
    seen.add(key);
  }
  for (const key of expected) if (!seen.has(key)) errors.push(`missing checker adjudication: ${key}`);
  if (!Array.isArray(adjudication.escalations)) errors.push('escalations must be explicitly listed');
  return errors;
}
