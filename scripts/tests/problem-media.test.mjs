import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compile } from 'xdm';
import gfm from 'remark-gfm';
import math from 'remark-math';
import { sha256, publicationState } from '../lib/problem-data.mjs';
import { validateProblemMedia, readProblemMedia, problemVideoMarkdown } from '../lib/problem-media.mjs';
import { problemMdx } from '../problems-to-site.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(import.meta.url);
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
// These bytes are the exact frozen reader H2 final and genuine single-pass receipt, not a publication waiver.
const finalFile=path.join(repo,'scripts/tests/fixtures/problem-media/igeo-2014-mmtest.json'),bytes=fs.readFileSync(finalFile),data=JSON.parse(bytes.toString('utf8'));
const receipt=json(path.join(repo,'scripts/tests/fixtures/problem-media/igeo-2014-mmtest.receipt.json'));
const record={data,contentHash:sha256(bytes)},records=[record],ledger={papers:{[data.paper.id]:{kind:'reviewed',contentHash:record.contentHash,review:receipt}}};
const config=json(path.join(repo,'content/problem-media.json')),proofFile=config.problems['igeo-2014-mmtest-p36'][0].provenance.evidence.file,proofBytes=fs.readFileSync(path.join(repo,proofFile));
const options={evidenceByFile:new Map([[proofFile,{sha256:sha256(proofBytes),data:JSON.parse(proofBytes.toString('utf8'))}]])};
const validate=(cfg=config,recs=records,pub=ledger,opts=options)=>validateProblemMedia(cfg,recs,pub,opts);
const mutate=change=>{const cfg=structuredClone(config);change(cfg.problems['igeo-2014-mmtest-p36'][0],cfg);return cfg;};

test('exact reader final, genuine receipt and both source-owned media entries pass without a waiver',()=>{
  assert.equal(receipt.contentHash,record.contentHash);assert.equal(publicationState(record,ledger).eligible,true);
  assert.deepEqual([...validate().keys()],['igeo-2014-mmtest-p36','igeo-2014-mmtest-p38']);
  assert.equal(readProblemMedia(repo,records,ledger).size,2);
});
test('unknown, draft, withdrawn, stale and retired owners cannot acquire media',()=>{
  assert.throws(()=>validate(config,[],ledger),/unpublished problem/);
  for(const status of ['draft','withdrawn','quarantined']){
    const changed=structuredClone(record);changed.data.paper.status=status;
    assert.throws(()=>validate(config,[changed],ledger),/unpublished problem/);
  }
  assert.throws(()=>validate(config,records,{papers:{}}),/unpublished problem/);
  const stale=structuredClone(record);stale.contentHash='a'.repeat(64);assert.throws(()=>validate(config,[stale],ledger),/unpublished problem/);
  assert.throws(()=>validate(config,records,ledger,{...options,retiredProblemIds:new Set(['igeo-2014-mmtest-p36'])}),/retired or unpublished/);
  assert.throws(()=>validate(mutate(e=>e.paperContentHash='a'.repeat(64))),/wrong source owner/);
});
test('media URLs require exact HTTPS host, hash pathname, no credentials/query/fragment',()=>{
  for(const url of ['http://example.test/a.webm','javascript:alert(1)','https://evil.test/a.webm',config.problems['igeo-2014-mmtest-p36'][0].url+'?tracking=1',config.problems['igeo-2014-mmtest-p36'][0].url+'#t=1'])assert.throws(()=>validate(mutate(e=>e.url=url)),/media URL/);
  assert.throws(()=>validate(mutate(e=>e.sha256='a'.repeat(64))),/media URL/);
  assert.throws(()=>validate(mutate(e=>e.mimeType='text/html')),/MIME/);
  assert.throws(()=>validate(mutate(e=>e.nativeOriginal.mimeType='video/webm')),/original MIME/);
});
test('source question, PDF hash, WMV provenance, public proof and qualified audio must match',()=>{
  for(const change of [e=>e.provenance.question=38,e=>e.provenance.sourcePdfSha256='a'.repeat(64),e=>e.nativeOriginal.archiveKey='elsewhere/q36.wmv'])assert.throws(()=>validate(mutate(change)),/original provenance/);
  assert.throws(()=>validate(mutate(e=>e.provenance.evidence.sha256='a'.repeat(64))),/stale source evidence/);
  assert.throws(()=>validate(mutate(e=>e.provenance.videoFrames.count=1)),/conversion evidence/);
  assert.throws(()=>validate(mutate(e=>e.provenance.audio.nativeByteIdentity=true)),/audio\/source qualification/);
  const proof=structuredClone(options.evidenceByFile.get(proofFile));proof.data.entries.find(e=>e.kind==='browser-compatible'&&e.question===36).publicStatus=404;
  assert.throws(()=>validate(config,records,ledger,{evidenceByFile:new Map([[proofFile,proof]])}),/proof mismatch/);
});
test('unknown fields, duplicate IDs, unbound links and unsafe proof paths are rejected',()=>{
  assert.throws(()=>validate(mutate(e=>e.autoplay=true)),/video fields/);
  assert.throws(()=>validate(mutate((e,cfg)=>cfg.problems['igeo-2014-mmtest-p38'][0].id=e.id)),/duplicate/);
  assert.throws(()=>validate(mutate(e=>e.provenance.evidence.file='../outside.json')),/unsafe evidence file/);
  assert.throws(()=>validate(mutate(e=>e.provenance.evidence.file='C:/outside.json')),/unsafe evidence file/);
  const changed=structuredClone(record);changed.data.problems.find(p=>p.number===36).statement='Unrelated statement.';
  assert.throws(()=>validate(config,[changed],ledger),/owned statement links/);
});
test('native player follows the complete real statement/figure and keeps science, answers and links',async()=>{
  const media=validate();
  for(const number of [36,38]){
    const problem=data.problems.find(p=>p.number===number),before=JSON.stringify(problem),mdx=problemMdx(data.paper,problem,{quality:'reviewed',singlePass:true},'fixture.json',{media});
    assert.equal((mdx.match(/<ProblemVideo /g)||[]).length,1);
    assert.ok(mdx.indexOf('<ProblemVideo ')>mdx.indexOf('</figure>'));
    assert.ok(mdx.indexOf('<ProblemVideo ')<mdx.indexOf('## Отговори'));
    assert.ok(mdx.includes('[Download the native WMV movie]'));
    assert.ok(mdx.includes('ANSWER CODE:'));
    assert.equal(JSON.stringify(problem),before);
    await compile(mdx,{remarkPlugins:[gfm,math]});
  }
});
test('player precedes structured Parts without affecting unrelated generated problems',()=>{
  const actual=data.problems.find(p=>p.number===36),problem={...actual,parts:[{label:'a)',statement:'AFTER_VIDEO_PART'}]},media=validate();
  const mdx=problemMdx(data.paper,problem,{quality:'reviewed',singlePass:true},'fixture.json',{media});
  assert.ok(mdx.indexOf('<ProblemVideo ')<mdx.indexOf('AFTER_VIDEO_PART'));
  for(const p of data.problems.filter(p=>![36,38].includes(p.number)))assert.equal(problemMdx(data.paper,p,{quality:'reviewed'},'fixture.json',{media}),problemMdx(data.paper,p,{quality:'reviewed'},'fixture.json'));
});
test('MDX caption is a string expression rather than executable markup',async()=>{
  const entry=structuredClone(config.problems['igeo-2014-mmtest-p36'][0]);entry.caption='Quote " <script>throw 1</script> {danger}';
  const mdx=problemVideoMarkdown(entry);
  assert.ok(mdx.includes('\\u003cscript>'));assert.ok(!mdx.includes('<script>'));
  await compile(mdx);
});
test('actual TSX renders accessible controls, metadata preload, original download and no autoplay',()=>{
  const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const source=fs.readFileSync(path.join(repo,'src/components/markdown/ProblemVideo.tsx'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},reportDiagnostics:true});
  assert.deepEqual(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
  const module={exports:{}};new Function('require','module','exports',compiled.outputText)(require,module,module.exports);
  for(const number of [36,38]){
    const e=config.problems['igeo-2014-mmtest-p'+number][0],html=renderToStaticMarkup(React.createElement(module.exports.default,{mediaId:e.id,src:e.url,mimeType:e.mimeType,caption:e.caption,originalUrl:e.nativeOriginal.url,originalFilename:path.posix.basename(e.nativeOriginal.archiveKey),width:e.width,height:e.height}));
    assert.match(html,/<video[^>]*controls=""/);assert.match(html,/preload="metadata"/);assert.match(html,/playsinline=""/);
    assert.ok(!/autoplay|muted|loop=/i.test(html));assert.ok(html.includes('type="video/webm"'));
    assert.ok(html.includes(`aria-describedby="${e.id}-caption"`));assert.ok(html.includes(`id="${e.id}-caption"`));
    assert.ok(html.includes(`href="${e.nativeOriginal.url}" download="2014MM-supportQ${number}.wmv"`));
    assert.ok(html.includes('width:100%'));assert.ok(html.includes('height:auto'));
  }
});
