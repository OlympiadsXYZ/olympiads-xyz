/** @jest-environment jsdom */
import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ProblemSolutionContext } from '../../context/ProblemSolutionContext';
import ComparePanel from './ComparePanel';
import { CompareToggleButton } from './ProblemPageActions';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('./ComparePanelContext', () => ({
  COMPARE_MEDIA_QUERY: '(min-width: 768px)',
  MIN_PANEL_WIDTH: 30,
  MAX_PANEL_WIDTH: 70,
  useComparePanel: () => ({
    doc: 'problems',
    width: 50,
    isSplit: true,
    setWidth: () => undefined,
    setDoc: () => undefined,
    toggle: () => undefined,
    close: () => undefined,
  }),
}));

function withProblem(url: string, children: React.ReactNode) {
  return (
    <ProblemSolutionContext.Provider
      value={{
        problem: { uniqueId: 'x-p1', url, solutionUrl: undefined },
        modulesThatHaveProblem: [],
      }}
    >
      {children}
    </ProblemSolutionContext.Provider>
  );
}

const panel = (url: string) =>
  withProblem(url, <ComparePanel containerRef={React.createRef()} />);

afterEach(() => jest.useRealTimers());

it('does not embed a Word original: it says so and offers the download', () => {
  render(panel('https://a.test/IZhO/2004/IZhO-2004-Exp_sen2.doc#page=1'));
  expect(document.querySelector('iframe')).toBeNull();
  expect(screen.getByText(/compare_word_not_embeddable/)).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'compare_download_file' })
  ).toHaveAttribute(
    'href',
    'https://a.test/IZhO/2004/IZhO-2004-Exp_sen2.doc#page=1'
  );
});

it('shows a text original on an opaque frame, with the fallback only when it does not load', () => {
  jest.useFakeTimers();
  render(panel('https://a.test/IYPT/1998.txt#page=1'));
  const frame = document.querySelector('iframe');
  expect(frame).toHaveAttribute('src', 'https://a.test/IYPT/1998.txt');
  expect(frame).toHaveClass('bg-white');
  expect(
    screen.queryByRole('link', { name: 'compare_embed_fallback_link' })
  ).toBeNull();
  act(() => {
    jest.advanceTimersByTime(10000);
  });
  expect(
    screen.getByRole('link', { name: 'compare_embed_fallback_link' })
  ).toBeInTheDocument();
  fireEvent.load(document.querySelector('iframe') as HTMLIFrameElement);
  expect(
    screen.queryByRole('link', { name: 'compare_embed_fallback_link' })
  ).toBeNull();
});

it('a loaded PDF never gets the fallback drawn over it', () => {
  jest.useFakeTimers();
  render(panel('https://a.test/NOF/2019/NOF3.pdf#page=2'));
  const frame = document.querySelector('iframe') as HTMLIFrameElement;
  expect(frame).toHaveAttribute(
    'src',
    'https://a.test/NOF/2019/NOF3.pdf#page=2'
  );
  fireEvent.load(frame);
  act(() => {
    jest.advanceTimersByTime(20000);
  });
  expect(
    screen.queryByRole('link', { name: 'compare_embed_fallback_link' })
  ).toBeNull();
});

it('offers "compare with the original" for a PDF or text file, not for a Word file', () => {
  const { rerender } = render(
    withProblem('https://a.test/a.pdf', <CompareToggleButton />)
  );
  expect(screen.getByRole('button')).toHaveTextContent('compare_with_original');
  rerender(withProblem('https://a.test/a.txt', <CompareToggleButton />));
  expect(screen.getByRole('button')).toBeInTheDocument();
  rerender(withProblem('https://a.test/a.docx', <CompareToggleButton />));
  expect(screen.queryByRole('button')).toBeNull();
});
