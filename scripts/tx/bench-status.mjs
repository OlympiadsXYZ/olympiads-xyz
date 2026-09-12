#!/usr/bin/env node
// Inventory and score actual adjudication evidence. Partial truth files never
// become references. This is model-adjudicated evidence, not human gold.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, parseArgs, writeJson, sha256File, isPrimaryCandidate, readRuns, paperDir } from './lib.mjs';
import { checkerEvidenceProblems, adjudicationEvidenceProblems, bindCheckerResult } from './evidence.mjs';

const args = parseArgs(process.argv.slice(2));
const fixturesFile = path.resolve(args.fixtures || 'tmp/bench/fixtures.json');
const benchDir = path.dirname(fixturesFile);
const outDir = path.resolve(args['out-dir'] || path.join(benchDir, 'results'));
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const rel = file => path.relative(ROOT, file);
const fixtures = read(fixturesFile);
if (!Array.isArray(fixtures)) throw new Error('fixtures must be an array');
const validate = (file, id, manifest) => {
  if (!fs.existsSync(file)) return { ok: false, errors: [{ message: 'file missing' }] };
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts/tx/validate.mjs'), file, '--paper-id', id, '--manifest', manifest], { encoding: 'utf8' });
  try { return JSON.parse(run.stdout); } catch { return { ok: false, errors: [{ message: run.stderr || 'validator did not return JSON' }] }; }
};
const reports = [];
const readyFixtures = [];
for (const fx of fixtures) {
  const id = fx.paperId, dir = paperDir(id), manifestFile = path.join(dir, 'manifest.json');
  const manifest = read(manifestFile);
  if (!manifest) { reports.push({ paperId: id, blockers: ['manifest missing'], candidates: [], checks: [], complete: false }); continue; }
  const blockers = [];
  const sourceHashes = {};
  for (const [doc, d] of Object.entries(manifest.documents)) {
    const source = path.join(dir, d.file);
    sourceHashes[doc] = fs.existsSync(source) ? sha256File(source) : null;
    if (sourceHashes[doc] !== d.sha256) blockers.push(`${doc} PDF missing or changed since preparation`);
  }
  const candidateDir = path.join(dir, 'candidates');
  const candidates = fs.readdirSync(candidateDir).filter(isPrimaryCandidate).sort().map(name => {
    const original = path.join(candidateDir, name), figs = original.replace(/\.json$/, '.figs.json');
    const file = fs.existsSync(figs) ? figs : original;
    const data = read(original), selected = read(file);
    const validation = validate(original, id, manifestFile);
    return { name: name.replace(/\.json$/, ''), model: data?.tx?.reader?.model || name, provider: data?.tx?.reader?.provider || 'unknown', file: rel(file), original: rel(original), view: rel(file.replace(/\.json$/, '.view.json')), sha256: sha256File(file), originalSha256: sha256File(original), validation: { ok: validation.ok, errors: validation.errors }, data: selected };
  });
  const checkDir = path.join(dir, 'checks');
  const checks = (fs.existsSync(checkDir) ? fs.readdirSync(checkDir).filter(n => n.endsWith('.json')) : []).sort().map(name => {
    const file = path.join(checkDir, name), data = read(file);
    // Old API requests did not supply the model the hash they asked it to
    // echo. Attribute by deterministic transport metadata, preserve that
    // integration defect separately, and assess the content on its merits.
    const transportSha = data?.checker?.candidateSha256;
    const binding = transportSha || data?.candidateSha256;
    const candidate = candidates.find(c => [c.sha256, c.originalSha256].includes(binding));
    const canonical = transportSha ? bindCheckerResult(data, data.checker) : data;
    const errors = candidate?.data ? checkerEvidenceProblems(canonical, candidate.data, manifest, binding) : ['no candidate matches checker transport evidence'];
    return { file: rel(file), sha256: sha256File(file), candidate: candidate?.name || null, provider: data?.checker?.provider || (name.startsWith('agent__') ? 'agent' : 'unknown'), model: data?.checker?.model || name.split('__for-')[0].replace(/^agent__/, ''), verdict: data?.verdict || null, transportHashCorrect: !!candidate, modelHashMismatch: !!transportSha && data?.candidateSha256 !== transportSha, evidenceErrors: errors, costUsdListEquivalent: data?.checker?.costUsd ?? null, data };
  });
  const truthFile = path.join(benchDir, 'truth', `${id}.json`), adjudicationFile = path.join(benchDir, 'adjudication', `${id}.json`);
  const truth = read(truthFile), adjudication = read(adjudicationFile);
  const goldValidation = truth ? validate(truthFile, id, manifestFile) : null;
  if (!truth) blockers.push('truth missing or unreadable');
  else if (!goldValidation.ok) blockers.push(...goldValidation.errors.map(e => `truth validation: ${e.path || ''} ${e.message}`));
  if (truth && truth.paper?.id !== id) blockers.push('truth paper id mismatch');
  if (adjudication && adjudication.paperId !== id) blockers.push('adjudication paper id mismatch');
  blockers.push(...adjudicationEvidenceProblems(adjudication, candidates, checks, ROOT));
  const complete = blockers.length === 0;
  const escalations = adjudication?.escalations || [];
  const usableReference = complete && escalations.length === 0 && !truth?.tx?.caveat;
  if (usableReference) readyFixtures.push({ ...fx, reference: rel(truthFile), referenceKind: 'model-adjudicated', adjudication: rel(adjudicationFile), referenceEvidence: [
    { file: rel(truthFile), sha256: sha256File(truthFile) }, { file: rel(adjudicationFile), sha256: sha256File(adjudicationFile) },
    ...candidates.map(c => ({ file: c.file, sha256: c.sha256 })), ...checks.map(c => ({ file: c.file, sha256: c.sha256 })),
  ] });
  const findAdjudicated = c => {
    const a = adjudication?.candidates?.find(a => path.resolve(ROOT, a.view) === path.resolve(ROOT, c.view));
    return a ? { ...a, reportedVerdict: a.verdict, verdict: a.defects.length ? 'fail' : a.verdict, verdictNormalized: a.verdict === 'pass' && a.defects.length > 0 } : null;
  };
  reports.push({ paperId: id, family: fx.family, heldOut: !!fx.heldOut, pages: Object.values(manifest.documents).reduce((s, d) => s + d.pages, 0), missingReaders: ['agent__haiku', 'agent__sonnet', 'zai__glm-5.3-flash'].filter(n => !candidates.some(c => c.name === n)), sourceHashes, complete, usableReference, blockers, escalations, adjudicator: adjudication?.adjudicator || null, truthSha256: truth ? sha256File(truthFile) : null, adjudicationSha256: adjudication ? sha256File(adjudicationFile) : null,
    candidates: candidates.map(({ data, ...c }) => ({ ...c, adjudicated: complete ? findAdjudicated(c) : null })),
    checks: checks.map(({ data, ...c }) => ({ ...c, findings: (data?.defects || []).map((d, index) => ({ severity: d.severity, kind: d.kind, path: d.path, adjudicated: complete ? adjudication.checkerFindings.find(f => path.resolve(ROOT, f.check) === path.resolve(ROOT, c.file) && f.index === index) : null })) })),
  });
}
const readerStats = {}, checkerStats = {};
for (const p of reports) {
  for (const c of p.candidates) {
    const s = readerStats[c.name] ||= { available: 0, schemaValid: 0, adjudicated: 0, pass: 0, papersWithCritical: 0, papersWithNonFigureCritical: 0, papersWithFigureDefects: 0, critical: 0, major: 0, minor: 0, heldOutAdjudicated: 0 };
    s.available++; s.schemaValid += !!c.validation.ok;
    if (!p.usableReference || !c.adjudicated) continue;
    s.adjudicated++; s.heldOutAdjudicated += p.heldOut; s.pass += c.adjudicated.verdict === 'pass';
    s.papersWithCritical += c.adjudicated.defects.some(d => d.severity === 'critical');
    s.papersWithNonFigureCritical += c.adjudicated.defects.some(d => d.severity === 'critical' && d.kind !== 'figure');
    s.papersWithFigureDefects += c.adjudicated.defects.some(d => d.kind === 'figure');
    for (const d of c.adjudicated.defects) if (['critical', 'major', 'minor'].includes(d.severity)) s[d.severity]++;
  }
  for (const c of p.checks) {
    const key = `${c.provider}/${c.model}`, s = checkerStats[key] ||= { calls: 0, rawPass: 0, structurallyValid: 0, protocolHashMismatch: 0, adjudicated: 0, adjudicatedRawPass: 0, truePositive: 0, falsePositive: 0, unresolvedFindings: 0, falsePass: 0, usablePass: 0, falseUsablePass: 0 };
    s.calls++; s.rawPass += c.verdict === 'pass'; s.structurallyValid += !c.evidenceErrors.length; s.protocolHashMismatch += c.modelHashMismatch;
    if (!p.usableReference) continue;
    const cand = p.candidates.find(a => a.name === c.candidate)?.adjudicated;
    if (!cand) continue;
    s.adjudicated++;
    s.adjudicatedRawPass += c.verdict === 'pass';
    const usablePass = c.verdict === 'pass' && !c.evidenceErrors.length;
    s.usablePass += usablePass;
    s.falsePass += c.verdict === 'pass' && cand.verdict === 'fail';
    s.falseUsablePass += usablePass && cand.verdict === 'fail';
    for (const d of c.findings) {
      if (d.severity === 'info') continue;
      if (!d.adjudicated || d.adjudicated.uncertain) s.unresolvedFindings++;
      else if (d.adjudicated.truePositive) s.truePositive++;
      else s.falsePositive++;
    }
  }
}
const ids = new Set(fixtures.map(f => f.paperId)), requestIds = new Set();
const successfulRuns = readRuns().filter(r => {
  if (!ids.has(r.paperId) || r.ok === false) return false;
  const key = `${r.provider}:${r.requestId}`;
  if (r.requestId && requestIds.has(key)) return false;
  if (r.requestId) requestIds.add(key);
  return true;
});
const usage = {};
for (const r of successfulRuns) {
  const key = `${r.provider}/${r.model}/${r.stage}`, s = usage[key] ||= { calls: 0, inputTokens: 0, outputTokens: 0, secondsSum: 0, costUsdListEquivalent: 0 };
  s.calls++; s.inputTokens += r.inputTokens || 0; s.outputTokens += r.outputTokens || 0; s.secondsSum += r.seconds || 0; s.costUsdListEquivalent += r.costUsd || 0;
}
const report = { at: new Date().toISOString(), fixtures: rel(fixturesFile), referenceType: 'model-adjudicated; no human gold', papers: reports, readerStats, checkerStats, usage, limitations: [
  'Incomplete adjudications and source escalations are excluded from quality aggregates.',
  'Historical pass verdicts with explicitly listed minor defects are scored as fail under the strict contract; reportedVerdict preserves the original judgment.',
  'Reader workflows differed: agent readers could inspect/repair with tools; API readers used scripted parsing/window assembly. This compares workflows, not raw model ability.',
  'Historical API requests omitted the hash they asked the model to echo. Attribution uses recorded transport hashes; modelHashMismatch is an integration defect.',
  'Checker precision counts adjudicated non-info findings; there is no field-level recall metric because defects are not matched one-to-one.',
  'Token costs are recorded list-price equivalents, not invoices; the Z.ai bundle and Claude/Codex subscription usage are not directly comparable. Agent usage and unrecorded failed calls are not priced.',
  'Partial coverage and adversarial fixture selection do not support a production-wide success-rate estimate.',
] };
writeJson(path.join(outDir, 'summary.json'), report);
writeJson(path.join(outDir, 'fixtures.complete.json'), readyFixtures);
const md = [`# Transcription benchmark evidence — ${report.at}`, '', `${reports.filter(p => p.complete).length}/${reports.length} adjudications complete; ${readyFixtures.length} usable model-adjudicated references.`, '', '## Readers', '', '| workflow | available | schema valid | adjudicated | pass | papers with critical defects |', '|---|---:|---:|---:|---:|---:|'];
for (const [name, s] of Object.entries(readerStats)) md.push(`| ${name} | ${s.available} | ${s.schemaValid} | ${s.adjudicated} | ${s.pass} | ${s.papersWithCritical} |`);
md.push('', '## Checkers', '', '| checker | calls | structurally valid* | adjudicated | true findings | false findings | false passes / raw passes on adjudicated candidates |', '|---|---:|---:|---:|---:|---:|---|');
for (const [name, s] of Object.entries(checkerStats)) md.push(`| ${name} | ${s.calls} | ${s.structurallyValid} | ${s.adjudicated} | ${s.truePositive} | ${s.falsePositive} | ${s.falsePass} / ${s.adjudicatedRawPass} |`);
md.push('', '*After normalizing the historical transport-hash integration defect in memory. Original artifacts are unchanged. Structural validity does not prove visual accuracy.', '', '## Papers', '', '| paper | readers | adjudication | usable reference | remaining |', '|---|---:|---|---|---|');
for (const p of reports) md.push(`| ${p.paperId} | ${p.candidates.length} | ${p.complete ? 'complete' : 'incomplete'} | ${p.usableReference ? 'yes' : 'no'} | ${p.blockers.join('; ').replaceAll('|', '/')} ${p.escalations.length ? `${p.escalations.length} escalations` : ''} |`);
md.push('', '## Limits', '', ...report.limitations.map(x => `- ${x}`), '');
fs.writeFileSync(path.join(outDir, 'summary.md'), md.join('\n'));
console.log(JSON.stringify({ output: rel(outDir), complete: reports.filter(p => p.complete).length, usableReferences: readyFixtures.length, fixtures: reports.length, readerStats, checkerStats }, null, 2));
