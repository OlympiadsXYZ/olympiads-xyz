import type { AlgoliaEditorFile } from '../../models/algoliaEditorFile';
let pending: Promise<AlgoliaEditorFile[]> | null = null;
export function loadEditorFiles(): Promise<AlgoliaEditorFile[]> {
  if (!pending) {
    pending = fetch('/editor-data/files.json')
      .then(response => {
        if (!response.ok) throw new Error('Списъкът с файлове не е зареден.');
        return response.json();
      })
      .catch(error => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
