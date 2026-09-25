// bisect-mdx.mjs <file> — compiles growing prefixes of an MDX file (closing an open <Spoiler> when needed) and
// prints the first line at which compilation starts failing (check-mdx.mjs only names the file).
import fs from 'fs';
import { compile } from 'xdm';
import gfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n');
const ok = async k => {
  let text = lines.slice(0, k).join('\n');
  const open = (text.match(/<Spoiler/g) || []).length - (text.match(/<\/Spoiler>/g) || []).length;
  if (open > 0) text += '\n\n</Spoiler>\n';
  const openFig = (text.match(/<figure[\s>]/g) || []).length - (text.match(/<\/figure>/g) || []).length;
  if (openFig > 0) return true; // mid-figure prefixes are not meaningful
  try { await compile(text, { remarkPlugins: [gfm, remarkMath, remarkFrontmatter, remarkMdxFrontmatter] }); return true; } catch (e) { return false; }
};
let lo = 1, hi = lines.length;
if (await ok(hi)) { console.log('whole file compiles'); process.exit(0); }
while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (await ok(mid)) lo = mid + 1; else hi = mid; }
console.log(`first failing prefix ends at line ${lo}:`);
for (let i = Math.max(0, lo - 4); i < Math.min(lines.length, lo + 1); i++) console.log(`${i + 1}: ${lines[i].slice(0, 200)}`);
