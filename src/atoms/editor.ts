import { atom } from 'jotai';
import { atomFamily, atomWithStorage } from 'jotai/utils';
import { fetchFileContent } from '../components/Editor/editorUtils';
import {
  AlgoliaEditorSolutionFile,
  AlgoliaEditorModuleFile,
} from '../models/algoliaEditorFile';
import { formatProblems } from '../utils/prettierFormatter';
import {
  moduleTemplate,
  solutionTemplate,
} from '../components/Editor/editorTemplates';

export type EditorFile = {
  path: string;
  markdown: string;
  problems?: string;
  isNew?: boolean;
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
    ? 'Отворете файл, за да започнете'
    : get(tabAtom) === 'content'
    ? activeFile.markdown
    : activeFile.problems;
});
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
      const data = await fetchFileContent(filePath);
      set(filesListAtom, prev => [...prev, filePath]);
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
    const newFile: EditorFile = {
      path: `solutions/${file.section}/${file.id}.mdx`,
      markdown: solutionTemplate(file),
      problems: '',
      isNew: true,
    };
    if (get(filesListAtom).includes(newFile.path)) {
      set(activeFileAtom, newFile.path);
      return;
    }

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
    const moduleMarkdownPath = `content/${module.section}/${module.id}.mdx`;
    if (get(filesListAtom).includes(moduleMarkdownPath)) {
      set(activeFileAtom, moduleMarkdownPath);
      return;
    }
    const newFile: EditorFile = {
      path: moduleMarkdownPath,
      markdown: moduleTemplate(module),
      problems: JSON.stringify(
        { MODULE_ID: module.id, module_problem: [] },
        null,
        2
      ),
      isNew: true,
    };
    set(filesListAtom, prev => [...prev, newFile.path]);
    set(saveFileAtom, newFile);
    set(activeFileAtom, newFile.path);
  }
);
