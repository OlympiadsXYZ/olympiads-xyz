import { graphql } from 'gatsby';
import * as React from 'react';
import styled from 'styled-components';
import tw from 'twin.macro';
import {
  LEVELS,
  LEVEL_LABELS,
  SECTION_LABELS,
  SECTION_SEO_DESCRIPTION,
  SECTION_SEO_TITLES,
  SectionID,
  moduleIDToSectionMap,
} from '../../content/ordering';
import { useLevel } from '../context/LevelContext';
import DashboardProgress, {
  DashboardProgressSmall,
} from '../components/Dashboard/DashboardProgress';
import ModuleLink from '../components/Dashboard/ModuleLink';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import Layout from '../components/layout';
import SEO from '../components/seo';
import { ModuleFrequency, ModuleLinkInfo } from '../models/module';
// import UserDataContext from '../context/UserDataContext/UserDataContext';
import {
  useModulesProgressInfo,
  useProblemsProgressInfo,
} from '../utils/getProgressInfo';
import { getModulesForDivision } from '../utils/utils';

import '../i18n';
import { useTranslation } from 'react-i18next';

const DottedLineContainer = styled.div`
  ${tw`space-y-6 relative`}

  @media (min-width: 768px) {
    &::before {
      content: '';
      position: absolute;
      width: 2px;
      display: block;
      left: calc(50% - 1px);
      top: 0;
      bottom: 0;
      border-right: 2px dashed;
      ${tw`border-gray-100`}
    }
    .dark &::before {
      ${tw`border-gray-700`}
    }
  }
`;

const SectionContainer = styled.div`
  ${tw`flex flex-col md:flex-row`}

  &:hover h2 {
    ${tw`text-gray-600`}
  }
  .dark &:hover h2 {
    ${tw`text-gray-300`}
  }
  &:hover h2 + p {
    ${tw`text-gray-500`}
  }
`;

const HeroBGColor: { [key in SectionID]: string } = {
  general: 'bg-blue-700 dark:bg-blue-900',
  mechanics: 'bg-indigo-700 dark:bg-indigo-900',
  thermodynamics: 'bg-amber-700 dark:bg-amber-900',
  electromagnetism: 'bg-rose-700 dark:bg-rose-900',
  optics: 'bg-teal-700 dark:bg-teal-900',
  'modern-physics': 'bg-red-700 dark:bg-red-900',
  astronomy: 'bg-violet-800 dark:bg-violet-950',
};

const HeroTextColor: { [key in SectionID]: string } = {
  general: 'text-teal-200',
  mechanics: 'text-indigo-100',
  thermodynamics: 'text-amber-100',
  electromagnetism: 'text-rose-100',
  optics: 'text-teal-100',
  'modern-physics': 'text-red-100',
  astronomy: 'text-violet-100',
};

const topicsWarning = (
  <>
    Темите тук не са напълно изчерпателни за тази категория!
    <br/>
    Задачите може да съдържат допълнителни теми, които не са включени тук, или пък са от друг раздел. Стараем се да бъдем максимално изчерпателни, но това не винаги е възможно.
  </>
);
const SECTION_DESCRIPTION: { [key in SectionID]: React.ReactNode } = {
  general: (
    <>
      Не е нужно да правите всичко тук. Това е само въведение в олимпиадите и състезанията, плюс някой друг съвет как да ползвате уебсайта.
      <br/>
      Чуствайте се свободни да пропуснете нещата тук, които не ви интересуват.
    </>
  ),
  mechanics: (
    <>
      {topicsWarning}
      <br/>
      Кинематика, динамика, енергия, гравитация, трептения и твърдо тяло.
    </>
  ),
  thermodynamics: (
    <>
      {topicsWarning}
      <br/>
      Топлинни явления, идеален газ, статистическа физика.
    </>
  ),
  electromagnetism: (
    <>
      {topicsWarning}
      <br/>
      Електростатика, вериги, магнетизъм и индукция.
    </>
  ),
  optics: (
    <>
      {topicsWarning}
      <br/>
      Геометрична и вълнова оптика, лещи, огледала и оптични уреди.
    </>
  ),
  'modern-physics': (
    <>
      {topicsWarning}
      <br/>
      Специална теория на относителността, квантова и атомна физика.
    </>
  ),
  astronomy: (
    <>
      {topicsWarning}
      <br/>
      Модули по астрономия — от небесната сфера до космологията, за НОА, IAO и IOAA.
    </>
  ),
};

export default function Template(props) {
  const data: Queries.SyllabusQuery = props.data;
  const allModules = data.modules.nodes.reduce((acc, cur) => {
    acc[cur.frontmatter.id] = cur;
    return acc;
  }, {} as { [key: string]: (typeof data.modules.nodes)[0] });

  const { division } = props.pageContext;
  const { level, levelReady, setLevel } = useLevel();

  const allChapters = getModulesForDivision(allModules, division);
  // site-wide level filter (docs/Structure.md): a chapter without `levels`
  // is visible everywhere; before hydration show everything (SSR stability)
  const section = allChapters.filter(
    chapter =>
      !levelReady || !chapter.levels || chapter.levels.includes(level)
  );

  const moduleIDs = section.reduce(
    (acc, cur) => [...acc, ...cur.items.map(x => x.frontmatter.id)],
    [] as string[]
  );
  const moduleProgressInfo = useModulesProgressInfo(moduleIDs);
  const problemIDs = [
    ...new Set(data.problems.nodes.map(x => x.uniqueId) as string[]),
  ];
  const problemsProgressInfo = useProblemsProgressInfo(problemIDs);

  const useProgressBarForCategory = (category: (typeof section)[0]) => {
    const categoryModuleIDs = category.items.map(
      module => module.frontmatter.id
    );
    const categoryProblemIDs = data.problems.nodes
      .filter(x => categoryModuleIDs.includes(x.module?.frontmatter.id ?? ''))
      .map(x => x.uniqueId);
    const problemsProgressInfo = useProblemsProgressInfo(categoryProblemIDs);
    return (
      categoryProblemIDs.length > 1 && (
        <DashboardProgressSmall
          {...problemsProgressInfo}
          total={categoryProblemIDs.length}
        />
      )
    );
  };
  const { t } = useTranslation();
  return (
    <Layout>
      <SEO
        title={SECTION_SEO_TITLES[division]}
        description={SECTION_SEO_DESCRIPTION[division]}
      />
      <div className="min-h-screen">
        <TopNavigationBar currentSection={division} />

        <main>
          <div className={`${HeroBGColor[division]} py-12 sm:py-16`}>
            <div className="max-w-7xl mx-auto sm:px-6 lg:px-8">
              <h1 className="mb-6 text-5xl tracking-tight leading-10 font-black text-white sm:leading-none md:text-6xl text-center">
                {SECTION_LABELS[division]}
              </h1>
              <p
                className={`${HeroTextColor[division]} text-center mb-6 px-4`}
              >
                {SECTION_DESCRIPTION[division]}
              </p>
              {division !== 'general' && (
                <div className="flex flex-wrap justify-center gap-2 mb-8 sm:mb-12 px-4">
                  {LEVELS.map(option => (
                    <button
                      key={option}
                      onClick={() => setLevel(option)}
                      className={`px-3 py-1 rounded-full text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-white/60 ${
                        levelReady && option === level
                          ? 'bg-white text-gray-900'
                          : 'bg-white/20 text-white hover:bg-white/30'
                      }`}
                    >
                      {LEVEL_LABELS[option]}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid max-w-2xl mx-auto lg:max-w-full lg:grid-cols-2 gap-8">
                <div className="bg-white dark:bg-gray-900 shadow sm:rounded-lg">
                  <div className="px-4 py-5 sm:p-6">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-dark-high-emphasis">
                      {t('syllabus_modules-progress')}
                    </h3>
                    <div className="mt-6">
                      <DashboardProgress
                        {...moduleProgressInfo}
                        total={moduleIDs.length}
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-900 shadow sm:rounded-lg">
                  <div className="px-4 py-5 sm:p-6">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-dark-high-emphasis">
                      {t('syllabus_problems-progress')}
                    </h3>
                    <div className="mt-6">
                      <DashboardProgress
                        {...problemsProgressInfo}
                        total={problemIDs.length}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DottedLineContainer className="py-12 px-4 max-w-screen-xl mx-auto">
            {levelReady && section.length === 0 && (
              <p className="text-center text-gray-500 dark:text-dark-med-emphasis">
                На ниво „{LEVEL_LABELS[level]}“ тази секция още няма категории —
                изберете друго ниво от бутоните горе.
              </p>
            )}
            {allChapters.map((category, categoryIdx) => (
              <React.Fragment key={`${category.name}-${categoryIdx}`}>
                {renderChapter(
                  category,
                  !levelReady ||
                    !category.levels ||
                    category.levels.includes(level)
                )}
              </React.Fragment>
            ))}
          </DottedLineContainer>
        </main>
      </div>
    </Layout>
  );

  // Renders one category row. Called as a plain function (not JSX) so its
  // hooks belong to the page component; runs for every chapter regardless of
  // the level filter, keeping hook order stable when the level changes.
  function renderChapter(
    category: (typeof allChapters)[0],
    visible: boolean
  ) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const progressBar = useProgressBarForCategory(category);
    if (!visible) return null;
    return (
              <SectionContainer>
                <div className="flex-1 md:text-right pr-12 group">
                  <h2 className="text-2xl font-semibold leading-6 py-3 text-gray-500 dark:text-dark-med-emphasis group-hover:text-gray-800 dark:group-hover:text-dark-high-emphasis transition">
                    {category.name}
                  </h2>
                  <div className="leading-6 py-3 text-gray-500 dark:text-dark-med-emphasis group-hover:text-gray-800 dark:group-hover:text-dark-high-emphasis transition">
                    {progressBar}
                  </div>
                  <p className="md:max-w-sm md:ml-auto text-gray-400 dark:text-gray-500 dark:group-hover:text-dark-med-emphasis group-hover:text-gray-600 transition">
                    {category.description}
                  </p>
                </div>
                <div className="flex-1 pl-12">
                  {category.items.map(item => (
                    <ModuleLink
                      key={item.frontmatter.id}
                      link={
                        new ModuleLinkInfo(
                          item.frontmatter.id,
                          moduleIDToSectionMap[item.frontmatter.id],
                          item.frontmatter.title,
                          item.frontmatter.description,
                          item.frontmatter.frequency as ModuleFrequency,
                          item.isIncomplete,
                          null,
                          null,
                          null,
                          item.fields?.gitAuthorTime,
                          []
                        )
                      }
                    />
                  ))}
                </div>
              </SectionContainer>
    );
  }
}
export const pageQuery = graphql`
  query Syllabus($division: String!) {
    modules: allXdm(
      filter: {
        fileAbsolutePath: { regex: "/content/" }
        fields: { division: { eq: $division } }
      }
    ) {
      nodes {
        id
        frontmatter {
          title
          id
          description
          frequency
        }
        isIncomplete
        cppOc
        javaOc
        pyOc
        fields {
          gitAuthorTime
        }
      }
    }
    problems: allProblemInfo(
      filter: { module: { fields: { division: { eq: $division } } } }
    ) {
      nodes {
        uniqueId
        name
        module {
          frontmatter {
            id
          }
        }
      }
    }
  }
`;
