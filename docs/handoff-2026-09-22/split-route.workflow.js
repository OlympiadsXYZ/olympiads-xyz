export const meta = {
  name: 'olympiads-split-route',
  description:
    'Split reads (D-P30) for papers over the 30-page cap: per paper a chain of Opus 5.5 agents, each reading at most 24 page images, adding what its pages print and promoting the paper; the first plans the chunks from the text layers',
  phases: [{ title: 'Papers', detail: 'one chain of chunk agents per paper' }],
};
// args: {repo, queue: '<queue file with keys, relative to repo>', papers: [{id}], maxChunks?: 8}
const REPO = args.repo;
const LABEL = 'opus-5-5';
const R = {
  type: 'object',
  properties: {
    paperId: { type: 'string' }, chunk: { type: 'number' }, chunksPlanned: { type: 'number' },
    done: { type: 'boolean' }, status: { type: 'string', enum: ['promoted', 'escalated', 'error'] },
    problems: { type: 'number' }, pagesRead: { type: 'number' }, lastNote: { type: 'string' }, notes: { type: 'string' },
  },
  required: ['paperId', 'chunk', 'done', 'status'],
};
const COMMON = p => `You are transcribing part of one long competition paper for Olympiads XYZ (an olympiad-prep site that publishes every problem of an archive verbatim, with figures and official solutions). Repository: ${REPO}. Paper: ${p.id}. It is over the 30-page cap for one agent, so it is read in chunks of at most 24 page images by a chain of agents (D-P30); you are one link of that chain.

On Windows, run commands with the Bash tool (Git Bash) and write every JSON file with the Write tool, never with a shell heredoc, echo or node -e string (Git Bash mangles backslashes, which corrupts LaTeX).

Transcription rules are those of the reader prompt that queue-start prints (read it in full once: rule 1 — fix only non-word misspellings, recorded in tx.edits; D-P28 — an agreement error stays as printed and goes into tx.notes; numbers, units, symbols, names and mathematics are never changed). Split-read rules:
- Read ONLY the page images of your chunk (${REPO}/tmp/tx/${p.id}/pages/<document>-NN.png). The text layers (${REPO}/tmp/tx/${p.id}/text/<document>.txt) are for orientation and spelling cross-checks, never a source.
- Keep tx.splitRead = true in the candidate. Declare the pages read so far: paper.source.pages (problems document) and paper.solutionSource.pages (solutions document) list every page read by all chunks so far, [] for a document none of whose pages is read yet; drop the field once the whole document is covered. The checker looks for omissions only on declared pages.
- A problem whose official solution is on pages not read yet gets solution.incomplete = true with incompleteReason "Официалното решение е на страници, които предстои да бъдат транскрибирани." (a later chunk replaces it). If some problems of the paper are not transcribed yet at all, paper.caveat says in one Bulgarian sentence what is transcribed so far (e.g. "Транскрибирани са задачите за 9. и 10. клас; останалите предстоят."); the last chunk removes it.
- Never rewrite text an earlier chunk transcribed, except to fix a defect the checker reports with page evidence.
- Checker defects: look at the page and decide from the page; never change text only to satisfy a check (no invisible characters, no re-spelling, no moving words, no turning a table into an image); sanctioned routes: tx.disputed {path, note} for a "printed nowhere" defect with no suggested fix, tx.notFigures {document, page, bbox, note} for decoration. At most 2 fix rounds (write ${REPO}/tmp/tx/${p.id}/candidates/agent__${LABEL}.agentfix.json and run node scripts/tx/run.mjs ${p.id} --continue --retry --repaired <that file>).
- Never run gatsby, never git add/commit/push, never edit other papers, scripts or content files by hand, no web search, never read ~/.config/olympiads-xyz. Keep scratch files under ${REPO}/tmp/tx/${p.id}/work/.
- Do NOT run prepare.mjs --gc unless your chunk is the last one (later chunks need the page images).
Return JSON {paperId, chunk, chunksPlanned, done (true when the paper is complete after your chunk), status, problems (in the paper now), pagesRead (by you), lastNote (run.mjs's last note), notes}.`;
const FIRST = p => `${COMMON(p)}

YOU ARE CHUNK 1 (the planner).
1. cd ${REPO} && node scripts/tx/queue-start.mjs ${args.queue} ${p.id}
   It prepares the paper and prints the reader task (exit 2). If it says the job already exists, run node scripts/tx/run.mjs ${p.id} --continue to see the task. Read the task's prompt text, not its page list.
2. Plan from the text layers (cheap: text, not images): write ${REPO}/tmp/tx/${p.id}/work/chunk-plan.json = {chunks: [{n, pages: [{document, page}], covers: "<what this chunk transcribes>"}]}. Every chunk has at most 24 page images; cut at problem boundaries (a problem's statement, parts and figures stay in one chunk; its official solution may come in a later chunk); put the statements first (all problem pages in chunk 1 when they fit), then the solution pages in order; skip pages that are pure cover/instructions/blank only if they print nothing a paper records (instructions and constants tables do go into paper.documentNotes). Aim for as few chunks as possible.
3. Transcribe chunk 1: read exactly its page images, write the candidate at the output path the task printed (tx.reader = {"provider":"agent","model":"${LABEL}","promptVersion":"v1","at":"<ISO time>"}, tx.splitRead = true), run the validate command it printed and fix format errors (at most 2 rounds).
4. node scripts/tx/figures.mjs ${p.id} <candidate> --dry-run ; read every crop and fix bad boxes (at most 2 rounds).
5. node scripts/tx/run.mjs ${p.id} --continue --repaired <candidate>   (--repaired lets a paper over the 120-page bulk cap through once a candidate exists). It checks, writes the receipt and promotes. Exit 3: fix rounds as above.`;
const NEXT = (p, k) => `${COMMON(p)}

YOU ARE CHUNK ${k}. The plan is ${REPO}/tmp/tx/${p.id}/work/chunk-plan.json; do chunk n = ${k} exactly as planned (if the plan needs a small correction for a problem that crosses its boundary, update the plan file and say so).
1. The paper as promoted after chunk ${k - 1} is content/problems/**/${p.id}.json (find it). Turn it back into a candidate: node scripts/tx/from-final.mjs ${p.id} --in <that file> --out ${REPO}/tmp/tx/${p.id}/candidates/agent__${LABEL}.c${k}.json (text untouched).
2. Read exactly chunk ${k}'s page images. Add what they print: new problems (statement, parts, figures, answers) and/or the official solutions of problems already in the paper (replacing their incomplete marks). Update paper.source.pages / paper.solutionSource.pages and paper.caveat as the split-read rules say. Keep tx.splitRead = true and set tx.reader = {"provider":"agent","model":"${LABEL}","promptVersion":"v1","at":"<ISO time>"}. Write the result to ${REPO}/tmp/tx/${p.id}/candidates/agent__${LABEL}.json and run node scripts/tx/validate.mjs <it> --paper-id ${p.id} --manifest ${REPO}/tmp/tx/${p.id}/manifest.json ; fix format errors.
3. node scripts/tx/figures.mjs ${p.id} ${REPO}/tmp/tx/${p.id}/candidates/agent__${LABEL}.json --dry-run ; read the crops of the figures you added and fix bad boxes.
4. node scripts/tx/run.mjs ${p.id} --continue --retry --repaired ${REPO}/tmp/tx/${p.id}/candidates/agent__${LABEL}.json — it checks, writes the receipt and promotes, replacing the published file. Exit 3: fix rounds as above.
5. If yours was the last chunk of the plan: make sure no incomplete mark of the "предстои" kind and no split caveat is left, then node scripts/tx/prepare.mjs ${p.id} --gc .`;
const res = await pipeline(args.papers, async p => {
  const chunks = [];
  for (let k = 1; k <= (args.maxChunks || 8); k++) {
    const r = await agent(k === 1 ? FIRST(p) : NEXT(p, k), { label: `split:${p.id}#${k}`, phase: 'Papers', schema: R, effort: 'medium' });
    if (!r) break;
    chunks.push(r);
    if (r.done || r.status !== 'promoted') break;
  }
  return { paperId: p.id, chunks };
});
const out = res.filter(Boolean);
log(`${out.filter(r => r.chunks.at(-1)?.done && r.chunks.at(-1)?.status === 'promoted').length} complete, ${out.filter(r => !r.chunks.at(-1)?.done).length} unfinished of ${out.length}`);
return out;
