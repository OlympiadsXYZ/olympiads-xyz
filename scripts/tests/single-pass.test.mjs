import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singlePassEvidenceProblems } from '../tx/single-pass-evidence.mjs';
import { provenanceFor } from '../tx/lib.mjs';

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
