import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import React from 'react';
import {
  activeFileAtom,
  closeFileAtom,
  createNewInternalSolutionFileAtom,
  filesListAtom,
  openOrCreateExistingFileAtom,
} from '../../../atoms/editor';
import {
  AlgoliaEditorFile,
  AlgoliaEditorSolutionFile,
} from '../../../models/algoliaEditorFile';
import { FileListSidebar } from './FileListSidebar';
import { useTranslation } from 'react-i18next';

export const EditorSidebar = (props): JSX.Element => {
  const { t } = useTranslation();
  const files = useAtomValue(filesListAtom);
  const [activeFile, setActiveFile] = useAtom(activeFileAtom);
  const openOrCreateExistingFile = useSetAtom(openOrCreateExistingFileAtom);
  const createNewInternalSolutionFile = useSetAtom(
    createNewInternalSolutionFileAtom
  );
  const closeFile = useSetAtom(closeFileAtom);

  const handleOpenFile = (file: string) => {
    setActiveFile(file);
  };

  const handleCloseFile = (file: string) => {
    if (confirm(t('confirm-close-this-file'))) {
      closeFile(file);
    }
  };

  const handleCloseAllFiles = () => {
    if (confirm(t('confirm-close-all-files'))) {
      for (const file of files) closeFile(file);
    }
  };

  const handleNewFile = (file: AlgoliaEditorFile) => {
    if (!file) return;
    if (file.path) {
      // this file already exists
      openOrCreateExistingFile(file.path).catch(error => alert(error.message));
    } else {
      // the user is trying to create a new internal solution
      createNewInternalSolutionFile(file as AlgoliaEditorSolutionFile);
    }
  };
  return (
    <div className="flex-col w-[250px] border-r border-gray-200 dark:border-gray-800">
      <FileListSidebar
        {...props}
        activeFile={activeFile}
        files={files || []}
        onOpenFile={handleOpenFile}
        onCloseFile={handleCloseFile}
        onCloseAllFiles={handleCloseAllFiles}
        onNewFile={handleNewFile}
      />
      <div className="p-4 text-sm space-y-3">
        <p>
          Редакциите се пазят в този браузър. Изтеглете файловете, за да
          запазите копие.
        </p>
        <p>
          За съществуващ файл: копирайте съдържанието, отворете „Редактирай в
          GitHub“ и го поставете там. GitHub ще ви предложи да изпратите
          промяната за преглед.
        </p>
        <a
          className="text-blue-600 dark:text-blue-300 underline"
          href="https://github.com/OlympiadsXYZ/olympiads-xyz/upload/master"
          target="_blank"
          rel="noreferrer"
        >
          Качи нови файлове в GitHub
        </a>
      </div>
    </div>
  );
};
