/** @jest-environment jsdom */
// The site shell: the announcement bar (build-time counts, a remembered
// dismiss), the menus (only sections with modules; the phone menu grouped, with
// Задачи and Архив first), the logo going home and the footer on every page.
import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import '../../i18n';
import Banner, { BANNER_ID } from './Banner';
import TopNavigationBar from './TopNavigationBar';
import Layout from '../layout';
import SectionsDropdown from '../SectionsDropdown';

const mockStats = {
  problems: 9033,
  problemsWithSolution: 6139,
  papers: 2121,
  subjects: ['physics', 'astronomy', 'chemistry', 'geography'],
  archiveFiles: 7304,
  archiveCompetitionFiles: 7044,
  archiveCompetitions: 58,
};

jest.mock('gatsby', () => ({
  Link: ({ to, children, getProps, state, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  graphql: () => null,
  useStaticQuery: () => ({ siteStats: mockStats }),
}));
jest.mock('@gatsbyjs/reach-router', () => ({
  useLocation: () => ({ pathname: '/problems/' }),
}));
jest.mock('../../context/UserDataContext/UserDataContext', () => ({
  useFirebaseUser: () => null,
  useIsUserDataLoaded: () => true,
  useSignOutAction: () => () => undefined,
}));
jest.mock('../../context/SignInContext', () => ({
  useSignIn: () => ({ signIn: () => undefined }),
}));
const mockSetTheme = jest.fn();
jest.mock('../../context/UserDataContext/properties/simpleProperties', () => ({
  useSetThemeSetting: () => mockSetTheme,
}));
jest.mock('../../context/DarkModeContext', () => ({
  useDarkMode: () => false,
}));
jest.mock('../../hooks/useAnalyticsEffect', () => ({
  useAnalyticsEffect: () => undefined,
}));
jest.mock('../../hooks/useUpdateStreakEffect', () => ({
  useUpdateStreakEffect: () => undefined,
}));
jest.mock('../ContactUsSlideover/ContactUsSlideover', () => () => null);
jest.mock('./SearchModal', () => ({ SearchModal: () => null }));
jest.mock('../LevelSwitcher', () => {
  const MockLevelSwitcher = () => <span>9–10 клас</span>;
  return MockLevelSwitcher;
});
jest.mock('gatsby-plugin-image', () => ({ StaticImage: () => null }));
jest.mock('../../components/seo', () => () => null);

beforeEach(() => {
  window.localStorage.clear();
  mockSetTheme.mockClear();
});

test('banner: build-time counts, "повечето", a Link to /problems/, no orphan sr-only text', () => {
  const { container } = render(<Banner />);
  expect(container).toHaveTextContent(
    'Над 9000 задачи от олимпиади по физика, астрономия, химия и география — повечето с официални решения'
  );
  expect(container).not.toHaveTextContent('се завръща');
  expect(container).not.toHaveTextContent('7000');
  for (const link of screen.getAllByRole('link', { name: /Към задачите/ })) {
    expect(link).toHaveAttribute('href', '/problems/');
  }
  // the only sr-only text is the close button's label
  const srOnly = container.querySelectorAll('.sr-only');
  expect(srOnly).toHaveLength(1);
  expect(srOnly[0].closest('button')).not.toBeNull();
});

test('banner: the close button hides it and it stays closed on the next page', () => {
  const first = render(<Banner />);
  fireEvent.click(screen.getByRole('button', { name: 'Затвори съобщението' }));
  expect(first.container).toBeEmptyDOMElement();
  expect(window.localStorage.getItem('olympiads:banner-dismissed')).toBe(
    BANNER_ID
  );
  first.unmount();
  const second = render(<Banner />);
  expect(second.container).toBeEmptyDOMElement();
});

test('Раздели lists only sections with a published module', () => {
  render(<SectionsDropdown />);
  fireEvent.click(screen.getByRole('button', { name: /Раздели/ }));
  const items = screen.getAllByRole('menuitem').map(x => x.textContent);
  expect(items).toEqual(['Предговор', 'Механика']);
});

test('top bar: logo goes home, no language switcher, theme toggle, grouped phone menu', () => {
  const { container } = render(<TopNavigationBar />);
  expect(
    screen.getByRole('link', { name: 'Olympiads XYZ — начална страница' })
  ).toHaveAttribute('href', '/');
  expect(container).not.toHaveTextContent('Български');
  expect(container).not.toHaveTextContent('Език');

  fireEvent.click(screen.getByRole('button', { name: 'Тъмна тема' }));
  expect(mockSetTheme).toHaveBeenCalledWith('dark');

  fireEvent.click(screen.getByRole('button', { name: 'Главно меню' }));
  const menu = container.querySelector('.lg\\:hidden > .grid') as HTMLElement;
  const groups = Array.from(menu.children) as HTMLElement[];
  // Задачи and Архив first
  const top = within(groups[0]).getAllByRole('link');
  expect(top.map(a => [a.textContent, a.getAttribute('href')])).toEqual([
    ['Задачи', '/problems/'],
    ['Архив', '/archive/'],
  ]);
  // captioned groups, the empty sections left out
  expect(groups[1]).toHaveTextContent(/^Раздели/);
  expect(groups[1]).toHaveTextContent('Механика');
  for (const empty of ['Електромагнетизъм', 'Оптика', 'Термодинамика']) {
    expect(menu).not.toHaveTextContent(empty);
  }
  expect(within(groups[1]).queryByText('Астрономия')).toBeNull();
  expect(groups[2]).toHaveTextContent(/^Архив по предмет/);
  expect(within(groups[2]).getByText('Астрономия')).toBeInTheDocument();
});

test('the footer is part of every page layout', () => {
  const { container, rerender } = render(
    <Layout>
      <p>page</p>
    </Layout>
  );
  const footer = container.querySelector('footer') as HTMLElement;
  expect(footer).not.toBeNull();
  expect(
    within(footer)
      .getAllByRole('link')
      .map(a => a.getAttribute('href'))
  ).toEqual(expect.arrayContaining(['/problems/', '/archive/', '/license']));
  rerender(
    <Layout footer="sidebar">
      <p>page</p>
    </Layout>
  );
  expect(container.querySelector('footer')).toHaveClass('lg:pl-80');
  rerender(
    <Layout footer="none">
      <p>page</p>
    </Layout>
  );
  expect(container.querySelector('footer')).toBeNull();
});

test('home: the counts, the problems and archive buttons, the modules link', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IndexPage = require('../../pages/index').default;
  const { container } = render(<IndexPage />);
  const main = container.querySelector('main') as HTMLElement;
  expect(main).toHaveTextContent('9000+');
  expect(main).toHaveTextContent('7300+');
  expect(main).toHaveTextContent(
    'задачи от олимпиади по физика, астрономия, химия и география, повечето с официални решения'
  );
  expect(main).toHaveTextContent('от 58 състезания');
  expect(
    within(main).getByRole('link', { name: 'Разгледай задачите' })
  ).toHaveAttribute('href', '/problems/');
  expect(within(main).getByRole('link', { name: 'Архив' })).toHaveAttribute(
    'href',
    '/archive/'
  );
  expect(
    within(main).getByRole('link', { name: /Към модулите и напредъка/ })
  ).toHaveAttribute('href', '/dashboard');
  expect(container.querySelector('#faq')).not.toBeNull();
  expect(container.querySelectorAll('footer')).toHaveLength(1);
});

test('404: the problems, the archive and search', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const NotFoundPage = require('../../pages/404').default;
  const { container } = render(<NotFoundPage />);
  const main = container.querySelector('main') as HTMLElement;
  expect(within(main).getByRole('link', { name: /Задачи/ })).toHaveAttribute(
    'href',
    '/problems/'
  );
  expect(within(main).getByRole('link', { name: /Архив/ })).toHaveAttribute(
    'href',
    '/archive/'
  );
  expect(main).toHaveTextContent('Над 9000 задачи от олимпиади');
  expect(
    within(main).getByRole('button', { name: 'Търси в сайта' })
  ).toBeInTheDocument();
});
