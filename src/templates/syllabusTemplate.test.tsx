/** @jest-environment jsdom */
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Template from './syllabusTemplate';

// Section pages without a full Gatsby build: the page shell, progress data
// and translations are stubbed; the ordering (content/ordering.ts) is real.
const mockLevel = { level: '9-10', levelReady: true, setLevel: jest.fn() };
jest.mock('../context/LevelContext', () => ({
  useLevel: () => mockLevel,
}));
jest.mock('gatsby', () => ({
  graphql: () => null,
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
jest.mock('../components/layout', () =>
  function Layout({ children }) {
    return <>{children}</>;
  }
);
jest.mock('../components/seo', () => () => null);
jest.mock('../components/TopNavigationBar/TopNavigationBar', () => () => null);
jest.mock('../components/Dashboard/ModuleLink', () =>
  function ModuleLink({ link }) {
    return <div data-testid="module-link">{link.title}</div>;
  }
);
jest.mock('../components/Dashboard/DashboardProgress', () => ({
  __esModule: true,
  default: ({ total }) => <div data-testid="progress">{total} общо</div>,
  DashboardProgressSmall: () => null,
}));
jest.mock('../utils/getProgressInfo', () => ({
  useModulesProgressInfo: () => ({}),
  useProblemsProgressInfo: () => ({}),
}));

const kinematics = ['st-kin-odes', 'st-kin-tricks', 'st-kin-2d', 'st-kin-optimal'];

function renderSection(division: string, level = '9-10') {
  mockLevel.level = level;
  const modules =
    division === 'mechanics'
      ? kinematics.map(id => ({
          id,
          frontmatter: { id, title: id, description: '', frequency: null },
          isIncomplete: false,
          fields: { gitAuthorTime: null },
        }))
      : [];
  const problems =
    division === 'mechanics'
      ? [{ uniqueId: 'p1', name: 'p1', module: { frontmatter: { id: 'st-kin-odes' } } }]
      : [];
  return render(
    <Template
      data={{ modules: { nodes: modules }, problems: { nodes: problems } }}
      pageContext={{
        division,
        problemCountBySubject: { physics: 3402, astronomy: 3664 },
      }}
    />
  );
}

test('a section with no modules links to its problems and archive instead of zero progress cards', () => {
  renderSection('thermodynamics');
  expect(screen.getByText('Модулите в този раздел предстоят')).toBeInTheDocument();
  expect(screen.getByText('Задачи по физика (3402)')).toHaveAttribute(
    'href',
    '/problems/?subject=physics'
  );
  expect(screen.getByText('Архив по физика')).toHaveAttribute(
    'href',
    '/archive/physics/'
  );
  expect(screen.queryByTestId('progress')).toBeNull();
  // no false "показваме 7–8 клас" and no level pills
  expect(screen.queryByText(/показваме/)).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  // the whole plan, each chapter with its level
  expect(screen.getByText('Основни понятия')).toBeInTheDocument();
  expect(screen.getByText('Олимпиадна термодинамика')).toBeInTheDocument();
  expect(screen.getAllByText('7–8 клас').length).toBeGreaterThan(0);
  expect(screen.queryByText(/не покриват изцяло/)).toBeNull();
});

test('astronomy links to the astronomy problems and archive', () => {
  renderSection('astronomy');
  expect(screen.getByText('Задачи по астрономия (3664)')).toHaveAttribute(
    'href',
    '/problems/?subject=astronomy'
  );
  expect(screen.getByText('Архив по астрономия')).toHaveAttribute(
    'href',
    '/archive/astronomy/'
  );
});

test('mechanics falls back to the level that has modules and says so', () => {
  renderSection('mechanics', '9-10');
  expect(
    screen.getByText(/За 9–10 клас в този раздел още няма модули/)
  ).toHaveTextContent('показваме Специална тема');
  expect(screen.getAllByTestId('module-link')).toHaveLength(4);
  expect(screen.getAllByTestId('progress')).toHaveLength(2);
  expect(screen.getByRole('button', { name: '9–10 клас' })).toBeInTheDocument();
  expect(screen.queryByText('Модулите в този раздел предстоят')).toBeNull();
  expect(screen.getByText(/не покриват изцяло/)).toBeInTheDocument();
});

test('mechanics at the level with modules shows no fallback notice', () => {
  renderSection('mechanics', 'olymp');
  expect(screen.queryByText(/показваме/)).toBeNull();
  expect(screen.getAllByTestId('module-link')).toHaveLength(4);
});

test('the page has one h1', () => {
  const { container } = renderSection('thermodynamics');
  expect(container.querySelectorAll('h1')).toHaveLength(1);
});
