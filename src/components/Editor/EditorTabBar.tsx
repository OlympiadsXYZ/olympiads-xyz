import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import React, { useState } from 'react';
import {
  activeFileAtom,
  tabAtom,
  trueFileAtom,
  trueFilePathAtom,
} from '../../atoms/editor';
import { editorFileURL, downloadEditorFile } from './editorUtils';
import { useQuizOpen } from '../../context/QuizGeneratorContext';
import AddProblemModal from './AddProblemModal';
import { useTranslation } from 'react-i18next';

export interface EditorTab {
  label: string;
  value: string;
}

export interface EditorTabBarProps {
  tabs: EditorTab[];
  /**
   * Value of the active tab.
   */
  activeTab: string;
  onTabSelect: (tab: EditorTab) => void;
  onFormatCode: () => void;
}

const EditorTabBar: React.FC<EditorTabBarProps> = ({
  tabs,
  activeTab,
  onTabSelect,
  onFormatCode,
}) => {
  const { t } = useTranslation();
  const { setOpen } = useQuizOpen();
  const activeFile = useAtomValue(activeFileAtom);
  const filePath = useAtomValue(trueFilePathAtom);
  const file = useAtomValue(trueFileAtom);
  const tab = useAtomValue(tabAtom);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const hasFile = filePath !== 'NONE' && file != null;
  const copyFile = async () => {
    try {
      await navigator.clipboard.writeText(file ?? '');
      setCopyStatus('Копирано. Поставете съдържанието в GitHub.');
    } catch {
      setCopyStatus(
        'Копирането не успя. Изтеглете файла, за да запазите редакциите.'
      );
    }
  };
  return (
    <>
      <div className="flex bg-gray-50 dark:bg-gray-950">
        <div className="flex-1">
          {tabs.map(tab => (
            <button
              key={tab.value}
              className={classNames(
                tab.value === activeTab
                  ? 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900 active:bg-gray-100 dark:active:bg-gray-900',
                'px-4 py-2 font-medium text-sm focus:outline-none transition'
              )}
              onClick={() => onTabSelect(tab)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className={
          'flex bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400'
        }
      >
        <button
          className={classNames(
            'hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-800',
            'px-3 py-2 text-sm font-medium focus:outline-none transition'
          )}
          onClick={() => setOpen(true)}
          type="button"
        >
          {t('generate-quiz')}
        </button>
        <button
          className={classNames(
            'hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-800',
            'px-3 py-2 font-medium text-sm focus:outline-none transition'
          )}
          onClick={() => onFormatCode()}
        >
          {t('format-code')}
        </button>
        {tab === 'problems' && (
          <button
            className={classNames(
              'hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-800',
              'px-3 py-2 font-medium text-sm focus:outline-none transition'
            )}
            onClick={() => setDialogOpen(true)}
          >
            {t('add-problem')}
          </button>
        )}
        {hasFile && (
          <>
            <button
              type="button"
              className="px-3 py-2 text-sm hover:underline"
              onClick={copyFile}
            >
              Копирай
            </button>
            <button
              type="button"
              className="px-3 py-2 text-sm hover:underline"
              onClick={() => downloadEditorFile(filePath, file ?? '')}
            >
              Изтегли
            </button>
            <a
              className="px-3 py-2 text-sm hover:underline"
              href={editorFileURL(filePath, activeFile?.isNew)}
              target="_blank"
              rel="noreferrer"
            >
              Редактирай в GitHub
            </a>
          </>
        )}
      </div>
      {copyStatus && (
        <p role="status" className="px-3 py-2 text-sm">
          {copyStatus}
        </p>
      )}
      <AddProblemModal
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
};

export default EditorTabBar;
