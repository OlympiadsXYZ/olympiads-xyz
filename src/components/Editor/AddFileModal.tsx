import { Dialog } from '@headlessui/react';
import { useSetAtom } from 'jotai';
import React, { useState } from 'react';
import { createNewInternalSolutionFileAtom, createNewModuleFileAtom } from '../../atoms/editor';
import { AlgoliaEditorSolutionFile, AlgoliaEditorModuleFile } from '../../models/algoliaEditorFile';
import Modal from '../Modal';
import Select from '../Select';
import { useTranslation } from 'react-i18next';


export default function AddFileModal(props) {
  const { t } = useTranslation();
  const [section, setSection] = useState<'1_General' | '2_Beginner' | '3_Intermediate' | '4_Advanced' | '5_Special' | '6_Beyond'>('1_General');
  const [fileType, setFileType] = useState<'solution' | 'module' >('module');
  const [fileStatus, setFileStatus] = useState<'Create File' | 'Creating File...'>('Create File');
  const [fileURL, setFileURL] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [moduleTitle, setModuleTitle] = useState('');
  const [moduleDescription, setModuleDescription] = useState('');
  
  const createSol = useSetAtom(createNewInternalSolutionFileAtom);
  const createModule = useSetAtom(createNewModuleFileAtom);
  const fileTypes = [
    { label: t('solution'), value: 'solution' },
    { label: t('module'), value: 'module' },
  ] as const;
  const sections = [
    { label: t('general'), value: '1_General' },
    { label: t('beginner'), value: '2_Beginner' },
    { label: t('intermediate'), value: '3_Intermediate' },
    { label: t('advanced'), value: '4_Advanced' },
    { label: t('special'), value: '5_Special' },
    { label: t('beyond'), value: '6_Beyond' },
  ] as const;

  return (
    <Modal {...props}>
      <Dialog.Panel className="bg-white dark:bg-black w-full max-w-xl dark:text-white p-5 rounded-lg shadow-lg flex flex-col items-start">
        <h3 className="text-lg font-bold">{t('create-new-file')}</h3>

        <p className="mt-2">{t('file-type')}</p>
        <div className="mt-2 relative w-full dark:bg-black rounded-md shadow-sm">
          <Select
            options={fileTypes}
            defaultValue={fileTypes[0]}
            onChange={e => setFileType(e.value)}
          />
        </div>

        {fileType === 'solution' ? (
          <>
            <p className="mt-2">{t('problem-source-url')}</p>
            <input
              type="url"
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md dark:bg-gray-900 dark:border-gray-700"
              placeholder={t('problem-source-url-placeholder')}
              onChange={e => setFileURL(e.target.value)}
            />
          </>
        ) : (
          <>
            <p className="mt-2">{t('module-id')}</p>
            <input
              type="text"
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md dark:bg-gray-900 dark:border-gray-700"
              placeholder={t('module-id-placeholder')}
              onChange={e => setModuleId(e.target.value)}
            />
            <p className="mt-2">{t('module-title')}</p>
            <input
              type="text"
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md dark:bg-gray-900 dark:border-gray-700"
              placeholder={t('module-title-placeholder')}
              onChange={e => setModuleTitle(e.target.value)}
            />
            <p className="mt-2">{t('module-description')}</p>
            <input
              type="text"
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md dark:bg-gray-900 dark:border-gray-700"
              placeholder={t('module-description-placeholder')}
              onChange={e => setModuleDescription(e.target.value)}
            />
          </>
        )}

        <p className="mt-2">{t('section')}</p>
        <div className="mt-2 relative w-full dark:bg-black rounded-md shadow-sm">
          <Select
            options={sections}
            onChange={e => setSection(e.value)}
          />
        </div>

        <button
          className="btn mt-2"
          disabled={fileStatus === 'Creating File...'}
          onClick={async () => {
            try {
              setFileStatus('Creating File...');
              
              if (fileType === 'module') {
                createModule({
                  id: moduleId,
                  title: moduleTitle,
                  description: moduleDescription,
                  section: section,
                } as unknown as AlgoliaEditorModuleFile);
              } else {
                const info = (
                  await fetch('/api/fetch-metadata', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url: fileURL }),
                  }).then(res => res.json())
                ).data;
                createSol({
                  id: info.uniqueId,
                  title: info.name,
                  source: info.source,
                  problemModules: [],
                  section: section,
                } as unknown as AlgoliaEditorSolutionFile);
              }

              props.onClose();
              setFileStatus('Create File');
            } catch (e) {
              setFileStatus('Create File');
              props.onClose();
              alert(e);
            }
          }}
        >
          {fileStatus === 'Create File' ? t('create-file') : t('creating-file')}
        </button>
      </Dialog.Panel>
    </Modal>
  );
}
