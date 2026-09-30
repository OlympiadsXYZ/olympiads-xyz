// Complete CommonMark fenced code is literal source text. Share this pure helper
// between the browser, Gatsby compilers and publication gates.
function splitFencedCode(value) {
  const text = String(value);
  const lines = [...text.matchAll(/[^\n]*\n|[^\n]+$/g)];
  const out = [];
  let plainStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?$/.exec(lines[i][0]);
    if (!open || (open[1][0] === '`' && open[2].includes('`'))) continue;
    const closer = new RegExp(
      '^ {0,3}' + open[1][0] + '{' + open[1].length + ',}[ \\t]*\\r?\\n?$'
    );
    let end = i + 1;
    while (end < lines.length && !closer.test(lines[end][0])) end++;
    if (end === lines.length) continue; // an incomplete fence gets no lint exemption
    const start = lines[i].index;
    const finish = lines[end].index + lines[end][0].length;
    if (start > plainStart)
      out.push({ text: text.slice(plainStart, start), code: false });
    out.push({ text: text.slice(start, finish), code: true });
    plainStart = finish;
    i = end;
  }
  if (plainStart < text.length || !out.length)
    out.push({ text: text.slice(plainStart), code: false });
  return out;
}
const outsideFencedCode = (text, transform) =>
  splitFencedCode(text)
    .map(part => (part.code ? part.text : transform(part.text)))
    .join('');
const mdxComments = text =>
  outsideFencedCode(text, prose =>
    prose.replace(/<!--/g, '{/* ').replace(/-->/g, '*/}')
  );
module.exports = { splitFencedCode, outsideFencedCode, mdxComments };
