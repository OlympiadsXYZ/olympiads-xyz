/** @jest-environment jsdom */
import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import ProblemsTree from './ProblemsTree';

jest.mock('gatsby', () => ({
  Link: ({ to, children, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));

const years = Array.from({ length: 70 }, (_, index) => {
  const year = 2026 - index;
  return {
    year,
    count: 1,
    papers: [
      {
        id: `paper-${year}`,
        label: `Theory ${year}`,
        count: 1,
        problems: [
          {
            id: `problem-${year}`,
            number: 1,
            title: null,
            url: `/problems/${year}/`,
          },
        ],
      },
    ],
  };
});
const tree = {
  count: 71,
  subjects: [
    {
      id: 'physics',
      label: 'Physics',
      count: 71,
      competitions: [
        { code: 'IZhO', short: 'IZhO', name: 'IZhO', count: 70, years },
        {
          code: 'IPhO',
          short: 'IPhO',
          name: 'IPhO',
          count: 1,
          years: [{ ...years[0], papers: [] }],
        },
      ],
    },
  ],
};

beforeAll(() => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => tree });
  HTMLElement.prototype.scrollIntoView = jest.fn();
});
beforeEach(() => window.sessionStorage.clear());

it('opens the current year and problem, with all 70 years in one picker', async () => {
  await act(async () => {
    render(<ProblemsTree currentProblemId="problem-1980" />);
  });
  const picker = await screen.findByRole('combobox', { name: 'IZhO · Year' });
  expect(picker).toHaveValue('1980');
  expect(screen.getAllByRole('option')).toHaveLength(70);
  expect(screen.getByRole('link', { name: 'Задача 1' })).toHaveAttribute(
    'href',
    '/problems/1980/'
  );
  expect(document.querySelector('[aria-current="page"]')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Theory 2026/ })
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /IPhO/ })).toBeInTheDocument();
});

it('selects old years directly, steps across years and disables end controls', async () => {
  await act(async () => {
    render(<ProblemsTree currentProblemId="problem-2026" />);
  });
  const picker = await screen.findByRole('combobox');
  expect(screen.getByRole('button', { name: 'Newer year' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Older year' }));
  expect(picker).toHaveValue('2025');
  expect(
    screen.getByRole('button', { name: /Theory 2025/ })
  ).toBeInTheDocument();
  fireEvent.change(picker, { target: { value: '1957' } });
  expect(screen.getByRole('button', { name: 'Older year' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: /Theory 2025/ })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Theory 1957/ }));
  expect(screen.getByRole('link', { name: 'Задача 1' })).toHaveAttribute(
    'href',
    '/problems/1957/'
  );
  fireEvent.click(screen.getByRole('button', { name: /IPhO/ }));
  expect(
    screen.queryByRole('combobox', { name: 'IZhO · Year' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /IZhO/ }));
  expect(screen.getByRole('combobox')).toHaveValue('1957');
});

it('normalizes old expanded sessions and follows a newly navigated problem', async () => {
  window.sessionStorage.setItem(
    'problems-tree:expanded',
    JSON.stringify({
      's:physics': true,
      'c:physics/IZhO': true,
      'c:physics/IPhO': true,
      'y:physics/IZhO/2026': true,
      'y:physics/IZhO/1980': true,
    })
  );
  let rerender;
  await act(async () => {
    ({ rerender } = render(<ProblemsTree currentProblemId="problem-1980" />));
  });
  expect(await screen.findByRole('combobox')).toHaveValue('1980');
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  rerender(<ProblemsTree currentProblemId="problem-1970" />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('1970'));
  expect(document.querySelector('[aria-current="page"]')).toHaveAttribute(
    'href',
    '/problems/1970/'
  );
});
