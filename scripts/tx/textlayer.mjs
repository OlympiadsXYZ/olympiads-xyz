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
// D-P23: the reader fixes what is obviously wrong in the print (a non-word
// misspelling, an agreement error, the й→ѝ pronoun, spacing) and records each
// fix in tx.edits = [{path, printed, fixed, document, page, kind}]. A record is
// first checked for eligibility: printed and fixed pair word for word (spacing
// aside) with at most one unchanged word of context; a misspelling changes few
// letters of a word no published paper uses; an agreement fix changes only an
// ending; a pronoun fix only й→ѝ; never a number, unit, symbol or name. An
// eligible record whose printed words are one printed span on that page of the
// layer is accepted (result.edits / result.info, not a defect) — an agreement
// fix as 'needs-model', since only a model reading the page can tell it from a
// real-word swap. Only the matched layer tokens and the paired fixed words are
// exempt from the other checks. A record whose printed words the layer does not
// have is a defect (an invented printed error); an ineligible or unrecorded
// change stays a defect with the mechanical restore-the-print fix, and a record
// whose field holds the printed wording again has lapsed ('stale': not a defect,
// not published). Omission runs are unchanged.
// A document is checked only when its text layer is trustworthy: at least 80 %
// of the candidate's own words for that document are found in it (a scan, a
// garbled encoding or a Word export that lost its letters fails this and is
// skipped with a note). Exit 0 no defects / 3 defects / 1 error.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, fail, readJson, writeJson, readManifest, paperDir, walkStrings, splitMath, fixHomoglyphs, nowIso, pointerGet, EDIT_KINDS, editFieldState, ROOT } from './lib.mjs';

export const TEXTLAYER_VERSION = 3; // 2: D-P23 recorded fixes (tx.edits); 3: eligibility, span-exact acceptance, lapsed records
const MIN_TRUST = 0.8, MIN_LAYER_WORDS = 40;
// fields whose words are the reader's own (alt text, notes) or not prose
// sourceSpans: page provenance ({document: 'problems' | 'solutions' | 'supplement', page}), not printed text — a
// „supplement“ span was reported as a word printed nowhere (ioaa-2019-observational-nabl, 2026-09-26)
const SKIP_PATH = /\/(tx|classification|sourceLayout|sourceSpans|notes|note|caveat|url|id|archiveKey|topics|problemType|kind|unit|source|incompleteReason|solutionSource|lang|subject|competition|round|grade|difficulty|importance|latex|equivalentForms)(\/|$)/;
const ALT_PATH = /\/alt$/; // the reader's own words: never "unprinted", but a misread printed term in it is still worth fixing
const NO_EXTRAS = /\/answer(\/|$)|^\/paper\//; // answers are summarised by the reader; masthead fields come from letterheads that are often images
// structural words the transcription encodes as fields, not prose
// The paper's language decides which script carries the prose (the other script is formulas and
// units), which structural words the transcription encodes as fields, and how a problem heading reads.
const PROFILES = {
  cyr: { content: /^[а-яѝёѐ]+$/u, stop: /^(задач|решени|отговор|критери|фиг|рис|точк|балл|общо|подусловие|бележк|забележк|примечани|указани)/u,
    // "Задача 2.", "ЗАДАЧА 1. – 10 точки", "Задача II.", "Задача №3", "1 задача.", "2-ра задача"
    heading: /^\s*(?:(?:задача|з\s*а\s*д\s*а\s*ч\s*а)\s*(?:№\s*)?(\d+|[ivx]+)\b|(\d+)\s*(?:-?\s*(?:ва|ра|та|а|и|я))?\s+задача\b)/iu },
  // function names printed inside formulas (cos, min, ln) are Latin words to the content rule but never prose
  lat: { content: /^[a-zäöüßéèêàâçñáíóúœæ]+$/u, stop: /^(problem|question|task|solution|answer|figure|fig|table|point|mark|part|section|hint|note|probl[eè]me|partie|aufgabe|l[öo]sung|abbildung|punkt|teil)|^(sin|cos|tan|cot|min|max|log|ln|exp|lim|const|arcsin|arccos|arctan|sinh|cosh|tanh|det|grad|div|rot|mod|sgn)$/u,
    // "Problem 1", "Question 2.", "Task 3", "Q1", "Problème 1", "Aufgabe 2", "1. Problem"
    heading: /^\s*(?:(?:problem|question|task|q|probl[eè]me|aufgabe|exercice)\s*(?:no\.?\s*|n[°o]\s*)?(\d+|[ivx]+)\b|(\d+)\s*[.)]?\s+(?:problem|question|task|probl[eè]me|aufgabe)\b)/iu },
};
export const profileFor = lang => (['en', 'fr', 'de', 'ro', 'kk-lat'].includes(String(lang || '').toLowerCase()) ? PROFILES.lat : PROFILES.cyr);
let P = PROFILES.cyr; // set per paper by textLayerCheck
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const headingNumber = line => { const h = P.heading.exec(line); if (!h) return null; const n = (h[1] || h[2]).toLowerCase(); return String(ROMAN[n] || Number(n) || n); };
const problemKey = n => { const s = String(n ?? '').trim().toLowerCase(); return String(ROMAN[s] || Number(s) || s); };

// NFKC folds Word's math-italic glyphs (𝑐𝑜𝑛𝑠𝑡 → const) and ligature glyphs (ﬁ → fi) into plain letters before comparing
// some Russian PDFs encode ё as ѐ (U+0450) in their text layer: «расчѐте» for the printed «расчёте» (belpho-2024-iii)
const norm = w => fixHomoglyphs(w.normalize('NFKC')).toLowerCase().replace(/[ёѐ]/g, 'е').replace(/ѝ/g, 'и');
// a word runs through combining marks: a decomposed й (и + U+0306) or ѝ (и + U+0300) is one letter, not a word break
// (nao-2008-iv-st: „отчитайте“ came out as „отчитаи“ + „те“ and a repair wrote the fragment into the paper)
const WORD = /\p{L}[\p{L}\p{M}]*/gu;
// "tобщо" / "Vmax" / "Tобщо": a variable glued to a Cyrillic word, or a Latin
// homoglyph inside one — both readings are kept (alt = the script-split parts)
const splitScripts = w => w.split(/(?<=[a-z])(?=[а-я])|(?<=[а-я])(?=[a-z])/u);
// a token set entirely in mathematical alphanumerics (𝑝ℎ𝑠𝑡𝑎 — a formula's variables the layer strings together) is
// lettering, never a printed prose word (apho-2023-theory-t1 was asked to transcribe it)
const isNeutral = t => t.skip || (t.fragment && !t.joined) || t.w.length < 3 || !P.content.test(t.w) || P.stop.test(t.w) || /[\u{1D400}-\u{1D7FF}\u{2100}-\u{214F}]/u.test(String(t.raw || '')); // any such letter: „𝑚𝑚and“ is a formula glued to a word (apho-2023-experiment-e1)

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
// A text layer glues words across a column gap or a lost space ("замразенав" = "замразена" + "в"):
// a missing token that splits into two transcribed words (the first ≥ 4 letters) counts as present.
// (a single letter on either side is a variable glued to a word: „𝑉diagram“ = V + diagram, "kmwhere" = km + where)
// Up to three words: a hidden duplicate text layer glued „first in hypothesis“ into „firstinhypothesis“, and the
// mechanical repair wrote that token into the paper as the printed wording (wopho-2012-q11).
const glued = (set, w, depth = 2) => {
  if (w.length < 5) return false;
  for (let i = 1; i <= w.length - 1; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    const aOk = a.length === 1 || (a.length >= 2 && set.has(a));
    if (!aOk) continue;
    if ((b.length === 1 || set.has(b)) && Math.max(a.length, b.length) >= 4) return true;
    if (depth > 1 && a.length >= 2 && glued(set, b, depth - 1)) return true;
  }
  return false;
};
const inSet = (set, t) => set.has(t.w) || (t.alt != null && t.alt.every(w => w.length < 3 || set.has(w))) || glued(set, t.w);
export function layerPages(text) {
  // NFC first: pdftotext writes some fonts' й as и + U+0306, and printed wording quoted from the layer is spliced into
  // candidates, so it must reach them composed
  const clean = text.normalize('NFC').replace(/­/g, '').replace(/\r/g, '');
  // a running header or footer (the same line on 3+ pages once digits are masked: „Theoretical Task 3 (T-3) : Solutions
  // 5 of 9“, ipho-2015-theory-3) is page furniture, not content the transcription must carry
  const rawPages = clean.split('\f');
  const lineKey = l => l.trim().replace(/\s+/g, ' ').replace(/\d+/g, '#');
  const onPages = new Map();
  rawPages.forEach((pt, pi) => { for (const k of new Set(pt.split('\n').map(lineKey).filter(k => /\p{L}{3}/u.test(k)))) onPages.set(k, (onPages.get(k) || 0) + 1); });
  const running = new Set([...onPages].filter(([, n]) => n >= 3).map(([k]) => k));
  return rawPages.map((pageText, pi) => {
    const lines = pageText.split('\n');
    const tokens = [];
    lines.forEach((line, li) => {
      // A word broken at a line end ("коли-" / "чката") is one printed word. In a
      // two-column layout pdftotext interleaves the columns, so a broken word's
      // head ends before a column gap and its tail starts after one, several
      // lines down: both halves are marked as fragments and joinFragments pairs
      // them when the join is a transcribed word.
      const heads = new Set(); for (const m of line.matchAll(/(\p{L}+)-(?=\s|$)/gu)) heads.add(m.index);
      // a formula line (symbols and digits against few letters) or a shouted header line (mostly capitals)
      // is lettering, not prose: its tokens count for nothing either way
      // Word-processor formulas come through as mathematical alphanumeric glyphs (𝑎, 𝑅, 𝛼, U+1D400–U+1D7FF): variables, so symbols
      // (plain Greek letters stay letters: a Bulgarian solution line naming ъглите α и β is prose; Word's math Greek is in the U+1D400 range)
      const letters = (line.match(/\p{L}/gu) || []).length, symbols = (line.match(/[0-9=+*/^_()<>≤≥±·√∙×∑∫|\\{}\[\]]|[\u{1D400}-\u{1D7FF}]/gu) || []).length, caps = (line.match(/\p{Lu}/gu) || []).length;
      const words = line.match(/\p{L}+/gu) || [], singles = words.filter(w => w.length === 1).length; // variables: "m mS S W t Q p"
      // equation editors leave their source in the text layer (LaTeXiT: latexit sha1_base64="…" followed by base64): never printed
      const junk = /latexit|sha1_base64|[A-Za-z0-9+/]{40,}={0,2}(?:\s|$)/.test(line);
      const lettering = junk || running.has(lineKey(line)) || (letters > 0 && (symbols > 0.25 * letters || (letters >= 12 && caps > 0.7 * letters) || (words.length >= 6 && singles >= 0.25 * words.length)));
      for (const t of tokenise(line)) {
        const tok = { ...t, line: li, page: pi + 1 };
        if (lettering || /^\p{L}\p{Ll}*\p{Lu}/u.test(t.raw)) tok.skip = true; // formula/lettering line, or a variable like rPS, mMS
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
    const hit = tails.find(t => known.has(h.w + t.w))
      // a two-column page whose gap pdftotext collapsed to one space leaves the tail mid-line and unmarked („…b x. cel
      // each other“ after „can-“, eupho-2019-theory-th-pr): a nearby lowercase token that is no word by itself but
      // completes a transcribed one (its line may be flagged lettering: the other column there holds a formula)
      || tokens.find(t => !t.fragment && !t.joined && t.line > h.line && t.line <= h.line + 2 && /^\p{Ll}/u.test(t.raw) && !known.has(t.w) && known.has(h.w + t.w));
    if (hit) { h.w = h.w + hit.w; h.joined = true; hit.joined = true; hit.skip = true; }
  }
}
// Some PDF exports insert a space inside a printed word ("е ус поредно на").
// Resolve only an exact join with the same immediate neighbours in a candidate
// field. The short prefix and remainder must not themselves be transcribed words;
// punctuation, column gaps, line breaks and approximate spellings are not joins.
function joinAdjacentFragments(page, fields, known) {
  const contexts = new Set();
  for (const f of fields) for (let i = 1; i < f.tokens.length - 1; i++) {
    const [before, word, after] = f.tokens.slice(i - 1, i + 2);
    if (word.w.length >= 7) contexts.add(`${before.w}\0${word.w}\0${after.w}`);
  }
  const tokens = page.tokens;
  for (let i = 1; i < tokens.length - 2; i++) {
    const [before, head, tail, after] = tokens.slice(i - 1, i + 3);
    if (head.skip || tail.skip || head.fragment || tail.fragment || head.joined || tail.joined) continue;
    if (head.w.length !== 2 || tail.w.length < 5 || !P.content.test(head.raw) || !P.content.test(tail.raw)) continue;
    if (known.has(head.w) || known.has(tail.w) || !known.has(head.w + tail.w)) continue;
    if (before.line !== head.line || tail.line !== head.line || after.line !== head.line) continue;
    const line = page.lines[head.line];
    if ([before, head, tail].some((t, n) => line.slice(t.index + t.raw.length, [head, tail, after][n].index) !== ' ')) continue;
    if (!contexts.has(`${before.w}\0${head.w + tail.w}\0${after.w}`)) continue;
    head.w += tail.w; head.raw += tail.raw; head.joined = true;
    tail.joined = true; tail.skip = true;
  }
}
function candidateFields(c, hasSolutions) {
  const fields = [];
  walkStrings(c, (p, s) => {
    if (SKIP_PATH.test(p) || !/\p{L}/u.test(s)) return;
    const sharedNote = /^\/paper\/documentNotes\/(\d+)\/(.+)$/.exec(p);
    if (sharedNote && !['title', 'statement'].includes(sharedNote[2])) return;
    const doc = sharedNote ? c.paper.documentNotes[Number(sharedNote[1])].document : hasSolutions && /\/(solution|answer)(\/|$)/.test(p) ? 'solutions' : 'problems';
    // A legacy transcription carries its figures inline: "![alt](url)" plus an italic caption line under the image.
    // The alt text is a description by design and the caption line is the figure's caption, not the field's prose
    // (nao-2018-ii-7-8, nao-2020-i-5-6, nao-2021-iv-ml-prak: „Гравюра“, „Снимка“, „Изображение“ printed nowhere).
    // Only a real image (a url with "/" or ":") has that caption line: a figure-id placeholder ("![](p1-fig1)") does
    // not, and the bold heading printed after it was dropped as a caption (nof-2020-iii-7, 2026-09-26).
    const noImages = s.replace(/(?:!\[[^\]\n]*\]\([^)\n]*[/:][^)\n]*\)[ \t|]*)+\n+[ \t]*(\*{1,2}|_{1,2})[^\n*_]{1,200}\1[ \t]*(?=\n|$)/g, ' ').replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ');
    // an environment name is markup, never a printed word (\begin{cases}, \begin{aligned}, \begin{array}{cc}: agents
    // rewrote correct LaTeX to get past „cases“/„aligned“ flagged as unprinted, idpho-2020-theory-ipho-q2, ipho-2015-theory-1)
    const segments = splitMath(noImages);
    const prose = segments.map(seg => seg.math ? seg.text.replace(/\\(?:begin|end)\{[a-zA-Z*]+\}(?:\{[^}]*\})?/g, ' ').replace(/\\(?:text|mathrm|textbf|textit|mathbf|operatorname)\{([^}]*)\}/g, ' $1 ').replace(/\\[a-zA-Z]+/g, ' ') : seg.text).join(' ');
    const tokens = tokenise(prose);
    // a subscripted symbol is also present in the glued form the layer prints ($C_{cd}$ „Ccd“, $\Delta v_{tot}$ „vtot“):
    // only as a word the field holds, never as a word it must find printed (usapho-2007-ii, baao-2024-ii-r2 were
    // parked on „Ccd = Cbf = Ceg“ / „∆vtot“ reported as omitted)
    // also through a font command: $A_{\mathrm{cs}}$ „Acs“, $\mathbf{v}_{\mathrm{rel}}$ „vrel“ (usapho-2021-plus)
    const glued = segments.filter(seg => seg.math).flatMap(seg => [...seg.text.matchAll(/(?<![A-Za-z\\])([A-Za-z])\}?_(?:\{(?:\\(?:mathrm|text|rm|mathit)\{)?([A-Za-z]{1,6})[,}]|([A-Za-z]))/g)].map(m => `${m[1]}${m[2] || m[3]}`));
    const set = new Set([...tokens.flatMap(t => [t.w, ...(t.alt || [])]), ...tokenise(glued.join(' ')).map(t => t.w)]);
    fields.push({ path: p, doc, text: s, tokens, set, altText: ALT_PATH.test(p) });
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

// D-P23 wording for a transcription that differs from the print: restore the print unless it is an obvious error
const RESTORE = 'restore the printed wording, unless the print is obviously wrong (a misspelling that is not a word, or an agreement error — never a number, unit, symbol, name or formula): then keep the fix and record it in tx.edits';
// Published prose as a lexicon: a word that occurs in 2+ other published papers is a word of the language, so a
// "misspelling" record of it is a real-word swap (the pilot's „начинает“ is in 4 papers, „обратопропорционална“ in
// none). Earlier papers kept printed typos verbatim (D-P16), hence two papers, not one. The papers are read once per
// process, only when a misspelling record needs them; OLYMPIADS_LEXICON_DIR points elsewhere (tests).
let LEXICON = null;
function lexiconFiles() {
  if (LEXICON) return LEXICON;
  const dir = process.env.OLYMPIADS_LEXICON_DIR || path.join(ROOT, 'content', 'problems');
  const walk = d => { let out = []; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) out = out.concat(e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.json') && e.name !== 'schema.json' ? [path.join(d, e.name)] : []); } catch { /* no content: an empty lexicon */ } return out; };
  LEXICON = walk(dir).map(f => { try { return { id: path.basename(f, '.json'), text: fs.readFileSync(f, 'utf8').normalize('NFC').toLowerCase().replace(/ё/g, 'е') }; } catch { return null; } }).filter(Boolean);
  return LEXICON;
}
// A source file shared by several papers (one solutions booklet for problems 1–7, split into three papers:
// iao-2025-theory-t-12/-345/-67-en) prints other papers' passages on this paper's pages. A run the layer finds
// nowhere in this transcription is not an omission when a published sibling from the same file carries it. Returns
// the id of that sibling, or null. The sibling must hold every missing word and most (60%) of the printed
// span's word triples in order — a span may cross two of its fields (a heading, then the statement), so not all.
const siblingWords = new Map();
const lc = w => w.normalize('NFC').toLowerCase().replace(/ё/g, 'е');
function siblingHolding(spanWords, missingWords, docKey, paperId) {
  if (!docKey || spanWords.length < 3) return null;
  const key = lc(docKey);
  if (!siblingWords.has(key)) siblingWords.set(key, lexiconFiles().filter(f => f.text.includes(JSON.stringify(key).slice(1, -1))).map(f => { const ws = [...f.text.matchAll(WORD)].map(m => m[0]); return { id: f.id, set: new Set(ws), tri: new Set(ws.slice(2).map((w, i) => `${ws[i]} ${ws[i + 1]} ${w}`)) }; }));
  const span = spanWords.map(lc), missing = missingWords.map(lc);
  const tri = span.slice(2).map((w, i) => `${span[i]} ${span[i + 1]} ${w}`);
  return siblingWords.get(key).find(f => f.id !== paperId && missing.every(w => f.set.has(w)) && tri.filter(t => f.tri.has(t)).length >= 0.6 * tri.length)?.id || null;
}
const knownCache = new Map();
function knownElsewhere(w, paperId) {
  const key = `${paperId}\0${w}`;
  if (knownCache.has(key)) return knownCache.get(key);
  const re = new RegExp(`(?<![\\p{L}\\p{M}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}])`, 'u');
  let n = 0;
  for (const f of lexiconFiles()) { if (f.id === paperId || !f.text.includes(w) || !re.test(f.text)) continue; if (++n >= 2) break; }
  knownCache.set(key, n);
  return n;
}
// unit names (with SI prefixes): a unit is never fixed under D-P23, whatever its spelling
const UNIT_WORD = /^(?:мили|милли|санти|кило|мега|гига|микро|нано|деци|хекто|milli|centi|kilo|mega|giga|micro|nano|deci)?(?:метр|метър|метър|грам|ампер|волт|ват|джаул|джоул|нютон|ньютон|паскал|херц|герц|кулон|келвин|тесл|фарад|хенри|генри|вебер|литр|литър|секунд|минут|градус|парсек|калори|meter|metre|gram|ampere|volt|watt|joule|newton|pascal|hertz|coulomb|kelvin|tesla|farad|henry|weber|liter|litre|second|minute|degree|parsec|calorie)\p{L}{0,4}$|^(?:ом|ома|омa|ohms?|часа|часове|hours?|mol|mole|moles|мол|мола|молa)$/u;
const lower = s => s.normalize('NFC').toLowerCase();
const commonSuffixLen = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; };
// Is the change one D-P23 allows? printed and fixed pair word for word (spacing aside); only the paired words that
// differ are the fix — they alone are exempt from the unprinted-word check, and at most one unchanged word of
// context may ride along (padding a record with other words would hide a dropped or invented word).
function eligibility(r, ctx) {
  const problems = [];
  const P1 = r.printed.normalize('NFC'), F1 = r.fixed.normalize('NFC');
  const pt = [...P1.matchAll(WORD)].map(m => m[0]), ft = [...F1.matchAll(WORD)].map(m => m[0]);
  let exempt = [];
  if (!pt.length || !ft.length) return { problems: ['a D-P23 fix changes words: printed and fixed must both have letters'], exempt };
  if (r.kind === 'spacing') {
    if (P1.replace(/\s+/g, '') !== F1.replace(/\s+/g, '')) problems.push('a spacing fix changes only whitespace, never a letter or a punctuation mark');
    const pw = new Set(pt.map(norm)); exempt = ft.map(norm).filter(w => !pw.has(w));
    return { problems, exempt };
  }
  if (r.kind === 'pronoun') {
    const a = [...P1], b = [...F1];
    const ok = a.length === b.length && a.some((c, i) => c !== b[i]) && a.every((c, i) => c === b[i] || (/[йЙ]/.test(c) && b[i] === (c === 'й' ? 'ѝ' : 'Ѝ')));
    // only the standalone pronoun: never й inside a word („който“)
    if (!ok || pt.some((w, i) => w !== ft[i] && lower(w) !== 'й')) problems.push('a pronoun fix changes only a standalone й into ѝ');
    return { problems, exempt };
  }
  if (pt.length !== ft.length) return { problems: [`printed and fixed must pair word for word (${pt.length} printed words, ${ft.length} fixed): record only the words that change, with at most one word of context`], exempt };
  const pairs = pt.map((w, i) => [w, ft[i]]);
  const diff = pairs.filter(([a, b]) => lower(a) !== lower(b)), same = pairs.length - diff.length;
  if (!diff.length) return { problems: ['printed and fixed differ in no word (a change of case or punctuation is not a D-P23 fix)'], exempt };
  if (same > 1) problems.push(`the record carries ${same} unchanged words: record the smallest span (the changed words and at most one word of context)`);
  for (const [a, b] of diff) {
    const la = lower(a), lb = lower(b), na = norm(a), nb = norm(b);
    if (UNIT_WORD.test(la) || UNIT_WORD.test(lb)) { problems.push(`„${a}“ → „${b}“ changes a unit: a unit is never fixed under D-P23 — the printed unit stays verbatim and is noted in tx.notes`); continue; }
    if ((/^\p{Lu}/u.test(a) || /^\p{Lu}/u.test(b)) && !ctx.sentenceStart) { problems.push(`„${a}“ is capitalised inside a sentence: a name is never fixed under D-P23`); continue; }
    if (r.kind === 'misspelling') {
      const d = lev(la, lb), allowed = Math.max(2, Math.floor(0.3 * Math.max(la.length, lb.length)));
      if (d > allowed) { problems.push(`„${a}“ → „${b}“ is not a misspelling fix (${d} letters change; at most ${allowed}): a different word replaced the printed one`); continue; }
      const n = knownElsewhere(na, ctx.paperId);
      if (n >= 2) { problems.push(`„${a}“ is a word (published papers use it): an acceptable printed form is kept, never swapped for another word`); continue; }
      if (ctx.transcribed.has(na)) { problems.push(`„${a}“ is transcribed verbatim elsewhere in this paper: the reader treats it as a word, so it is not an obvious misspelling (fix every occurrence or none)`); continue; }
    } else if (r.kind === 'agreement') {
      // an agreement fix changes an ending: a shared stem of 4+ letters (at least half the word), endings of up to 4 letters
      const stem = commonPrefix(la, lb);
      // adding or dropping a reflexive -ся/-сь changes the verb, not its agreement (the pilot's „начинает“ → „начинается“)
      if (/^(?:ся|сь)$/.test(la.length > lb.length ? la.slice(lb.length) : lb.slice(la.length)) && (la.startsWith(lb) || lb.startsWith(la))) { problems.push(`„${a}“ → „${b}“ adds or drops a reflexive -ся: that changes the verb, not an agreement error`); continue; }
      if (stem < 4 || stem < 0.5 * Math.min(la.length, lb.length) || la.length - stem > 4 || lb.length - stem > 4) { problems.push(`„${a}“ → „${b}“ is not an agreement fix (an agreement fix changes only the ending of the same word)`); continue; }
    }
    exempt.push(nb);
  }
  return { problems, exempt };
}
// A recorded fix, checked for shape and eligibility before the layer is consulted.
function editRecord(e, index, candidate, manifest, ctx) {
  const r = { index, path: e?.path, document: e?.document, page: e?.page, kind: e?.kind, printed: e?.printed, fixed: e?.fixed, status: 'pending', problems: [], exempt: [] };
  const state = editFieldState(candidate, e);
  // a repair restored the printed wording: the record has lapsed (lib.mjs transcriptionEdits never publishes it)
  if (state === 'printed') { r.status = 'stale'; r.reason = 'the field holds the printed wording again: the record has lapsed and is not published'; r.printedWords = []; r.fixedWords = []; return r; }
  if (state === 'no-field') r.problems.push(`path ${JSON.stringify(r.path)} is not a text field of the transcription`);
  const strings = typeof r.printed === 'string' && r.printed.trim() && typeof r.fixed === 'string' && r.fixed.trim();
  if (!strings) r.problems.push('printed and fixed must both be non-empty strings');
  else if (r.printed === r.fixed) r.problems.push('printed and fixed are identical');
  if (!EDIT_KINDS.includes(r.kind)) r.problems.push(`kind ${JSON.stringify(r.kind)} is not one of ${EDIT_KINDS.join(', ')}`);
  const d = manifest.documents?.[r.document];
  if (!d) r.problems.push(`document ${JSON.stringify(r.document)} is not a document of this paper`);
  else if (!Number.isInteger(r.page) || r.page < 1 || (d.pages && r.page > d.pages)) r.problems.push(`page ${JSON.stringify(r.page)} is not a page of the ${r.document} document`);
  // never under D-P23: numbers, units, symbols, mathematics — a recorded change there is a changed value
  const pair = [r.printed, r.fixed].filter(x => typeof x === 'string').map(x => x.normalize('NFC')); // a decomposed ѝ (и + U+0300) is a letter, not a symbol
  r.science = pair.some(x => /[0-9$\\=+^_<>%°±×·√∑∫]/.test(x)) || (pair.length === 2 && JSON.stringify((pair[0].match(/[^\p{L}\p{M}\s.,;:!?„“"'()\-–—]/gu) || []).sort()) !== JSON.stringify((pair[1].match(/[^\p{L}\p{M}\s.,;:!?„“"'()\-–—]/gu) || []).sort()));
  if (r.science) r.problems.push('a D-P23 fix never touches numbers, units, symbols or mathematics — the printed value stays verbatim and is noted in tx.notes');
  r.printedWords = typeof r.printed === 'string' ? [...new Set(tokenise(r.printed).map(t => t.w))] : [];
  r.fixedWords = typeof r.fixed === 'string' ? [...new Set(tokenise(r.fixed).map(t => t.w))] : [];
  if (state === 'neither' && strings) r.problems.push(`the recorded fixed wording „${r.fixed}“ is not in this field`);
  // eligibility: only when the record is otherwise well formed (its problems then say why the change is not a D-P23 fix)
  if (!r.problems.length) {
    const value = String(pointerGet(candidate, r.path)).normalize('NFC');
    const at = value.toLowerCase().indexOf(r.fixed.normalize('NFC').toLowerCase().trim());
    const head = value.slice(0, Math.max(0, at));
    const sentenceStart = at >= 0 && (/^[\s„"«(*_\-–—]*$/u.test(head) || /[.!?:;\n][\s„"«(*_\-–—]*$/u.test(head));
    const el = eligibility(r, { ...ctx, sentenceStart });
    r.exempt = el.exempt;
    if (el.problems.length) { r.problems.push(...el.problems); r.ineligible = true; }
  }
  return r;
}
// Where a record's printed words stand on a page, as a run of layer tokens: consecutive words are adjacent tokens,
// or (a two-column layout interleaves the columns) the line's last token and the first token of a line within the
// next 8 lines. A printed word may also be two tokens (a word broken at a line end without a hyphen). The joined
// tail of a hyphenated word is not a word of its own. Returns the matched tokens, or null.
function findSpan(pg, words, used) {
  const seq = pg.tokens.filter(t => !(t.joined && t.skip));
  const lastOnLine = new Map(), firstOnLine = new Map();
  seq.forEach((t, i) => { lastOnLine.set(t.line, i); if (!firstOnLine.has(t.line)) firstOnLine.set(t.line, i); });
  const matchAt = (i, w) => { if (i >= seq.length) return 0; const t = seq[i]; if (t.w === w || t.alt?.join('') === w) return 1; if (i + 1 < seq.length && t.w + seq[i + 1].w === w && w.length >= 7) return 2; return 0; };
  const go = (i, k) => {
    const n = matchAt(i, words[k]); if (!n) return null;
    const here = seq.slice(i, i + n);
    if (k === words.length - 1) return here;
    const next = i + n, cands = [next];
    const endLine = seq[next - 1].line;
    if (lastOnLine.get(endLine) === next - 1) for (let l = endLine + 1; l <= endLine + 8; l++) if (firstOnLine.has(l) && firstOnLine.get(l) !== next) cands.push(firstOnLine.get(l));
    for (const c of cands) { const rest = go(c, k + 1); if (rest) return here.concat(rest); }
    return null;
  };
  for (let i = 0; i < seq.length; i++) { const hit = go(i, 0); if (hit && !hit.some(t => used.has(t))) return hit; }
  return null;
}

export function textLayerCheck(candidate, manifest, paperId) {
  P = profileFor(manifest?.meta?.lang || candidate?.paper?.lang || 'bg');
  const hasSolutions = !!manifest.documents.solutions;
  const fields = candidateFields(candidate, hasSolutions);
  const problemIndexByNumber = new Map((candidate.problems || []).map((pr, i) => [problemKey(pr.number), i]));
  const result = { version: TEXTLAYER_VERSION, paperId, at: nowIso(), documents: {}, defects: [], notes: [], edits: [], info: [] };
  // D-P23 recorded fixes: shape first; the layer decides below, per document
  const allWords = new Set(fields.flatMap(f => [...f.set]));
  const edits = (Array.isArray(candidate?.tx?.edits) ? candidate.tx.edits : []).map((e, i) => editRecord(e, i, candidate, manifest, { paperId, transcribed: allWords }));
  for (const e of edits) {
    if (e.status === 'stale') { result.notes.push(`tx.edits[${e.index}] (printed „${e.printed}“ → „${e.fixed}“): ${e.reason}`); continue; }
    if (!e.problems.length) continue;
    e.status = 'invalid';
    const where = typeof e.path === 'string' && typeof pointerGet(candidate, e.path) === 'string' ? e.path : `/tx/edits/${e.index}`;
    // a change D-P23 does not allow (a real-word swap, a unit, a name, a padded span) is an unrecorded change of the
    // print: the layer checks below flag it with the restore-the-print fix, and once the print is back the record lapses
    const bad = e.science ? { severity: 'major', kind: 'wrong-value' } : e.ineligible ? { severity: 'major', kind: 'reworded' } : { severity: 'minor', kind: 'other' };
    result.defects.push({ path: where, ...(manifest.documents?.[e.document] && Number.isInteger(e.page) ? { document: e.document, page: e.page } : {}), ...bad, source: 'text-layer', confidence: 0.9,
      description: `Text-layer check: tx.edits[${e.index}] (printed „${e.printed}“ → „${e.fixed}“) is not ${e.ineligible || e.science ? 'a D-P23 fix' : 'a valid D-P23 record'}: ${e.problems.join('; ')}.${e.science || e.ineligible ? ' Restore the printed wording in the field verbatim (the record then lapses; a wrong printed value is noted in tx.notes).' : ' Correct the record, or restore the printed wording in the field (the record then lapses).'}`, suggestedFix: null });
  }
  // accepted fixes: the layer tokens they explain (the matched span only, not the word anywhere on the page) and the
  // fixed words they explain in a field (only the words paired with a changed printed word)
  const acceptedTokens = new Set(), acceptedFixed = new Map();
  const accept = (e, span) => {
    for (const t of span) acceptedTokens.add(t);
    if (!acceptedFixed.has(e.path)) acceptedFixed.set(e.path, new Set()); for (const w of e.exempt) acceptedFixed.get(e.path).add(w);
  };
  const fixedIn = p => acceptedFixed.get(p) || new Set();
  const editPrinted = new Set(edits.filter(e => e.status === 'pending').flatMap(e => e.printedWords));
  // Alt text and captions are in the paper's language: a Cyrillic description on an English paper (or Latin
  // prose on a Bulgarian one) is the reader's own language slipping in (eupho-2026-theory-x solution figures).
  // Independent of the text layer; minor, no mechanical fix — the refix rewrites it.
  const lang = String(manifest?.meta?.lang || candidate?.paper?.lang || 'bg').toLowerCase();
  for (const f of fields) {
    if (!/\/(alt|caption)$/.test(f.path)) continue;
    const prose = splitMath(f.text).filter(seg => !seg.math).map(seg => seg.text).join(' ');
    const cyr = (prose.match(/[Ѐ-ӿ]/g) || []).length, lat = (prose.match(/[A-Za-zÀ-ɏ]/g) || []).length;
    if (cyr + lat < 15) continue;
    const wrong = P === PROFILES.lat ? cyr >= 0.7 * (cyr + lat) : lat >= 0.7 * (cyr + lat) && !/^(ru|uk|kk|sr|mk|be)$/.test(lang) && !/^[A-Z][a-z]*(\s+[A-Z][a-z]*)*$/.test(prose.trim());
    if (wrong) result.defects.push({ path: f.path, severity: 'minor', kind: 'other', source: 'text-layer', confidence: 0.9,
      description: `The ${f.path.endsWith('/alt') ? 'alt text' : 'caption'} is not in the paper's language (${lang}): „${prose.trim().slice(0, 80)}“ — rewrite it in the paper's language${f.path.endsWith('/caption') ? ' (a caption is the printed caption line only)' : ''}.` });
  }
  // the solutions document repeats the masthead and the problem headings: those words are the problems document's, but count as present on both
  const shared = /^\/paper\/|^\/problems\/\d+\/(title|number)$/;
  const wordsOf = doc => new Set(fields.filter(f => f.doc === doc || shared.test(f.path)).flatMap(f => [...f.set]));
  // A LaTeX text layer whose fi/fl/ff/ffi/ffl glyphs carry no Unicode mapping prints „signi cant gures“, „e ective“,
  // „di erential“: a transcribed word is present when the pieces around its ligatures are, and such a piece is a
  // present printed word (ipho-2024-theory-q3: 11 defects from this alone).
  const LIG = /ffi|ffl|ff|fi|fl/;
  const ligPiecesOf = w => LIG.test(w) ? w.split(/ffi|ffl|ff|fi|fl/).filter(p => p.length >= 3) : [];
  const ligPresent = (set, w) => { const ps = ligPiecesOf(w); return ps.length > 0 && ps.every(p => set.has(p)); };
  const ligPieces = new Set([...allWords].flatMap(ligPiecesOf));
  // the layer glues a word to its neighbour at a lost space („flowsIn“ for „flows In“): the transcribed word is
  // present when a layer token is it plus another transcribed word (else the check would "fix" flows → flowsIn)
  const gluedInLayer = (set, w) => { for (const t of set) { if (t.length <= w.length) continue; if (t.startsWith(w) && allWords.has(t.slice(w.length))) return true; if (t.endsWith(w) && allWords.has(t.slice(0, t.length - w.length))) return true; } return false; };
  // and the reverse: a word broken at a line end without a hyphen („компонен“ / „тите“) is two layer tokens
  const brokenInLayer = (set, w) => { if (w.length < 7) return false; for (let i = 3; i <= w.length - 3; i++) if (set.has(w.slice(0, i)) && set.has(w.slice(i))) return true; return false; };
  const layerSets = {};
  for (const [doc, d] of Object.entries(manifest.documents)) {
    const file = d.text ? path.join(paperDir(paperId), d.text) : null;
    const info = { trusted: false, reason: null, layerWords: 0, candidateWords: 0, candidateCovered: null, layerCovered: null, omissions: 0, misreadings: 0, unprinted: 0 };
    result.documents[doc] = info;
    if (!file || !fs.existsSync(file)) { info.reason = 'no text layer'; continue; }
    const pages = layerPages(fs.readFileSync(file, 'utf8'));
    // a solutions document shared by several papers (one marking file for every fieldwork task, igeo-2015-experiment-
    // fwe1task1): a passage the paper must carry comes only from the pages it declares it took its solutions from; every
    // page still counts as print for the words it does carry (wopho-2013-q2 transcribes a header from an earlier page)
    // the same for the problems document when paper.source.pages declares part of it: one language of a bilingual PDF
    // (balkanski-2011-cgp: French pp. 1–4 and 8–9), a converter's evaluation page (ipho-2007-experiment: Win2PDF p.8)
    const declared = doc === 'solutions' ? candidate?.paper?.solutionSource?.pages : doc === 'problems' ? candidate?.paper?.source?.pages : null;
    // a split read (D-P30: a paper over 30 pages read in chunks, tx.splitRead) declares the pages read so far; an empty
    // list means none of this document yet (the statements chunk before any solution page) — only a split read may say so
    const splitRead = candidate?.tx?.splitRead === true;
    const omissionPages = Array.isArray(declared) && (declared.length || splitRead) && declared.every(Number.isInteger) && d.pages && declared.length < d.pages ? new Set(declared) : null;
    const joinFields = fields.filter(f => f.doc === doc || shared.test(f.path));
    // a recorded misspelling broken at a line end ("обрато-" / "пропорционална") joins like a transcribed word
    const joinKnown = editPrinted.size ? new Set([...allWords, ...editPrinted]) : allWords;
    for (const pg of pages) {
      joinFragments(pg.tokens, joinKnown);
      joinAdjacentFragments(pg, joinFields, allWords);
    }
    const tokens = pages.flatMap(p => p.tokens);
    const layerSet = new Set(tokens.flatMap(t => [t.w, ...(t.alt || [])]));
    const layerRaw = new Map(); for (const t of tokens) if (!t.fragment && !layerRaw.has(t.w)) layerRaw.set(t.w, t.raw);
    layerSets[doc] = layerSet;
    // the solutions document reprints statements before solving them, so for it every transcribed word counts as
    // present; a "problems" document that prints solutions too (a marking scheme, "Detailed solution") is treated the same
    const solutionCues = pages.reduce((n, pg) => n + pg.lines.filter(l => /^\s*(solution|marking scheme|answer|detailed solution|решени|отговор|критери|ответ)/i.test(l)).length, 0);
    const own = hasSolutions && doc === 'problems' && solutionCues < 3 ? wordsOf('problems') : allWords;
    const ownWords = [...(hasSolutions ? wordsOf(doc) : allWords)].filter(w => w.length >= 4 && P.content.test(w));
    info.layerWords = tokens.filter(t => !isNeutral(t)).length;
    info.candidateWords = ownWords.length;
    if (info.layerWords < MIN_LAYER_WORDS) { info.reason = `text layer has only ${info.layerWords} words (scan or image-only document)`; continue; }
    info.candidateCovered = ownWords.length ? Number((ownWords.filter(w => layerSet.has(w)).length / ownWords.length).toFixed(3)) : null;
    if (info.candidateCovered != null && info.candidateCovered < MIN_TRUST) { info.reason = `text layer covers only ${Math.round(info.candidateCovered * 100)}% of the transcription's words (garbled or lossy layer)`; continue; }
    // An OCR layer is a reading, not the print: on a scanned document (pages that are images) or from an
    // OCR producer its "typos" are recognition errors, and a mechanical fix would write them into the text.
    const regs = readJson(path.join(paperDir(paperId), 'regions', `${doc}.json`), null);
    const scannedPages = (regs?.pages || []).filter(p => p.scanned).length;
    if (regs?.pages?.length && scannedPages >= 0.5 * regs.pages.length) { info.reason = `OCR text layer: ${scannedPages} of ${regs.pages.length} pages are scanned images`; continue; }
    if (/office lens|abbyy|finereader|tesseract|\bocr\b|camscanner|scansnap|paper capture|readiris|omnipage/i.test(d.producer || '')) { info.reason = `OCR text layer (producer ${d.producer})`; continue; }
    info.trusted = true;
    // D-P23: a recorded fix is accepted when its printed words are on that page of this document's layer
    const pageSets = new Map(pages.map(pg => [pg.page, new Set(pg.tokens.flatMap(t => [t.w, ...(t.alt || [])]))]));
    const onPage = (set, w) => set.has(w) || brokenInLayer(set, w);
    // a mechanically verified misspelling/pronoun/spacing fix is accepted; an agreement fix is on the page but only a
    // model reading the page can tell it from a real-word swap (receipt.mjs keeps it from a crops/mechanical check)
    const verdict = e => (e.kind === 'agreement' ? 'needs-model' : 'accepted');
    for (const e of edits.filter(x => x.status === 'pending' && x.document === doc)) {
      const printedSeq = tokenise(e.printed).map(t => t.w);
      if (!e.printedWords.length) { e.status = 'unverified'; e.reason = 'the printed form has no letters to look up'; continue; }
      const set = pageSets.get(e.page) || new Set();
      const missing = e.printedWords.filter(w => !onPage(set, w));
      const pgOf = pno => pages.find(pg => pg.page === pno);
      if (!missing.length) {
        const span = pgOf(e.page) ? findSpan(pgOf(e.page), printedSeq, acceptedTokens) : null;
        e.contiguous = !!span;
        if (span) { e.status = verdict(e); accept(e, span); continue; }
        // the words are on the page, but not as one printed span: a record padded with words from elsewhere on the page
        e.status = 'rejected'; e.reason = 'the printed words are on that page, but not as one printed span';
        result.defects.push({ path: e.path, document: doc, page: e.page, severity: 'major', kind: 'reworded', source: 'text-layer', confidence: 0.85,
          description: `Text-layer check: tx.edits[${e.index}] claims the ${doc} document prints „${e.printed}“ (p.${e.page}), but the page has these words only apart, not as one printed span — a record names the exact printed span it fixes. Re-read the passage, transcribe it verbatim, and record only the words that change.`, suggestedFix: null });
        continue;
      }
      const elsewhere = [...pageSets].filter(([pno, s]) => pno !== e.page && e.printedWords.every(w => onPage(s, w))).map(([pno]) => ({ pno, span: findSpan(pgOf(pno), printedSeq, acceptedTokens) })).filter(x => x.span);
      if (elsewhere.length) {
        // the printed form exists, on another page: the fix stands, the record's page is wrong
        e.status = 'misplaced'; e.contiguous = true; e.reason = `printed on p.${elsewhere.map(x => x.pno).join(', ')}`; accept(e, elsewhere[0].span);
        result.defects.push({ path: e.path, document: doc, page: elsewhere[0].pno, severity: 'minor', kind: 'other', source: 'text-layer', confidence: 0.8,
          description: `Text-layer check: tx.edits[${e.index}] records the printed „${e.printed}“ on ${doc} p.${e.page}, but the text layer has it on p.${elsewhere.map(x => x.pno).join(', ')} — correct the record's page.`, suggestedFix: null });
        continue;
      }
      e.status = 'rejected'; e.reason = `not in the text layer: ${missing.join(', ')}`;
      result.defects.push({ path: e.path, document: doc, page: e.page, severity: 'major', kind: 'reworded', source: 'text-layer', confidence: 0.85,
        description: `Text-layer check: tx.edits[${e.index}] claims the ${doc} document prints „${e.printed}“ (p.${e.page}), fixed to „${e.fixed}“, but the claimed printed form is not found in the text layer (${missing.map(w => `„${w}“`).join(', ')} printed nowhere on that page) — probably a misreading, not a printed error. Re-read the page and transcribe the printed wording verbatim; the record must go (a record whose field holds the printed wording lapses on its own).`, suggestedFix: null });
    }
    const ownLig = own === allWords ? ligPieces : new Set([...own].flatMap(ligPiecesOf));
    const present = t => inSet(allWords, t) || ligPieces.has(t.w);
    const presentInDoc = t => inSet(own, t) || ownLig.has(t.w);
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
      if (omissionPages && !omissionPages.has(pg.page)) continue;
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
          // a run whose printed span is mostly symbols is equation lettering the layer strings together ("Rp /Rs = , "
          // p 2 # 1/2 tF (1 ) b2 = p 1.0 tT": ioaa-2016-theory-qp), not a passage a transcription can omit
          if (text.length >= 20 && text.replace(/[\p{L}\s]/gu, '').length > 0.3 * text.length) { run = []; return; }
          const sibling = siblingHolding([...text.matchAll(WORD)].map(m => m[0]), run.map(t => t.raw), d.key, paperId);
          if (sibling) { result.notes.push(`${doc} p.${pg.page}: „${text.slice(0, 120)}“ is transcribed in ${sibling}, which shares this source file — not an omission of ${paperId}`); run = []; return; }
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
          if (acceptedTokens.has(t)) continue; // the printed span of a recorded D-P23 fix (result.edits)
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
            const extra = f.tokens.map(x => x.w).filter(w => w.length >= 4 && P.content.test(w) && !layerSet.has(w) && !fixedIn(f.path).has(w) && similar(w, t.w));
            if (extra.length === 1) { wrong = extra[0]; consumed.add(`${f.path}|${extra[0]}`); const out = replaceWord(f.text, extra[0], t.raw.replace(/-$/, '') || t.w); if (out !== f.text) fixed = out; }
          }
          if (fixed) {
            result.defects.push({ path: f.path, document: doc, page: pg.page, severity: 'major', kind: 'reworded', source: 'text-layer', confidence: 0.85,
              description: `Text-layer check: the page prints „${t.raw}“ (${doc} p.${pg.page}: „${printedLine.slice(0, 120)}“) where the transcription has „${wrong}“ and no tx.edits record explains it — ${RESTORE}.`, suggestedFix: fixed });
          } else {
            // a single missing word is a misreading (kind reworded: the replacement may be shorter), not an omission
            result.defects.push({ path: f.path, document: doc, page: pg.page, severity: 'major', kind: 'reworded', source: 'text-layer', confidence: 0.7,
              description: `Text-layer check: the printed word „${t.raw}“ (${doc} p.${pg.page}: „${printedLine.slice(0, 120)}“) does not appear in this field; re-read the passage and transcribe it verbatim (an obvious printed error may be fixed only with a tx.edits record).`, suggestedFix: null });
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
      const fixedHere = fixedIn(f.path); // the words a recorded, accepted D-P23 fix wrote into this field
      const extras = [...new Set(f.tokens.filter(x => x.w.length >= 5 && P.content.test(x.w) && !P.stop.test(x.w) && !fixedHere.has(x.w) && !layerSet.has(x.w) && !ligPresent(layerSet, x.w) && !other.some(s => s.has(x.w)) && !consumed.has(`${f.path}|${x.w}`) && !gluedInLayer(layerSet, x.w) && !brokenInLayer(layerSet, x.w)).map(x => x.raw))];
      if (!extras.length) continue;
      const minor = /\/(caption|title|label)$/.test(f.path);
      // an unprinted word with exactly one similar printed word ("закривя" / "закривява") is a misreading: fix it mechanically;
      // in alt text (the reader's own words) that is the only rule applied, as a minor defect
      // in alt text only a difference in the stem counts ("разнозначните"/"разноименните"); an ending is the reader's own inflection
      const commonSuffix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; };
      const altMisread = (a, b) => Math.abs(a.length - b.length) <= 1 && commonPrefix(a, b) >= 4 && commonSuffix(a, b) >= 3 && commonPrefix(a, b) < Math.min(a.length, b.length) - 3 && lev(a, b) <= 0.35 * Math.max(a.length, b.length);
      // a layer word that is the transcribed word cut at a line break („компонен“ + „тите“) is a fragment, not the printed spelling
      const fragmentOf = (x, w) => (w.startsWith(x) && layerSet.has(w.slice(x.length))) || (w.endsWith(x) && layerSet.has(w.slice(0, w.length - x.length)));
      const misread = extras.map(raw => { const w = norm(raw); const near = [...layerSet].filter(x => x.length >= 5 && P.content.test(x) && !fragmentOf(x, w) && (f.altText ? altMisread(x, w) : !allWords.has(x) && similar(x, w))); return near.length === 1 ? { raw, printed: layerRaw.get(near[0]) || near[0] } : null; }).filter(Boolean);
      let rest = extras;
      if (!minor && misread.length) {
        let fixed = f.text; for (const m of misread) fixed = replaceWord(fixed, m.raw, m.printed);
        if (fixed !== f.text) {
          info.unprinted += misread.length;
          result.defects.push({ path: f.path, document: doc, page: pages[0]?.page || 1, severity: f.altText ? 'info' : 'major', kind: 'reworded', source: 'text-layer', confidence: 0.8,
            description: `Text-layer check: the transcription has ${misread.map(m => `„${m.raw}“`).join(', ')} where the ${doc} document prints ${misread.map(m => `„${m.printed}“`).join(', ')}${f.altText ? ' — use the printed term if the description names it' : ` and no tx.edits record explains it — ${RESTORE}`}.`,
            // alt text is the reader's own description: a near-match between two real words is no misreading
            // („grey construction lines“ became „conservation lines“, wopho-2013-q2), so it is never rewritten mechanically
            suggestedFix: f.altText ? null : fixed });
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
        const content = f.tokens.filter(x => x.w.length >= 4 && P.content.test(x.w) && !P.stop.test(x.w));
        const cue = /^\s*(фиг|figure|fig|табл|схема|снимка|карта|диаграма|графика|рис)/iu.test(f.text);
        if (!cue || content.length >= 6 || extrasLeft.length >= 0.5 * Math.max(1, content.length)) {
          result.defects.push({ path: f.path, document: doc, page, severity: 'minor', kind: 'reworded', source: 'text-layer', confidence: 0.7,
            description: `Text-layer check: the caption „${f.text.slice(0, 80)}“ is not printed (${extrasLeft.length} of its ${content.length} words appear nowhere in the ${doc} document) — a caption is the printed caption line only; the field is dropped.`, suggestedFix: '' });
          continue;
        }
      }
      // a whole block of unprinted words on a page that carries a large graphic is text set as an image (a data table,
      // a figure's heading — nao-2016-iii-11-12): the layer cannot see it, the refix can; minor, so a dispute settles it
      const graphicOnPage = (regs?.pages?.find(pg => pg.page === page)?.regions || []).some(g => (g.areaFrac || 0) >= 0.08);
      const imageText = extrasLeft.length >= 8 && graphicOnPage;
      result.defects.push({ path: f.path, document: doc, page, severity: minor || imageText ? 'minor' : 'major', kind: 'reworded', source: 'text-layer', confidence: imageText ? 0.4 : 0.6,
        description: `Text-layer check: ${extrasLeft.length === 1 ? 'the word' : 'the words'} ${extrasLeft.map(w => `„${w}“`).join(', ')} in this field ${extrasLeft.length === 1 ? 'is' : 'are'} printed nowhere in the ${doc} document (a typo, a rewording or an unrecorded fix${imageText ? ' — or text set as an image: the page carries a large graphic, which the text layer cannot read' : ''}); re-read the passage on the page and transcribe it verbatim (an obvious printed error may be fixed only with a tx.edits record).`, suggestedFix: null, words: extrasLeft });
    }
  }
  for (const [doc, info] of Object.entries(result.documents)) if (!info.trusted) result.notes.push(`${doc}: not checked — ${info.reason}`);
  for (const e of edits) {
    if (e.status === 'pending') { e.status = 'unverified'; e.reason = `${e.document} document not checked — ${result.documents[e.document]?.reason || 'no text layer'}`; }
    result.edits.push({ index: e.index, path: e.path, document: e.document, page: e.page, kind: e.kind, printed: e.printed, fixed: e.fixed, status: e.status, ...(e.contiguous !== undefined ? { contiguous: e.contiguous } : {}), ...(e.reason ? { reason: e.reason } : e.problems.length ? { reason: e.problems.join('; ') } : {}) });
    if (['accepted', 'needs-model', 'unverified'].includes(e.status)) result.info.push({ path: e.path, document: e.document, page: e.page, severity: 'info', kind: 'source-error', source: 'text-layer',
      description: `Recorded D-P23 fix (${e.kind}): printed „${e.printed}“ → „${e.fixed}“ (${e.document} p.${e.page}) — ${e.status === 'accepted' ? 'the printed form is on that page of the text layer' : e.status === 'needs-model' ? 'the printed form is on that page of the text layer; an agreement fix needs a model checker reading the page (not a crops/mechanical check)' : `not verifiable here (${e.reason})`}.` });
  }
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
  result.summary = { defects: result.defects.length, critical: result.defects.filter(d => d.severity === 'critical').length, major: result.defects.filter(d => d.severity === 'major').length, minor: result.defects.filter(d => d.severity === 'minor').length, withFix: result.defects.filter(d => d.suggestedFix).length, edits: { recorded: edits.length, accepted: edits.filter(e => e.status === 'accepted').length, needsModel: edits.filter(e => e.status === 'needs-model').length, rejected: edits.filter(e => ['rejected', 'invalid', 'misplaced'].includes(e.status)).length, unverified: edits.filter(e => e.status === 'unverified').length, stale: edits.filter(e => e.status === 'stale').length }, checked: Object.entries(result.documents).filter(([, i]) => i.trusted).map(([d]) => d) };
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
