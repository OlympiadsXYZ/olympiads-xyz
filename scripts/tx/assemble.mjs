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
import { parseArgs, fail, readJson, writeJson, readManifest, WINDOW_PLACEHOLDER, allFigures, nowIso, sanitizeCandidate } from './lib.mjs';

const textLen = pr => String(pr.statement || '').length + (pr.parts || []).reduce((a, p) => a + String(p.statement || '').length, 0);
const isPlaceholder = pr => String(pr.statement || '').trim() === WINDOW_PLACEHOLDER;
const spanKey = s => `${s.document}:${s.page}`;
const uniqBy = (arr, key) => { const seen = new Set(); return arr.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

export function assembleWindows(parts, manifest) {
  if (!parts.length) throw new Error('no parts to assemble');
  const report = { ok: true, windows: parts.map(p => p.tx?.window || null), problems: [], uncoveredPages: [], duplicates: [] };
  const first = parts[0];
  const paper = JSON.parse(JSON.stringify(first.paper || {}));
  // Windows that start mid-document often omit paper fields (lang, title, held…):
  // fill each missing/null field from the first window that has it.
  for (const part of parts) for (const [k, v] of Object.entries(part.paper || {})) if ((paper[k] == null) && v != null) paper[k] = JSON.parse(JSON.stringify(v));
  if (paper.lang == null) paper.lang = manifest?.meta?.lang || 'bg';
  const pagesOf = (doc) => [...new Set(parts.flatMap(p => (p.paper?.[doc]?.pages || [])))].sort((a, b) => a - b);
  if (paper.source) paper.source.pages = pagesOf('source');
  const solSrc = parts.find(p => p.paper?.solutionSource)?.paper.solutionSource;
  if (solSrc) paper.solutionSource = { ...solSrc, pages: pagesOf('solutionSource') };

  const byNumber = new Map();
  const windowDoc = part => { const w = part.tx?.window; return w && typeof w === 'object' ? Object.keys(w)[0] || null : null; };
  const separateSolutions = !!(manifest?.documents?.problems && manifest?.documents?.solutions);
  parts.forEach((part, wi) => {
    for (const pr of part.problems || []) {
      const n = Number(pr.number);
      if (!byNumber.has(n)) byNumber.set(n, []);
      byNumber.get(n).push({ pr, wi, doc: windowDoc(part) });
    }
  });
  // A solutions-only window sometimes numbers the paper's single problem as the print does ("Q3", 3) while the
  // problems window numbered it 1: when exactly one problem has a statement anywhere, every placeholder-only
  // number is that problem (ipho-2024-theory-q3: the continuation came back as "problem 3").
  const fullNumbers = [...byNumber.entries()].filter(([, seen]) => seen.some(s => !isPlaceholder(s.pr))).map(([n]) => n);
  report.renumbered = [];
  if (fullNumbers.length === 1) {
    const target = fullNumbers[0];
    for (const [n, seen] of [...byNumber.entries()]) {
      if (n === target || !seen.every(s => isPlaceholder(s.pr))) continue;
      for (const s of seen) { s.pr.number = target; byNumber.get(target).push(s); }
      byNumber.delete(n); report.renumbered.push({ from: n, to: target });
    }
  }
  const problems = [];
  report.solutionWindowStatements = [];
  for (const n of [...byNumber.keys()].sort((a, b) => a - b)) {
    const seen = byNumber.get(n);
    const full = seen.filter(s => !isPlaceholder(s.pr));
    if (full.length > 1) report.duplicates.push({ number: n, windows: full.map(s => s.wi) });
    // statement: the most complete non-placeholder version (windows overlap by a page). When the
    // statements are a document of their own, a version read from a solutions window never outranks
    // one read from the problems document: a solutions-only window that "finds" the statement on its
    // pages is usually pasting the solution's narrative (eupho-2025-theory-x); it is a fallback only.
    const fromProblems = separateSolutions ? full.filter(s => s.doc !== 'solutions') : full;
    const pool = fromProblems.length ? fromProblems : full;
    const base = pool.sort((a, b) => textLen(b.pr) - textLen(a.pr))[0];
    if (base && separateSolutions && !fromProblems.length) report.solutionWindowStatements.push(n);
    if (!base) { report.problems.push(`problem ${n}: statement not found in any window (placeholder only)`); }
    const out = JSON.parse(JSON.stringify((base || seen[0]).pr));
    // solution: the longest beginning any window produced, followed by the continuations later
    // windows read (tx.continuation: the part printed after the overlap page). A window's own
    // "[извън прозореца …]" notes inside a solution are not printed text.
    const solText = s => String(s.pr.solution?.statement || '').replace(/\[извън прозореца[^\]]*\]/g, '').trim();
    const pieces = seen.filter(s => s.pr.solution && solText(s));
    const heads = pieces.filter(s => !s.pr.tx?.continuation).sort((a, b) => solText(b).length - solText(a).length);
    const head = heads[0] || null;
    const conts = pieces.filter(s => s.pr.tx?.continuation && (!head || s.wi > head.wi)).sort((a, b) => a.wi - b.wi);
    if (head || conts.length) {
      const first = head || conts.shift();
      out.solution = JSON.parse(JSON.stringify(first.pr.solution));
      out.solution.statement = [solText(first), ...conts.map(solText)].join('\n\n');
      if (conts.length) {
        // whether the solution is complete is known only at its end; a continuation that calls itself
        // incomplete because its beginning lies in an earlier window is complete once stitched
        const last = conts.at(-1).pr.solution;
        const aboutBeginning = /begin|earlier|previous|preceding|start|prior|начал|предишн|по-ран|предход/iu.test(String(last.incompleteReason || ''));
        if (last.incomplete && !aboutBeginning) { out.solution.incomplete = true; if (last.incompleteReason) out.solution.incompleteReason = last.incompleteReason; }
        else { delete out.solution.incomplete; delete out.solution.incompleteReason; }
      }
      if (!head) (report.orphanContinuations ||= []).push(n);
    } else if (!out.solution) out.solution = seen.map(s => s.pr.solution).find(Boolean) || undefined;
    if (out.solution === undefined) delete out.solution;
    // figures: union by id, in statement and solution
    const figsOf = (pick) => uniqBy(seen.flatMap(s => pick(s.pr) || []), f => f.id);
    const stFigs = figsOf(pr => pr.figures); if (stFigs.length) out.figures = stFigs; else delete out.figures;
    if (out.solution) { const sf = figsOf(pr => pr.solution?.figures); if (sf.length) out.solution.figures = sf; else delete out.solution.figures; }
    // A solutions-only window sometimes lists a solution figure in BOTH lists; keep
    // each id in the list its id names (pN-sol-figM → solution, pN-figM → statement).
    const solIds = new Set((out.solution?.figures || []).map(f => f.id)), stIds = new Set((out.figures || []).map(f => f.id));
    if (out.figures) { out.figures = out.figures.filter(f => !(/-sol-/.test(f.id) && solIds.has(f.id))); if (!out.figures.length) delete out.figures; }
    if (out.solution?.figures) { out.solution.figures = out.solution.figures.filter(f => !(!/-sol-/.test(f.id) && stIds.has(f.id))); if (!out.solution.figures.length) delete out.solution.figures; }
    // source spans: union
    const spans = uniqBy(seen.flatMap(s => s.pr.tx?.sourceSpans || []), spanKey).sort((a, b) => spanKey(a).localeCompare(spanKey(b)));
    out.tx = { ...(out.tx || {}), sourceSpans: spans, windows: [...new Set(seen.map(s => s.wi))] };
    delete out.tx.window; delete out.tx.continuation;
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
  const data = sanitizeCandidate({ paper, problems, tx });
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
