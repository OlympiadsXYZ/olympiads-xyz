import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCheck,bindCheckCandidate} from '../tx/pilot-check.mjs';
const candidate={blocks:[{id:'a'},{id:'b'}]};
const good=()=>({schemaVersion:1,verdict:'no-material-defect-found',inspectedBlockIds:['a','b'],issues:[],uncertainties:[]});
const defect=()=>({blockId:'a',category:'math',severity:'critical',candidateText:'α = εr',sourceReading:'a = εr',sourceBbox:[10,20,300,90],explanation:'The acceleration symbol changed.'});
test('a false pass with a material defect or uncertainty is rejected',()=>{
 const report=good();report.issues.push(defect());assert.ok(validateCheck(report,candidate).length);
 report.verdict='needs-repair';assert.deepEqual(validateCheck(report,candidate),[]);
 const unsure=good();unsure.uncertainties.push('Cannot read the index.');assert.ok(validateCheck(unsure,candidate).length);
});
test('complete source block inspection is required even for a passing report',()=>{
 const report=good();assert.deepEqual(validateCheck(report,candidate),[]);
 for(const ids of [['a'],['a','a'],['a','b','unknown']]){report.inspectedBlockIds=ids;assert.ok(validateCheck(report,candidate).length);}
});
test('omissions can be source-only, but corrections cannot cite invented blocks',()=>{
 const report=good();report.verdict='needs-repair';report.issues=[{...defect(),blockId:null,category:'omission'}];assert.deepEqual(validateCheck(report,candidate),[]);
 report.issues[0].blockId='missing';assert.ok(validateCheck(report,candidate).length);
 report.issues[0].blockId='a';report.issues[0].sourceBbox=[0,0,0,0];assert.ok(validateCheck(report,candidate).length);
});
test('checks bind to the exact source page and prepared image',()=>{
 const item={id:'source-page',paperId:'nof-1997-iii-10-11',documentRole:'problems',sourcePdfSha256:'pdf',imageSha256:'png',pdfPage:1,viewTransform:'clockwise90'};
 assert.equal(bindCheckCandidate(item,{item,page:candidate}),candidate);
 for(const key of Object.keys(item))assert.throws(()=>bindCheckCandidate({...item,[key]:'changed'},{item,page:candidate}),/mismatch/);
});

test('structured rotation and resize transforms bind by exact data after JSON reload',()=>{
 const item={id:'source-page',paperId:'paper',documentRole:'solutions',sourcePdfSha256:'pdf',imageSha256:'png',pdfPage:2,viewTransform:{rotateCW:90,fullPage:true,resizeFrom:[1872,1323],resizeTo:[1872,1323]}};
 const saved=JSON.parse(JSON.stringify({item,page:candidate}));
 assert.equal(bindCheckCandidate(item,saved),saved.page);
 for(const change of [t=>t.rotateCW=0,t=>t.fullPage=false,t=>t.resizeTo[0]--,t=>delete t.resizeFrom]){
  const altered=structuredClone(item);change(altered.viewTransform);
  assert.throws(()=>bindCheckCandidate(altered,saved),/viewTransform/);
 }
});

test('duplicate or malformed candidate IDs cannot collapse into a clean inspection claim',()=>{
 const report=good();report.inspectedBlockIds=['a'];
 for(const blocks of [[{id:'a'},{id:'a'}],[null],[{id:''}],{id:'a'},[]]){
  assert.doesNotThrow(()=>validateCheck(report,{blocks}));
  assert.ok(validateCheck(report,{blocks}).length);
  assert.throws(()=>bindCheckCandidate({},{item:{},page:{blocks}}),/unique nonempty/);
 }
});

test('source binding rejects missing identity fields even when both sides omit them',()=>{
 const item={id:'source-page',paperId:'paper',documentRole:'solutions',sourcePdfSha256:'pdf',imageSha256:'png',pdfPage:1};
 for(const key of Object.keys(item)){
  const incomplete={...item};delete incomplete[key];
  assert.throws(()=>bindCheckCandidate(incomplete,{item:incomplete,page:candidate}),/mismatch/);
 }
 assert.equal(bindCheckCandidate({...item,viewTransform:'original'},{item,page:candidate}),candidate);
 assert.throws(()=>bindCheckCandidate({...item,pdfPage:0},{item:{...item,pdfPage:0},page:candidate}),/mismatch/);
});
