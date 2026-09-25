import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singlePassEvidenceProblems } from '../tx/single-pass-evidence.mjs';
import { provenanceFor } from '../tx/lib.mjs';
import {sourceReadScopes, sourceReadScopeProblems, readScopeErrors} from '../tx/source-read-scope.mjs';

const who = { provider: 'agent', model: 'gpt-6-astra', requestId: 'reader-1' };
const candidate = { tx: { reader: who }, problems: [{ id: 'p1', figures: [] }] };
const manifest = { documents: { problems: { pages: 2 }, solutions: { pages: 1 } } };
const hash = 'a'.repeat(64);
const evidence = () => ({ reader: who, candidateSha256: hash, pagesRead: [{document:'problems',page:1},{document:'problems',page:2},{document:'solutions',page:1}], problemsRead: 1, figuresInspected: 0, summary: 'Read original pages.', sourceGaps: [] });
test('single-pass reader evidence accepts complete source claims without a checker verdict', () => {
  assert.deepEqual(singlePassEvidenceProblems(evidence(), candidate, manifest, hash), []);
});
test('single-pass evidence refuses stale bytes and invented reader identity', () => {
  const e = evidence(); e.candidateSha256 = 'b'.repeat(64); e.reader = {...who, requestId:'someone-else'};
  const errors = singlePassEvidenceProblems(e, candidate, manifest, hash);
  assert(errors.some(x => x.includes('different candidate bytes')));
  assert(errors.some(x => x.includes('does not match candidate reader')));
});
test('single-pass evidence refuses missing, repeated or unknown pages and uninspected figures', () => {
  const e = evidence(); e.pagesRead = [{document:'problems',page:1},{document:'problems',page:1},{document:'solutions',page:9}];
  const c = {...candidate,problems:[{id:'p1',figures:[{id:'f1'}]}]};
  const errors = singlePassEvidenceProblems(e,c,manifest,hash);
  for(const phrase of ['unknown page','repeats page','not covered source pages','figuresInspected']) assert(errors.some(x=>x.includes(phrase)),phrase);
});
test('a source adjudicator may complete an existing draft without rewriting its reader provenance', () => {
  const c = {...candidate, tx:{reader:{provider:'agent',model:'gpt-6-sol',requestId:'draft'},adjudicator:who}};
  assert.deepEqual(singlePassEvidenceProblems(evidence(),c,manifest,hash),[]);
});
test('single-pass provenance never claims text-layer comparison or a separate model checker', () => {
  const p = provenanceFor(candidate,{reviewer:{provider:'mechanical',model:'single-pass-gates'},mode:'single-pass',promptVersion:'v1',checkedAt:'2026-09-25',sourceHashes:{},independent:false});
  assert.match(p.verifiedBy,/single-pass source transcription/);
  assert.doesNotMatch(p.verifiedBy,/independent checker|same-model checker|text layer|printed figures/);
});

test('selected proceedings solutions retain full-file identity and original page coverage', () => {
  const m=structuredClone(manifest);
  m.documents.solutions={key:'proceedings.pdf',sha256:'b'.repeat(64),pages:147,readScope:{pages:[47,48,49],reason:'Complete selected theory solution section; adjacent pages belong to other rounds.'}};
  const c={...candidate,paper:{solutionSource:{archiveKey:'proceedings.pdf',pages:[47,48,49]}},problems:[{id:'p1',tx:{sourceSpans:[{document:'solutions',page:48}]}}]};
  const e={...evidence(),sourceReadScopes:sourceReadScopes(m),pagesRead:[{document:'problems',page:1},{document:'problems',page:2},...m.documents.solutions.readScope.pages.map(page=>({document:'solutions',page}))]};
  assert.deepEqual(singlePassEvidenceProblems(e,c,m,hash),[]);
  assert.equal(e.sourceReadScopes.solutions.totalPages,147);
  const incomplete={...e,pagesRead:e.pagesRead.slice(0,-1)};
  assert.match(singlePassEvidenceProblems(incomplete,c,m,hash).join(),/not covered source pages: solutions:49/);
  assert.match(singlePassEvidenceProblems({...e,sourceReadScopes:{}},c,m,hash).join(),/scope differs/);
  c.paper.solutionSource.pages=[1,2,3];
  assert.match(sourceReadScopeProblems(m,c,e.sourceReadScopes).join(),/original page numbers/);
  c.paper.solutionSource.pages=[47,48,49];
  c.problems[0].tx.sourceSpans[0].page=50;
  assert.match(sourceReadScopeProblems(m,c,e.sourceReadScopes).join(),/outside its prepared read scope/);
  m.documents.solutions.readScope.reason='Changed after receipt';
  assert.match(sourceReadScopeProblems(m,c,e.sourceReadScopes).join(),/scope differs/);
});

test('page selection rejects silent omissions, duplicates and fabricated page ranges', () => {
  for(const scope of [{pages:[],reason:'x'},{pages:[1,1],reason:'x'},{pages:[3,2],reason:'x'},{pages:[0],reason:'x'},{pages:[148],reason:'x'},{pages:[2],reason:''}])assert.ok(readScopeErrors(scope,147).length);
});
