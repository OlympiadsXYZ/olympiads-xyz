#!/usr/bin/env node
// bench.mjs --fixtures tmp/bench/fixtures.json --candidates '<glob>' [--out-dir tmp/bench]
// Compares candidate transcriptions to a reference per paper and joins cost/time
// from tmp/tx/runs.jsonl. The reference is the adjudicated truth when the
// fixture names one ("reference"), otherwise the existing content JSON (the
// old Opus output) — the report says which, because the Opus JSON is not gold.
//
// fixtures.json: [ { "paperId": "psf-2004-proletno-7", "reference": "tmp/bench/truth/psf-2004-proletno-7.json"? } ]
// candidates: files named <provider>__<model>.json (as transcribe.mjs writes); the
// derived .figs/.view/.dryrun/.window-*/.rN copies next to them are skipped so a
// candidate is scored once. `*` matches within a path segment, `**` across.
// Acceptance columns come from the pipeline artefacts in tmp/tx/<paperId>/:
// validate.mjs is run on each candidate, checks/*.json whose candidateSha256
// matches give the checker verdict, receipt.json the receipt verdict, and
// runs.jsonl the total cost (reader + checker, all attempts) — so the table shows
// $ per ACCEPTED paper, not $ per request.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, fail, readJson, writeJson, findContentFile, mathSpans, proseOnly, normaliseLatex, allFigures, readRuns, isPrimaryCandidate, paperDir, sha256File, ROOT, nowIso } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.fixtures || !args.candidates) fail("usage: bench.mjs --fixtures tmp/bench/fixtures.json --candidates 'tmp/tx/*/candidates/*.json' [--out-dir tmp/bench]");
const fixtures = readJson(path.resolve(args.fixtures));
if (!Array.isArray(fixtures)) fail('fixtures must be a JSON array');
const outDir = path.resolve(args['out-dir'] || path.dirname(path.resolve(args.fixtures)));

function glob(pattern) {
  const abs = path.resolve(pattern);
  const root = path.parse(abs).root; // '/' on POSIX, the drive root on Windows
  const parts = abs.slice(root.length).split(path.sep).filter(Boolean);
  let paths = [root];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    const next = [];
    for (const base of paths) {
      if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) continue;
      if (seg === '**') {
        const stack = [base];
        while (stack.length) { const d = stack.pop(); next.push(d); for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) stack.push(path.join(d, e.name)); }
      } else if (seg.includes('*')) {
        const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
        for (const e of fs.readdirSync(base)) if (re.test(e)) next.push(path.join(base, e));
      } else next.push(path.join(base, seg));
    }
    paths = next;
  }
  return [...new Set(paths)].filter(p => fs.existsSync(p) && fs.statSync(p).isFile()).sort();
}

// ---- text comparison helpers
const norm = s => proseOnly(String(s || '')).toLowerCase().replace(/[„“"«»'’`]/g, '').replace(/\s+/g, ' ').trim();
const tokens = s => norm(s).split(/[^\p{L}\p{N},.]+/u).filter(Boolean);
function similarity(a, b) { // normalised token diff ratio (LCS based, like difflib.ratio)
  const A = tokens(a), B = tokens(b);
  if (!A.length && !B.length) return 1;
  const n = A.length, m = B.length;
  let prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) { const cur = new Array(m + 1).fill(0); for (let j = 1; j <= m; j++) cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); prev = cur; }
  return +((2 * prev[m]) / (n + m)).toFixed(4);
}
const NUM = /(?<![\p{L}])[-−]?\d+(?:[.,]\d+)?(?:\s?(?:%|°|[a-zA-Zа-яА-ЯΩµ]{1,4}(?:\/[a-zA-Zа-я]{1,3})?(?:[²³^]\d?)?))?/gu;
function numericTokens(text) { // numbers with their glued unit, from prose and math alike
  const s = String(text || '').replace(/\\\s/g, ' ').replace(/\\mathrm\{([^}]*)\}/g, '$1').replace(/\{,\}/g, ',').replace(/[$]/g, ' ');
  return (s.match(NUM) || []).map(t => t.replace(/\s+/g, '').replace(',', '.'));
}
function multisetDiff(a, b) {
  const count = arr => arr.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
  const ca = count(a), cb = count(b);
  const missing = [], extra = [];
  for (const [t, c] of ca) if ((cb.get(t) || 0) < c) missing.push(...Array(c - (cb.get(t) || 0)).fill(t));
  for (const [t, c] of cb) if ((ca.get(t) || 0) < c) extra.push(...Array(c - (ca.get(t) || 0)).fill(t));
  return { missing, extra };
}
const tableCells = text => String(text || '').split('\n').filter(l => /^\s*\|.*\|\s*$/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).flatMap(l => l.trim().slice(1, -1).split('|').map(c => norm(c)));
function problemText(pr) { return [pr.statement, ...(pr.parts || []).map(p => `${p.label} ${p.statement}`)].join('\n'); }
function answers(pr) {
  const out = [];
  const one = (a, where) => { if (!a) return; out.push({ where, kind: a.kind, value: a.value ?? a.latex ?? a.correct ?? null, unit: a.unit ?? null }); };
  one(pr.answer, 'problem'); (pr.parts || []).forEach(p => one(p.answer, p.label));
  return out;
}

function compare(ref, cand) {
  const byNum = arr => new Map((arr.problems || []).map(p => [String(p.number), p]));
  const R = byNum(ref), C = byNum(cand);
  const missing = [...R.keys()].filter(k => !C.has(k)), extra = [...C.keys()].filter(k => !R.has(k));
  const per = [];
  for (const [k, rp] of R) {
    const cp = C.get(k); if (!cp) continue;
    const rt = problemText(rp), ct = problemText(cp);
    const nd = multisetDiff(numericTokens(rt), numericTokens(ct));
    const rs = (rp.solution?.statement || ''), cs = (cp.solution?.statement || '');
    const sd = multisetDiff(numericTokens(rs), numericTokens(cs));
    const ra = answers(rp), ca = answers(cp);
    const answerMismatches = ra.filter(a => !ca.some(b => b.where === a.where && String(b.value) === String(a.value) && (b.unit || null) === (a.unit || null))).map(a => a.where);
    const latexOf = t => mathSpans(t).map(sp => normaliseLatex(sp.inner));
    const ld = multisetDiff(latexOf(rt), latexOf(ct)), lds = multisetDiff(latexOf(rs), latexOf(cs));
    per.push({
      number: k,
      statementSimilarity: similarity(rt, ct), solutionSimilarity: rs || cs ? similarity(rs, cs) : null,
      numericMismatches: { statement: nd, solution: sd },
      latexMismatches: { statement: ld, solution: lds },
      latexSpanDelta: mathSpans(ct).length - mathSpans(rt).length,
      latexSpanDeltaSolution: mathSpans(cs).length - mathSpans(rs).length,
      tableCellDiff: multisetDiff(tableCells(rt + '\n' + rs), tableCells(ct + '\n' + cs)),
      partsDelta: (cp.parts || []).length - (rp.parts || []).length,
      pointsMismatch: (rp.points ?? null) !== (cp.points ?? null),
      answerMismatches, answersRef: ra.length, answersCand: ca.length,
    });
  }
  const figs = d => allFigures(d).length;
  const mean = xs => xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4) : null;
  return {
    problemsRef: R.size, problemsCand: C.size, missing, extra,
    figureCountDelta: figs(cand) - figs(ref),
    meanStatementSimilarity: mean(per.map(p => p.statementSimilarity)),
    meanSolutionSimilarity: mean(per.map(p => p.solutionSimilarity).filter(x => x != null)),
    numericMismatchCount: per.reduce((a, p) => a + p.numericMismatches.statement.missing.length + p.numericMismatches.statement.extra.length, 0),
    solutionNumericMismatchCount: per.reduce((a, p) => a + p.numericMismatches.solution.missing.length + p.numericMismatches.solution.extra.length, 0),
    tableCellDiffCount: per.reduce((a, p) => a + p.tableCellDiff.missing.length + p.tableCellDiff.extra.length, 0),
    latexSpanDelta: per.reduce((a, p) => a + p.latexSpanDelta, 0),
    latexMismatchCount: per.reduce((a, p) => a + p.latexMismatches.statement.missing.length + p.latexMismatches.statement.extra.length, 0),
    solutionLatexMismatchCount: per.reduce((a, p) => a + p.latexMismatches.solution.missing.length + p.latexMismatches.solution.extra.length, 0),
    answerMismatchCount: per.reduce((a, p) => a + p.answerMismatches.length, 0),
    pointsMismatchCount: per.filter(p => p.pointsMismatch).length,
    problems: per,
  };
}

const runs = readRuns();
function costFor(paperId, provider, model, file) {
  const rs = runs.filter(r => r.paperId === paperId && r.provider === provider && r.model === model && r.ok !== false);
  const sum = (stage, k) => rs.filter(r => r.stage === stage).reduce((a, r) => a + (r[k] || 0), 0) || null;
  const failed = runs.filter(r => r.paperId === paperId && r.provider === provider && r.model === model && r.ok === false).length;
  // Attribute checks to this candidate by transport hash. A competing reader's
  // checks are experiment overhead, not the cost of accepting this candidate.
  const hashes = new Set([sha256File(file)]), figs = file.replace(/\.json$/, '.figs.json');
  if (fs.existsSync(figs)) hashes.add(sha256File(figs));
  const checkDir = path.join(paperDir(paperId), 'checks');
  const checks = fs.existsSync(checkDir) ? fs.readdirSync(checkDir).filter(n => n.endsWith('.json')).map(n => readJson(path.join(checkDir, n), null)).filter(c => hashes.has(c?.checker?.candidateSha256 || c?.candidateSha256)) : [];
  const priced = checks.filter(c => Number.isFinite(c.checker?.costUsd));
  const checkerKnown = priced.reduce((a, c) => a + c.checker.costUsd, 0);
  const checkerComplete = checks.length > 0 && priced.length === checks.length;
  const readerCost = sum('reader', 'costUsd');
  const knownSubtotal = (readerCost || 0) + checkerKnown;
  const total = readerCost != null && checkerComplete && failed === 0 ? knownSubtotal : null;
  return { readerCostUsd: readerCost, readerSeconds: sum('reader', 'seconds'), readerInputTokens: sum('reader', 'inputTokens'), readerOutputTokens: sum('reader', 'outputTokens'), readerAttempts: sum('reader', 'attempts'), failedAttempts: failed, checkerCostUsd: checkerComplete ? checkerKnown : null, knownSubtotalUsd: +knownSubtotal.toFixed(6), costCoverageComplete: total != null, totalCostUsd: total == null ? null : +total.toFixed(6), runs: rs.length };
}
// acceptance evidence from the pipeline artefacts next to the candidate
function acceptance(paperId, file) {
  const dir = paperDir(paperId);
  const manifest = path.join(dir, 'manifest.json');
  const v = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'tx', 'validate.mjs'), file, '--paper-id', paperId, ...(fs.existsSync(manifest) ? ['--manifest', manifest] : []), '--quiet'], { encoding: 'utf8' });
  const shas = new Set([sha256File(file)]);
  const figs = file.replace(/\.json$/, '.figs.json');
  if (fs.existsSync(figs)) shas.add(sha256File(figs));
  let checkerVerdict = null, checkedBy = null;
  const checkDir = path.join(dir, 'checks');
  if (fs.existsSync(checkDir)) for (const f of fs.readdirSync(checkDir)) {
    const c = readJson(path.join(checkDir, f), null);
    const sha = c?.checker?.candidateSha256 || c?.candidateSha256;
    if (sha && shas.has(sha)) { checkerVerdict = c.verdict ?? null; checkedBy = c.checker ? `${c.checker.provider}:${c.checker.model}` : f; }
  }
  const receipt = readJson(path.join(dir, 'receipt.json'), null);
  const receiptVerdict = receipt && shas.has(receipt.candidateSha256) ? receipt.verdict : null;
  const jobs = readJson(path.join(path.dirname(dir), 'jobs.json'), null)?.jobs?.[paperId] || null;
  return { validateOk: v.status === 0, checkerVerdict, checkedBy, receiptVerdict, escalated: jobs?.stage === 'escalated' || receiptVerdict === 'escalate', repairRounds: jobs?.round ?? null };
}

const files = glob(args.candidates).filter(isPrimaryCandidate);
const report = { at: nowIso(), fixtures: path.relative(ROOT, path.resolve(args.fixtures)), candidatesGlob: args.candidates, papers: [] };
for (const fx of fixtures) {
  const refFile = fx.reference ? path.resolve(ROOT, fx.reference) : findContentFile(fx.paperId);
  if (!refFile || !fs.existsSync(refFile)) { report.papers.push({ paperId: fx.paperId, error: 'no reference available' }); continue; }
  const ref = readJson(refFile);
  const boundReference = fx.referenceKind === 'model-adjudicated' && Array.isArray(fx.referenceEvidence) && fx.referenceEvidence.length >= 2 &&
    fx.referenceEvidence.some(e => path.resolve(ROOT, e.file) === refFile) &&
    fx.referenceEvidence.some(e => path.resolve(ROOT, e.file) === path.resolve(ROOT, fx.adjudication || '')) &&
    fx.referenceEvidence.every(e => fs.existsSync(path.resolve(ROOT, e.file)) && sha256File(path.resolve(ROOT, e.file)) === e.sha256);
  const entry = { paperId: fx.paperId, reference: path.relative(ROOT, refFile), referenceKind: boundReference ? 'model-adjudicated' : fx.reference ? 'unverified-reference (not gold)' : 'existing-opus-json (not gold)', candidates: [] };
  for (const f of files) {
    const cand = readJson(f, null);
    if (!cand || cand.paper?.id !== fx.paperId) continue;
    const m = /^([^_]+)__(.+)\.json$/.exec(path.basename(f));
    const provider = cand.tx?.reader?.provider || m?.[1] || 'unknown', model = cand.tx?.reader?.model || m?.[2] || path.basename(f, '.json');
    const acc = acceptance(fx.paperId, f), cost = costFor(fx.paperId, provider, model, f);
    entry.candidates.push({ file: path.relative(ROOT, f), provider, model, ...compare(ref, cand), ...cost, ...acc, acceptedCostUsd: acc.receiptVerdict === 'pass' ? cost.totalCostUsd : null });
  }
  report.papers.push(entry);
}

// ---- markdown
const md = [];
md.push(`# Transcription benchmark — ${report.at}`, '', `Fixtures: \`${report.fixtures}\`; candidates: \`${report.candidatesGlob}\`.`, '', 'Reference kind matters: "existing-opus-json" is the old workflow\'s output, not adjudicated truth; a difference is a disagreement, not necessarily a candidate error.', '');
md.push('| paper | reference | candidate | problems (ref/cand, missing, extra) | stmt sim | sol sim | numeric mismatches (stmt/sol) | LaTeX ≠ (stmt/sol) | table cells | LaTeX Δ | figures Δ | answers ≠ | points ≠ | valid | checker | receipt | reader $ | total $ | accepted $ | reader s |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const p of report.papers) {
  if (p.error) { md.push(`| ${p.paperId} | — | — | ${p.error} | | | | | | | | | | | | | | | | |`); continue; }
  if (!p.candidates.length) md.push(`| ${p.paperId} | ${p.referenceKind} | (no candidates) | | | | | | | | | | | | | | | | | |`);
  for (const c of p.candidates) md.push(`| ${p.paperId} | ${p.referenceKind} | ${c.provider}/${c.model} | ${c.problemsRef}/${c.problemsCand}, ${c.missing.length}, ${c.extra.length} | ${c.meanStatementSimilarity} | ${c.meanSolutionSimilarity ?? '—'} | ${c.numericMismatchCount}/${c.solutionNumericMismatchCount} | ${c.latexMismatchCount}/${c.solutionLatexMismatchCount} | ${c.tableCellDiffCount} | ${c.latexSpanDelta} | ${c.figureCountDelta} | ${c.answerMismatchCount} | ${c.pointsMismatchCount} | ${c.validateOk ? 'yes' : 'no'} | ${c.checkerVerdict ?? '—'} | ${c.receiptVerdict ?? '—'}${c.escalated ? ' (escalated)' : ''} | ${c.readerCostUsd ?? '—'} | ${c.totalCostUsd ?? '—'} | ${c.acceptedCostUsd ?? '—'} | ${c.readerSeconds ?? '—'} |`);
}
md.push('', 'Columns: *valid* = validate.mjs exit 0; *checker* = recorded verdict, not a guarantee of quality; *receipt* = receipt.json verdict for these bytes; *total $* = recorded reader + checks bound to this candidate, shown only with complete recorded costs and no unpriced failed attempts; *accepted $* requires a passed receipt. Agent subscription usage is unpriced. Dollar figures are list-price equivalents, not invoices. LaTeX ≠ counts normalised math spans present on one side only; these are review signals, not adjudicated errors.', '', '## Per-problem detail', '');
for (const p of report.papers) for (const c of p.candidates || []) {
  md.push(`### ${p.paperId} — ${c.provider}/${c.model}`, '');
  for (const q of c.problems) {
    const bits = [`stmt ${q.statementSimilarity}`, q.solutionSimilarity != null ? `sol ${q.solutionSimilarity}` : null, q.numericMismatches.statement.missing.length ? `missing numbers: ${q.numericMismatches.statement.missing.join(' ')}` : null, q.numericMismatches.statement.extra.length ? `extra numbers: ${q.numericMismatches.statement.extra.join(' ')}` : null, q.latexMismatches.statement.missing.length + q.latexMismatches.statement.extra.length ? `LaTeX ≠ ${q.latexMismatches.statement.missing.map(x => `−${x}`).concat(q.latexMismatches.statement.extra.map(x => `+${x}`)).slice(0, 6).join(' ')}` : null, q.latexMismatches.solution.missing.length + q.latexMismatches.solution.extra.length ? `solution LaTeX ≠ ${q.latexMismatches.solution.missing.length}/${q.latexMismatches.solution.extra.length}` : null, q.tableCellDiff.missing.length + q.tableCellDiff.extra.length ? `table cells ±${q.tableCellDiff.missing.length}/${q.tableCellDiff.extra.length}` : null, q.answerMismatches.length ? `answers ≠ ${q.answerMismatches.join(', ')}` : null, q.pointsMismatch ? 'points ≠' : null, q.partsDelta ? `parts Δ${q.partsDelta}` : null].filter(Boolean);
    md.push(`- problem ${q.number}: ${bits.join('; ')}`);
  }
  md.push('');
}
fs.mkdirSync(outDir, { recursive: true });
writeJson(path.join(outDir, 'report.json'), report);
fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n') + '\n');
console.log(md.slice(0, 5 + report.papers.reduce((a, p) => a + Math.max(1, (p.candidates || []).length), 0)).join('\n'));
console.log(`\nwrote ${path.relative(ROOT, path.join(outDir, 'report.md'))} and report.json`);
