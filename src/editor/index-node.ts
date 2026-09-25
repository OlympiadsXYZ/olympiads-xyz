import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { AlgoliaEditorFile } from '../models/algoliaEditorFile';

export function writeEditorIndex(root: string): number {
  const files: AlgoliaEditorFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!entry.name.endsWith('.mdx')) continue;
      const { data } = matter(fs.readFileSync(file, 'utf8'));
      // Generated transcriptions are changed through the reviewed source pipeline.
      if (!data.id || data.canonicalSource) continue;
      const relative = path.relative(root, file).split(path.sep).join('/');
      const common = {
        id: String(data.id),
        title: String(data.title || data.id),
        objectID: relative,
        path: relative,
        section: relative.split('/')[1],
      };
      files.push(
        relative.startsWith('content/')
          ? { ...common, kind: 'module', description: data.description || null }
          : {
              ...common,
              kind: 'solution',
              source: data.source || '',
              solutions: [],
              problemModules: [],
            }
      );
    }
  };
  walk(path.join(root, 'content'));
  walk(path.join(root, 'solutions'));
  files.sort((a, b) => a.path!.localeCompare(b.path!));
  const dir = path.join(root, 'static', 'editor-data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'files.json'), JSON.stringify(files));
  return files.length;
}
