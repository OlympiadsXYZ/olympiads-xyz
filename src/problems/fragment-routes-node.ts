import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ProblemFragmentRoute } from './fragment-routes';

type NativeSection = { id: string; title?: string };
type FragmentProblem = {
  id: string;
  title?: string;
  sections?: NativeSection[];
  solution?: { sections?: NativeSection[] };
};
type FragmentPaper = { paper: { id: string }; problems: FragmentProblem[] };

export type ProblemFragmentConfig = {
  version: 1;
  groups: {
    /** Exact grouped canonical input; stale hashes fail the build. */
    paper: { path: string; sha256: string };
    /** Historical source-reader correspondence proof retained by the publisher. */
    sourceReaderEvidence: { reference: string; sha256: string };
    previousCanonicalSha256: string;
    mappings: {
      fromProblemId: string;
      fromFragment: string;
      toProblemId: string;
      toFragment: string;
      label: string;
    }[];
  }[];
};

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ANCHOR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const anchors = (p: FragmentProblem) =>
  new Set([
    ...(p.sections ?? []).map(x => x.id),
    ...(p.solution?.sections ?? []).map(x => `solution-${x.id}`),
  ]);

/** Retained pages cannot use whole-page aliases. Attach browser fragment context. */
export function readProblemFragmentRoutes(
  root: string,
  availableSolutionUrls: Map<string, string>,
  config?: ProblemFragmentConfig
): Map<string, ProblemFragmentRoute[]> {
  const file = path.join(root, 'content/problem-fragment-routes.json');
  if (!config && !fs.existsSync(file)) return new Map();
  const data: ProblemFragmentConfig =
    config ?? JSON.parse(fs.readFileSync(file, 'utf8'));
  function reject(message: string): never {
    throw new Error(`[problem fragments] ${message}`);
  }
  if (data.version !== 1 || !Array.isArray(data.groups))
    reject('invalid config/version');
  const result = new Map<string, ProblemFragmentRoute[]>();
  const sourceKeys = new Set<string>();
  const targetKeys = new Set<string>();
  const paperInputs = new Set<string>();
  for (const group of data.groups) {
    if (
      !group.paper ||
      !/^content\/problems\/[a-zA-Z0-9_./-]+\.json$/.test(group.paper.path) ||
      group.paper.path.split('/').some(x => x === '..' || x === '.')
    )
      reject('unsafe canonical paper path');
    const canonical = path.resolve(root, group.paper.path);
    const relative = path.relative(
      path.resolve(root, 'content/problems'),
      canonical
    );
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      reject('paper must be inside content/problems');
    if (paperInputs.has(canonical)) reject('duplicate paper group');
    paperInputs.add(canonical);
    if (
      !SHA.test(group.paper.sha256) ||
      !SHA.test(group.previousCanonicalSha256) ||
      !group.sourceReaderEvidence?.reference?.trim() ||
      !SHA.test(group.sourceReaderEvidence.sha256)
    )
      reject('missing exact input/source-reader evidence hashes');
    if (group.paper.sha256 === group.previousCanonicalSha256)
      reject('grouped input must differ from historical input');
    const bytes = fs.readFileSync(canonical);
    if (
      crypto.createHash('sha256').update(bytes).digest('hex') !==
      group.paper.sha256
    )
      reject('canonical input hash mismatch: ' + group.paper.path);
    const paper: FragmentPaper = JSON.parse(bytes.toString('utf8'));
    if (!paper.paper?.id || !Array.isArray(paper.problems))
      reject('invalid canonical paper');
    const problems = new Map(paper.problems.map(p => [p.id, p]));
    if (
      problems.size !== paper.problems.length ||
      !Array.isArray(group.mappings) ||
      !group.mappings.length
    )
      reject('duplicate problem IDs or empty mappings');
    for (const mapping of group.mappings) {
      const { fromProblemId, fromFragment, toProblemId, toFragment, label } =
        mapping;
      if (
        !ID.test(fromProblemId) ||
        !ID.test(toProblemId) ||
        !ANCHOR.test(fromFragment) ||
        !ANCHOR.test(toFragment) ||
        typeof label !== 'string' ||
        !label.trim()
      )
        reject('invalid mapping identifier/label');
      const from = problems.get(fromProblemId),
        to = problems.get(toProblemId);
      if (!from || !to || fromProblemId === toProblemId)
        reject(
          'mapping must move between two retained IDs in the exact same paper'
        );
      if (
        !availableSolutionUrls.has(fromProblemId) ||
        !availableSolutionUrls.has(toProblemId)
      )
        reject('source or target solution page is unavailable');
      if (anchors(from).has(fromFragment))
        reject(
          'mapping shadows a retained native section: ' +
            fromProblemId +
            '#' +
            fromFragment
        );
      if (!anchors(to).has(toFragment))
        reject(
          'missing target native question/key section: ' +
            toProblemId +
            '#' +
            toFragment
        );
      const source = fromProblemId + '#' + fromFragment,
        target = toProblemId + '#' + toFragment;
      if (sourceKeys.has(source))
        reject('duplicate source fragment: ' + source);
      sourceKeys.add(source);
      targetKeys.add(target);
      const url = availableSolutionUrls.get(toProblemId)!;
      if (
        !/^\/problems\/[a-zA-Z0-9_/%-]+\/solution$/.test(url) ||
        url.includes('..') ||
        url.includes('\\')
      )
        reject('unsafe target solution URL');
      const rows = result.get(fromProblemId) ?? [];
      rows.push({
        fromFragment,
        toUrl: url + '#' + encodeURIComponent(toFragment),
        label,
      });
      result.set(fromProblemId, rows);
    }
  }
  for (const source of sourceKeys)
    if (targetKeys.has(source))
      reject('fragment chains/cycles are not permitted');
  return result;
}
