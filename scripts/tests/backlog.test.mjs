// Tests for scripts/tx/backlog.mjs (which catalogue documents are still to transcribe) and the plain-text route of
// scripts/tx/prepare.mjs. The unit tests are synthetic; the catalogue test reads the repository's own catalogue,
// content/problems and content/backlog-exclusions.json (no network); the .txt → PDF test needs python3 with
// PyMuPDF and pdftotext and is skipped without them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const txScript = name => path.join(repo, 'scripts', 'tx', name);
const txModule = name => pathToFileURL(txScript(name)).href;
const backlog = await import(txModule('backlog.mjs'));
const lib = await import(txModule('lib.mjs'));
const { isMulti, leftOutReason, loadExclusions, shadowingRow, shardLookup, bucketCollisions, publishedBuckets, EXCLUSIONS_FILE } = backlog;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-test-'));
const nfc = s => s.normalize('NFC');

test('isMulti: "multi" only as a whole word of the file name', () => {
  for (const f of ['Физика/Състезания/IZhO/2023/Theory/IZhO-2023-Theory_multi.pdf', 'x/IZhO-2024-Exp_multi.pdf', 'a/paper-multi.pdf', 'a/multi.pdf', 'a/MULTI_lang.pdf', 'a/theory multi (1).pdf'])
    assert.equal(isMulti(f), true, f);
  for (const f of ['Астрономия/Състезания/IOAA-Jr/2022/Theoretical/Problems/Multiple_Choice.pdf', 'a/multimeter.pdf', 'a/multiple-choice.pdf', 'a/semultima.pdf', 'multi/theory.pdf'])
    assert.equal(isMulti(f), false, f);
});

const liveIndex = entries => ({
  byId: new Map(entries.map(([id, key]) => [id, { file: `${id}.json`, paper: { id, source: { archiveKey: key } } }])),
  byKey: new Map(entries.map(([id, key]) => [key, id])),
});

test('leftOutReason: a document a published paper holds leaves the backlog whatever id it derives', () => {
  const live = liveIndex([['nof-2015-iii-10-12-d1', 'Физика/NOF/2015/NOF3_2015_10-12problemsD1.pdf']]);
  // the derived proposal (nof-2015-iii-10-12) is not the published id, the archive key still matches
  assert.equal(leftOutReason({ problemsKey: 'Физика/NOF/2015/NOF3_2015_10-12problemsD1.pdf' }, 'nof-2015-iii-10-12', { live }), 'live');
  // an NFD spelling of the same key (macOS file names) is the same document
  const nfdLive = liveIndex([['iao-2003-x', 'Астрономия/IAO/2003/Български/theo.doc'.normalize('NFD')]]);
  assert.equal(leftOutReason({ problemsKey: 'Астрономия/IAO/2003/Български/theo.doc'.normalize('NFC') }, 'whatever', { live: nfdLive }), 'live');
  // another file whose id a published paper holds is left out too (it would be prepared over that paper)
  assert.equal(leftOutReason({ problemsKey: 'Физика/ESF/2019/esenni_2019_10problems.pdf' }, 'nof-2015-iii-10-12-d1', { live }), 'live-id');
  // a sibling document of the same round stays
  assert.equal(leftOutReason({ problemsKey: 'Физика/NOF/2015/NOF3_2015_10-12problemsExp.pdf' }, 'nof-2015-iii-10-12-exp', { live }), null);
  // a twin of another row, a staged paper, a reviewed exclusion
  assert.equal(leftOutReason({ problemsKey: 'a.pdf', duplicateOf: 'b.pdf' }, 'x-1', { live }), 'duplicate');
  assert.equal(leftOutReason({ problemsKey: 'a.pdf' }, 'x-1', { live, staged: new Map([['x-1', null]]) }), 'staged');
  assert.equal(leftOutReason({ problemsKey: 'a.pdf' }, 'x-2', { live, stagedKeys: new Set(['a.pdf']) }), 'staged');
  assert.equal(leftOutReason({ problemsKey: 'Пролетни/2012/Тема7.doc'.normalize('NFD') }, 'psf-2012-proletno-7-doc', { live, exclusions: new Map([[nfc('Пролетни/2012/Тема7.doc'), {}]]) }), 'excluded');
});

test('loadExclusions: validated entries keyed by the NFC archive key', () => {
  const dir = tmp();
  const file = path.join(dir, 'ex.json');
  assert.equal(loadExclusions(path.join(dir, 'missing.json')).size, 0);
  const entry = { key: 'Пролетни/2012/Тема7.doc'.normalize('NFD'), reason: 'Word original of the published PDF paper', duplicateOf: 'psf-2012-proletno-7', evidence: 'titles match' };
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [entry] }));
  const m = loadExclusions(file);
  assert.equal(m.size, 1);
  assert.equal(m.get(nfc('Пролетни/2012/Тема7.doc')).duplicateOf, 'psf-2012-proletno-7');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ ...entry, evidence: '' }] }));
  assert.throws(() => loadExclusions(file), /evidence/);
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [entry, { ...entry, key: nfc(entry.key) }] }));
  assert.throws(() => loadExclusions(file), /twice/);
  fs.writeFileSync(file, JSON.stringify([entry]));
  assert.throws(() => loadExclusions(file), /entries/);
  fs.writeFileSync(file, '{');
  assert.throws(() => loadExclusions(file));
});

test('content/backlog-exclusions.json: each entry is an unpublished catalogue document duplicating a published paper in its language', () => {
  const ex = loadExclusions(EXCLUSIONS_FILE);
  assert.ok(ex.size > 0);
  const live = lib.existingPaperIndex();
  const liveKeys = new Set([...live.byKey.keys()].map(nfc));
  const cat = new Map(lib.loadCatalogue().filter(e => e.kind === 'competition' && e.type === 'problems').map(e => [nfc(e.file), e]));
  for (const [key, e] of ex) {
    const c = cat.get(key);
    assert.ok(c, `${e.key}: not a catalogue problems document`);
    assert.ok(!liveKeys.has(key), `${e.key}: is itself published`);
    const ids = e.duplicateOf.split(/,\s*/);
    for (const id of ids) {
      const p = live.byId.get(id)?.paper;
      assert.ok(p, `${e.key}: duplicateOf ${id} is not a published paper`);
      assert.equal(p.competition, c.competition, `${e.key}: another competition than ${id}`);
      assert.equal(p.lang, c.lang, `${e.key}: a translation of ${id} is a page of its own, not an exclusion`);
      assert.equal(p.year, c.year, `${e.key}: another year than ${id}`);
    }
  }
});

test('bucketCollisions: rows that may be a published paper filed under another name', () => {
  const pub = (id, year, grade, extra = {}) => ({ id, key: `${id}.pdf`, competition: 'PSF', year, round: null, grade, lang: 'bg', ...extra });
  const pubs = [pub('psf-2016-proletno-11-12', 2016, '11-12'), pub('psf-2016-proletno-7', 2016, '7'), pub('psf-2003-esenno-10', 2003, '10'), pub('psf-2016-en', 2016, '11-12', { lang: 'en' }), pub('psf-2016-r2', 2016, '11-12', { round: 'II' })];
  const row = (paperId, year, grade) => ({ paperId, competition: 'PSF', year, round: null, grade, lang: 'bg', problemsKey: `${paperId}.pdf` });
  const hits = r => bucketCollisions([r], pubs).map(h => `${h.pub.id}${h.exact ? '=' : '~'}`).sort();
  // same bucket: a problems+solutions file of the published paper
  assert.deepEqual(hits(row('psf-2016-proletno-11-12-12', 2016, '11-12')), ['psf-2016-proletno-11-12=']);
  // a whole-competition book (no grade) meets every grade of its year; another language or round is not a candidate
  assert.deepEqual(hits(row('psf-2016-proletno-burgas', 2016, null)), ['psf-2016-proletno-11-12~', 'psf-2016-proletno-7~']);
  // a folder year off by one (esenni_2004_10problems.pdf is the 2003 paper), not two
  assert.deepEqual(hits(row('psf-2004-esenno-10', 2004, '10')), ['psf-2003-esenno-10~']);
  assert.deepEqual(hits(row('psf-2005-esenno-10', 2005, '10')), []);
  // another grade of the same year is not a candidate
  assert.deepEqual(hits(row('psf-2016-proletno-9', 2016, '9')), []);
  // publishedBuckets reads the catalogue metadata of each published key (NFC or NFD)
  const live = liveIndex([['psf-x', 'Пролетни/2016/x.pdf'.normalize('NFD')]]);
  const cat = [{ file: 'Пролетни/2016/x.pdf', competition: 'PSF', year: 2016, round: null, group: '11-12', lang: 'bg' }];
  assert.deepEqual(publishedBuckets(live, cat).map(p => [p.id, p.grade, p.year]), [['psf-x', '11-12', 2016]]);
});

test('shadowingRow: an id prepare.mjs would resolve to another shard document', () => {
  const live = liveIndex([['nof-2014-iii-10-12-d1', 'NOF/2014/NOF3_2014_10-12problemsD1.pdf']]);
  const d1 = { competition: 'NOF', year: 2014, round: 'III', grade: '10-12', problemsKey: 'NOF/2014/NOF3_2014_10-12problemsD1.pdf' };
  const shards = shardLookup([d1], live);
  // the published D1 file derives nof-2014-iii-10-12 as its proposal: that id resolves to D1, not to D2
  assert.equal(lib.derivePaperId(d1), 'nof-2014-iii-10-12');
  assert.equal(shadowingRow('nof-2014-iii-10-12', 'NOF/2014/NOF3_2014_10-12problemsD2.pdf', shards), d1);
  assert.equal(shadowingRow('nof-2014-iii-10-12', 'NOF/2014/NOF3_2014_10-12problemsD1.pdf', shards), null);
  assert.equal(shadowingRow('nof-2014-iii-10-12-d2', 'NOF/2014/NOF3_2014_10-12problemsD2.pdf', shards), null);
});

test('backlog.mjs --catalogue: no published or excluded document, the fixed rows present, ids unique and resolvable', () => {
  const r = spawnSync(process.execPath, [txScript('backlog.mjs'), '--catalogue', '--json'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  const live = lib.existingPaperIndex();
  const liveKeys = new Set([...live.byKey.keys()].map(nfc));
  const ex = loadExclusions(EXCLUSIONS_FILE);
  const byKey = new Map(rows.map(x => [nfc(x.problemsKey), x]));
  for (const x of rows) {
    assert.ok(!liveKeys.has(nfc(x.problemsKey)), `published document listed: ${x.problemsKey}`);
    assert.ok(!ex.has(nfc(x.problemsKey)), `excluded document listed: ${x.problemsKey}`);
    assert.ok(!live.byId.has(x.paperId), `published id listed: ${x.paperId}`);
  }
  assert.equal(new Set(rows.map(x => x.paperId)).size, rows.length, 'paper ids are unique');
  // (each fixed row is listed, or has been published since)
  const listed = key => byKey.get(nfc(key)) || (liveKeys.has(nfc(key)) ? 'published' : null);
  // the reviewed bucket collisions: re-uploads, Word sources, problems+solutions files and whole-competition books of
  // published papers (content/backlog-exclusions.json) are not listed
  for (const key of ['Физика/Състезания/Пролетни/2012/Spec Tema zad final.doc', 'Физика/Състезания/Есенни/2016/11-12.pdf', 'Физика/Състезания/Пролетни/2016/11-12.pdf',
    'Физика/Състезания/Пролетни/2018/st.pdf', 'Физика/Състезания/Пролетни/2001/spec.pdf', 'Физика/Състезания/Пролетни/2002/spec.pdf', 'Физика/Състезания/Пролетни/2011/9_9.pdf',
    'Астрономия/Състезания/Национална олимпиада/2002/2002-II/02-II-78.doc', 'Физика/Състезания/Есенни/2004/esenni_2004_10problems.pdf',
    'Физика/Състезания/Пролетни/2016/proletno_burgas.pdf', 'Астрономия/Състезания/IOAA/2021/Theory/Theory Problems.pdf', 'Физика/Състезания/RMPh/2017/2.pdf'])
    { assert.ok(ex.has(nfc(key)), `not in backlog-exclusions.json: ${key}`); assert.ok(!byKey.has(nfc(key)), `reviewed duplicate listed: ${key}`); }
  // "Multiple_Choice" is not a multilingual twin
  assert.ok(listed('Астрономия/Състезания/IOAA-Jr/2022/Theoretical/Problems/Multiple_Choice.pdf'));
  // the IYPT years that exist only as plain text are papers
  for (const y of [1994, 2003, 2014]) assert.ok(listed(`Физика/Състезания/IYPT/${y}.txt`), `IYPT ${y}.txt`);
  // the rounds whose derived id resolved to a published sibling take an id of their own
  for (const [key, id] of [['Физика/Състезания/Национална олимпиада/III Национален кръг/2014/NOF3_2014_10-12problemsD2.pdf', 'nof-2014-iii-10-12-d2'],
    ['Физика/Състезания/Национална олимпиада/III Национален кръг/2015/NOF3_2015_10-12problemsExp.pdf', 'nof-2015-iii-10-12-exp']]) {
    if (listed(key) === 'published') continue;
    assert.equal(byKey.get(nfc(key))?.paperId, id, key);
    assert.doesNotThrow(() => lib.resolvePaper(id, { problems: key }));
  }
});

const havePy = spawnSync('python3', ['-c', 'import fitz'], { encoding: 'utf8' }).status === 0 && spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).status === 0;
test('prepare.mjs --txt-to-pdf: UTF-8, UTF-16 and Cyrillic code pages typeset with a faithful text layer', { skip: !havePy && 'python3 + PyMuPDF or pdftotext missing' }, () => {
  const dir = tmp();
  const bg = '2001 - теоретичен тур:\n\n1. На каква дълбочина трябва да се отшлифова огледало с диаметър D = 250 mm?\n2. Земята, Луната и Слънцето — °C, ±, µm, Ω, Δt, 5×10^-3 „кавички“.\n';
  const en = '7th IYPT (1994)\n\n1. Optics\nThink up and solve a problem connected with employing a thin lens of a large focal length. ' + 'A long line that must wrap across the page width without losing any word. '.repeat(12) + '\n';
  const cases = [
    ['utf8.txt', Buffer.from(bg, 'utf8'), bg, 'utf-8'],
    ['utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(en.replace(/\n/g, '\r\n'), 'utf16le')]), en, 'utf-16'],
    // Windows-1251 and Mac Cyrillic (the IAO files): same lower case, different capitals and я
    ['cp1251.txt', Buffer.from([0xcd, 0xe0, 0x20, 0xea, 0xe0, 0xea, 0xe2, 0xe0, 0x20, 0xff, 0xe1, 0xfa, 0xeb, 0xea, 0xe0, 0x20, 0xc7, 0xe5, 0xec, 0xff, 0xf2, 0xe0, 0x2e, 0x0d, 0x0a]), 'На каква ябълка Земята.\n', 'cp1251'],
    ['mac.txt', Buffer.from([0x8d, 0xe0, 0x20, 0xea, 0xe0, 0xea, 0xe2, 0xe0, 0x20, 0xdf, 0xe1, 0xfa, 0xeb, 0xea, 0xe0, 0x20, 0x87, 0xe5, 0xec, 0xdf, 0xf2, 0xe0, 0x2e, 0x0d, 0x0a]), 'На каква ябълка Земята.\n', 'mac_cyrillic'],
  ];
  const squash = s => s.normalize('NFC').replace(/\s+/g, ' ').trim();
  for (const [name, bytes, expected, enc] of cases) {
    const src = path.join(dir, name), pdf = src.replace(/\.txt$/, '.pdf');
    fs.writeFileSync(src, bytes);
    const r = spawnSync(process.execPath, [txScript('prepare.mjs'), '--txt-to-pdf', src, pdf], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    assert.equal(info.encoding, enc, name);
    const text = spawnSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }).stdout;
    assert.equal(squash(text), squash(expected), `${name}: the text layer reads the source`);
    assert.ok(!text.includes('­'), `${name}: hyphens stay hyphens`);
    // deterministic: the same bytes give the same PDF (receipts bind the PDF's sha256)
    const again = pdf.replace(/\.pdf$/, '.2.pdf');
    assert.equal(spawnSync(process.execPath, [txScript('prepare.mjs'), '--txt-to-pdf', src, again], { encoding: 'utf8' }).status, 0);
    const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    assert.equal(sha(again), sha(pdf), `${name}: deterministic output`);
  }
  // the long English line wrapped onto several lines of one A4 page, and the page renders (a readable page image)
  const pages = spawnSync('pdfinfo', [path.join(dir, 'utf16.pdf')], { encoding: 'utf8' }).stdout;
  assert.match(pages, /Pages:\s+1\b/);
  assert.match(pages, /Page size:\s+595 x 842 pts/);
  const png = spawnSync('pdftoppm', ['-r', '40', '-png', '-singlefile', path.join(dir, 'utf8.pdf'), path.join(dir, 'page')], { encoding: 'utf8' });
  assert.equal(png.status, 0, png.stderr);
  assert.ok(fs.statSync(path.join(dir, 'page.png')).size > 2000, 'the page image has ink on it');
});
