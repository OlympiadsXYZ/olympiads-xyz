import type {
  AlgoliaEditorModuleFile,
  AlgoliaEditorSolutionFile,
} from '../../models/algoliaEditorFile';

// JSON strings are also YAML scalars, including titles with colons or quotes.
export function moduleTemplate(module: AlgoliaEditorModuleFile): string {
  return `---
id: ${JSON.stringify(module.id)}
title: ${JSON.stringify(module.title)}
author: "Добавете вашето име"
description: ${JSON.stringify(module.description || '')}
prerequisites: []
frequency: 0
---

## Обяснение

Добавете съдържанието на модула тук.

## Задачи

<Problems problems="module_problem" />
`;
}

export function solutionTemplate(file: AlgoliaEditorSolutionFile): string {
  return `---
id: ${JSON.stringify(file.id)}
source: ${JSON.stringify(file.source)}
title: ${JSON.stringify(file.title)}
author: "Добавете вашето име"
---

## Решение

Добавете обяснението тук. Формулите се пишат между доларови знаци, например $E = mc^2$.
`;
}
