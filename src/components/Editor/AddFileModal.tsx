import { Dialog } from '@headlessui/react';
import { useSetAtom } from 'jotai';
import React, { useState } from 'react';
import { createNewInternalSolutionFileAtom, createNewModuleFileAtom } from '../../atoms/editor';
import { AlgoliaEditorSolutionFile, AlgoliaEditorModuleFile } from '../../models/algoliaEditorFile';
import Modal from '../Modal';
import Select from '../Select';
import { useTranslation } from 'react-i18next';
import algoliasearch from 'algoliasearch/lite';
import { indexName } from '../ProblemAutocompleteModal/ProblemAutocomplete';


export default function AddFileModal(props) {
  const searchClient = algoliasearch(
    process.env.GATSBY_ALGOLIA_APP_ID ?? '',
    process.env.GATSBY_ALGOLIA_SEARCH_KEY ?? ''
  );
  const { t } = useTranslation();
  const [section, setSection] = useState<'1_General' | '2_Beginner' | '3_Intermediate' | '4_Advanced' | '5_Special' | '6_Beyond'>('1_General');
  const [fileType, setFileType] = useState<'solution' | 'module' >('module');
  const [fileStatus, setFileStatus] = useState<'Create File' | 'Creating File...'>('Create File');
  const [fileURL, setFileURL] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [moduleTitle, setModuleTitle] = useState('');
  const [moduleDescription, setModuleDescription] = useState('');
  const [problemId, setProblemId] = useState('');
  
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
            value={fileTypes.find(t => t.value === fileType)}
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
            <p className="mt-2">{t('problem-id')}</p>
            <input
              type="text"
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md dark:bg-gray-900 dark:border-gray-700"
              placeholder={t('problem-id-placeholder')}
              onChange={e => setProblemId(e.target.value)}
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
                
                if (!moduleId) {
                  alert(t('module-id-required'));
                  setFileStatus('Create File');
                  return;
                }

                if (!moduleTitle) {
                  alert(t('module-title-required'));
                  setFileStatus('Create File');
                  return;
                }

                if (!moduleDescription) {
                  alert(t('module-description-required'));
                  setFileStatus('Create File');
                  return;
                }

                // Validate module ID format (e.g. knzhou-m1-p1): only lowercase letters, numbers and dashes
                const moduleIdRegex = /^[a-z0-9-]+$/;
                if (!moduleIdRegex.test(moduleId)) {
                  alert(t('module-id-format-invalid'));
                  setFileStatus('Create File');
                  return;
                }

                // TODO: Change the index name for the modules
                const index = searchClient.initIndex("olympiads_xyz_modules");
                const { hits } = await index.search('', {
                  filters: `objectID:${moduleId}`
                });

                console.log(hits);
                
                if (hits.length > 0 && moduleId) {
                  alert(t('module-id-already-exists'));
                  setFileStatus('Create File');
                  return;
                }

                
                createModule({
                  id: moduleId,
                  title: moduleTitle,
                  description: moduleDescription,
                  section: section,
                } as unknown as AlgoliaEditorModuleFile);

              } else {

                const index = searchClient.initIndex(indexName);
                const { hits } = await index.search('', {
                  filters: `objectID:${problemId}`
                });

                
                if (hits.length === 0 && problemId) {
                  alert(t('nonexistent-problem-id'));
                }

                const problemIdRegex = /^[a-z0-9-]+$/;
                if (!problemIdRegex.test(problemId)) {
                  alert(t('problem-id-format-invalid'));
                  setFileStatus('Create File');
                  return;
                }

                
                const info = (
                  await fetch('/api/fetch-metadata', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url: fileURL }),
                  }).then(res => res.json())
                ).data;

                // TODO: Check if that the problem section is correct!
                createSol({
                  id: problemId || info.uniqueId,
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
