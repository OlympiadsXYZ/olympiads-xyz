import * as React from 'react';
import { useContext } from 'react';
import { useMarkdownLayout } from '../../context/MarkdownLayoutContext';
import { ProblemSolutionContext } from '../../context/ProblemSolutionContext';
import { SolutionInfo } from '../../models/solution';
import ProblemsTree from '../ProblemsTree/ProblemsTree';

/**
 * What the sidebar shows instead of the module nav (SidebarNav): on a problem
 * page (the layout's markdownLayoutInfo is a SolutionInfo) the browsable
 * problems tree, with the current problem highlighted. Returns null on module
 * pages, which keep SidebarNav exactly as before.
 */
export function useSidebarContent(): React.ReactElement | null {
  const { markdownLayoutInfo } = useMarkdownLayout();
  // null when markdownLayoutInfo is a ModuleInfo
  const problemSolution = useContext(ProblemSolutionContext);
  if (!(markdownLayoutInfo instanceof SolutionInfo)) return null;
  // problem.uniqueId and SolutionInfo.id are the same id
  const currentProblemId =
    problemSolution?.problem?.uniqueId ?? markdownLayoutInfo.id;
  return <ProblemsTree currentProblemId={currentProblemId} />;
}
