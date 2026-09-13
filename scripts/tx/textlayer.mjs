#!/usr/bin/env node
// textlayer.mjs <paperId> --candidate <f> [--out <f>] [--verbose]
// Mechanical verbatim check of a candidate against the PDF's own text layer
// (tmp/tx/<id>/text/<document>.txt from pdftotext). For a born-digital PDF the
// text layer IS the printed prose, so a word it prints that the transcription
// lacks is an omission or a misreading, and a word the transcription has that
// is printed nowhere is a typo or a rewording — none of which a same-model
// checker reliably sees (it re-reads the page with the same eyes). Formulas,
// numbers and figure lettering are noisy in text layers, so only words count:
//   - a run of 3+ consecutive printed words absent from the transcription is an
//     omission (critical from 6 words) — the printed passage is quoted so the
//     refix model can restore it in place;
//   - a single absent word of 5+ letters on an otherwise transcribed line is a
//     misreading; when the same field holds a similar unprinted word the fix is
//     mechanical (suggestedFix = the field with that word replaced);
//   - unprinted words of 5+ letters in a field are reported per field.
// A document is checked only when its text layer is trustworthy: at least 80 %
// of the candidate's own words for that document are found in it (a scan, a
// garbled encoding or a Word export that lost its letters fails this and is
// skipped with a note). Exit 0 no defects / 3 defects / 1 error.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, fail, readJson, writeJson, readManifest, paperDir, walkStrings, splitMath, fixHomoglyphs, nowIso } from './lib.mjs';

export const TEXTLAYER_VERSION = 1;
const MIN_TRUST = 0.8, MIN_LAYER_WORDS = 40;
// fields whose words are the reader's own (alt text, notes) or not prose
const SKIP_PATH = /\/(tx|notes|note|caveat|url|id|archiveKey|topics|problemType|kind|unit|source|incompleteReason|solutionSource|lang|subject|competition|round|grade|difficulty|importance|latex|equivalentForms)(\/|$)/;
const ALT_PATH = /\/alt$/; // the reader's own words: never "unprinted", but a misread printed term in it is still worth fixing
const NO_EXTRAS = /\/answer(\/|$)/; // answers are summarised by the reader, not printed as such
// structural words the transcription encodes as fields, not prose
const STOP = /^(задач|решени|отговор|критери|фиг|точк|общо|подусловие|бележк|забележк)/u;
// "Задача 2.", "ЗАДАЧА 1. – 10 точки", "Задача II.", "Задача №3", "1 задача.", "2-ра задача"
const HEADING = /^\s*(?:(?:задача|з\s*а\s*д\s*а\s*ч\s*а)\s*(?:№\s*)?(\d+|[ivx]+)\b|(\d+)\s*(?:-?\s*(?:ва|ра|та|а|и))?\s+задача\b)/iu;
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const headingNumber = line => { const h = HEADING.exec(line); if (!h) return null; const n = (h[1] || h[2]).toLowerCase(); return String(ROMAN[n] || Number(n) || n); };
const problemKey = n => { const s = String(n ?? '').trim().toLowerCase(); return String(ROMAN[s] || Number(s) || s); };
const CYR = /^[а-яѝ]+$/u;

const norm = w => fixHomoglyphs(w).toLowerCase().replace(/ё/g, 'е').replace(/ѝ/g, 'и');
const WORD = /\p{L}+/gu;
// "tобщо" / "Vmax" / "Tобщо": a variable glued to a Cyrillic word, or a Latin
// homoglyph inside one — both readings are kept (alt = the script-split parts)
const splitScripts = w => w.split(/(?<=[a-z])(?=[а-я])|(?<=[а-я])(?=[a-z])/u);
const isNeutral = t => t.skip || (t.fragment && !t.joined) || t.w.length < 3 || !CYR.test(t.w) || STOP.test(t.w);

function tokenise(s) {
  const out = [];
  for (const m of s.matchAll(WORD)) {
    const parts = splitScripts(m[0].toLowerCase()).filter(Boolean);
    const tok = { w: norm(m[0]), raw: m[0], index: m.index };
    if (parts.length > 1) tok.alt = parts;
    out.push(tok);
  }
  return out;
}
const inSet = (set, t) => set.has(t.w) || (t.alt != null && t.alt.every(w => w.length < 3 || set.has(w)));
export function layerPages(text) {
  const clean = text.replace(/­/g, '').replace(/\r/g, '');
  return clean.split('\f').map((pageText, pi) => {
    const lines = pageText.split('\n');
    const tokens = [];
    lines.forEach((line, li) => {
      // A word broken at a line end ("коли-" / "чката") is one printed word. In a
      // two-column layout pdftotext interleaves the columns, so a broken word's
      // head ends before a column gap and its tail starts after one, several
      // lines down: both halves are marked as fragments and joinFragments pairs
      // them when the join is a transcribed word.
      const heads = new Set(); for (const m of line.matchAll(/(\p{L}+)-(?=\s|$)/gu)) heads.add(m.index);
      for (const t of tokenise(line)) {
        const tok = { ...t, line: li, page: pi + 1 };
        if (heads.has(t.index)) { tok.fragment = 'head'; tok.raw = t.raw + '-'; }
        else if (/^\p{Ll}/u.test(t.raw) && (t.index === line.search(/\S/) || /\s{2,}$/.test(line.slice(0, t.index)))) tok.fragment = 'tail';
        tokens.push(tok);
      }
    });
    return { page: pi + 1, lines, tokens };
  }).filter(p => p.tokens.length || p.lines.some(l => l.trim()));
}
// Resolve broken words: a head fragment joined with a tail fragment within the next
// 8 lines that makes a transcribed word marks both as present (w = the whole word).
function joinFragments(tokens, known) {
  const heads = tokens.filter(t => t.fragment === 'head');
  for (const h of heads) {
    const tails = tokens.filter(t => t.fragment === 'tail' && t.line > h.line && t.line <= h.line + 8 && !t.joined);
    const hit = tails.find(t => known.has(h.w + t.w));
    if (hit) { h.w = h.w + hit.w; h.joined = true; hit.joined = true; hit.skip = true; }
  }
}
function candidateFields(c, hasSolutions) {
  const fields = [];
  walkStrings(c, (p, s) => {
    if (SKIP_PATH.test(p) || !/\p{L}/u.test(s)) return;
    const doc = hasSolutions && /\/(solution|answer)(\/|$)/.test(p) ? 'solutions' : 'problems';
    const prose = splitMath(s).map(seg => seg.math ? seg.text.replace(/\\(?:text|mathrm|textbf|textit|mathbf|operatorname)\{([^}]*)\}/g, ' $1 ').replace(/\\[a-zA-Z]+/g, ' ') : seg.text).join(' ');
    const tokens = tokenise(prose);
    fields.push({ path: p, doc, text: s, tokens, set: new Set(tokens.flatMap(t => [t.w, ...(t.alt || [])])), altText: ALT_PATH.test(p) });
  });
  return fields;
}
const lev = (a, b) => {
  if (a === b) return 0;
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
};
const similar = (a, b) => { const d = lev(a, b); return d <= Math.max(1, Math.round(0.4 * Math.max(a.length, b.length))) || (commonPrefix(a, b) >= 4 && Math.abs(a.length - b.length) <= 3); };
const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const matchCase = (model, w) => model === model.toUpperCase() && model.length > 1 ? w.toUpperCase() : /^\p{Lu}/u.test(model) ? w[0].toUpperCase() + w.slice(1) : w;
// replace one whole word outside math, case-insensitively, keeping the printed word's case
function replaceWord(text, from, to) {
  let done = false;
  const re = new RegExp(`(^|[^\\p{L}])(${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[^\\p{L}]|$)`, 'iu');
  return splitMath(text).map(seg => {
    if (seg.math || done) return seg.text;
    return seg.text.replace(re, (all, pre, word) => { done = true; return pre + matchCase(word, to); });
  }).join('');
}

export function textLayerCheck(candidate, manifest, paperId) {
  const hasSolutions = !!manifest.documents.solutions;
  const fields = candidateFields(candidate, hasSolutions);
  const problemIndexByNumber = new Map((candidate.problems || []).map((pr, i) => [problemKey(pr.number), i]));
  const result = { version: TEXTLAYER_VERSION, paperId, at: nowIso(), documents: {}, defects: [], notes: [] };
  // the solutions document repeats the masthead and the problem headings: those words are the problems document's, but count as present on both
  const shared = /^\/paper\/|^\/problems\/\d+\/(title|number)$/;
  const wordsOf = doc => new Set(fields.filter(f => f.doc === doc || shared.test(f.path)).flatMap(f => [...f.set]));
  const allWords = new Set(fields.flatMap(f => [...f.set]));
  const layerSets = {};
  for (const [doc, d] of Object.entries(manifest.documents)) {
    const file = d.text ? path.join(paperDir(paperId), d.text) : null;
    const info = { trusted: false, reason: null, layerWords: 0, candidateWords: 0, candidateCovered: null, layerCovered: null, omissions: 0, misreadings: 0, unprinted: 0 };
    result.documents[doc] = info;
    if (!file || !fs.existsSync(file)) { info.reason = 'no text layer'; continue; }
    const pages = layerPages(fs.readFileSync(file, 'utf8'));
    for (const pg of pages) joinFragments(pg.tokens, allWords);
    const tokens = pages.flatMap(p => p.tokens);
    const layerSet = new Set(tokens.flatMap(t => [t.w, ...(t.alt || [])]));
    const layerRaw = new Map(); for (const t of tokens) if (!t.fragment && !layerRaw.has(t.w)) layerRaw.set(t.w, t.raw);
    layerSets[doc] = layerSet;
    // the solutions document reprints statements before solving them, so for it every transcribed word counts as present
    const own = hasSolutions && doc === 'problems' ? wordsOf('problems') : allWords;
    const ownWords = [...(hasSolutions ? wordsOf(doc) : allWords)].filter(w => w.length >= 4 && CYR.test(w));
    info.layerWords = tokens.filter(t => !isNeutral(t)).length;
    info.candidateWords = ownWords.length;
    if (info.layerWords < MIN_LAYER_WORDS) { info.reason = `text layer has only ${info.layerWords} words (scan or image-only document)`; continue; }
    info.candidateCovered = ownWords.length ? Number((ownWords.filter(w => layerSet.has(w)).length / ownWords.length).toFixed(3)) : null;
    if (info.candidateCovered != null && info.candidateCovered < MIN_TRUST) { info.reason = `text layer covers only ${Math.round(info.candidateCovered * 100)}% of the transcription's words (garbled or lossy layer)`; continue; }
    info.trusted = true;
    const present = t => inSet(allWords, t);
    const presentInDoc = t => inSet(own, t);
    info.layerCovered = Number((tokens.filter(t => !isNeutral(t) && present(t)).length / Math.max(1, info.layerWords)).toFixed(3));
    const docFields = fields.filter(f => f.doc === (hasSolutions ? doc : 'problems'));
    // which field a printed line belongs to: the field sharing the most of the line's transcribed words
    const fieldFor = (ctxTokens, problemIdx, minScore = 2) => {
      const ctx = [...new Set(ctxTokens.filter(t => !isNeutral(t) && present(t)).map(t => t.w))];
      if (!ctx.length) return null;
      let best = null, bestScore = 0;
      for (const f of docFields) {
        let s = 0; for (const w of ctx) if (f.set.has(w)) s++;
        if (problemIdx != null && f.path.startsWith(`/problems/${problemIdx}/`)) s += 0.5;
        if (/\/(title|caption|label)$/.test(f.path)) s -= 0.25; // a heading or caption is never the passage a body line belongs to
        if (s > bestScore || (s === bestScore && best && f.set.size > best.set.size)) { bestScore = s; best = f; }
      }
      if (!best || bestScore < minScore || bestScore < 0.5 * ctx.length) return null;
      return best;
    };
    const consumed = new Set(); // "path|word" extras explained by a misreading
    for (const pg of pages) {
      let problemIdx = null;
      const byLine = new Map();
      for (const t of pg.tokens) { if (!byLine.has(t.line)) byLine.set(t.line, []); byLine.get(t.line).push(t); }
      const lineCtx = li => [...(byLine.get(li - 1) || []), ...(byLine.get(li) || []), ...(byLine.get(li + 1) || [])];
      const quote = (from, to) => { const a = pg.lines[from.line], b = pg.lines[to.line]; const s = from.line === to.line ? a.slice(from.index, to.index + to.raw.length) : a.slice(from.index) + ' ' + pg.lines.slice(from.line + 1, to.line).join(' ') + ' ' + b.slice(0, to.index + to.raw.length); return s.replace(/\s+/g, ' ').trim(); };
      let run = [], gap = 0;
      const flush = () => {
        gap = 0;
        if (run.length >= 3) {
          const ctx = lineCtx(run[0].line).concat(run.length > 1 ? lineCtx(run.at(-1).line) : []);
          // a passage before the first problem heading of a document (grading notes, a masthead line) belongs to no field
          const f = fieldFor(ctx, problemIdx, problemIdx == null ? 4 : 3) || (problemIdx != null ? { path: doc === 'solutions' || !hasSolutions && /решени/i.test(pg.lines[run[0].line] || '') ? `/problems/${problemIdx}/solution/statement` : `/problems/${problemIdx}/statement`, fallback: true } : null);
          const text = quote(run[0], run.at(-1));
          const lines = pg.lines.slice(run[0].line, run.at(-1).line + 1).join(' ').replace(/\s+/g, ' ').trim();
          info.omissions++;
          result.defects.push({ path: f?.path || null, document: doc, page: pg.page, severity: run.length >= 6 ? 'critical' : 'major', kind: 'omission', source: 'text-layer', confidence: f && !f.fallback ? 0.9 : 0.6,
            description: `Text-layer check: the printed passage „${text}“ (${doc} p.${pg.page}, printed line: „${lines.slice(0, 160)}“) does not appear in the transcription; restore it verbatim in its printed place${f?.fallback ? ' (field guessed from the problem heading)' : ''}.`, suggestedFix: null, words: run.map(t => t.raw) });
        } else for (const t of run) {
          if (t.w.length < 5 || problemIdx == null) continue; // before the first heading: masthead, instructions, grading notes — not transcribed prose
          const line = byLine.get(t.line) || [];
          const content = line.filter(x => !isNeutral(x));
          if (content.length < 2 || content.filter(present).length < 0.5 * content.length) continue; // a formula line or lettering, not transcribed prose
          const f = fieldFor(lineCtx(t.line), problemIdx);
          if (!f) continue;
          info.misreadings++;
          const printedLine = (pg.lines[t.line] || '').replace(/\s+/g, ' ').trim();
          // Mechanical fix, two ways: the printed word's neighbours ("количките се ▮ след време") locate
          // the misread word in the field even when its spelling is printed elsewhere ("ударят" in part б),
          // else the field holds exactly one similar word the document never prints.
          const at = line.indexOf(t);
          const neighbours = k => { const out = []; for (let i = at + k; i >= 0 && i < line.length && out.length < 2; i += k) if (line[i].w.length >= 2 && present(line[i])) out.push(line[i].raw); return k < 0 ? out.reverse() : out; };
          const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          let fixed = null, wrong = null;
          const before = neighbours(-1), after = neighbours(1);
          if (before.length + after.length >= 2) {
            const re = new RegExp(`(${before.map(esc).join('\\s+')}${before.length ? '\\s+' : ''})(\\p{L}+)(${after.length ? '\\s+' : ''}${after.map(esc).join('\\s+')})`, 'giu');
            const hits = [...f.text.matchAll(re)].filter(m => norm(m[2]) !== t.w);
            // the same misreading may occur more than once in the field ("се ударят" twice): fix every hit when they agree
            if (hits.length && new Set(hits.map(h => norm(h[2]))).size === 1) {
              wrong = hits[0][2]; let out = f.text;
              for (const h of hits.slice().reverse()) out = out.slice(0, h.index) + h[1] + matchCase(h[2], t.raw.replace(/-$/, '')) + h[3] + out.slice(h.index + h[0].length);
              fixed = out;
            }
          }
          if (!fixed) {
            const extra = f.tokens.map(x => x.w).filter(w => w.length >= 4 && CYR.test(w) && !layerSet.has(w) && similar(w, t.w));
            if (extra.length === 1) { wrong = extra[0]; consumed.add(`${f.path}|${extra[0]}`); const out = replaceWord(f.text, extra[0], t.raw.replace(/-$/, '') || t.w); if (out !== f.text) fixed = out; }
          }
          if (fixed) {
            result.defects.push({ path: f.path, document: doc, page: pg.page, severity: 'major', kind: 'reworded', source: 'text-layer', confidence: 0.85,
              description: `Text-layer check: the page prints „${t.raw}“ (${doc} p.${pg.page}: „${printedLine.slice(0, 120)}“) where the transcription has „${wrong}“ — keep the printed spelling, typos included.`, suggestedFix: fixed });
          } else {
            // a single missing word is a misreading (kind reworded: the replacement may be shorter), not an omission
            result.defects.push({ path: f.path, document: doc, page: pg.page, severity: 'major', kind: 'reworded', source: 'text-layer', confidence: 0.7,
              description: `Text-layer check: the printed word „${t.raw}“ (${doc} p.${pg.page}: „${printedLine.slice(0, 120)}“) does not appear in this field; re-read the passage and transcribe it verbatim.`, suggestedFix: null });
          }
        }
        run = [];
      };
      for (const t of pg.tokens) {
        const line = pg.lines[t.line] || '';
        if (t.index === line.search(/\S/)) { const n = headingNumber(line); if (n != null) { const i = problemIndexByNumber.get(n); if (i != null) problemIdx = i; } }
        if (isNeutral(t)) continue;
        // a word transcribed elsewhere in the paper (the solution reuses the statement's words) does not make it present here;
        // one present word inside an omitted sentence (a noun the statement uses elsewhere) does not end the run
        if (presentInDoc(t)) { if (run.length && gap === 0) gap = 1; else flush(); }
        else { run.push(t); gap = 0; }
      }
      flush();
    }
    // words the transcription has that the document never prints
    for (const f of docFields) {
      if (NO_EXTRAS.test(f.path)) continue;
      const other = Object.values(layerSets).filter(s => s !== layerSet);
      const extras = [...new Set(f.tokens.filter(x => x.w.length >= 5 && CYR.test(x.w) && !layerSet.has(x.w) && !other.some(s => s.has(x.w)) && !consumed.has(`${f.path}|${x.w}`)).map(x => x.raw))];
      if (!extras.length) continue;
      const minor = /\/(caption|title|label)$/.test(f.path);
      // an unprinted word with exactly one similar printed word ("закривя" / "закривява") is a misreading: fix it mechanically;
      // in alt text (the reader's own words) that is the only rule applied, as a minor defect
      // in alt text only a difference in the stem counts ("разнозначните"/"разноименните"); an ending is the reader's own inflection
      const commonSuffix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; };
      const altMisread = (a, b) => Math.abs(a.length - b.length) <= 1 && commonPrefix(a, b) >= 4 && commonSuffix(a, b) >= 3 && commonPrefix(a, b) < Math.min(a.length, b.length) - 3 && lev(a, b) <= 0.35 * Math.max(a.length, b.length);
      const misread = extras.map(raw => { const w = norm(raw); const near = [...layerSet].filter(x => x.length >= 5 && CYR.test(x) && (f.altText ? altMisread(x, w) : !allWords.has(x) && similar(x, w))); return near.length === 1 ? { raw, printed: layerRaw.get(near[0]) || near[0] } : null; }).filter(Boolean);
      let rest = extras;
      if (!minor && misread.length) {
        let fixed = f.text; for (const m of misread) fixed = replaceWord(fixed, m.raw, m.printed);
        if (fixed !== f.text) {
          info.unprinted += misread.length;
          result.defects.push({ path: f.path, document: doc, page: pages[0]?.page || 1, severity: f.altText ? 'minor' : 'major', kind: 'reworded', source: 'text-layer', confidence: 0.8,
            description: `Text-layer check: the transcription has ${misread.map(m => `„${m.raw}“`).join(', ')} where the ${doc} document prints ${misread.map(m => `„${m.printed}“`).join(', ')} — keep the printed spelling.`, suggestedFix: fixed });
          rest = extras.filter(e => !misread.some(m => m.raw === e));
        }
      }
      if (f.altText || !rest.length) continue;
      const extrasLeft = rest;
      info.unprinted += extrasLeft.length;
      // the page where most of the field's words are printed
      let page = pages[0]?.page || 1, bestHit = -1;
      for (const pg of pages) { const set = new Set(pg.tokens.map(t => t.w)); const hit = f.tokens.filter(t => t.w.length >= 4 && set.has(t.w)).length; if (hit > bestHit) { bestHit = hit; page = pg.page; } }
      // A printed caption is a short cue line ("Фиг. 2", "Снимка 1", "Фигура 3а"); a caption with unprinted
      // words that starts with no cue, or runs past a few words, is the reader's own description: drop it.
      if (/\/caption$/.test(f.path)) {
        const content = f.tokens.filter(x => x.w.length >= 4 && CYR.test(x.w) && !STOP.test(x.w));
        const cue = /^\s*(фиг|figure|fig|табл|схема|снимка|карта|диаграма|графика|рис)/iu.test(f.text);
        if (!cue || content.length >= 6 || extrasLeft.length >= 0.5 * Math.max(1, content.length)) {
          result.defects.push({ path: f.path, document: doc, page, severity: 'minor', kind: 'reworded', source: 'text-layer', confidence: 0.7,
            description: `Text-layer check: the caption „${f.text.slice(0, 80)}“ is not printed (${extrasLeft.length} of its ${content.length} words appear nowhere in the ${doc} document) — a caption is the printed caption line only; the field is dropped.`, suggestedFix: '' });
          continue;
        }
      }
      result.defects.push({ path: f.path, document: doc, page, severity: minor ? 'minor' : 'major', kind: 'reworded', source: 'text-layer', confidence: 0.6,
        description: `Text-layer check: ${extrasLeft.length === 1 ? 'the word' : 'the words'} ${extrasLeft.map(w => `„${w}“`).join(', ')} in this field ${extrasLeft.length === 1 ? 'is' : 'are'} printed nowhere in the ${doc} document (a typo or a rewording); re-read the passage on the page and transcribe it verbatim.`, suggestedFix: null, words: extrasLeft });
    }
  }
  for (const [doc, info] of Object.entries(result.documents)) if (!info.trusted) result.notes.push(`${doc}: not checked — ${info.reason}`);
  // one defect per field for what the refix model has to re-read (mechanical fixes stay separate: repair.mjs applies them first)
  const merged = [], byPath = new Map();
  const rank = { critical: 3, major: 2, minor: 1, info: 0 };
  result.unmapped = result.defects.filter(d => !d.path); // a printed passage no field claims (a masthead line, a figure's lettering)
  for (const d of result.defects) {
    if (!d.path) continue;
    if (d.suggestedFix) { merged.push(d); continue; }
    const m = byPath.get(d.path);
    if (!m) { byPath.set(d.path, d); merged.push(d); continue; }
    m.items = m.items || [m.description]; m.items.push(d.description);
    m.description = m.items.map((s, i) => `(${i + 1}) ${s}`).join(' ');
    if (rank[d.severity] > rank[m.severity]) m.severity = d.severity;
    if (d.kind === 'omission') m.kind = 'omission'; // an omitted passage keeps the "fix must be longer" protection of repair.mjs
    if (d.page && !m.page) m.page = d.page;
    m.confidence = Math.max(m.confidence || 0, d.confidence || 0);
  }
  for (const d of merged) delete d.items;
  result.defects = merged;
  result.summary = { defects: result.defects.length, critical: result.defects.filter(d => d.severity === 'critical').length, major: result.defects.filter(d => d.severity === 'major').length, minor: result.defects.filter(d => d.severity === 'minor').length, withFix: result.defects.filter(d => d.suggestedFix).length, checked: Object.entries(result.documents).filter(([, i]) => i.trusted).map(([d]) => d) };
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const args = parseArgs(process.argv.slice(2), { flags: ['verbose'] });
  const paperId = args._[0];
  if (!paperId || !args.candidate) fail('usage: textlayer.mjs <paperId> --candidate <f> [--out <f>] [--verbose]');
  const manifest = readManifest(paperId);
  if (!manifest) fail(`no manifest for ${paperId}`);
  const candidate = readJson(path.resolve(args.candidate), null);
  if (!candidate) fail('candidate not readable');
  const r = textLayerCheck(candidate, manifest, paperId);
  if (args.out) writeJson(path.resolve(args.out), r);
  if (args.verbose) { for (const d of r.defects) console.log(`${d.severity.padEnd(8)} ${d.kind.padEnd(9)} ${d.path || '(unmapped)'}  ${d.description}${d.suggestedFix ? '  [fix ready]' : ''}`); }
  console.log(JSON.stringify({ paperId, documents: r.documents, summary: r.summary, notes: r.notes }, null, 2));
  process.exit(r.defects.length ? 3 : 0);
}
