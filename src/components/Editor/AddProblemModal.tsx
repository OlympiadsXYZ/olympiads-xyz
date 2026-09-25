import { Dialog } from '@headlessui/react';
import prettier from 'prettier';
import babelParser from 'prettier/parser-babel';
import React, { useState } from 'react';
import Modal from '../Modal';
import { loadProblemsIndex } from '../ProblemsPage/problemSearch';
import CopyButton from './CopyButton';
import { editorProblemMetadata } from './editorUtils';
import { useTranslation } from 'react-i18next';
async function addProblem(
  url: string,
  setMetadata: (metadata: string) => void,
  setStatus: (status: 'Get Metadata' | 'Fetching metadata...') => void
) {
  try {
    setStatus('Fetching metadata...');
    const problems = await loadProblemsIndex();
    const parsed = problems.find(
      problem =>
        problem.url === url ||
        problem.uniqueId === url ||
        new URL(problem.problemURL, window.location.origin).href === url
    );
    if (!parsed) {
      throw new Error(
        'Задачата не е намерена. Въведете адрес или идентификатор от каталога със задачи.'
      );
    }
    const metadata = editorProblemMetadata(parsed);
    setMetadata(
      await prettier.format(JSON.stringify(metadata, null, 2), {
        parser: 'json',
        plugins: [babelParser],
      })
    );
    setStatus('Get Metadata');
  } catch (e) {
    setMetadata(e.toString());
    setStatus('Get Metadata');
  }
}
export default function AddProblemModal(props: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [link, setLink] = useState('');
  const [metadata, setMetadata] = useState('// metadata will appear here');
  const [status, setStatus] = useState<'Get Metadata' | 'Fetching metadata...'>(
    'Get Metadata'
  );
  const { t } = useTranslation();
  return (
    <Modal {...props}>
      <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-black text-white p-6 text-left align-middle shadow-xl transition-all">
        <Dialog.Title as="h3" className="text-lg font-medium leading-6">
          {t('add-problem')}
        </Dialog.Title>
        <div className="mt-2 relative rounded-md shadow-sm">
          <input
            type="text"
            className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md dark:bg-gray-900 dark:border-gray-700"
            placeholder={t('enter-problem-url')}
            onChange={e => setLink(e.target.value)}
          />
        </div>

        <div className="mt-4">
          <button
            className="btn"
            disabled={status === 'Fetching metadata...'}
            onClick={() => addProblem(link, setMetadata, setStatus)}
          >
            {status === 'Fetching metadata...'
              ? t('fetching-metadata')
              : t('get-metadata')}
          </button>
        </div>
        <div className="mt-4 relative">
          <pre className="bg-gray-900 p-4 rounded-md text-white text-sm whitespace-pre-wrap">
            {metadata}
          </pre>
          <CopyButton
            className="btn absolute top-2 right-2"
            onClick={() => {
              navigator.clipboard.writeText(metadata);
            }}
          />
        </div>
      </Dialog.Panel>
    </Modal>
  );
}
