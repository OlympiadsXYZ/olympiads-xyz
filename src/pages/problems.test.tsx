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
import ProblemsPage from './problems';

jest.mock('gatsby', () => ({
  Link: ({ to, children, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('../i18n', () => ({}));
jest.mock(
  '../components/layout',
  () =>
    function Layout({ children }) {
      return <>{children}</>;
    }
);
jest.mock('../components/seo', () => () => null);
jest.mock('../components/TopNavigationBar/TopNavigationBar', () => () => null);
jest.mock('../context/UserDataContext/properties/userProgress', () => ({
  useUserProgressOnProblems: () => ({}),
}));
jest.mock('../components/ProblemsPage/Selection', () => ({
  __esModule: true,
  default: ({ attribute, placeholder }) => (
    <span data-facet={attribute}>{placeholder}</span>
  ),
}));
jest.mock('../components/ProblemsPage/ProblemHits', () => ({
  __esModule: true,
  default: ({ problems }) => (
    <ol>
      {problems.map(p => (
        <li key={p.uniqueId}>{p.uniqueId}</li>
      ))}
    </ol>
  ),
}));

const entry = (uniqueId: string, year: number, subject = 'physics') => ({
  uniqueId,
  name: uniqueId,
  url: `https://a.test/${uniqueId}.pdf`,
  source: `NOF ${year}`,
  difficulty: 'Normal',
  isStarred: false,
  tags: [],
  problemModules: [],
  solution: { kind: 'internal' },
  problemURL: `/problems/${uniqueId}`,
  subject,
  competition: 'NOF',
  year,
});
const index = [
  ...Array.from({ length: 30 }, (_, i) => entry(`nof-2019-p${i + 1}`, 2019)),
  entry('nof-2024-p1', 2024),
  entry('chem-2021-p1', 2021, 'chemistry'),
];

const collections = [
  {
    id: 'edited-astronomy',
    kind: 'collection',
    title: 'Edited astronomy collection',
    url: '/collections/edited-astronomy/',
    subject: 'astronomy',
    competition: 'IOAA',
    language: 'en',
    publicationYear: null,
    contestYears: [2007, 2008],
    chapterTitles: ['Celestial mechanics', 'Observations'],
    taskCount: 25,
    printedTags: ['I08T01'],
  },
];

beforeAll(() => {
  global.fetch = jest.fn().mockImplementation(async url => {
    if (url === '/problems-data/index.json') {
      return { ok: true, json: async () => index };
    }
    if (url === '/collections-data/index.json') {
      return { ok: true, json: async () => collections };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });
});

async function renderAt(search: string) {
  window.history.replaceState(null, '', `/problems/${search}`);
  await act(async () => {
    render(<ProblemsPage {...({ location: { search, key: 'k' } } as any)} />);
  });
}

it('lists the newest year first, counts the results and has no Източник facet', async () => {
  await renderAt('');
  const rows = screen.getAllByRole('listitem').map(li => li.textContent);
  expect(rows[0]).toBe('nof-2024-p1');
  expect(rows[1]).toBe('chem-2021-p1');
  expect(rows[2]).toBe('nof-2019-p1');
  expect(screen.getByText('32 задачи')).toBeInTheDocument();
  expect(document.querySelector('[data-facet="year"]')).toBeInTheDocument();
  expect(document.querySelector('[data-facet="source"]')).toBeNull();
  expect(document.querySelector('[data-facet="assessmentLabel"]')).toBeNull();
  expect(screen.getByText('стр. 1 от 2')).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

it('reads its filters and page from the URL and writes them back', async () => {
  await renderAt('?subject=physics&page=2');
  expect(screen.getByText('31 задачи от 32')).toBeInTheDocument();
  expect(screen.getByText('стр. 2 от 2')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(7);
  expect(
    screen.getByRole('button', { name: 'Филтри (1)' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Първа страница' }));
  expect(window.location.search).toBe('?subject=physics');
  fireEvent.change(screen.getByRole('combobox', { name: /Подреди/ }), {
    target: { value: 'oldest' },
  });
  expect(window.location.search).toBe('?subject=physics&sort=oldest');
  fireEvent.click(screen.getByRole('button', { name: 'Изчисти филтрите' }));
  expect(screen.getByText('32 задачи')).toBeInTheDocument();
  expect(window.location.search).toBe('?sort=oldest');
});

it('shows collections separately from annual tasks and filters their search text', async () => {
  await renderAt('?subject=astronomy&competition=IOAA&year=2008');
  expect(
    await screen.findByRole('link', { name: 'Edited astronomy collection' })
  ).toHaveAttribute('href', '/collections/edited-astronomy/');
  expect(
    screen.getByRole('region', { name: 'Тематични сборници' })
  ).toBeInTheDocument();
  expect(
    screen.getByText('2 глави · 25 печатни задачи · EN')
  ).toBeInTheDocument();
  expect(
    screen.getByText('Редактирани варианти от 2007, 2008')
  ).toBeInTheDocument();
  expect(screen.getByText('0 задачи от 32')).toBeInTheDocument();
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  expect(global.fetch).toHaveBeenCalledWith('/problems-data/index.json');
  expect(global.fetch).toHaveBeenCalledWith('/collections-data/index.json');

  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'unmatched-collection-query' },
  });
  await waitFor(() => {
    expect(
      screen.queryByRole('link', { name: 'Edited astronomy collection' })
    ).not.toBeInTheDocument();
  });
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'celestial' },
  });
  expect(
    await screen.findByRole('link', { name: 'Edited astronomy collection' })
  ).toHaveAttribute('href', '/collections/edited-astronomy/');
  expect(window.location.search).toContain('q=celestial');
});

it('excludes collections when a task-only difficulty filter is selected', async () => {
  await renderAt('?difficulty=Normal');
  expect(screen.getByText('32 задачи')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(24);
  expect(
    screen.queryByRole('link', { name: 'Edited astronomy collection' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Тематични сборници' })
  ).not.toBeInTheDocument();
});
