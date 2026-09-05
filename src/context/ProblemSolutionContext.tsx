import * as React from 'react';
import { ProblemInfo } from '../models/problem';

const ProblemSolutionContext = React.createContext<{
  // url = the problems PDF; solutionUrl = the official solutions PDF, if any
  problem: Pick<ProblemInfo, 'uniqueId' | 'url' | 'solutionUrl'>;
  modulesThatHaveProblem: { id: string; title: string }[];
} | null>(null);

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
