import * as React from 'react';
import { ProblemSectionAnchor } from './ProblemSection';
import { archiveHref } from '../../archive/links';
import { useDarkMode } from '../../context/DarkModeContext';
// type only: the component itself is loaded on demand (HighlightedCode)
import type CodeBlockType from './CodeBlock/CodeBlock';

// Note: try to avoid adding inline styles here; rather, use css selectors to target them.
// Otherwise it's really hard to override some of these styles

export const OffsetAnchor = ({ id, ...props }): JSX.Element | null => {
  const sectionId = React.useContext(ProblemSectionAnchor);
  if (sectionId === id) return null;
  return (
    <span
      id={id}
      {...props}
      className="absolute"
      style={{ bottom: '60px', height: '2px' }}
    />
  );
};

const h1 = ({ id, children, ...props }): JSX.Element => (
  <h1
    {...props}
    className="leading-tight text-4xl font-bold mb-5 mt-12 text-gray-700 dark:text-dark-high-emphasis"
  >
    <OffsetAnchor id={id} />
    {children}
  </h1>
);
const h2 = ({ id, children, ...props }): JSX.Element => (
  <h2
    className="leading-tight text-3xl font-bold mb-5 mt-12 text-gray-700 dark:text-dark-high-emphasis"
    {...props}
  >
    <OffsetAnchor id={id} />
    {children}
  </h2>
);
const h3 = ({ id, children, ...props }): JSX.Element => (
  <h3 {...props} className="leading-snug text-2xl font-semibold mb-4 mt-8">
    <OffsetAnchor id={id} />
    {children}
  </h3>
);
const h4 = ({ id, children, ...props }): JSX.Element => (
  <h4 {...props} className="leading-none text-xl font-semibold mb-2 mt-6">
    <OffsetAnchor id={id} />
    {children}
  </h4>
);
const p = (props): JSX.Element => <p {...props} />;
// Note: for the following li component, this is only really necessary for ol.li. It's not needed for anything else.
// But XDM removed support for ol.li so this sort of works :P
const li = ({ children, ...props }): JSX.Element => (
  <li {...props}>
    <div className="flex-1">{children}</div>
  </li>
);
// The ol numbers come from a CSS counter (generalStyles.css), which ignored a list's start: a list that resumed after a
// paragraph or an equation ("3. …") was numbered from 1 again (noh-2012-ii-9-p3 showed 1; 1, 2, 3; 1; 1).
const ol = ({ start, style, ...props }): JSX.Element => (
  <ol
    start={start}
    style={
      start != null && Number.isFinite(Number(start))
        ? { counterReset: `number ${Number(start) - 1}`, ...style }
        : style
    }
    {...props}
  />
);
// A wide table scrolls in its own box; the only scroll box was the whole article column, so on a phone swiping a
// table moved every heading and paragraph with it (8% of problem pages).
const table = (props): JSX.Element => (
  <div className="markdown-table-scroll">
    <table {...props} />
  </div>
);
// The plain text of a cell, or null when it holds anything else (math, a link, an image).
const cellText = (children: React.ReactNode): string | null => {
  let text = '';
  for (const child of React.Children.toArray(children)) {
    if (typeof child === 'string' || typeof child === 'number') {
      text += String(child);
    } else {
      return null;
    }
  }
  return text;
};
// A markdown table always has a header row; a transcribed table without one is written "| | |" over "| --- | --- |".
// That header renders as an empty first row above the data ("Справочни данни", nao-2008-ii-9-10 задача 5): skipped.
const thead = (props): JSX.Element | null => {
  const rows = React.Children.toArray(props.children).filter(
    React.isValidElement
  ) as React.ReactElement[];
  const empty =
    rows.length > 0 &&
    rows.every(row =>
      (
        React.Children.toArray(row.props.children).filter(
          React.isValidElement
        ) as React.ReactElement[]
      ).every(cell => (cellText(cell.props.children) ?? 'x').trim() === '')
    );
  return empty ? null : <thead {...props} />;
};
// A short plain-text cell ("387 000 000 км", "88 земни дни") keeps its value on one line: on a phone the column
// would otherwise break numbers between their digit groups; the table scrolls instead.
const NOWRAP_CELL_MAX = 20;
const td = ({ children, className, ...props }): JSX.Element => {
  const text = cellText(children);
  const nowrap =
    text !== null &&
    text.trim().length > 0 &&
    text.trim().length <= NOWRAP_CELL_MAX;
  return (
    <td
      {...props}
      className={
        [className, nowrap && 'nowrap-cell'].filter(Boolean).join(' ') ||
        undefined
      }
    >
      {children}
    </td>
  );
};
const inlineCode = (props): JSX.Element => (
  <code {...props} className="inline-code" />
);
const a = ({ children, ...props }) => {
  const external = !!props.href && !props.href.startsWith('#');
  return (
    <a
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      {...props}
      href={archiveHref(props.href)}
    >
      {children}
    </a>
  );
};
// Only C++/Java/Python blocks are highlighted (CodeBlock, a USACO Guide feature); no page here has one, so the
// highlighter (Prism, ~35 KB gzipped) is fetched when such a block mounts instead of shipping with every page. Any
// other block is the plain <pre> CodeBlock renders for it; the server and the first client render show that too.
const HIGHLIGHTED = /^language-(?:cpp|java|py|python)$/;
const PlainCode = ({ code }: { code: unknown }): JSX.Element => (
  <pre className="-mx-4 sm:-mx-6 md:mx-0 md:rounded bg-gray-100 p-4 mb-4 whitespace-pre-wrap break-all dark:bg-gray-900">
    {String(code ?? '').replace(/^[\r\n]+|[\r\n]+$/g, '')}
  </pre>
);
const HighlightedCode = (props: {
  children: string;
  className: string;
  isDarkMode: boolean;
  copyButton: boolean;
}): JSX.Element => {
  const [Block, setBlock] = React.useState<typeof CodeBlockType | null>(null);
  React.useEffect(() => {
    let live = true;
    import('./CodeBlock/CodeBlock').then(m => {
      if (live) setBlock(() => m.default);
    });
    return () => {
      live = false;
    };
  }, []);
  return Block ? <Block {...props} /> : <PlainCode code={props.children} />;
};
const pre = ({ children, copyButton = true, ...props }) => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const isDarkMode = useDarkMode();
  if (!React.isValidElement(children)) return <pre {...props}>{children}</pre>;
  const code = children.props as { className?: string; children?: string };

  return HIGHLIGHTED.test(code.className ?? '') ? (
    <HighlightedCode
      copyButton={copyButton}
      isDarkMode={isDarkMode}
      className={code.className!}
    >
      {code.children ?? ''}
    </HighlightedCode>
  ) : (
    <PlainCode code={code.children} />
  );
};

const HeaderLink: React.FC = props => {
  return (
    <svg
      fill="none"
      height="24"
      width="24"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      className="inline-block align-middle"
      {...props}
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
};

const HTMLComponents = {
  h1,
  h2,
  h3,
  h4,
  p,
  li,
  ol,
  table,
  thead,
  td,
  code: inlineCode,
  pre,
  a,
  HeaderLink,
};

export default HTMLComponents;
