#!/usr/bin/env node
// assemble.mjs <paperId> --parts 'glob-or-comma-list' --out <candidate.json>
// Merges the window parts a windowed reader produced (transcribe.mjs
// --window-pages N) into one candidate: problems are keyed by number, the
// statement comes from the window where the problem begins, the solution from
// the window that holds it, source spans and figures are unioned, the
// WINDOW_PLACEHOLDER statements are replaced. Reports coverage (pages no
// problem claims), unresolved placeholders and numbering gaps; exit 1 on any.
// Also exported as assembleWindows(parts, manifest) for transcribe.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, fail, readJson, writeJson, readManifest, WINDOW_PLACEHOLDER, allFigures, nowIso } from './lib.mjs';

const textLen = pr => String(pr.statement || '').length + (pr.parts || []).reduce((a, p) => a + String(p.statement || '').length, 0);
const isPlaceholder = pr => String(pr.statement || '').trim() === WINDOW_PLACEHOLDER;
const spanKey = s => `${s.document}:${s.page}`;
const uniqBy = (arr, key) => { const seen = new Set(); return arr.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

export function assembleWindows(parts, manifest) {
  if (!parts.length) throw new Error('no parts to assemble');
  const report = { ok: true, windows: parts.map(p => p.tx?.window || null), problems: [], uncoveredPages: [], duplicates: [] };
  const first = parts[0];
  const paper = JSON.parse(JSON.stringify(first.paper || {}));
  const pagesOf = (doc) => [...new Set(parts.flatMap(p => (p.paper?.[doc]?.pages || [])))].sort((a, b) => a - b);
  if (paper.source) paper.source.pages = pagesOf('source');
  const solSrc = parts.find(p => p.paper?.solutionSource)?.paper.solutionSource;
  if (solSrc) paper.solutionSource = { ...solSrc, pages: pagesOf('solutionSource') };

  const byNumber = new Map();
  parts.forEach((part, wi) => {
    for (const pr of part.problems || []) {
      const n = Number(pr.number);
      if (!byNumber.has(n)) byNumber.set(n, []);
      byNumber.get(n).push({ pr, wi });
    }
  });
  const problems = [];
  for (const n of [...byNumber.keys()].sort((a, b) => a - b)) {
    const seen = byNumber.get(n);
    const full = seen.filter(s => !isPlaceholder(s.pr));
    if (full.length > 1) report.duplicates.push({ number: n, windows: full.map(s => s.wi) });
    // statement: the most complete non-placeholder version (windows overlap by a page)
    const base = full.sort((a, b) => textLen(b.pr) - textLen(a.pr))[0];
    if (!base) { report.problems.push(`problem ${n}: statement not found in any window (placeholder only)`); }
    const out = JSON.parse(JSON.stringify((base || seen[0]).pr));
    // solution: the longest one any window produced
    const sols = seen.map(s => s.pr.solution).filter(s => s && (s.statement || '').trim());
    if (sols.length) out.solution = sols.sort((a, b) => String(b.statement).length - String(a.statement).length)[0];
    else if (!out.solution) out.solution = seen.map(s => s.pr.solution).find(Boolean) || undefined;
    if (out.solution === undefined) delete out.solution;
    // figures: union by id, in statement and solution
    const figsOf = (pick) => uniqBy(seen.flatMap(s => pick(s.pr) || []), f => f.id);
    const stFigs = figsOf(pr => pr.figures); if (stFigs.length) out.figures = stFigs; else delete out.figures;
    if (out.solution) { const sf = figsOf(pr => pr.solution?.figures); if (sf.length) out.solution.figures = sf; else delete out.solution.figures; }
    // source spans: union
    const spans = uniqBy(seen.flatMap(s => s.pr.tx?.sourceSpans || []), spanKey).sort((a, b) => spanKey(a).localeCompare(spanKey(b)));
    out.tx = { ...(out.tx || {}), sourceSpans: spans, windows: [...new Set(seen.map(s => s.wi))] };
    delete out.tx.window;
    problems.push(out);
  }
  problems.forEach((pr, i) => { if (Number(pr.number) !== i + 1) report.problems.push(`numbering gap: position ${i + 1} holds problem ${pr.number}`); });
  // coverage: every page of every document should be claimed by some problem's spans (or be a masthead page)
  const claimed = new Set(problems.flatMap(pr => (pr.tx.sourceSpans || []).map(spanKey)));
  for (const [doc, d] of Object.entries(manifest.documents || {})) for (let p = 1; p <= d.pages; p++) if (!claimed.has(`${doc}:${p}`)) report.uncoveredPages.push({ document: doc, page: p });
  // paper-level tx
  const readers = parts.map(p => p.tx?.reader).filter(Boolean);
  const sum = k => readers.some(r => typeof r[k] === 'number') ? readers.reduce((a, r) => a + (r[k] || 0), 0) : null;
  const tx = {
    printedMeta: parts.map(p => p.tx?.printedMeta).find(Boolean) ?? null,
    catalogDisagrees: parts.some(p => p.tx?.catalogDisagrees === true),
    textLayerTrustworthy: parts.map(p => p.tx?.textLayerTrustworthy).find(v => v != null) ?? null,
    notes: parts.map((p, i) => (p.tx?.notes ? `[window ${i + 1}] ${String(p.tx.notes).trim()}` : null)).filter(Boolean).join('\n') || undefined,
    caveat: parts.map(p => p.tx?.caveat).find(Boolean),
    assembledAt: nowIso(), windows: report.windows,
    reader: readers.length ? {
      provider: readers[0].provider, model: readers[0].model, promptVersion: readers[0].promptVersion, promptSha256: readers[0].promptSha256,
      requestId: readers.map(r => r.requestId).filter(Boolean).join(','), at: readers.at(-1).at,
      inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), reasoningTokens: sum('reasoningTokens'), costUsd: sum('costUsd') == null ? null : +sum('costUsd').toFixed(6), seconds: sum('seconds'), attempts: sum('attempts'),
      windows: readers.length, ...(readers[0].reasoning ? { reasoning: readers[0].reasoning } : {}),
    } : undefined,
  };
  for (const k of Object.keys(tx)) if (tx[k] === undefined) delete tx[k];
  const data = { paper, problems, tx };
  report.ok = report.problems.length === 0;
  report.figures = allFigures(data).length;
  return { data, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const paperId = args._[0];
  if (!paperId || !args.parts || !args.out) fail("usage: assemble.mjs <paperId> --parts 'a.json,b.json' --out <candidate.json>");
  const manifest = readManifest(paperId);
  if (!manifest) fail(`no manifest for ${paperId}`);
  const files = String(args.parts).split(',').map(f => path.resolve(f.trim())).filter(Boolean);
  const parts = files.map(f => { const d = readJson(f, null); if (!d) fail(`part not readable: ${f}`); return d; });
  // order parts by their window (document, first page)
  const order = p => { const w = p.tx?.window || {}; const [doc, range] = Object.entries(w)[0] || ['zz', [0]]; return `${doc === 'problems' ? 0 : 1}-${String(range[0]).padStart(3, '0')}`; };
  parts.sort((a, b) => order(a).localeCompare(order(b)));
  const { data, report } = assembleWindows(parts, manifest);
  if (data.paper?.id && data.paper.id !== paperId) fail(`assembled paper.id ${data.paper.id} != ${paperId}`);
  writeJson(path.resolve(args.out), data);
  console.log(JSON.stringify({ out: path.resolve(args.out), ...report }, null, 2));
  process.exit(report.ok ? 0 : 1);
}
