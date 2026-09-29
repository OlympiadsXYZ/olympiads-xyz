import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pagedFingerprint,pagedCacheValid,pagedKind} from '../tx/paged-source.mjs';
import {sourceConversionProblems,sourceConversions} from '../tx/source-conversions.mjs';

for(const ext of ['ppsx','pptx','djvu','djv']) test(`${ext}: reject changed originals, missing mappings and forged conversion evidence`,t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'paged-evidence-'));
  t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('paged-evidence-'));fs.rmSync(directory,{recursive:true,force:true});});
  fs.mkdirSync(path.join(directory,'src'));
  const source=path.join(directory,'src/supplement-1.'+ext),pdf=path.join(directory,'src/supplement-1.pdf');
  fs.writeFileSync(source,'original fixture');fs.writeFileSync(pdf,'%PDF- fixture');
  const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),key='archive/slides.'+ext;
  const c={from:pagedKind(key),rendererFingerprint:pagedFingerprint(key),sourceFile:'src/supplement-1.'+ext,sourceSha256:hash(source),pdfSha256:hash(pdf),pages:[{page:1,sourcePage:1},{page:2,sourcePage:2}]};
  const doc={key,file:'src/supplement-1.pdf',sha256:hash(pdf),pages:2,converted:c},m={documents:{'supplement-1':doc}},e=sourceConversions(m);
  assert.deepEqual(sourceConversionProblems(m,directory,e),[]);
  assert.equal(pagedCacheValid({...doc,pages:3},pdf,source),false);
  c.pages[1].sourcePage=1;assert.equal(pagedCacheValid(doc,pdf,source),false);c.pages[1].sourcePage=2;
  assert.match(sourceConversionProblems(m,directory,{}).join(),/provenance mismatch/);
  assert.match(sourceConversionProblems({documents:{'supplement-1':{...doc,converted:null}}},directory).join(),/missing original paged/);
  fs.appendFileSync(source,'changed');assert.match(sourceConversionProblems(m,directory,e).join(),/no longer matches/);
});

test('presentation inventory follows presentation order and exposes hidden/timed slides; external media is rejected',()=>{
  const helper=fileURLToPath(new URL('../tx/presentation-to-pdf.py',import.meta.url));
  const script=String.raw`import importlib.util,sys,tempfile,zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('conversion',sys.argv[1]);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp)/'exam.ppsx'
 def write(external=False):
  with zipfile.ZipFile(p,'w') as z:
   z.writestr('ppt/presentation.xml','<p:presentation xmlns:p="'+mod.P+'" xmlns:r="'+mod.R+'"><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>')
   z.writestr('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>')
   z.writestr('ppt/slides/slide1.xml','<p:sld xmlns:p="'+mod.P+'"/>')
   z.writestr('ppt/slides/slide2.xml','<p:sld xmlns:p="'+mod.P+'" show="0"><p:timing/></p:sld>')
   if external:z.writestr('ppt/slides/_rels/slide1.xml.rels','<Relationships><Relationship Id="r1" TargetMode="External" Type="image" Target="https://example.com/image.png"/></Relationships>')
 write();a=mod.inventory(p);assert [s['part'] for s in a['pages']]==['ppt/slides/slide2.xml','ppt/slides/slide1.xml'];assert a['pages'][0]['hidden'] and a['pages'][0]['hasTiming']
 write(True)
 try:mod.inventory(p)
 except ValueError as e:assert 'Externally linked' in str(e)
 else:raise AssertionError('external linked source accepted')
`;
  const r=spawnSync(process.env.OLYMPIADS_TEST_PYTHON||'python3',['-c',script,helper],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});
