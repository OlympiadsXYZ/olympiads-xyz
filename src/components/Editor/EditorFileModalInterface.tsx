import React from 'react';
import type { AlgoliaEditorFile } from '../../models/algoliaEditorFile';
import { loadEditorFiles } from './editorSearch';

export default function EditorFileModalInterface({
  onSelect,
  openAddFile,
}: {
  onSelect: (file: AlgoliaEditorFile) => void;
  openAddFile: () => void;
}): JSX.Element {
  const [files, setFiles] = React.useState<AlgoliaEditorFile[]>([]);
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(() => {
    setLoading(true);
    setError('');
    loadEditorFiles()
      .then(setFiles)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  React.useEffect(load, [load]);
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const hits = files
    .filter(file =>
      tokens.every(token =>
        [file.title, file.id, file.path]
          .join(' ')
          .toLocaleLowerCase()
          .includes(token)
      )
    )
    .slice(0, 30);
  return (
    <div className="p-3">
      <h2 className="font-semibold mb-2">Отвори файл</h2>
      <input
        type="search"
        aria-label="Търси модул или решение"
        placeholder="Търси по заглавие или път"
        className="w-full rounded dark:bg-gray-900"
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus
      />
      {loading && <p role="status">Зареждане…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" className="underline" onClick={load}>
            Опитай отново
          </button>
        </p>
      )}
      <div className="max-h-80 overflow-y-auto divide-y dark:divide-gray-700">
        {hits.map(file => (
          <button
            type="button"
            key={file.objectID}
            className="block text-left w-full p-3 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => onSelect(file)}
          >
            <span className="block font-medium">{file.title}</span>
            <span className="text-sm break-all">{file.path}</span>
          </button>
        ))}
      </div>
      {!loading && !error && !hits.length && <p>Няма намерени файлове.</p>}
      <button type="button" className="btn mt-3" onClick={openAddFile}>
        Нов модул или решение
      </button>
      <p className="text-sm mt-3">
        За поправка на транскрибирана задача използвайте връзката „Съобщи за
        грешка“ на страницата ѝ.
      </p>
    </div>
  );
}
