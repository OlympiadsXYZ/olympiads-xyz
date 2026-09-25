import type {
  ProblemMetadata,
  ProblemSolutionMetadata,
} from '../../models/problem';
import type { ProblemsIndexEntry } from '../../problems/index-node';

const REPOSITORY = 'https://github.com/OlympiadsXYZ/olympiads-xyz';

export function editorProblemMetadata(
  problem: ProblemsIndexEntry
): ProblemMetadata {
  const solution = problem.solution;
  let solutionMetadata: ProblemSolutionMetadata = { kind: 'none' };
  if (solution?.kind === 'internal') {
    solutionMetadata = { kind: 'internal', hasHints: !!solution.hasHints };
  } else if (solution?.kind === 'link' && solution.url) {
    solutionMetadata = { kind: 'link', url: solution.url };
  } else if (solution?.kind === 'sketch' && solution.sketch) {
    solutionMetadata = { kind: 'sketch', sketch: solution.sketch };
  }
  return {
    uniqueId: problem.uniqueId,
    name: problem.name,
    url: problem.url,
    source: problem.source,
    difficulty: problem.difficulty as ProblemMetadata['difficulty'],
    isStarred: false,
    tags: problem.tags || [],
    solutionMetadata,
  };
}

export function editorPath(filePath: string): string {
  const path = filePath.replace(/\\/g, '/');
  if (
    !/^(content|solutions)\//.test(path) ||
    path.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error('Невалиден път на файл.');
  }
  return path.split('/').map(encodeURIComponent).join('/');
}

export function editorFileURL(filePath: string, isNew = false): string {
  const encoded = editorPath(filePath);
  if (!isNew) return REPOSITORY + '/edit/master/' + encoded;
  const split = encoded.lastIndexOf('/');
  return (
    REPOSITORY +
    '/new/master/' +
    encoded.slice(0, split) +
    '?filename=' +
    encoded.slice(split + 1)
  );
}

export function downloadEditorFile(filePath: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/plain;charset=utf-8' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filePath.split(/[\\/]/).pop() || 'draft.mdx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fetchFileContent = async (
  filePath: string
): Promise<{ markdown: string; problems?: string }> => {
  const base =
    'https://raw.githubusercontent.com/OlympiadsXYZ/olympiads-xyz/master/';
  const requests = [fetch(base + editorPath(filePath))];
  if (filePath.startsWith('content/')) {
    requests.push(
      fetch(base + editorPath(filePath.replace(/\.mdx$/, '.problems.json')))
    );
  }
  const result = await Promise.all(requests);
  if (!result[0].ok) {
    throw new Error(
      'Файлът не е зареден (' +
        result[0].status +
        '). Редакциите ви са запазени.'
    );
  }
  if (result[1] && !result[1].ok && result[1].status !== 404) {
    throw new Error('Задачите към файла не са заредени. Опитайте отново.');
  }
  return {
    markdown: await result[0].text(),
    problems: result[1]?.ok ? await result[1].text() : '',
  };
};
