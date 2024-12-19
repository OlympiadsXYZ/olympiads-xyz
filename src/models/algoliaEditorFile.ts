import type { BaseHit, Hit } from 'instantsearch.js';
import { ProblemSolutionInfo } from './problem';

export type AlgoliaEditorModuleFile = {
  title: string;
  id: string;
  description: string | null;
  // content/1_Bronze/Complete_Rec.mdx
  path: string; //if it doesn't exist, then it's a new file probably
  section: string;
};

export type AlgoliaEditorSolutionFile = {
  title: string;
  id: string;
  source: string;
  path: string | null; // null if file doesn't yet exist
  problemModules: AlgoliaEditorModuleFile[];
  solutions: ProblemSolutionInfo[];
  section: string;
};

export type AlgoliaEditorFile =
  | ({
      kind: 'module';
      objectID: string;
    } & AlgoliaEditorModuleFile)
  | ({
      kind: 'solution';
      objectID: string;
    } & AlgoliaEditorSolutionFile);

export type AlgoliaEditorFileHit = Hit<BaseHit> & AlgoliaEditorFile;
