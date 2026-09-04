#!/usr/bin/env node
// Compile every solutions/**/*.mdx (or the paths given on the command line)
// with the same xdm pipeline the site uses (src/gatsby/create-xdm-node.ts),
// so MDX parse errors surface before a 40-minute Gatsby build does.
//
//   node scripts/check-mdx.mjs [--warn] [files…]
//
// Exit code 1 if any file fails to compile. --warn also prints KaTeX errors
// (they don't fail the build — rehype-math has throwOnError off — but they
// render as red text on the page).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { compile } from 'xdm';
import gfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import { remarkMdxFrontmatter } from 'remark-mdx-frontmatter';
import rehypeRaw from 'rehype-raw';

const require = createRequire(import.meta.url);
const customRehypeKatex = require('../src/mdx-plugins/rehype-math.js');

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const warn = args.includes('--warn');
const given = args.filter(a => !a.startsWith('--'));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.mdx') ? [p] : [];
  });
}

const files = given.length ? given.map(f => path.resolve(f)) : walk(path.join(ROOT, 'solutions'));
let failed = 0, warned = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  // The compiled gatsby-node bundles parse-entities' *browser* decoder, which
  // calls document.createElement — any named character reference (&nbsp; …)
  // crashes the real build even though xdm alone compiles it fine.
  const entities = [...content.matchAll(/&[a-zA-Z]+;/g)].map(m => m[0]);
  if (entities.length) {
    failed++;
    console.log(`FAIL ${path.relative(ROOT, file)}\n     named HTML entities crash the Gatsby build (document is not defined): ${[...new Set(entities)].join(' ')} — use the literal character in the source JSON`);
    continue;
  }
  try {
    const vfile = await compile(content.replace(/<!--/g, '{/* ').replace(/-->/g, '*/}'), {
      remarkPlugins: [gfm, remarkMath, remarkFrontmatter, remarkMdxFrontmatter],
      rehypePlugins: [
        [rehypeRaw, { passThrough: ['mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression', 'mdxJsxFlowElement', 'mdxJsxTextElement'] }],
        customRehypeKatex,
      ],
      outputFormat: 'function-body',
    });
    if (warn && vfile.messages.length) {
      for (const m of vfile.messages) {
        warned++;
        console.log(`WARN ${path.relative(ROOT, file)}:${m.line ?? '?'}:${m.column ?? '?'} ${m.reason.split('\n')[0]}`);
      }
    }
  } catch (e) {
    failed++;
    const where = e.line != null ? `:${e.line}:${e.column}` : '';
    console.log(`FAIL ${path.relative(ROOT, file)}${where}\n     ${String(e.reason || e.message).split('\n')[0]}`);
  }
}
console.log(`${files.length} MDX file(s) checked, ${failed} failed${warn ? `, ${warned} KaTeX/lint warning(s)` : ''}`);
process.exit(failed ? 1 : 0);
