import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { XLS_RENDERER, XLS_RENDERER_FINGERPRINT, xlsCacheValid } from '../tx/xls-source.mjs';
import { sourceConversionProblems, sourceConversions } from '../tx/source-conversions.mjs';
const hash = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
test('legacy XLS source cache requires real OLE/PDF bytes and exact portable provenance', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xls-source-'));t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('xls-source-'));fs.rmSync(dir,{recursive:true,force:true});});fs.mkdirSync(path.join(dir,'src'));
 const source=path.join(dir,'src/solutions.xls'),pdf=path.join(dir,'src/solutions.pdf');fs.writeFileSync(source,Buffer.concat([Buffer.from('d0cf11e0a1b11ae1','hex'),Buffer.from('fixture')]));fs.writeFileSync(pdf,'%PDF- fixture');
 const converted={from:'xls',renderer:XLS_RENDERER,rendererFingerprint:XLS_RENDERER_FINGERPRINT,sourceFile:'src/solutions.xls',sourceSha256:hash(source),pdfSha256:hash(pdf)};
 const doc={key:'archive/key.xls',file:'src/solutions.pdf',sha256:hash(pdf),converted},m={documents:{solutions:doc}};
 assert.equal(xlsCacheValid(doc,pdf,source),true);assert.deepEqual(sourceConversionProblems(m,dir,sourceConversions(m)),[]);
 assert.ok(sourceConversionProblems(m,dir,{solutions:{...converted,sourceSha256:'changed'}}).some(x=>x.includes('provenance mismatch')));
 assert.equal(xlsCacheValid({...doc,converted:{...converted,rendererFingerprint:'old'}},pdf,source),false);
 assert.ok(sourceConversionProblems({documents:{solutions:{...doc,converted:undefined}}},dir).some(x=>x.includes('missing original XLS')));
 fs.appendFileSync(source,'changed');assert.equal(xlsCacheValid(doc,pdf,source),false);
 fs.copyFileSync(source,pdf);doc.sha256=converted.pdfSha256=hash(pdf);converted.sourceSha256=hash(source);assert.equal(xlsCacheValid(doc,pdf,source),false);
});
test('BIFF preflight fails closed on formulas, macros, active objects, links and truncation',()=>{
 const script=String.raw`import importlib.util,sys,struct
spec=importlib.util.spec_from_file_location('xls',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def rec(code,body=b''):return struct.pack('<HH',code,len(body))+body
safe=rec(0x809,struct.pack('<HH',0x600,5))+rec(0x1ae,struct.pack('<HH',1,0x401))+rec(0xa)
assert m.preflight(safe)==0
bad=[rec(6,b'formula'),rec(0x18,b'name'),rec(0x809,struct.pack('<HH',0x600,0x40)),rec(0x85,b'00000'+bytes([1])+b'00'),rec(0x1ae,struct.pack('<HH',1,0x3a01)),rec(0x1b7,b'\x01\x00'),rec(0x5d,rec(0x15,struct.pack('<H',8))),rec(0x5d,rec(0x15,struct.pack('<H',5))+rec(4,b'macro')),rec(0xffff),b'\x01',b'\x09\x08\x04\x00x']
for data in bad:
 try:m.preflight(data)
 except (ValueError,struct.error):pass
 else:raise AssertionError('unsafe record accepted '+repr(data))
assert m.preflight(rec(0x809,struct.pack('<HH',0x600,32))+rec(0xa))==1
`;
 const r=spawnSync(process.env.OLYMPIADS_TEST_PYTHON||'python3',['-c',script,path.resolve('scripts/tx/xls-to-pdf.py')],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
});
