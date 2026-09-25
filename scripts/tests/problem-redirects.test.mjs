import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const target = require('../lib/problem-redirect-target.cjs');
const metaRedirect = require('gatsby-plugin-meta-redirect/getMetaRedirect');

test('generated meta redirects preserve problem section fragments on the configured site', () => {
  for (const site of ['https://www.olympiads.xyz', 'http://localhost:9000']) {
    const url = target('/problems/merged/solution#e2', site);
    const html = metaRedirect(url);
    const destination = /URL='([^']+)'/.exec(html)[1];
    assert.equal(destination, `${site}/problems/merged/solution#e2`);
    assert.equal(new URL(destination).hash, '#e2');
  }
});
