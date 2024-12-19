import { atom } from 'jotai';
import { atomFamily, atomWithStorage } from 'jotai/utils';
import { Octokit } from 'octokit';
import { fetchFileContent } from '../components/Editor/editorUtils';
import { AlgoliaEditorSolutionFile, AlgoliaEditorModuleFile } from '../models/algoliaEditorFile';
import { formatProblems } from '../utils/prettierFormatter';
import { AlgoliaModuleInfo } from '../models/module';


export type EditorFile = {
  path: string;
  markdown: string;
  problems?: string;
};

export const filesFamily = atomFamily((path: string) => {
  return atomWithStorage<EditorFile>(`guide:editor:files:${path}`, {
    path,
    markdown: '',
    problems: '',
  });
});

/**
 * Saves a file atom based on its path as its identifier.
 */
export const saveFileAtom = atom(
  null,
  (
    get,
    set,
    update:
      | {
          path: string;
          update: (f: EditorFile) => EditorFile;
        }
      | EditorFile
  ) => {
    const file = update.hasOwnProperty('update')
      ? (update as { update: (f: EditorFile) => EditorFile }).update(
          get(filesFamily(update.path))
        )
      : (update as EditorFile);
    set(filesFamily(file.path), file);
  }
);

const baseActiveFileAtom = atomWithStorage(
  'guide:editor:activeFile',
  null as string | null
);
export const branchAtom = atomWithStorage('guide:editor:branch', null);
export const tokenAtom = atom<string | null>(null);
export const octokitAtom = atom(get =>
  get(tokenAtom) === null ? null : new Octokit({ auth: get(tokenAtom) })
);
export const forkAtom = atom<string | undefined>(undefined);
export const baseTabAtom = atom<'content' | 'problems'>('content');
export const editingSolutionAtom = atom(get => {
  const activeFile = get(activeFileAtom);
  return activeFile && activeFile.path.startsWith('solutions');
});
export const tabAtom = atom(get =>
  get(editingSolutionAtom) ? 'content' : get(baseTabAtom)
);
export const trueFilePathAtom = atom(get => {
  const activeFile = get(activeFileAtom);
  return activeFile === null
    ? 'NONE'
    : get(tabAtom) === 'content'
    ? activeFile.path
    : activeFile.path.replace(/\.mdx$/, '.problems.json');
});
export const trueFileAtom = atom(get => {
  const activeFile = get(activeFileAtom);
  return activeFile === null
    ? 'Open a file to begin'
    : get(tabAtom) === 'content'
    ? activeFile.markdown
    : activeFile.problems;
});
export const githubInfoAtom = atom(
  async get => (await get(octokitAtom)?.request('GET /user'))?.data
);
export const activeFileAtom = atom(
  get => {
    const activeFile = get(baseActiveFileAtom);
    return activeFile ? get(filesFamily(activeFile)) : null;
  },
  (get, set, nextActiveFilePath) => {
    set(baseActiveFileAtom, nextActiveFilePath);
  }
);

export const filesListAtom = atomWithStorage<string[]>(
  'guide:editor:filesList',
  []
);

export const openOrCreateExistingFileAtom = atom(
  null,
  async (get, set, filePath: string) => {
    if (get(filesListAtom).find(f => f === filePath)) {
      set(activeFileAtom, filePath);
    } else {
      set(filesListAtom, prev => [...prev, filePath]);
      const data = await fetchFileContent(filePath);
      set(saveFileAtom, {
        path: filePath,
        markdown: data.markdown,
        problems: data.problems,
      });
      set(activeFileAtom, filePath);
    }
  }
);

export const createNewInternalSolutionFileAtom = atom(
  null,
  async (get, set, file: AlgoliaEditorSolutionFile) => {
    const module = file.problemModules[0]?.path.split('/')[1];
    const section =
      file.section;
      // (!module ? 'orphaned' : module.split('_')[1].toLowerCase());
    const newFile: EditorFile = {
      path: `solutions/${section}/${file.id}.mdx`,
      //TODO: add automatically the solution metadata to the file
      markdown: `---
id: ${file.id}
source: ${
        file.source
      } (TODO -- convert to something like \`USACO Silver 2017 January\`)
title: ${file.title}
author: TODO -- insert your name here
---


When adding an internal solution, you have to update relevant modules to point to this new internal solution. This process is partially automated; modules containing this problem have been updated in the editor (see file list to the left).

## Explanation

(add explanation here ...)

Use \`\\texttt{}\` around variable names with length *greater than one*, like so. Place long equations on separate lines with display math, and use \`\\cdot\` instead of \`*\` to denote multiplication.

$$
\\texttt{arr}[i]=2\\cdot (a+b+c+d+e)+\\sum_{j=0}^{i-1}\\texttt{arr}[j]
$$

Some additional text styles which you might consider using:

http://latexref.xyz/Font-styles.html

http://applied-r.com/latex-font-styles/

$func(var)$

$\\textit{func(var)}$

$\\textrm{func(var)}$

$\\text{func(var)}$

$\\textsf{func(var)}$

$\\textbf{func(var)}$

$\\texttt{func(var)}$

## Implementation

**Time Complexity:** $\\mathcal{O}(N\\log^2N)$

^ Format time complexity like this. Should appear outside of \`<LanguageSection>\` if it's the same for all implementations.

<LanguageSection>

<CPPSection>

(add cpp code)

</CPPSection>

<PySection>

(if you have Python code)

</PySection>

<JavaSection>

(if you have Java code)

</JavaSection>

</LanguageSection>`,
      problems: '',
    };

    const updateProblemJSON = (json: string | undefined) => {
      if (!json) return undefined;
      const updated = JSON.parse(json);
      Object.keys(updated).forEach(key => {
        if (key === 'MODULE_ID') return;
        updated[key].forEach(obj => {
          if (obj.uniqueId === file.id) {
            obj.solutionMetadata = {
              kind: 'internal',
            };
          }
        });
      });
      return formatProblems(JSON.stringify(updated, null, 2));
    };

    await Promise.all(
      file.problemModules.map(async module => {
        if (get(filesListAtom).find(file => file === module.path)) {
          const currentFile = get(filesFamily(module.path));
          set(saveFileAtom, {
            ...currentFile,
            problems: updateProblemJSON(currentFile.problems),
          });
          return;
        }
        const data = await fetchFileContent(module.path);
        set(saveFileAtom, {
          path: module.path,
          markdown: data.markdown,
          problems: updateProblemJSON(data.problems),
        });
      })
    );

    set(filesListAtom, prev => [
      ...new Set([
        ...prev,
        newFile.path,
        ...file.problemModules.map(module => module.path),
      ]),
    ]);
    set(saveFileAtom, newFile);
    set(activeFileAtom, newFile.path);
  }
);

export const closeFileAtom = atom(null, (get, set, filePath: string) => {
  set(
    filesListAtom,
    get(filesListAtom).filter(file => file !== filePath)
  );
  if (get(activeFileAtom)?.path === filePath) {
    const remainingFiles = get(filesListAtom);
    set(activeFileAtom, remainingFiles.length > 0 ? remainingFiles[0] : null);
  }
  filesFamily.remove(filePath);
});

const baseMonacoEditorInstanceAtom = atom({ monaco: null as any });
export const monacoEditorInstanceAtom = atom(
  get => get(baseMonacoEditorInstanceAtom),
  (get, _set, val: any) => {
    get(baseMonacoEditorInstanceAtom).monaco = val;
  }
);

export const createNewModuleFileAtom = atom(
  null,
  async (get, set, module: AlgoliaEditorModuleFile) => {
    const moduleProblemsPath = `content/${module.section}/${module.id}.problems.json`;
    const moduleMarkdownPath = `content/${module.section}/${module.id}.mdx`;
     // Create and save the problems file first
     const problemsFile: EditorFile = {
      path: moduleProblemsPath,
      markdown: '',
      problems: JSON.stringify({
        MODULE_ID: module.id,
        module_problem: [
          {

            "uniqueId": "unique-problem-id-in-this-format",
          
            "name": "Име на задачата",
          
            "url": "https://mega.nz/folder/3ZpAGKYJ#hp_Z2CtDlJjhR9shIMHP8w",
          
            "source": "НОФ-3",
          
            "difficulty": "Easy",
          
            "isStarred": false,
          
            "tags": ["Някакви тагове за по-лесна индентификация при търсене като напр:", "Национален кръг"],
          
            "solutionMetadata": {
          
              "kind": "in-module",
          
              "hasHints": false
          
            }   
          }     
        ]
      }, null, 2)
    };
    
    // TODO: make the template better for the user
    const markdownFile: EditorFile = {
      path: moduleMarkdownPath,
      markdown: `---
id: ${module.id}
title: ${module.title}
author: Създателя/Създателите на модула
contributors: Ако някой е помогнал (примерно поправял нещо, дал идея и т.н.), добавете го тук
prerequisites:
  - Ако се изисква знания от предходен модул, добавете му ID-то тук, или ако са няколко, добавете ги всички с тиренца
description: '${module.description || 'Кратко описание на какво ще има в модула'}'
frequency: Не е задължително, но ако имате представа, добавете колко често се среща тази тема в олимпиади или състезания (0-4)
---

## Prerequisites

 - TODO

## Resources
 - TODO

## Content

TODO -- add module content

## Problems

<Problems problems="module_problem" />`,
problems: problemsFile.problems // Reference the same problems content
};

// Save both files
set(filesListAtom, prev => [...new Set([...prev, moduleMarkdownPath])]);
set(saveFileAtom, problemsFile);
set(saveFileAtom, markdownFile);
set(activeFileAtom, moduleMarkdownPath);
}
);
