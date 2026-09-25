#!/usr/bin/env node
// prepare.mjs <paperId> [--problems <key>] [--solutions <key>] [--supplements <json-file>] [--force] [--gc]
// Downloads the source PDFs once, records hashes/page geometry, renders pages at
// 160 dpi and dumps the text layer. Idempotent by content hash: a second run
// with the same keys and unchanged bytes does no network and no rendering; a
// changed key, a hash mismatch or --force re-downloads and re-renders.
//   --gc   remove src/ and pages/ (large, reproducible) but keep manifest.json,
//          text/ and candidates/.
// prepare.mjs --txt-to-pdf <in.txt> <out.pdf>
//   converts one plain-text file the way a .txt archive document is converted (used by the tests).
// Sources that are not PDFs become one first: images (PIL), Word documents (office2pdf.ps1) and plain text (.txt:
// the IYPT problem lists, three IAO Bulgarian theory papers) — typeset by PyMuPDF on A4 in a TrueType font that has a
// glyph for every character, with a real text layer, so pages, text layer and the checks downstream work unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { supplementKeys, SUPPLEMENT_ID } from './supplements.mjs';
import {
  parseArgs, fail, run, resolvePaper, paperDir, manifestFile, readManifest, writeJson,
  sha256File, nowIso, RENDER_DPI, R2_REMOTE, which, ROOT, pdftotextBin,
} from './lib.mjs';

// Plain text to PDF (python3 + PyMuPDF). Decodes UTF-8/UTF-16 (BOM) or a Cyrillic/Latin code page, keeps the printed
// line breaks, wraps long lines, paginates, and writes a deterministic PDF (fixed metadata, no new document id), so
// converting the same bytes again yields the same sha256. Prints {encoding, font, pages, chars} as JSON.
const TXT_TO_PDF_PY = String.raw`import sys, os, json, unicodedata, fitz
src, out = sys.argv[1], sys.argv[2]
raw = open(src, 'rb').read()
# the archive's plain-text papers: UTF-16 with a BOM (IYPT), UTF-8, or Windows-1251 (old Bulgarian/Russian files)
if raw[:3] == b'\xef\xbb\xbf': enc, text = 'utf-8-sig', raw[3:].decode('utf-8')
elif raw[:2] in (b'\xff\xfe', b'\xfe\xff'): enc, text = 'utf-16', raw.decode('utf-16')
else:
    try: enc, text = 'utf-8', raw.decode('utf-8')
    except UnicodeDecodeError:
        # a single-byte code page: the one that reads the most Bulgarian/Russian (or accented Latin) letters, less a
        # penalty for capitals inside words; Windows-1251 and Mac Cyrillic share the lower case and differ in the capitals
        import re
        def score(enc, t):
            letters = len(re.findall('[\u0410-\u044f\u0401\u0451\u040d\u045d]', t)) if enc != 'cp1252' else len(re.findall('[\u00c0-\u024f]', t))
            mixed = len(re.findall('[A-Za-z][\u0400-\u04ff]|[\u0400-\u04ff][A-Za-z]', t))  # Latin and Cyrillic letters inside one word: a wrong code page
            return letters - 3 * len(re.findall('[\u0430-\u044fa-z\u00e0-\u00ff][\u0410-\u042f\u0401\u040d]', t)) - 3 * mixed - 5 * t.count('\ufffd')
        best_score = None
        for enc in ('cp1251', 'mac_cyrillic', 'cp1252'):
            t = raw.decode(enc, errors='replace')
            if best_score is None or score(enc, t) > best_score: best_score, best_enc, best_text = score(enc, t), enc, t
        enc, text = best_enc, best_text
text = unicodedata.normalize('NFC', text.replace('\r\n', '\n').replace('\r', '\n').replace('\u2028', '\n').replace('\u2029', '\n\n')).expandtabs(4)
text = ''.join(ch for ch in text if ch == '\n' or unicodedata.category(ch)[0] != 'C')
text = '\n'.join(l.rstrip() for l in text.split('\n')).strip('\n') + '\n'
need = sorted({ch for ch in text if not ch.isspace()})
# a font that has a glyph for every character of the file (Cyrillic, Greek, symbols); OLYMPIADS_TXT_FONT overrides
cands = [os.environ.get('OLYMPIADS_TXT_FONT'),
    '/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf',
    'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/ARIALUNI.TTF', 'C:/Windows/Fonts/segoeui.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf']
best = None
for f in [c for c in cands if c and os.path.exists(c)]:
    try: font = fitz.Font(fontfile=f)
    except Exception: continue
    miss = [ch for ch in need if not font.has_glyph(ord(ch))]
    if best is None or len(miss) < len(best[2]): best = (f, font, miss)
    if not miss: break
if best is None: sys.exit('no usable TrueType font found (set OLYMPIADS_TXT_FONT)')
if best[2]: sys.exit('font %s has no glyph for %s (set OLYMPIADS_TXT_FONT)' % (os.path.basename(best[0]), ''.join(best[2][:40])))
fontfile, font, _ = best
W, H, M, SIZE, LEAD = 595.0, 842.0, 56.0, 11.0, 1.35
width = W - 2 * M - 2  # a little slack so insert_textbox never re-wraps a measured line
lines = []
for para in text.split('\n'):
    if not para.strip(): lines.append(''); continue
    indent = len(para) - len(para.lstrip(' '))
    cur = ''
    for word in para.split(' '):
        cand = word if cur == '' else cur + ' ' + word
        if cur and font.text_length(cand, fontsize=SIZE) > width: lines.append(cur); cur = ' ' * indent + word
        else: cur = cand
        while font.text_length(cur, fontsize=SIZE) > width:  # one word wider than the page: break it
            n = len(cur)
            while n > 1 and font.text_length(cur[:n], fontsize=SIZE) > width: n -= 1
            lines.append(cur[:n]); cur = cur[n:]
    lines.append(cur)
while lines and lines[-1] == '': lines.pop()
per = int((H - 2 * M) // (SIZE * LEAD)) - 1
doc = fitz.open()
for i in range(0, max(1, len(lines)), per):
    page = doc.new_page(width=W, height=H)
    rest = page.insert_textbox(fitz.Rect(M, M, W - M, H - M), '\n'.join(lines[i:i + per]), fontsize=SIZE, fontname='src', fontfile=fontfile, lineheight=LEAD)
    if rest < 0: sys.exit('text did not fit on page %d' % (i // per + 1))
doc.set_metadata({'title': os.path.basename(src), 'producer': 'olympiads-xyz prepare.mjs (plain text, %s)' % enc, 'creator': '', 'creationDate': '', 'modDate': ''})
doc.subset_fonts()
# the ToUnicode map of a TrueType font names one character per glyph, and fonts give '-' and the soft hyphen one glyph,
# so the text layer would read U+00AD for every hyphen: rewrite it to name the characters this file actually uses
gid = {}
for ch in text:
    if not ch.isspace() or ch == ' ': gid.setdefault(font.has_glyph(ord(ch)), ch)
def u16(ch):
    b = ch.encode('utf-16-be'); return ''.join('%02x' % x for x in b)
items = sorted((g, c) for g, c in gid.items() if g)
body = ''.join('%d beginbfchar\n%s\nendbfchar\n' % (len(items[i:i + 100]), '\n'.join('<%04x> <%s>' % (g, u16(c)) for g, c in items[i:i + 100])) for i in range(0, len(items), 100))
cmap = ('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
        '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n' + body +
        'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n')
fixed = 0
for x in range(1, doc.xref_length()):
    if doc.xref_is_stream(x) and b'begincmap' in doc.xref_stream(x): doc.update_stream(x, cmap.encode('ascii')); fixed += 1
if not fixed: sys.exit('no ToUnicode map found in the generated PDF')
doc.save(out, garbage=4, deflate=True, no_new_id=True)
print(json.dumps({'encoding': enc, 'font': os.path.basename(fontfile), 'pages': doc.page_count, 'chars': len(text)}))
`;
function txtToPdf(txt, pdf) {
  const r = run('python3', ['-c', TXT_TO_PDF_PY, txt, pdf], { allowFail: true });
  if (r.status !== 0 || !fs.existsSync(pdf)) return { error: (r.stderr || r.stdout || '').trim().split('\n').pop().slice(0, 300) || `exit ${r.status}` };
  try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return {}; }
}
if (process.argv[2] === '--txt-to-pdf') {
  const [inp, out] = process.argv.slice(3);
  if (!inp || !out) fail('usage: prepare.mjs --txt-to-pdf <in.txt> <out.pdf>');
  const r = txtToPdf(inp, out);
  if (r.error) fail(`plain text to PDF conversion failed: ${r.error}`);
  console.log(JSON.stringify(r));
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2), { flags: ['force', 'gc', 'json'] });
const paperId = args._[0];
if (!paperId) fail('usage: prepare.mjs <paperId> [--problems <key>] [--solutions <key>] [--force] [--gc]');

const dir = paperDir(paperId);
if (args.gc) {
  for (const sub of ['src', 'pages', 'figs']) fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  const m = readManifest(paperId);
  if (m) { m.gcAt = nowIso(); writeJson(manifestFile(paperId), m); }
  console.log(`gc: removed src/, pages/, figs/ under ${path.relative(process.cwd(), dir)}`);
  process.exit(0);
}
for (const tool of ['rclone', 'pdftoppm', 'pdftotext', 'pdfinfo']) if (!which(tool)) fail(`${tool} not found on PATH`);

const { meta, keys, origin } = resolvePaper(paperId, { problems: args.problems, solutions: args.solutions });
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
fs.mkdirSync(path.join(dir, 'text'), { recursive: true });
fs.mkdirSync(path.join(dir, 'candidates'), { recursive: true });

const previous = readManifest(paperId); // --force re-downloads and re-renders regardless of it
// Explicit file wins; otherwise preserve declared sources from a prior prepare.
// Use an empty object file to deliberately remove supplements from the manifest.
const supplementInput = args.supplements
  ? JSON.parse(fs.readFileSync(path.resolve(args.supplements), 'utf8'))
  : { ...Object.fromEntries(Object.entries(previous?.documents || {}).filter(([id]) => SUPPLEMENT_ID.test(id)).map(([id, d]) => [id, d.key])), ...Object.fromEntries(Object.entries(keys).filter(([id]) => SUPPLEMENT_ID.test(id))) };
for (const id of Object.keys(keys)) if (SUPPLEMENT_ID.test(id)) delete keys[id];
Object.assign(keys, supplementKeys(supplementInput));
const manifest = {
  paperId, meta, origin, renderDpi: RENDER_DPI,
  documents: {},
  preparedAt: nowIso(),
};

function pdfInfo(file) {
  const out = run('pdfinfo', ['-f', '1', '-l', '10000', file]).stdout;
  const pages = Number(/^Pages:\s+(\d+)/m.exec(out)?.[1]);
  const pageSizes = [];
  for (const m of out.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)) pageSizes[Number(m[1]) - 1] = { page: Number(m[1]), widthPt: Number(m[2]), heightPt: Number(m[3]) };
  // pdfinfo reports the unrotated media box, but pdftoppm renders the page as
  // displayed (/Rotate applied) and every box a reader proposes is relative to
  // that image; pdfcrop.py's page.rect is rotated too. Record the displayed size.
  for (const m of out.matchAll(/^Page\s+(\d+) rot:\s+(\d+)/gm)) {
    const s = pageSizes[Number(m[1]) - 1], rot = Number(m[2]) % 360;
    if (!s || !rot) continue;
    s.rotation = rot;
    if (rot === 90 || rot === 270) [s.widthPt, s.heightPt] = [s.heightPt, s.widthPt];
  }
  if (!pages || pageSizes.length !== pages) throw new Error(`pdfinfo could not read page geometry of ${file}`);
  return { pages, pageSizes, producer: /^Producer:\s+(.*)$/m.exec(out)?.[1] || null };
}

function renderedPages(doc, expected) {
  const files = fs.readdirSync(path.join(dir, 'pages')).filter(f => f.startsWith(`${doc}-`) && f.endsWith('.png')).sort();
  return files.length === expected ? files.map(f => `pages/${f}`) : null;
}

const converted = {}; // doc -> how a non-PDF source became src/<doc>.pdf (plain text only, for now)
for (const doc of Object.keys(keys)) {
  const key = keys[doc];
  if (!key) continue;
  const file = path.join(dir, 'src', `${doc}.pdf`);
  const prev = previous?.documents?.[doc];
  let downloaded = false;
  // Re-download when there is no file, when --force was given, when the archive
  // key differs from the one the cached file came from, or when the cached bytes
  // no longer match the manifest (a partial or tampered file).
  const stale = !fs.existsSync(file) || args.force || !prev || prev.key !== key || sha256File(file) !== prev.sha256;
  if (stale) {
    fs.rmSync(file, { force: true });
    if (/\.(jpe?g|png|gif)$/i.test(key)) {
      // a photographed or scanned sheet: one image becomes a one-page PDF (PIL), then the usual route
      const img = file.replace(/\.pdf$/, path.extname(key).toLowerCase());
      run('rclone', ['copyto', `${R2_REMOTE}/${key}`, img]);
      const r = run('python3', ['-c', "import sys; from PIL import Image\nim=Image.open(sys.argv[1]); im=im.convert('RGB')\nim.save(sys.argv[2], 'PDF', resolution=150.0)", img, file], { allowFail: true });
      if (r.status !== 0 || !fs.existsSync(file)) fail(`image to PDF conversion failed for ${key}: ${(r.stderr || '').trim().slice(0, 300)}`);
    } else if (/\.(docx?|rtf|odt)$/i.test(key)) {
      // a Word document in the archive: fetched as is, printed to PDF by the installed Word (office2pdf.ps1)
      const office = file.replace(/\.pdf$/, path.extname(key).toLowerCase());
      run('rclone', ['copyto', `${R2_REMOTE}/${key}`, office]);
      const r = run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'tx', 'office2pdf.ps1'), '-In', office, '-Out', file], { allowFail: true });
      if (r.status !== 0 || !fs.existsSync(file)) fail(`Word to PDF conversion failed for ${key}: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
    } else if (/\.txt$/i.test(key)) {
      // a plain-text paper (IYPT problem lists, IAO Bulgarian theory): fetched as is, typeset to PDF by PyMuPDF
      const txt = file.replace(/\.pdf$/, '.txt');
      run('rclone', ['copyto', `${R2_REMOTE}/${key}`, txt]);
      const r = txtToPdf(txt, file);
      if (r.error) fail(`plain text to PDF conversion failed for ${key}: ${r.error}`);
      converted[doc] = { from: 'txt', sourceSha256: sha256File(txt), encoding: r.encoding || null, font: r.font || null };
    } else run('rclone', ['copyto', `${R2_REMOTE}/${key}`, file]);
    downloaded = true;
  }
  const sha256 = sha256File(file);
  const bytes = fs.statSync(file).size;
  const info = pdfInfo(file);
  // Render only when the cached pages do not correspond to these exact bytes.
  let pageImages = !args.force && prev && prev.sha256 === sha256 && prev.renderDpi === RENDER_DPI ? renderedPages(doc, info.pages) : null;
  if (!pageImages) {
    for (const f of fs.readdirSync(path.join(dir, 'pages'))) if (f.startsWith(`${doc}-`)) fs.rmSync(path.join(dir, 'pages', f));
    run('pdftoppm', ['-r', String(RENDER_DPI), '-png', file, path.join(dir, 'pages', doc)]);
    // pdftoppm pads page numbers to the width of the page count; normalise to two digits.
    for (const f of fs.readdirSync(path.join(dir, 'pages'))) {
      const m = new RegExp(`^${doc}-(\\d+)\\.png$`).exec(f);
      if (!m) continue;
      const target = `${doc}-${String(Number(m[1])).padStart(2, '0')}.png`;
      if (target !== f) fs.renameSync(path.join(dir, 'pages', f), path.join(dir, 'pages', target));
    }
    pageImages = renderedPages(doc, info.pages);
    if (!pageImages) throw new Error(`rendering ${doc} produced an unexpected page count`);
  }
  const textFile = path.join(dir, 'text', `${doc}.txt`);
  // The text layer belongs to these exact bytes: regenerate after any download or hash change.
  if (!fs.existsSync(textFile) || downloaded || prev?.sha256 !== sha256) { fs.rmSync(textFile, { force: true }); run(pdftotextBin(), ['-enc', 'UTF-8', '-layout', file, textFile], { allowFail: true }); }
  const text = fs.existsSync(textFile) ? fs.readFileSync(textFile, 'utf8') : '';
  // a converted source keeps its record while the cached PDF is the one it produced
  const conv = converted[doc] || (prev?.converted && prev.key === key && prev.sha256 === sha256 ? prev.converted : null);
  manifest.documents[doc] = {
    key, file: `src/${doc}.pdf`, sha256, bytes, pages: info.pages, pageSizes: info.pageSizes, producer: info.producer,
    renderDpi: RENDER_DPI, pageImages, text: `text/${doc}.txt`,
    textChars: text.trim().length, textDigits: (text.match(/\d/g) || []).length,
    downloaded,
    ...(conv ? { converted: conv } : {}),
  };
}
if (!manifest.documents.problems) fail('no problems document resolved');
if (previous?.preparedAt && Object.values(manifest.documents).every(d => !d.downloaded)) manifest.firstPreparedAt = previous.firstPreparedAt || previous.preparedAt;
else manifest.firstPreparedAt = previous?.firstPreparedAt || manifest.preparedAt;
writeJson(manifestFile(paperId), manifest);

if (args.json) console.log(JSON.stringify(manifest, null, 2));
else {
  console.log(`prepared ${paperId} (${origin}) -> ${path.relative(process.cwd(), dir)}`);
  for (const [doc, d] of Object.entries(manifest.documents)) console.log(`  ${doc}: ${d.pages} page(s), ${(d.bytes / 1024).toFixed(0)} KB, sha256 ${d.sha256.slice(0, 12)}…, text ${d.textChars} chars/${d.textDigits} digits${d.downloaded ? '' : ' (cached)'}`);
}
