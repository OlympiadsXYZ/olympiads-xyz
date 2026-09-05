import * as React from 'react';
import { ProblemInfo } from '../models/problem';

const ProblemSolutionContext = React.createContext<{
  // url = the problems PDF; solutionUrl = the official solutions PDF, if any
  problem: Pick<ProblemInfo, 'uniqueId' | 'url' | 'solutionUrl'>;
  modulesThatHaveProblem: { id: string; title: string }[];
  // present on transcribed problem pages only (see solutionTemplate.tsx)
  verification?: ProblemVerification;
} | null>(null);

/** Publication quality of a transcribed page, from the publication ledger. */
export type ProblemVerification = {
  /** legacy = released before the ledger; reviewed = independent model pass; human = editor */
  kind: string;
  /** ISO timestamp of the review receipt, when kind is 'reviewed' */
  verifiedAt?: string;
  /** repo path of the canonical paper JSON */
  canonicalSource?: string;
};

export function useProblemSolutions() {
  const context = React.useContext(ProblemSolutionContext);
  if (!context) {
    throw new Error(
      'useProblemSolutions must be used within a ProblemSolutionProvider'
    );
  }
  return context;
}

export { ProblemSolutionContext };
