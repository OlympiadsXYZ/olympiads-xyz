export const meta = {
  name: 'olympiads-agent-route',
  description:
    'Subscription-agent transcription route: one Opus 5.5 agent per paper reads (or reuses a pilot read), reviews its figure crops, then drives run.mjs through upload, free mechanical checks, repair, receipt and promotion; fixes parked papers from the page',
  phases: [
    { title: 'Papers', detail: 'one agent per paper, run.mjs state machine' },
  ],
};
// args: {repo: '<absolute repo path>', queue: '<queue file, relative to repo>', papers: [{id, alreadyRead?}]}
// Keys come from the queue file via scripts/tx/queue-start.mjs; never put archive keys in args.
const REPO = args.repo;
const LABEL = 'opus-5-5';
const R = {
  type: 'object',
  properties: {
    paperId: { type: 'string' },
    status: { type: 'string', enum: ['promoted', 'escalated', 'error'] },
    problems: { type: 'number' },
    figures: { type: 'number' },
    boxesFixed: { type: 'number' },
    fixRounds: { type: 'number' },
    lastNote: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['paperId', 'status'],
};
const res = await pipeline(args.papers, p =>
  agent(
    `You are transcribing one competition paper for Olympiads XYZ (an olympiad-prep site that publishes every problem of an archive verbatim, with figures and official solutions). Repository: ${REPO}. Paper: ${
      p.id
    }.

On Windows, run commands with the Bash tool (Git Bash) and write every JSON file with the Write tool, never with a shell heredoc, echo or node -e string: Git Bash mangles backslashes in those, which corrupts LaTeX.

1. cd ${REPO} && node scripts/tx/queue-start.mjs ${args.queue} ${p.id}
   It prepares the paper and prints a reader task, then exits with code 2. (If it says the job already exists, run: node scripts/tx/run.mjs ${
     p.id
   } --continue.) Older candidates from other readers (anthropic__*.json) may sit in the paper's candidates folder; ignore them.
   Size guard (D-P24): if the task lists more than 30 page images in total, stop here without reading any page and return status "error" with notes "too-large: N pages". Such papers are split and read separately.
2. ${
      p.alreadyRead
        ? `The read is already done: the candidate at ${REPO}/tmp/tx/${p.id}/candidates/agent__${LABEL}.json was written by an earlier one-shot agent following the same task. Do not re-read the paper. Only run the validate command the task printed and fix format errors if any.`
        : `Follow the printed task exactly: read the whole prompt (its rules are binding — including rule 1: fix only obviously wrong printed text, i.e. non-word misspellings and agreement errors, record every fix in tx.edits, and keep every acceptable printed form; numbers, units, symbols, names and mathematics are never changed), Read EVERY listed page image in order, write the JSON to the printed output path with tx.reader = {"provider":"agent","model":"${LABEL}","promptVersion":"v1","at":"<ISO time>"}, then run the validate command it printed and fix format errors (at most 2 rounds).`
    }
3. Figures: node scripts/tx/figures.mjs ${p.id} ${REPO}/tmp/tx/${
      p.id
    }/candidates/agent__${LABEL}.json --dry-run
   Read every crop PNG it lists. A crop must show the whole figure with its axis labels, lettering and legend, and no body text or caption sentence. Fix any bad box in the candidate JSON (tx.bbox is in permille of the page; look at the page image to choose the new edges) and re-run the dry run; at most 2 rounds.
4. node scripts/tx/run.mjs ${p.id} --continue
   This validates, crops and uploads the figures, runs the free text-layer and printed-region checks, repairs mechanically, writes the receipt and promotes the paper into content/problems. Exit 0 with a 'promoted' note means done.
5. If it exits 3 (escalated/parked): read ${REPO}/tmp/tx/${
      p.id
    }/receipt.json (defects[] with path, page, description, suggestedFix) and the current candidate (the latest candidates/agent__${LABEL}*.json that run.mjs names in its output or in ${REPO}/tmp/tx/jobs.json under jobs["${
      p.id
    }"].artefacts.candidate). For each defect, look at the page image and decide from the page: restore the printed wording (text-layer defects quote it), or keep an obvious-error fix and record it in tx.edits, or correct a figure box. Write the fixed JSON to ${REPO}/tmp/tx/${
      p.id
    }/candidates/agent__${LABEL}.agentfix.json and run: node scripts/tx/run.mjs ${
      p.id
    } --continue --retry --repaired ${REPO}/tmp/tx/${
      p.id
    }/candidates/agent__${LABEL}.agentfix.json . At most 2 such rounds; if still parked, stop and report.
6. When the paper is promoted, run: node scripts/tx/prepare.mjs ${
      p.id
    } --gc (frees disk; keeps the manifest and candidates).
Rules: never run gatsby; never git add/commit/push (the orchestrator ships); do not edit other papers, scripts, or content files by hand (run.mjs/promote write content); do not open content/problems of other papers; no web search; never read ~/.config/olympiads-xyz or print any key.
Return JSON {paperId, status: promoted|escalated|error, problems, figures, boxesFixed, fixRounds, lastNote (run.mjs's last note), notes}.`,
    { label: `paper:${p.id}`, phase: 'Papers', schema: R, effort: 'medium' }
  )
);
const out = res.filter(Boolean);
log(
  `${out.filter(r => r.status === 'promoted').length} promoted, ${
    out.filter(r => r.status === 'escalated').length
  } parked, ${out.filter(r => r.status === 'error').length} errors of ${
    args.papers.length
  }`
);
return out;
