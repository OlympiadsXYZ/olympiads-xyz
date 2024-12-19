import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import React, { useCallback, useEffect, useState } from 'react';
import {
  activeFileAtom,
  branchAtom,
  closeFileAtom,
  createNewInternalSolutionFileAtom,
  filesListAtom,
  forkAtom,
  githubInfoAtom,
  octokitAtom,
  openOrCreateExistingFileAtom,
} from '../../../atoms/editor';
import {
  AlgoliaEditorFile,
  AlgoliaEditorSolutionFile,
} from '../../../models/algoliaEditorFile';
import { FileListSidebar } from './FileListSidebar';
import { useTranslation } from 'react-i18next';

function GithubActions() {
  const [fork, setFork] = useAtom(forkAtom);
  const githubInfo = useAtomValue(githubInfoAtom);
  const octokit = useAtomValue(octokitAtom);
  const [branch, setBranch] = useAtom(branchAtom);
  const [branchState, setBranchState] = useState<
    | 'Create/Set Branch'
    | 'Creating Branch...'
    | 'Setting Branch...'
    | 'Detecting Branches...'
  >('Create/Set Branch');
  const [installed, setInstalled] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!octokit || !githubInfo) return;
    octokit
      .request('GET /user/installations', {
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      .then(res =>
        setInstalled(
          !!res.data.installations.find(
            installation => installation.account?.id === githubInfo.id
          )
        )
      );
    octokit
      .request('GET /user/repos', {
        affiliation: 'owner',
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      .then(res =>
        setFork( 
          //TODO: change to the new repo if needed and fix the fork detection
          res.data.find(repo => repo.name === 'olympiads-xyz')?.html_url ??
            undefined
        )
      );
  }, [githubInfo, branch, octokit, setFork]);
  const createBranch = useCallback(
    async branchName => {
      if (/\s/.test(branchName)) {
        return alert('Branch name cannot contain spaces!');
      }
      if (!octokit || !githubInfo || !fork) return;
      setBranchState('Detecting Branches...');
      // octokit.paginate has weird typing for some reason
      const branches =
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        (await octokit.paginate('GET /repos/{owner}/{repo}/branches', {
          owner: githubInfo.login,
          repo: 'olympiads-xyz',
          per_page: 100,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28',
          },
        })) as { name: string }[];
      if (!branchName) {
        for (let i = 0; ; i++) {
          if (!branches.find(branch => branch.name === `patch${i}`)) {
            branchName = `patch${i}`;
            break;
          }
        }
      }
      if (branches.find(branch => branch.name === branchName)) {
        setBranchState('Setting Branch...');
      } else setBranchState('Creating Branch...');
      const masterSha = (
        await octokit?.request(
          'GET /repos/{owner}/{repo}/git/matching-refs/{ref}',
          {
            owner: 'OlympiadsXYZ',
            repo: 'olympiads-xyz',
            ref: 'heads/master',
            headers: {
              'X-GitHub-Api-Version': '2022-11-28',
            },
          }
        )
      ).data[0].object.sha;
      octokit
        .request('POST /repos/{owner}/{repo}/git/refs', {
          owner: githubInfo.login,
          repo: 'olympiads-xyz',
          ref: `refs/heads/${branchName}`,
          sha: masterSha,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28',
          },
        })
        .catch(() => {})
        .finally(() => {
          setBranch(branchName);
          setBranchState('Create/Set Branch');
        });
    },
    [githubInfo, octokit, fork, setBranch]
  );
  return (
    <>
      {!installed ? (
        installed === undefined ? (
          <p>Detecting app installation...</p>
        ) : (
          //TODO: create a similar app for olympiads-xyz and change the link
          <a className="btn" href="https://github.com/apps/usaco-guide-editor">
            Install GitHub App
          </a>
        )
      ) : (
        <>
          {!fork ? (
            fork === undefined ? (
              <p>detecting fork...</p>
            ) : (
              <>
                <p>No fork detected.</p>
                <a
                  className="btn mt-1"
                  href="https://github.com/cpinitiative/usaco-guide/fork"
                  target="_blank"
                  rel="noreferrer"
                >
                  Create Fork
                </a>
              </>
            )
          ) : (
            <>
              <p>
                <a
                  href={fork}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  Fork detected!
                </a>
              </p>
              {branch && githubInfo ? (
                <p>
                  Current branch:{' '}
                  <a
                    href={`https://github.com/${githubInfo.login}/olympiads-xyz/tree/${branch}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    {branch}
                  </a>
                </p>
              ) : (
                <p>Branch not set</p>
              )}
              <button
                onClick={() =>
                  createBranch(
                    prompt('Branch name? (leave empty for auto-generated name)')
                  )
                }
                className="btn"
              >
                {branchState}
              </button>
              {branch && githubInfo && (
                <a
                  className="btn mt-4"
                  href={`https://github.com/${githubInfo.login}/olympiads-xyz/pull/new/${branch}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Pull Request
                </a>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function GithubSidebar({ loading }: { loading: boolean }) {
  const githubInfo = useAtomValue(githubInfoAtom);
  const { t } = useTranslation();
  return (
    <div className="px-4 py-4">
      {!githubInfo ? (
        loading ? (
          <p>Logging in...</p>
        ) : (
          <a
            href={`https://github.com/login/oauth/authorize?client_id=${
              process.env.GATSBY_EDITOR_CLIENT_ID
            }&redirect_uri=${
              process.env.NODE_ENV === 'development'
                ? 'http://localhost:8000/editor'
                : ''
            }`}
            className="btn"
          >
            {t('log-in-with')} GitHub &rarr;
          </a>
        )
      ) : (
        <div className="flex flex-col items-start">
          <p>{`${t('welcome')}, ${githubInfo.login}!`}</p>
          <React.Suspense fallback={<p>Loading...</p>}>
            <GithubActions />
          </React.Suspense>
        </div>
      )}
    </div>
  );
}

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
    if (
      confirm(
        t('confirm-close-this-file')
      )
    ) {
      closeFile(file);
    }
  };

  const handleCloseAllFiles = () => {
    if (
      confirm(
        t('confirm-close-all-files')
      )
    ) {
      for (const file of files) closeFile(file);
    }
  };

  const handleNewFile = (file: AlgoliaEditorFile) => {
    if (!file) return;
    if (file.path) {
      // this file already exists
      openOrCreateExistingFile(file.path);
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
      <React.Suspense fallback={<p className="p-4">Loading...</p>}>
        <GithubSidebar {...props} />
      </React.Suspense>
    </div>
  );
};
