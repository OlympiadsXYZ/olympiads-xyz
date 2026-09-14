import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { providerFailurePolicy, shouldPauseProvider, assertFrozenRequestImage, assertPreparedSource } from '../tx/pilot-controls.mjs';
import { buildRequestFromPaths } from '../tx/pilot-providers.mjs';

test('source preparation blocks must be resolved explicitly before dispatch',()=>{
  assert.throws(()=>assertPreparedSource({readyForDispatch:false}),{code:'PILOT_SOURCE_NOT_READY'});
  assert.throws(()=>assertPreparedSource({readyForDispatch:true,rotationNeedsReview:true}),{code:'PILOT_SOURCE_NOT_READY'});
  assert.doesNotThrow(()=>assertPreparedSource({readyForDispatch:true,rotationNeedsReview:false}));
  assert.doesNotThrow(()=>assertPreparedSource({}));
});

test('quota, access and service errors stop further dispatch to that provider', () => {
  for (const status of [401, 403, 408, 429, 500, 502, 503, 504, 599]) assert.equal(shouldPauseProvider(status), true, String(status));
  assert.equal(providerFailurePolicy(429).reason, 'rate_limit_or_quota');
  assert.equal(providerFailurePolicy(403).reason, 'authentication_or_access');
  assert.equal(providerFailurePolicy(503).reason, 'provider_unavailable');
  // A 429 is not proof of exhausted trial credit or unsupported model access.
  assert.ok(!JSON.stringify(providerFailurePolicy(429)).includes('trial'));
});

test('status alone never releases unknown charges or authorizes a retry', () => {
  for (const status of [200, 400, 401, 403, 408, 422, 429, 500, 503, undefined, null]) {
    const policy = providerFailurePolicy(status);
    assert.equal(policy.releaseReservation, false);
    assert.equal(policy.automaticRetry, false);
  }
});

test('successful and individual request responses do not pause other work', () => {
  for (const status of [200, 201, 202, 204, 299, 400, 404, 413, 422]) assert.equal(shouldPauseProvider(status), false, String(status));
  const pausedProviders = new Set();
  if (shouldPauseProvider(429)) pausedProviders.add('zai-vision');
  assert.equal(pausedProviders.has('zai-vision'), true);
  assert.equal(pausedProviders.has('openai'), false);
});

test('missing or malformed final statuses fail closed without copying diagnostics', () => {
  for (const status of [undefined, null, NaN, Infinity, 99, 600, '429', { message: 'secret diagnostic must not escape' }]) {
    const result = providerFailurePolicy(status);
    assert.equal(result.pauseProvider, true);
    assert.equal(result.httpStatus, null);
    assert.equal(result.reason, 'unknown_response_or_transport');
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  for (const status of [100, 101, 301, 302, 307, 308]) assert.equal(shouldPauseProvider(status), true);
});

test('dispatch rejects an image replaced after the frozen-plan preflight', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-frozen-image-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('pilot-frozen-image-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'page.png');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2gwAAAABJRU5ErkJggg==', 'base64');
  await fs.writeFile(file, bytes);
  const item = { imageSha256: createHash('sha256').update(await fs.readFile(file)).digest('hex') };
  const options = { images: [{ path: file, mime: 'image/png' }], prompt: 'Read this page.' };
  const original = await buildRequestFromPaths('openai', options);
  assert.equal(assertFrozenRequestImage(item, original), true);
  // Distinct valid source bytes (PNG trailing data is permitted), arriving after
  // the first preflight but before the later worker captures its request bytes.
  await fs.writeFile(file, Buffer.concat([bytes, Buffer.from('changed source bytes')]));
  const changed = await buildRequestFromPaths('openai', options);
  assert.notEqual(changed.imageMetadata[0].sha256, original.imageMetadata[0].sha256);
  assert.throws(() => assertFrozenRequestImage(item, changed), { code: 'PILOT_SOURCE_CHANGED' });
  assert.equal(assertFrozenRequestImage(item, original), true, 'Already-captured request bytes remain correctly bound despite later disk changes');
  for (const request of [{}, { imageMetadata: [] }, { imageMetadata: [original.imageMetadata[0], original.imageMetadata[0]] }]) {
    assert.throws(() => assertFrozenRequestImage(item, request), { code: 'PILOT_SOURCE_CHANGED' });
  }
});
