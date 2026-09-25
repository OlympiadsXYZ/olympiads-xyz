import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { XLSX_RENDERER, XLSX_RENDERER_FINGERPRINT, xlsxCacheValid } from '../tx/xlsx-source.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const helper = path.join(repo, 'scripts/tx/xlsx-to-pdf.py');
const python = process.env.OLYMPIADS_TEST_PYTHON || 'python3';
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-source-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('xlsx-source-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}

test('XLSX cache rejects mislabeled bytes, missing provenance, changed workbook and renderer', t => {
  const dir = scratch(t), pdf = path.join(dir, 'source.pdf'), source = path.join(dir, 'source.xlsx');
  fs.writeFileSync(source, 'PK workbook bytes');
  fs.writeFileSync(pdf, '%PDF- derived bytes');
  const previous = { sha256: hash(pdf), converted: { renderer: XLSX_RENDERER, rendererFingerprint: XLSX_RENDERER_FINGERPRINT, sourceSha256: hash(source), pdfSha256: hash(pdf) } };
  assert.equal(xlsxCacheValid(previous, pdf, source), true);
  assert.equal(xlsxCacheValid({ sha256: hash(pdf) }, pdf, source), false);
  assert.equal(xlsxCacheValid({ ...previous, converted: { ...previous.converted, rendererFingerprint: 'old' } }, pdf, source), false);
  fs.writeFileSync(source, 'modified workbook');
  assert.equal(xlsxCacheValid(previous, pdf, source), false);
  fs.copyFileSync(source, pdf);
  previous.sha256 = previous.converted.pdfSha256 = hash(pdf);
  previous.converted.sourceSha256 = hash(source);
  assert.equal(xlsxCacheValid(previous, pdf, source), false, 'matching hashes cannot turn ZIP bytes into PDF');
});

test('preflight rejects refreshable sources and missing caches; cache comparison detects recalculation', t => {
  const dir = scratch(t);
  // Minimal OOXML package fragments exercise the read-only parser, not a substitute renderer.
  run(python, ['-c', `import importlib.util,sys,zipfile,pathlib
spec=importlib.util.spec_from_file_location('native_xlsx',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root=pathlib.Path(sys.argv[2]); ns=m.NS['s']; rel=m.REL[1:].split('}')[0]
parts={'xl/workbook.xml':f'<workbook xmlns="{ns}" xmlns:r="{rel}"><sheets><sheet name="Test" sheetId="1" r:id="rId1"/></sheets></workbook>',
'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
'xl/worksheets/sheet1.xml':f'<worksheet xmlns="{ns}"><sheetData><row r="1"><c r="A1"><f>1+2</f><v>77</v></c></row></sheetData></worksheet>'}
def write(name,p):
 with zipfile.ZipFile(root/name,'w') as z:
  for key,value in p.items():z.writestr(key,value)
write('valid.xlsx',parts); original=m.inventory(root/'valid.xlsx')
m.check_values(original,[{'sheet':'Test','address':'A1','value':77,'text':'77'}])
try:m.check_values(original,[{'sheet':'Test','address':'A1','value':3,'text':'3'}])
except ValueError as e:assert 'changed cached' in str(e)
else:raise AssertionError('recalculation was not caught')
write('refresh.xlsx',{**parts,'xl/connections.xml':'<connections/>'})
try:m.inventory(root/'refresh.xlsx')
except ValueError as e:assert 'unsupported external' in str(e)
else:raise AssertionError('refreshable source accepted')
parts['xl/worksheets/sheet1.xml']=parts['xl/worksheets/sheet1.xml'].replace('<v>77</v>','')
write('missing.xlsx',parts)
try:m.inventory(root/'missing.xlsx')
except ValueError as e:assert 'Missing cached formula' in str(e)
else:raise AssertionError('missing cache accepted')`, helper, dir]);
});

test('native Excel preserves cached values/print areas, inventories omissions and appends complete chart; prepare reuses verified cache', { skip: process.platform !== 'win32' || process.env.OLYMPIADS_TEST_EXCEL !== '1' }, t => {
  const dir = scratch(t), source = path.join(dir, 'source.xlsx'), pdf = path.join(dir, 'source.pdf');
  const fixture = path.join(dir, 'fixture.ps1');
  fs.writeFileSync(fixture, `param([string]$Out)
$ErrorActionPreference='Stop'; $app=$null; $book=$null
try {
 $app=New-Object -ComObject Excel.Application; $app.Visible=$false; $app.DisplayAlerts=$false; $app.AutomationSecurity=3
 $book=$app.Workbooks.Add(-4167); $sheet=$book.Worksheets.Item(1); $sheet.Name='Visible'
 $sheet.Range('A1').Value2='x'; $sheet.Range('B1').Value2='y'
 $sheet.Range('A2').Value2=1; $sheet.Range('A3').Value2=2; $sheet.Range('A4').Value2=3
 $sheet.Range('B2').Formula='=1+2'; $sheet.Range('B3').Value2=4; $sheet.Range('B4').Value2=5
 $sheet.Range('C8').Value2='OMITTED ANSWER'; $sheet.Range('A3').EntireRow.Hidden=$true
 $sheet.PageSetup.PrintArea='$A$1:$B$4'
 $chart=$sheet.ChartObjects().Add(600,30,500,280); $chart.Name='Complete chart'; $chart.Chart.SetSourceData($sheet.Range('A1:B4')); $chart.Chart.ChartType=74
 $hidden=$book.Worksheets.Add(); $hidden.Name='Hidden answers'; $hidden.Range('A1').Formula='=8+1'; $hidden.Visible=0
 $app.Calculate(); $book.SaveAs($Out,51)
} finally {if($book){$book.Close($false)}; if($app){$app.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)}}
`, 'utf8');
  run('powershell', ['-NoProfile', '-File', fixture, '-Out', source]);
  // Deliberately stale cached 77 (formula is 1+2): export must retain it, never recalculate.
  run(python, ['-c', `import zipfile,sys,re
p=sys.argv[1]
with zipfile.ZipFile(p) as z:parts={f:z.read(f) for f in z.namelist()}
for key,value in list(parts.items()):
 if key.startswith('xl/worksheets/sheet') and key.endswith('.xml'):
  parts[key]=re.sub(rb'(<f>1[+]2</f><v>)[^<]+',lambda m:m.group(1)+b'77',value)
with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED) as z:
 for key,value in parts.items():z.writestr(key,value)
`, source]);
  const originalHash = hash(source);
  const converted = JSON.parse(run(python, [helper, source, pdf]));
  assert.equal(hash(source), originalHash);
  assert.equal(converted.sourceSha256, originalHash);
  assert.equal(converted.pdfSha256, hash(pdf));
  assert.equal(converted.nativePrintPages, 1);
  assert.equal(converted.pages, 2);
  assert.equal(converted.chartAppendices.length, 1);
  assert.equal(converted.chartAppendices[0].chart, 'Complete chart');
  const visible = converted.native.sheets.find(s => s.name === 'Visible');
  assert.equal(visible.printArea, '$A$1:$B$4');
  assert.ok(visible.cellsOutsidePrintArea.includes('C8'));
  assert.ok(visible.omittedContent.includes('hidden rows'));
  assert.equal(converted.native.sheets.find(s => s.name === 'Hidden answers').visible, false);
  run(python, ['-c', `import fitz,sys
d=fitz.open(sys.argv[1]); assert '77' in d[0].get_text(); assert 'OMITTED ANSWER' not in d[0].get_text(); assert 'Derived chart appendix' in d[1].get_text(); assert not d.metadata.get('author')`, pdf]);
  const paperId = 'zz-2099-xlsx-cache', paper = path.join(dir, paperId);
  fs.mkdirSync(path.join(paper, 'src'), { recursive: true });
  fs.copyFileSync(pdf, path.join(paper, 'src/problems.pdf'));
  fs.copyFileSync(source, path.join(paper, 'src/problems.xlsx'));
  converted.rendererFingerprint = XLSX_RENDERER_FINGERPRINT;
  converted.sourceFile = 'src/problems.xlsx';
  const key = 'fixture/native.xlsx';
  fs.writeFileSync(path.join(paper, 'manifest.json'), JSON.stringify({ paperId, documents: { problems: { key, sha256: hash(pdf), converted } } }));
  const args = [path.join(repo, 'scripts/tx/prepare.mjs'), paperId, '--problems', key];
  const env = { ...process.env, OLYMPIADS_TX_DIR: dir };
  run(process.execPath, args, { env });
  const manifest = JSON.parse(fs.readFileSync(path.join(paper, 'manifest.json')));
  assert.equal(manifest.documents.problems.downloaded, false);
  assert.equal(manifest.documents.problems.pages, 2);
  assert.equal(manifest.documents.problems.converted.sourceSha256, originalHash);
  const image = path.join(paper, manifest.documents.problems.pageImages[0]);
  const mtime = fs.statSync(image).mtimeMs;
  run(process.execPath, args, { env });
  assert.equal(fs.statSync(image).mtimeMs, mtime);
});
