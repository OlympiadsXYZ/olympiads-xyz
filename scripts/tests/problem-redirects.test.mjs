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

// Exercise the actual meta-redirect plugin filesystem output, not just the URL
// formatter: production's generic Vercel redirect first adds /solution/.
test('declared aliases produce readable static redirects for old base and solution URLs with either slash form', async t => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { problemAliases } = await import('../problems-to-site.mjs');
  const { onPostBuild } = require('gatsby-plugin-meta-redirect/gatsby-node');
  const { pathToRegexp, compile } = require('path-to-regexp-updated');
  const config = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'problem-alias-build-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const id = 'nof-2013-iv-exp1-doc-p1';
  const oldId = 'nof-2013-iv-exp1-doc-p2';
  const aliases = problemAliases({ id, sections: [{ id: 'task-2' }], aliases: [{ id: oldId, sectionId: 'task-2' }] }, { [oldId]: '/problems/old-frozen-slug' });
  const redirects = Object.entries(aliases).map(([fromPath, toPath]) => ({ fromPath, toPath: target(toPath, 'https://www.olympiads.xyz') }));
  await onPostBuild({ store: { getState: () => ({ redirects, program: { directory }, config: {} }) } });
  for (const base of ['/problems/' + oldId, '/problems/old-frozen-slug']) {
    for (const suffix of ['', '/', '/solution', '/solution/']) {
      let url = base + suffix;
      for (const rule of config.redirects) {
        const keys = [];
        const match = pathToRegexp(rule.source, keys, { strict: true, sensitive: true, delimiter: '/' }).exec(url);
        if (!match) continue;
        url = compile(rule.destination, { validate: false })(Object.fromEntries(keys.map((key, i) => [key.name, match[i + 1]])));
        break;
      }
      const file = path.join(directory, 'public', url, 'index.html');
      assert.ok(fs.existsSync(file), `missing redirect HTML for ${base + suffix}`);
      const destination = /URL='([^']+)'/.exec(fs.readFileSync(file, 'utf8'))[1];
      assert.equal(destination, 'https://www.olympiads.xyz/problems/' + id + '/solution#task-2');
      assert.equal(new URL(destination).hash, '#task-2');
    }
  }
});

test('replacement refuses missing old problem links and preserves earlier aliases across repeated merges', async () => {
  const { assertReplacementLinks } = await import('../tx/replacement-links.mjs');
  const previous = { problems: [{ id: 'p1', aliases: [{ id: 'older', sectionId: 'first' }] }, { id: 'p2' }] };
  const next = { problems: [{ id: 'p1', sections: [{ id: 'first' }, { id: 'second' }] }] };
  assert.throws(() => assertReplacementLinks(previous, next), /older, p2/);
  next.problems[0].aliases = [{ id: 'p2', sectionId: 'second' }];
  assert.throws(() => assertReplacementLinks(previous, next), /older/);
  next.problems[0].aliases.push({ id: 'older', sectionId: 'first' });
  assert.doesNotThrow(() => assertReplacementLinks(previous, next));
  next.problems[0].aliases[0].sectionId = 'missing';
  assert.throws(() => assertReplacementLinks(previous, next), /missing section/);
});

test('replacement accepts unchanged IDs, whole-problem duplicate aliases and restored old aliases as actual problems', async () => {
  const { assertReplacementLinks } = await import('../tx/replacement-links.mjs');
  const previous = { problems: [{ id: 'p1', aliases: [{ id: 'old' }] }, { id: 'p2' }] };
  assert.doesNotThrow(() => assertReplacementLinks(previous, structuredClone(previous)));
  assert.doesNotThrow(() => assertReplacementLinks(previous, { problems: [{ id: 'p1', aliases: [{ id: 'p2' }] }, { id: 'old' }] }));
  assert.throws(() => assertReplacementLinks(previous, { problems: [{ id: 'p1', aliases: [{ id: 'p1' }] }] }), /conflicts/);
});
