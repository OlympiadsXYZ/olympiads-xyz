#!/usr/bin/env node
// from-final.mjs <paperId> --in <final paper JSON> --out <candidate.json>
// Turns a final-shape paper (content/problems/** or tmp/staging/**: figures with
// url/width/height/source.pdfRect, hoisted sourceSpans, paper.transcription) back
// into the candidate shape the pipeline verifies (figure proposals as
// tx.document/page/bbox in permille, provenance under tx.reader, status draft),
// so an older transcription can go through figures → checker → receipt → promote
// and earn a receipt for the exact bytes it becomes. Text is not touched.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, fail, readJson, writeJson, readManifest, allFigures, sha256File, nowIso, BBOX_SCALE } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const paperId = args._[0];
if (!paperId || !args.in || !args.out) fail('usage: from-final.mjs <paperId> --in <final.json> --out <candidate.json>');
const manifest = readManifest(paperId);
if (!manifest) fail(`no manifest for ${paperId}; run prepare.mjs first`);
const src = path.resolve(args.in);
const data = readJson(src, null);
if (!data?.paper || !Array.isArray(data.problems)) fail(`not a paper JSON: ${src}`);
if (data.paper.id !== paperId) fail(`paper id ${data.paper.id} in the file, ${paperId} requested`);

const report = { figures: 0, converted: 0, unplaced: [], spans: 0 };
for (const { fig, path: p } of allFigures(data)) {
  report.figures++;
  const s = fig.source;
  const doc = s?.document || (/\/solution\//.test(p) ? 'solutions' : 'problems');
  const size = manifest.documents[doc]?.pageSizes?.[(s?.page || 0) - 1];
  if (!s?.pdfRect || !size) { report.unplaced.push({ id: fig.id, path: p, reason: !s?.pdfRect ? 'no source.pdfRect' : `no page ${s.page} in ${doc}` }); }
  else {
    const [x0, y0, x1, y1] = s.pdfRect;
    fig.tx = { document: doc, page: s.page, bbox: [x0 / size.widthPt, y0 / size.heightPt, x1 / size.widthPt, y1 / size.heightPt].map(v => Math.round(v * BBOX_SCALE)) };
    report.converted++;
  }
  delete fig.url; delete fig.width; delete fig.height; delete fig.source;
}
for (const pr of data.problems) {
  if (Array.isArray(pr.sourceSpans) && pr.sourceSpans.length) { pr.tx = { ...(pr.tx || {}), sourceSpans: pr.sourceSpans.map(x => ({ document: x.document, page: x.page })) }; report.spans++; }
  delete pr.sourceSpans;
}
const t = data.paper.transcription || {};
delete data.paper.transcription;
data.paper.status = 'draft';
data.tx = {
  ...(data.tx || {}),
  reader: { provider: t.provider || 'agent', model: t.model || 'unknown', promptVersion: t.promptVersion || 'agent-workflow-2026-09', at: t.at || nowIso().slice(0, 10) },
  notes: [data.tx?.notes, t.notes].filter(Boolean).join('\n'),
  fromFinal: { file: path.relative(process.cwd(), src).split(path.sep).join('/'), sha256: sha256File(src), at: nowIso() },
};
writeJson(path.resolve(args.out), data);
console.log(JSON.stringify({ paperId, out: path.resolve(args.out), reader: data.tx.reader, ...report }, null, 2));
if (report.unplaced.length) process.exit(3);
