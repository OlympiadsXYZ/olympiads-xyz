export const meta = {
  name: 'olympiads-repair-route',
  description:
    'Repair route: one Opus 5.5 agent per already-published paper turns it back into a candidate (from-final), fixes the text-layer defects listed for it from the page images, then drives run.mjs through the mechanical checks, receipt and promote --replace',
  phases: [{ title: 'Papers', detail: 'one agent per paper, from-final → fix from the page → run.mjs' }],
};
// args: {repo, queue: '<queue file with keys, relative to repo>', defectsDir: 'tmp/sp-fix', papers: [{id}]}
// Each paper needs <defectsDir>/<id>.json = {paperId, contentFile, defects: [{path, kind, page, document, description, suggestedFix}]}.
const REPO = args.repo;
const LABEL = 'opus-5-5';
const R = {
  type: 'object',
  properties: {
    paperId: { type: 'string' },
    status: { type: 'string', enum: ['promoted', 'escalated', 'error'] },
    defectsFixed: { type: 'number' },
    disputed: { type: 'number' },
    fixRounds: { type: 'number' },
    lastNote: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['paperId', 'status'],
};
const promptFor = p => {
  const dir = `${REPO}/tmp/tx/${p.id}`;
  const cand = `${dir}/candidates/agent__${LABEL}`;
  return `You are repairing one already-published competition paper for Olympiads XYZ (an olympiad-prep site that publishes every problem of an archive verbatim, with figures and official solutions). Repository: ${REPO}. Paper: ${p.id}.

Background: on 2026-09-25 this paper was transcribed through a "single-pass" route that did not compare the text with the PDF. The free mechanical text-layer check then found defects in the published text: ${REPO}/${args.defectsDir}/${p.id}.json lists them (path, kind, page, document, description, suggestedFix) and names the published file (contentFile). Your job is to make the text verbatim again and take the paper through the verified route (mechanical text-layer and printed-region checks, receipt, promote replacing the published file). You are NOT re-transcribing the paper: read only the pages the defects name, plus whatever you need to settle them.

On Windows, run commands with the Bash tool (Git Bash) and write every JSON file with the Write tool, never with a shell heredoc, echo or node -e string: Git Bash mangles backslashes in those, which corrupts LaTeX.

1. cd ${REPO} && node scripts/tx/queue-start.mjs ${args.queue} ${p.id}
   It opens the job and prints the reader task, then exits with code 2. Read the task's rules (the reader prompt it prints: rule 1 on obvious errors, the tx block, figures) because the repaired candidate must follow them, but do not read every page. (If it says the job already exists, run: node scripts/tx/run.mjs ${p.id} --continue.) Older candidates from other readers (anthropic__*.json, and earlier agent__${LABEL}*.json files) may sit in the candidates folder; ignore them.
2. node scripts/tx/from-final.mjs ${p.id} --in <contentFile from the defects file> --out ${cand}.fromfinal.json
   This turns the published JSON back into candidate shape; the text is untouched.
3. Fix the defects. For each one, look at the page image it names (${dir}/pages/<document>-NN.png; NN is the two-digit page) and the text layer (${dir}/text/<document>.txt), and decide from the page:
   - Words "printed nowhere": text the single-pass reader added. That includes editorial and pipeline notes („Поправка на източника…“, „Файлът съдържа…“, „Официальное … Автор“, "supplement" notes, remarks about the file, the source or the transcription), paraphrases, and the reader's own corrections. Remove the addition and restore exactly what the page prints. The same inserted note usually repeats in several problems: search the whole candidate and remove every copy. If the page really prints the words (text the layer misses, e.g. inside an image), keep them and add {path, note} to tx.disputed with the page evidence (the printed words, the page, why the layer misses them).
   - A printed word missing or replaced ("the page prints X where the transcription has Y"): restore the printed form. Only an obvious non-word misspelling may be fixed (D-P23), recorded in tx.edits with the printed form and its page. An agreement error stays as printed and goes into tx.notes (D-P28).
   - Numbers, units, symbols, names and mathematics are never changed: a value the reader "corrected" goes back to what is printed (a suspected printing error may be mentioned in tx.notes).
   Change nothing else. Set tx.reader = {"provider":"agent","model":"${LABEL}","promptVersion":"v1","at":"<ISO time>"} and add to tx.notes: "repaired from the 2026-09-25 single-pass transcription by <the previous tx.reader provider/model>". Write the result to ${cand}.json and run the validate command the task printed; fix format errors (at most 2 rounds).
4. Figures: node scripts/tx/figures.mjs ${p.id} ${cand}.json --dry-run
   Read every crop PNG it lists. A crop must show the whole figure with its axis labels, lettering and legend, and no body text or caption sentence. Fix any bad box in the candidate JSON (tx.bbox is in permille of the page; look at the page image to choose the new edges) and re-run the dry run; at most 2 rounds.
5. node scripts/tx/run.mjs ${p.id} --continue
   This validates, crops and uploads the figures, runs the free text-layer and printed-region checks, repairs mechanically, writes the receipt and promotes the paper, replacing the published file. Exit 0 with a 'promoted' note means done.
6. If it exits 3 (escalated/parked): read ${dir}/receipt.json (defects[] with path, page, description, suggestedFix) and the current candidate (the latest candidates/agent__${LABEL}*.json that run.mjs names in its output or in ${REPO}/tmp/tx/jobs.json under jobs["${p.id}"].artefacts.candidate). For each defect, look at the page and decide from the page, exactly as in step 3. Never change the text only to satisfy a check: no invisible characters (soft hyphen, zero-width space), no re-spelling, no moving words, no turning a table into an image. If the page shows your text is right and the check is wrong, use the sanctioned routes: tx.disputed {path, note} for a text-layer "printed nowhere" defect with no suggested fix; tx.notFigures {document, page, bbox, note} for a region defect that is decoration or already-transcribed text. Anything else the check gets wrong: stop and report status escalated with the evidence. Write the fixed JSON to ${cand}.agentfix.json and run: node scripts/tx/run.mjs ${p.id} --continue --retry --repaired ${cand}.agentfix.json . At most 2 such rounds; if still parked, stop and report.
7. When the paper is promoted, run: node scripts/tx/prepare.mjs ${p.id} --gc (frees disk; keeps the manifest and candidates).
Rules: never run gatsby; never git add/commit/push (the orchestrator ships); do not edit other papers, scripts, or content files by hand (run.mjs/promote write content); no web search; never read ~/.config/olympiads-xyz or print any key. Keep every helper script and scratch file under ${dir}/work/ — never in a shared scratchpad or temp folder: other paper agents run in parallel and reuse the same file names.
Return JSON {paperId, status: promoted|escalated|error, defectsFixed, disputed, fixRounds, lastNote (run.mjs's last note), notes (what you removed or restored, with pages)}.`;
};
const res = await pipeline(args.papers, p => agent(promptFor(p), { label: `repair:${p.id}`, phase: 'Papers', schema: R, effort: 'medium' }));
const out = res.filter(Boolean);
log(`${out.filter(r => r.status === 'promoted').length} promoted, ${out.filter(r => r.status === 'escalated').length} parked, ${out.filter(r => r.status === 'error').length} errors of ${out.length}`);
return out;
