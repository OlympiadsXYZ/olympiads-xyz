// Explicit, source-audited language counterparts. This only changes discovery:
// all ProblemInfo IDs, source content and solution routes keep their identity.
import type { PaperFile } from './tree';

export type EditionInput = {
  path: string;
  sha256: string;
  lang: string;
};
export type EditionGroup = {
  id: string;
  subject: string;
  competition: string;
  year: number;
  cohort: string;
  roundType?: string;
  originalLanguage: string;
  paperIds: string[];
  tasks: { key: string; members: string[] }[];
  evidence: string;
};
export type ProblemEditions = {
  version: 1;
  inputs: { [paperId: string]: EditionInput };
  groups: EditionGroup[];
};
export type EditionProjection = {
  primaryById: Map<string, string>;
  membersById: Map<string, string[]>;
  languageById: Map<string, string>;
  issues: string[];
  suppressedIds: Set<string>;
};
export type ProblemEditionLink = {
  id: string;
  lang: string;
  label: string;
  url: string;
};
const LANGUAGE_LABELS: { [code: string]: string } = {
  bg: 'Български',
  en: 'English',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
};

/** Unknown versions and invalid groups fail open: they never hide a problem. */
export function buildEditionProjection(
  raw: unknown,
  papers: PaperFile[],
  availableIds: Set<string>,
  hashes: Map<string, string>
): EditionProjection {
  const out: EditionProjection = {
    primaryById: new Map(),
    membersById: new Map(),
    languageById: new Map(),
    suppressedIds: new Set(),
    issues: [],
  };
  if (raw == null) return out;
  const config = raw as ProblemEditions;
  if (config.version !== 1 || !config.inputs || !Array.isArray(config.groups)) {
    out.issues.push('Unsupported or malformed content/problem-editions.json');
    return out;
  }
  if (
    config.groups.some(
      g =>
        !g ||
        !Array.isArray(g.paperIds) ||
        !Array.isArray(g.tasks) ||
        g.tasks.some(t => !t || !Array.isArray(t.members))
    )
  ) {
    out.issues.push('Malformed edition groups; keeping all editions visible');
    return out;
  }
  const cohort = (value: string | null | undefined) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/α/g, 'alpha')
      .replace(/β/g, 'beta')
      .replace(/^a$/, 'alpha')
      .replace(/^b$/, 'beta')
      .replace(/[\s,+/–-]/g, '');
  const byPaper = new Map(papers.map(p => [p.paper.id, p] as const));
  const problemPaper = new Map(
    papers.flatMap(p => p.problems.map(q => [q.id, p.paper] as const))
  );
  for (const [id, paper] of problemPaper)
    out.languageById.set(id, paper.lang ?? '');
  // A repeated member invalidates every affected group, not just the later one.
  const owners = new Map<string, number>();
  for (const group of config.groups)
    for (const task of group.tasks ?? [])
      for (const id of task.members ?? [])
        owners.set(id, (owners.get(id) ?? 0) + 1);
  const groupIds = new Set<string>();
  for (const group of config.groups) {
    const errors: string[] = [];
    if (!group.id || groupIds.has(group.id))
      errors.push('missing or repeated group id');
    groupIds.add(group.id);
    if (
      !group.cohort ||
      !group.originalLanguage ||
      !group.evidence ||
      !Array.isArray(group.paperIds) ||
      !Array.isArray(group.tasks)
    ) {
      errors.push(
        'missing source scope, language, evidence or explicit members'
      );
    }
    const paperIds = new Set(group.paperIds ?? []);
    for (const id of paperIds) {
      const file = byPaper.get(id),
        input = config.inputs[id];
      if (!file || !input) {
        errors.push(`${id}: missing paper/input`);
        continue;
      }
      if (
        file.paper.subject !== group.subject ||
        file.paper.competition !== group.competition ||
        file.paper.year !== group.year
      )
        errors.push(`${id}: competition/year/subject differs`);
      if (group.roundType && file.paper.roundType !== group.roundType)
        errors.push(`${id}: round differs`);
      if (
        file.paper.grade &&
        cohort(group.cohort) !== 'all' &&
        cohort(file.paper.grade) !== cohort(group.cohort)
      )
        errors.push(`${id}: cohort differs`);
      if (file.paper.lang !== input.lang)
        errors.push(`${id}: language differs`);
      if (
        !/^[a-f0-9]{64}$/.test(input.sha256) ||
        hashes.get(id) !== input.sha256
      )
        errors.push(`${id}: source-audited input hash differs`);
    }
    const taskKeys = new Set<string>();
    for (const task of group.tasks ?? []) {
      if (!task.key || taskKeys.has(task.key))
        errors.push('missing or repeated task key');
      taskKeys.add(task.key);
      if (!Array.isArray(task.members) || task.members.length < 2) {
        errors.push(`${task.key}: fewer than two editions`);
        continue;
      }
      const languages = new Set<string>();
      for (const id of task.members) {
        const paper = problemPaper.get(id);
        if (!paper || !paperIds.has(paper.id))
          errors.push(`${id}: missing problem or outside audited scope`);
        if ((owners.get(id) ?? 0) > 1)
          errors.push(`${id}: mapped more than once`);
        if (paper?.lang) languages.add(paper.lang);
      }
      if (languages.size < 2)
        errors.push(`${task.key}: not a language correspondence`);
    }
    if (errors.length) {
      out.issues.push(...errors.map(e => `${group.id}: ${e}`));
      continue;
    }
    for (const task of group.tasks) {
      const available = task.members.filter(id => availableIds.has(id));
      if (available.length < 2) continue;
      const rank = (id: string) => {
        const lang = problemPaper.get(id)?.lang;
        return lang === 'bg'
          ? 0
          : lang === group.originalLanguage
          ? 1
          : lang === 'en'
          ? 2
          : 3;
      };
      // Equal-ranked source editions use explicit member order, never paper IDs or heuristics.
      const primary = [...available].sort((a, b) => rank(a) - rank(b))[0];
      for (const id of available) {
        out.primaryById.set(id, primary);
        out.membersById.set(id, available);
        if (id !== primary) out.suppressedIds.add(id);
      }
    }
  }
  return out;
}

export function primaryEditionPapers(
  papers: PaperFile[],
  projection: EditionProjection
): PaperFile[] {
  return papers.map(file => ({
    ...file,
    problems: file.problems.filter(p => !projection.suppressedIds.has(p.id)),
  }));
}

/** Every link uses the exact preserved route belonging to the alternate ID. */
export function problemEditionLinks(
  id: string,
  projection: EditionProjection,
  urls: Map<string, string>
): ProblemEditionLink[] {
  return (projection.membersById.get(id) ?? [])
    .filter(member => member !== id && urls.has(member))
    .map(member => {
      const lang = projection.languageById.get(member) ?? '';
      return {
        id: member,
        lang,
        label: LANGUAGE_LABELS[lang] ?? lang,
        url: urls.get(member)!,
      };
    });
}
