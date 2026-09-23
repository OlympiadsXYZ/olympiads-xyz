#!/usr/bin/env node
// progress.mjs [--out <dir>] [--meter <weekly %>] [--meter-resets <ISO>] [--inflight <workflow args.json>] [--tranche <name>]
// Snapshot of the transcription effort for the progress dashboard: what is live, what the archive catalogue still
// holds (scripts/tx/backlog.mjs --catalogue) and where each remaining paper stands. Writes two JSON documents to --out
// (default tmp/progress): snapshot.json (totals, breakdowns, history, parked list) and remaining.json (one row per
// remaining paper). Read-only apart from those files and a small history cache in the same folder.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPapers, publicationState, readJson } from '../lib/problem-data.mjs';
import { ROOT } from './lib.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(ROOT, arg('--out') || 'tmp/progress');
fs.mkdirSync(OUT, { recursive: true });
const nfc = s => String(s ?? '').normalize('NFC');
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 }).stdout;
const HANDOFF = path.join(ROOT, 'docs/handoff-2026-09-22');

// --- live: every paper file, with the problems the site publishes (the ledger decides eligibility)
const ledger = readJson(path.join(ROOT, 'content/problem-publication.json'), { papers: {} });
const live = { papers: 0, eligiblePapers: 0, problems: 0, reviewed: 0, legacy: 0, withheld: 0 };
// papers promoted into the working tree but not yet committed: transcribed, not on the site until the next ship
const unshipped = new Set(git('status', '--porcelain', '-z', '--untracked-files=all', '--', 'content/problems').split('\0').filter(l => /^(\?\?|A ) /.test(l)).map(l => path.resolve(ROOT, l.slice(3))));
const pending = { papers: 0, problems: 0 };
const liveIds = new Set();
const bySubject = {}, byLangLive = {}, byComp = {};
const compKey = (subject, competition) => `${subject}|${competition}`;
const comp = (subject, competition) => (byComp[compKey(subject, competition)] ||= { subject, competition, livePapers: 0, liveProblems: 0, remaining: 0, remainingEst: 0 });
for (const record of readPapers(ROOT)) {
  const { paper, problems } = record.data;
  liveIds.add(paper.id);
  comp(paper.subject, paper.competition).livePapers++;
  if (unshipped.has(path.resolve(record.file))) { pending.papers++; pending.problems += problems.length; continue; }
  live.papers++;
  const state = publicationState(record, ledger);
  const s = (bySubject[paper.subject] ||= { subject: paper.subject, papers: 0, problems: 0 });
  s.papers++;
  const l = (byLangLive[paper.lang || '?'] ||= { lang: paper.lang || '?', papers: 0, problems: 0 });
  l.papers++;
  const c = comp(paper.subject, paper.competition);
  if (!state.eligible) { live.withheld++; continue; }
  live.eligiblePapers++; live.problems += problems.length; live[state.quality]++;
  s.problems += problems.length; l.problems += problems.length; c.liveProblems += problems.length;
}

// --- the archive catalogue: what is left, and what backlog.mjs leaves out on purpose
const bl = spawnSync(process.execPath, ['scripts/tx/backlog.mjs', '--catalogue', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 });
if (bl.status !== 0) throw new Error(`backlog.mjs failed: ${bl.stderr}`);
const rows = JSON.parse(bl.stdout);
const summary = /(\d+) backlog entries not in [^(]*\(of (\d+); left out: (.*)\)\s*$/m.exec(bl.stderr);
const catalogue = {
  documents: summary ? Number(summary[2]) : null,
  remaining: rows.length,
  imageOnlySheets: Number(/(\d+) image-only problem sheets/.exec(bl.stderr)?.[1] || 0),
  coverSheets: Number(/(\d+) instructions\/cover sheet/.exec(bl.stderr)?.[1] || 0),
  leftOut: summary ? summary[3].split(/,\s*(?=\d)/).map(x => { const m = /^(\d+) (.*)$/.exec(x.trim()); return m ? { n: Number(m[1]), what: m[2] } : { n: 0, what: x.trim() }; }) : [],
};

// --- where each remaining paper stands
const classified = readJson(path.join(HANDOFF, 'backlog-1587-classified.json'), []);
const clsById = new Map(classified.map(r => [r.paperId, r])), clsByKey = new Map(classified.map(r => [nfc(r.problemsKey), r]));
const jobsFile = readJson(path.join(ROOT, 'tmp/tx/jobs.json'), { jobs: {} });
const jobs = jobsFile.jobs || jobsFile;
const plan = readJson(path.join(HANDOFF, 'enru-dedupe-plan.json'), { hold: [] });
const holds = readJson(path.join(HANDOFF, 'holds.json'), { held: {}, broken: {} });
const held = new Map([...plan.hold.map(h => [h.id, h.reason]), ...Object.entries(holds.held || {})]);
const broken = new Map(Object.entries(holds.broken || {}));
const inflightArgs = arg('--inflight') ? readJson(path.resolve(arg('--inflight')), { papers: [] }) : { papers: [] };
const inflight = new Set(inflightArgs.papers.flatMap(p => p.ids || [p.id]));
// A queue may name a paper differently from the catalogue (prepare.mjs disambiguates ids), so rows are matched to their
// queue entry by archive key, and the queue's id is the one jobs, manifests and holds use.
const queues = {}, queueIdByKey = new Map();
for (const f of fs.readdirSync(HANDOFF).filter(f => /^queue-.*\.json$/.test(f))) for (const p of readJson(path.join(HANDOFF, f), { papers: [] }).papers || []) {
  queues[p.id] ||= f.replace(/^queue-|\.json$/g, '');
  if (p.problemsKey && !queueIdByKey.has(nfc(p.problemsKey))) queueIdByKey.set(nfc(p.problemsKey), p.id);
}
const totalPages = (id, fallback) => { try { const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp/tx', id, 'manifest.json'), 'utf8')); return { pages: Object.values(m.documents || {}).reduce((s, d) => s + (d.pages || 0), 0), measured: true }; } catch { return { pages: fallback || 0, measured: false }; } };
const lastNote = job => String(job?.history?.at(-1)?.note || '').replace(/\s+/g, ' ').slice(0, 280);

const STATUSES = ['inflight', 'queued', 'tooLarge', 'parked', 'held', 'broken'];
const remaining = [];
const byClass = {}, byStatus = Object.fromEntries(STATUSES.map(s => [s, { papers: 0, est: 0 }]));
for (const row of rows) {
  const id = queueIdByKey.get(nfc(row.problemsKey)) || row.paperId;
  const c = clsById.get(id) || clsById.get(row.paperId) || clsByKey.get(nfc(row.problemsKey)) || {};
  const kind = /\.(docx?|rtf|odt)$/i.test(row.problemsKey) ? 'word' : c.cls || 'unknown';
  const job = jobs[id];
  const agent = job?.reader?.provider === 'agent';
  const { pages, measured } = totalPages(id, c.pages);
  let status, note = '';
  if (inflight.has(id)) status = 'inflight';
  else if (broken.has(id)) { status = 'broken'; note = broken.get(id); }
  else if (held.has(id)) { status = 'held'; note = held.get(id); }
  else if (agent && job.stage === 'escalated') { status = 'parked'; note = lastNote(job); }
  else if (pages > 30) { status = 'tooLarge'; note = `${pages} pages${measured ? '' : ' (problems only)'}: needs a split read (D-P24)`; }
  else if (agent) { status = 'parked'; note = `stopped at ${job.stage}: ${lastNote(job)}`; }
  else status = 'queued';
  const est = Number(c.indexProblems) || 0;
  const lang = row.lang || c.lang || '?';
  remaining.push([id, row.competition, row.subject, row.year, lang, kind, status, pages, est, queues[id] || '', note]);
  const k = `${lang}|${kind}`;
  const b = (byClass[k] ||= { lang, kind, papers: 0, est: 0, ...Object.fromEntries(STATUSES.map(s => [s, 0])) });
  b.papers++; b.est += est; b[status]++;
  byStatus[status].papers++; byStatus[status].est += est;
  const cc = comp(row.subject, row.competition);
  cc.remaining++; cc.remainingEst += est;
}

// --- growth: papers on master after every commit that touched content/problems (cached by commit), problems from the
// ship commits' own summary line
const cacheFile = path.join(OUT, 'history-cache.json');
const cache = readJson(cacheFile, {});
const history = [];
for (const line of git('log', '--reverse', '--format=%H|%cI|%s', '--', 'content/problems').split('\n').filter(Boolean)) {
  const [hash, at, ...rest] = line.split('|');
  const subject = rest.join('|');
  if (cache[hash] === undefined) cache[hash] = git('ls-tree', '-r', '-z', '--name-only', hash, 'content/problems').split('\0').filter(f => f.endsWith('.json') && !f.endsWith('/schema.json')).length;
  const m = /(\d+) papers; (\d+) eligible problems/.exec(subject);
  history.push({ at, papers: m ? Number(m[1]) : cache[hash], problems: m ? Number(m[2]) : null, commit: hash.slice(0, 10) });
}
fs.writeFileSync(cacheFile, JSON.stringify(cache));

// --- promotions per day and route, from the job ledger
const routeOf = p => (p === 'agent' ? 'agent' : p === 'zai' ? 'glm' : p === 'anthropic' ? 'api' : 'other');
const daily = {};
for (const job of Object.values(jobs)) for (const h of job.history || []) if (h.stage === 'done' && /^promoted/.test(h.note || '')) {
  const day = String(h.at).slice(0, 10);
  const d = (daily[day] ||= { day, agent: 0, api: 0, glm: 0, other: 0 });
  d[routeOf(job.reader?.provider)]++;
}

const head = git('log', '-1', '--format=%h|%cI|%s').trim().split('|');
const snapshot = {
  generatedAt: new Date().toISOString(),
  commit: { hash: head[0], at: head[1], subject: head.slice(2).join('|').slice(0, 160) },
  live,
  pending,
  catalogue,
  remaining: { papers: rows.length, est: remaining.reduce((s, r) => s + r[8], 0), byStatus, byClass: Object.values(byClass).sort((a, b) => b.papers - a.papers) },
  bySubject: Object.values(bySubject).sort((a, b) => b.papers - a.papers),
  byLangLive: Object.values(byLangLive).sort((a, b) => b.papers - a.papers),
  competitions: Object.values(byComp).sort((a, b) => b.livePapers + b.remaining - (a.livePapers + a.remaining)),
  history,
  daily: Object.values(daily).sort((a, b) => a.day.localeCompare(b.day)),
  meter: arg('--meter') ? { weekly: Number(arg('--meter')), resetsAt: arg('--meter-resets') || null } : null,
  tranche: inflight.size ? { name: arg('--tranche') || 'current tranche', papers: byStatus.inflight.papers, launched: inflight.size } : null,
};
fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(snapshot));
fs.writeFileSync(path.join(OUT, 'remaining.json'), JSON.stringify({ columns: ['id', 'competition', 'subject', 'year', 'lang', 'kind', 'status', 'pages', 'est', 'queue', 'note'], rows: remaining }));
const kb = f => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
console.log(`live ${live.papers} papers / ${live.problems} problems (+${pending.papers} papers / ${pending.problems} problems unshipped); remaining ${rows.length} papers (~${snapshot.remaining.est} problems): ${STATUSES.map(s => `${s} ${byStatus[s].papers}`).join(', ')}; snapshot ${kb('snapshot.json')} KB, remaining ${kb('remaining.json')} KB -> ${path.relative(ROOT, OUT)}`);
