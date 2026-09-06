import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const jsonText = value => JSON.stringify(value, null, 2) + '\n';
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
export function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.partial`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}
export function walkJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    const file = path.join(dir, e.name);
    return e.isDirectory() ? walkJson(file) : e.name.endsWith('.json') && e.name !== 'schema.json' ? [file] : [];
  });
}
export function readPapers(root) {
  const ids = new Set(), problems = new Set();
  return walkJson(path.join(root, 'content/problems')).map(file => {
    const bytes = fs.readFileSync(file), data = JSON.parse(bytes.toString('utf8'));
    if (!data.paper || !Array.isArray(data.problems)) throw new Error(`Invalid paper: ${file}`);
    const { paper } = data;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(paper.id) || !/^[a-z]+$/.test(paper.subject)) throw new Error(`Unsafe paper id/subject: ${file}`);
    if (ids.has(paper.id)) throw new Error(`Duplicate paper id: ${paper.id}`);
    ids.add(paper.id);
    for (const problem of data.problems) {
      if (!problem.id.startsWith(paper.id + '-') || /[/\\\x00]/.test(problem.id) || problem.id.includes('..')) throw new Error(`Unsafe/unscoped problem id: ${problem.id}`);
      if (problems.has(problem.id)) throw new Error(`Duplicate problem id: ${problem.id}`);
      problems.add(problem.id);
    }
    return { file, relativePath: path.relative(root, file), data, contentHash: sha256(bytes) };
  });
}
export function publicationState(record, ledger) {
  const { paper } = record.data;
  if (paper.status === 'withdrawn' || paper.status === 'quarantined') return { eligible: false, reason: paper.status };
  const entry = ledger?.papers?.[paper.id];
  if (!entry) return { eligible: false, reason: 'no-publication-record' };
  if (entry.contentHash !== record.contentHash) return { eligible: false, reason: 'revision-needs-review' };
  if (entry.kind === 'legacy' && /^[a-f0-9]{40}$/.test(entry.sourceCommit || '') && entry.recordedAt) return { eligible: true, quality: 'legacy' };
  const review = entry.review;
  if (entry.kind === 'reviewed' && paper.status !== 'draft' && review?.verdict === 'pass' && review.contentHash === record.contentHash && review.reviewer?.provider && review.reviewer?.model && review.reviewer?.requestId && review.checkedAt && review.sourceHashes?.problems && Array.isArray(review.defects) && review.defects.length === 0 && !(review.blockers?.length) && (!review.independence || review.independence.independent === true || review.independence.allowSameModel === true)) return { eligible: true, quality: 'reviewed', verifiedAt: review.checkedAt };
  return { eligible: false, reason: 'invalid-publication-record' };
}

// Coarse, controlled categories are for discovery. Exact source wording and
// the original model's proposed topic strings remain in the canonical paper.
// A raw string matches an entry when it equals the entry id or an alias, or
// sits below one of them ("thermodynamics/ideal-gas" -> "thermodynamics");
// the subject prefixes models add inconsistently ("physics/", "astronomy/")
// are ignored. Longer aliases are checked first so "electromagnetism/induction"
// lands on magnetism even though a shorter "electromagnetism" alias exists.
export function controlledTopics(proposed, taxonomy) {
  const found = new Set();
  const matches = (topic, key) => topic === key || topic.startsWith(key + '/');
  for (const raw of proposed || []) {
    const topic = String(raw).toLowerCase().trim();
    const candidates = [...new Set([topic, topic.replace(/^physics\//, ''), topic.replace(/^astronomy\//, '')])];
    let best = null;
    for (const entry of taxonomy.topics) {
      for (const key of [entry.id, ...entry.aliases]) {
        if (candidates.some(c => matches(c, key)) && (!best || key.length > best.key.length)) best = { key, id: entry.id };
      }
    }
    if (best) found.add(best.id);
  }
  return [...found].sort();
}
