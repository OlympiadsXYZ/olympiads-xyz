import { graphql, Link } from 'gatsby';
import * as React from 'react';
import styled from 'styled-components';
import tw from 'twin.macro';
import {
  Level,
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

// Small print under the chapters of a section that has modules (it used to
// open the hero and took half a phone screen, even on sections with none).
const topicsWarning = (
  <>
    Темите тук не покриват изцяло раздела: задачите може да съдържат теми,
    които не са включени тук или са от друг раздел. Стараем се да бъдем
    максимално изчерпателни, но това не винаги е възможно.
  </>
);
const SECTION_DESCRIPTION: { [key in SectionID]: React.ReactNode } = {
  general: (
    <>
      Не е нужно да правите всичко тук. Това е само въведение в олимпиадите и състезанията, плюс няколко съвета как да ползвате уебсайта.
      <br/>
      Чувствайте се свободни да пропуснете нещата тук, които не ви интересуват.
    </>
  ),
  mechanics: 'Кинематика, динамика, енергия, гравитация, трептения и твърдо тяло.',
  thermodynamics: 'Топлинни явления, идеален газ, статистическа физика.',
  electromagnetism: 'Електростатика, вериги, магнетизъм и индукция.',
  optics: 'Геометрична и вълнова оптика, лещи, огледала и оптични уреди.',
  'modern-physics':
    'Специална теория на относителността, квантова и атомна физика.',
  astronomy:
    'Модули по астрономия — от небесната сфера до космологията, за НОА, IAO и IOAA.',
};

// Subject of the section's problems on /problems and in /archive/<subject>/
// (the codes of src/archive/labels.ts SCIENCE_LABELS), with its label after
// "Задачи по" / "Архив по".
const SECTION_SUBJECT: {
  [key in SectionID]: { id: string; label: string } | null;
} = {
  general: null,
  mechanics: { id: 'physics', label: 'физика' },
  thermodynamics: { id: 'physics', label: 'физика' },
  electromagnetism: { id: 'physics', label: 'физика' },
  optics: { id: 'physics', label: 'физика' },
  'modern-physics': { id: 'physics', label: 'физика' },
  astronomy: { id: 'astronomy', label: 'астрономия' },
};

export default function Template(props) {
  const data: Queries.SyllabusQuery = props.data;
  const allModules = data.modules.nodes.reduce((acc, cur) => {
    acc[cur.frontmatter.id] = cur;
    return acc;
  }, {} as { [key: string]: (typeof data.modules.nodes)[0] });

  const { division } = props.pageContext;
  const problemCountBySubject: { [subject: string]: number } =
    props.pageContext.problemCountBySubject ?? {};
  const { level, levelReady, setLevel } = useLevel();

  const allChapters = getModulesForDivision(allModules, division);
  // No published module at any level (thermodynamics, optics, …): the page
  // shows the planned chapters and links to the subject's problems and
  // archive instead of level pills and zero progress cards.
  const sectionHasModules = allChapters.some(
    chapter => chapter.items.length > 0
  );
  // Levels this section actually differentiates on (docs/Structure.md).
  // No tagged chapters (astronomy, general) => level-independent section.
  const taggedLevels = LEVELS.filter(option =>
    allChapters.some(chapter => chapter.levels?.includes(option))
  );
  // Levels with at least one published module here. Most chapters are the
  // planned syllabus with no modules yet: mechanics has modules only under
  // «Специална тема», so the default 9–10 showed an empty page with 0 modules.
  const levelsWithModules = taggedLevels.filter(option =>
    allChapters.some(
      chapter => chapter.levels?.includes(option) && chapter.items.length > 0
    )
  );
  // Never show an empty section: if the global level has no modules here,
  // display the first level that does (global level stays unchanged). A level
  // picked on this page is shown as picked, modules or not, until the global
  // level changes elsewhere. With no modules at any level there is nothing to
  // fall back to: the global level stays (it used to claim "показваме 7–8
  // клас" for a level that had no modules either).
  const [pickedLevel, setPickedLevel] = React.useState<Level | null>(null);
  const displayLevel =
    pickedLevel !== null && pickedLevel === level
      ? level
      : taggedLevels.length === 0 ||
        levelsWithModules.length === 0 ||
        levelsWithModules.includes(level)
      ? level
      : levelsWithModules[0];
  const pickLevel = (option: Level) => {
    setPickedLevel(option);
    setLevel(option);
  };
  // a chapter without `levels` is visible everywhere; before hydration
  // show everything (SSR stability). A section without modules shows its
  // whole plan, each chapter labelled with its levels.
  const chapterVisible = (chapter: (typeof allChapters)[0]) =>
    !sectionHasModules ||
    !levelReady ||
    !chapter.levels ||
    chapter.levels.includes(displayLevel);
  const subject = SECTION_SUBJECT[division as SectionID];
  const subjectProblemCount = subject
    ? problemCountBySubject[subject.id] ?? 0
    : 0;
  const section = allChapters.filter(chapterVisible);

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
              <h1 className="mb-6 px-4 text-3xl sm:text-5xl tracking-tight leading-10 font-black text-white sm:leading-none md:text-6xl text-center break-words">
                {SECTION_LABELS[division]}
              </h1>
              <p
                className={`${HeroTextColor[division]} text-center mb-6 px-4`}
              >
                {SECTION_DESCRIPTION[division]}
              </p>
              {division !== 'general' && levelsWithModules.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 mb-8 sm:mb-12 px-4">
                  {taggedLevels.map(option => (
                    <button
                      key={option}
                      onClick={() => pickLevel(option)}
                      className={`px-3 py-1 rounded-full text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-white/60 ${
                        levelReady && option === displayLevel
                          ? 'bg-white text-gray-900'
                          : 'bg-white/20 text-white hover:bg-white/30'
                      }`}
                    >
                      {LEVEL_LABELS[option]}
                    </button>
                  ))}
                </div>
              )}
              {levelReady &&
                levelsWithModules.length > 0 &&
                displayLevel !== level && (
                  <p
                    className={`${HeroTextColor[division]} text-center text-sm -mt-4 sm:-mt-8 mb-8 px-4`}
                  >
                    За {LEVEL_LABELS[level]} в този раздел още няма модули —
                    показваме {LEVEL_LABELS[displayLevel]}.
                  </p>
                )}
              {!sectionHasModules ? (
                <div className="max-w-2xl mx-auto bg-white dark:bg-gray-900 shadow sm:rounded-lg">
                  <div className="px-4 py-5 sm:p-6">
                    <h2 className="text-lg leading-6 font-medium text-gray-900 dark:text-dark-high-emphasis">
                      Модулите в този раздел предстоят
                    </h2>
                    <p className="mt-2 text-sm text-gray-600 dark:text-dark-med-emphasis">
                      Подготвяме уроците по плана по-долу. Междувременно
                      можете да решавате задачи от олимпиади и състезания и
                      да разглеждате оригиналните материали в архива.
                    </p>
                    {subject && (
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Link
                          to={`/problems/?subject=${subject.id}`}
                          className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 transition"
                        >
                          Задачи по {subject.label}
                          {subjectProblemCount > 0 &&
                            ` (${subjectProblemCount.toLocaleString('bg-BG')})`}
                        </Link>
                        <a
                          href={`/archive/${subject.id}/`}
                          className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 transition"
                        >
                          Архив по {subject.label}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className={`grid max-w-2xl mx-auto gap-8 ${
                    moduleIDs.length > 0 && problemIDs.length > 0
                      ? 'lg:max-w-full lg:grid-cols-2'
                      : ''
                  }`}
                >
                  {moduleIDs.length > 0 && (
                    <div className="bg-white dark:bg-gray-900 shadow sm:rounded-lg">
                      <div className="px-4 py-5 sm:p-6">
                        <h2 className="text-lg leading-6 font-medium text-gray-900 dark:text-dark-high-emphasis">
                          {t('syllabus_modules-progress')}
                        </h2>
                        <div className="mt-6">
                          <DashboardProgress
                            {...moduleProgressInfo}
                            total={moduleIDs.length}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  {problemIDs.length > 0 && (
                    <div className="bg-white dark:bg-gray-900 shadow sm:rounded-lg">
                      <div className="px-4 py-5 sm:p-6">
                        <h2 className="text-lg leading-6 font-medium text-gray-900 dark:text-dark-high-emphasis">
                          {t('syllabus_problems-progress')}
                        </h2>
                        <div className="mt-6">
                          <DashboardProgress
                            {...problemsProgressInfo}
                            total={problemIDs.length}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <DottedLineContainer className="py-12 px-4 max-w-screen-xl mx-auto">
            {allChapters.map((category, categoryIdx) => (
              <React.Fragment key={`${category.name}-${categoryIdx}`}>
                {renderChapter(category, chapterVisible(category))}
              </React.Fragment>
            ))}
          </DottedLineContainer>
          {sectionHasModules && division !== 'general' && (
            <p className="max-w-2xl mx-auto px-4 pb-12 text-center text-xs text-gray-500 dark:text-gray-400">
              {topicsWarning}
            </p>
          )}
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
                  {!sectionHasModules && category.levels && (
                    <p className="text-sm font-medium text-gray-500 dark:text-dark-med-emphasis">
                      {category.levels.map(x => LEVEL_LABELS[x]).join(', ')}
                    </p>
                  )}
                  <div className="leading-6 py-3 text-gray-500 dark:text-dark-med-emphasis group-hover:text-gray-800 dark:group-hover:text-dark-high-emphasis transition">
                    {progressBar}
                  </div>
                  <p className="md:max-w-sm md:ml-auto text-gray-500 dark:text-gray-500 dark:group-hover:text-dark-med-emphasis group-hover:text-gray-600 transition">
                    {category.description}
                  </p>
                </div>
                <div className="flex-1 pl-12">
                  {category.items.length === 0 && (
                    <p className="py-3 text-sm italic text-gray-500 dark:text-gray-500">
                      Модулите в тази глава предстоят.
                    </p>
                  )}
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
