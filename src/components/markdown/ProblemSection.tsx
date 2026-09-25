import * as React from 'react';

export const ProblemSectionAnchor = React.createContext<string | null>(null);

/** One printed section within a problem. The stable id also receives legacy links. */
export default function ProblemSection({ id, children }: { id: string; children: React.ReactNode }): JSX.Element {
  return <ProblemSectionAnchor.Provider value={id}><section id={id} className="problem-section">{children}</section></ProblemSectionAnchor.Provider>;
}
