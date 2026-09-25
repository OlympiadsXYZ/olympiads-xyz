import { useCallback } from 'react';

export function problemSuggestionURL(data: {
  name: string;
  link: string;
  difficulty: string;
  tags: string;
  additionalNotes: string;
  problemTableLink: string;
  moduleName: string;
  section: string;
  problemListName: string;
  source: string;
  filePath: string;
}): string {
  const body = [
    'Задача: ' + data.name,
    'Адрес: ' + data.link,
    'Модул: ' + data.moduleName + ' (' + data.problemTableLink + ')',
    'Файл: ' + data.filePath,
    'Таблица: ' + data.problemListName,
    'Източник: ' + data.source,
    'Трудност: ' + data.difficulty,
    'Тагове: ' + data.tags,
    '',
    data.additionalNotes,
  ].join('\n');
  const params = new URLSearchParams({
    title: 'Предложение за задача: ' + data.name,
    body,
  });
  const url =
    'https://github.com/OlympiadsXYZ/olympiads-xyz/issues/new?' +
    params.toString();
  if (url.length > 7500) {
    throw new Error(
      'Описанието е твърде дълго. Съкратете бележките и опитайте отново.'
    );
  }
  return url;
}

export default function useProblemSuggestionAction() {
  // Preparing this link sends nothing. The visitor reviews and submits it on GitHub.
  return useCallback(
    async (data: Parameters<typeof problemSuggestionURL>[0]) => ({
      data: problemSuggestionURL(data),
    }),
    []
  );
}
