#!/usr/bin/env node
// ship.mjs [--dry-run] [--no-push]
// Ships whatever the transcription loop has promoted since the last ship: runs the
// source gates the deploy workflow runs (normalise, generate, MDX compile, tests,
// schema validation, generated-pages currency), and when every gate passes commits
// content/ + solutions/ and pushes master. Any gate failure leaves the tree alone
// (a paper caught mid-promotion by a batch simply waits for the next run). Safe to
// run on a schedule while batches are writing: nothing is committed unless the whole
// tree validates. Exit 0 shipped or nothing to ship, 2 gates failed, 1 error.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry-run'), noPush = process.argv.includes('--no-push');
const log = s => console.log(`[ship ${new Date().toISOString().slice(11, 19)}] ${s}`);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONUTF8: '1' }, ...opts });
const git = args => run('git', args);

const changed = git(['status', '--porcelain', '--', 'content', 'solutions']).stdout.trim().split('\n').filter(Boolean);
const papers = changed.filter(l => /content\/problems\//.test(l)).length;
if (!changed.length) { log('nothing to ship'); process.exit(0); }
log(`${changed.length} changed path(s), ${papers} paper file(s); running the gates`);
const gates = [
  ['node', ['scripts/normalise-papers.mjs']],
  ['node', ['scripts/problems-to-site.mjs']],
  // every paper has a canonical round label, no sidebar node shows one number twice, no number contradicts the title
  ['node', ['scripts/check-navigation.mjs']],
  ['node', ['scripts/check-mdx.mjs']],
  ['node', ['--test', 'scripts/tests/problems.test.mjs', 'scripts/tests/tx.test.mjs', 'scripts/tests/navigation.test.mjs']],
  ['python3', ['scripts/validate-papers.py']],
];
for (const [cmd, args] of gates) {
  const r = run(cmd, args);
  if (r.status !== 0) { log(`gate failed: ${cmd} ${args.join(' ')}\n${(r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')}`); process.exit(2); }
}
// Currency of the generated pages: while the loop workers keep promoting, papers land between the generate step
// and this check ("stale artifacts"); regenerate and check again a few times before calling it a failure.
for (let attempt = 1; ; attempt++) {
  // stage before the check: a paper promoted after this add stays out of the commit, so the committed set of papers
  // and generated pages is the one the check saw (CI regenerates from the commit and refuses a mismatch)
  git(['add', 'content', 'solutions']);
  const r = run('node', ['scripts/problems-to-site.mjs', '--check']);
  if (r.status === 0) break;
  if (attempt >= 4) { log(`gate failed: node scripts/problems-to-site.mjs --check\n${(r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')}`); process.exit(2); }
  log(`generated pages went stale during the gates (attempt ${attempt}); regenerating`);
  const g = run('node', ['scripts/problems-to-site.mjs']);
  if (g.status !== 0) { log(`gate failed: node scripts/problems-to-site.mjs\n${(g.stderr || g.stdout).trim().split('\n').slice(-6).join('\n')}`); process.exit(2); }
}
const summary = (run('node', ['scripts/problems-to-site.mjs', '--check']).stdout.match(/\d+ papers; \d+ eligible problems/) || [''])[0];
log(`gates green (${summary})`);
if (dry) { log('dry run: not committing'); process.exit(0); }
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'problem-publication.json'), 'utf8'));
const kinds = {}; for (const v of Object.values(ledger.papers || ledger)) kinds[v.kind] = (kinds[v.kind] || 0) + 1;
git(['add', 'content', 'solutions']);
const staged = git(['diff', '--cached', '--name-only']).stdout.trim().split('\n').filter(Boolean);
if (!staged.length) { log('nothing staged after the gates'); process.exit(0); }
const newPapers = staged.filter(f => /^content\/problems\/.*\.json$/.test(f)).length;
const msg = `content: ship ${newPapers} promoted paper file(s) (${summary}; ledger ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')})\n\nAutomated publication of checked content (scripts/ship.mjs). Per-paper receipts record transcription and review provenance.\n`;
const cr = run('git', ['commit', '-q', '-F', '-'], { input: msg });
if (cr.status !== 0 && !/nothing to commit/.test(cr.stdout + cr.stderr)) { log(`commit failed: ${(cr.stderr || cr.stdout).slice(0, 300)}`); process.exit(1); }
log(`committed ${git(['log', '--oneline', '-1']).stdout.trim()}`);
if (noPush) process.exit(0);
const p = git(['push', '-q', 'origin', 'HEAD']);
if (p.status !== 0) { log(`push failed: ${(p.stderr || p.stdout).slice(0, 300)}`); process.exit(1); }
log('pushed');
