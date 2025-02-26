import { graphql } from 'gatsby';
import * as React from 'react';
import styled from 'styled-components';
import tw from 'twin.macro';
import {
  SECTION_LABELS,
  SECTION_SEO_DESCRIPTION,
  SECTION_SEO_TITLES,
  SectionID,
  moduleIDToSectionMap,
} from '../../content/ordering';
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
  beginner: 'bg-yellow-800 dark:bg-yellow-900',
  intermediate: 'bg-teal-700 dark:bg-teal-900',
  advanced: 'bg-indigo-700 dark:bg-indigo-900',
  special: 'bg-purple-700 dark:bg-purple-900',
  beyond: 'bg-green-700 dark:bg-green-900',
};

const HeroTextColor: { [key in SectionID]: string } = {
  general: 'text-teal-200',
  beginner: 'text-yellow-100',
  intermediate: 'text-teal-100',
  advanced: 'text-indigo-100',
  special: 'text-purple-100',
  beyond: 'text-green-100',
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
  beginner: (
    <>
      {topicsWarning}
      <br/>
      Включва материал, който е подходящ за състезателни групи 7-8 клас.
    </>
  ),
  intermediate: (
    <>
      {topicsWarning}
      <br/>
      Включва материал, който е подходящ за състезателни групи 9-10 клас.
    </>
  ),
  advanced: (
    <>
      {topicsWarning}
      <br/>
      Включва материал, който е подходящ за състезателни групи 11-12 клас.
    </>
  ),
  special: (
    <>
      {topicsWarning}
      <br/>
      Включва материал, който е подходящ за Международните олимпиади и подбора за тях.
    </>
  ),
  beyond: (
    <>
      Отвъд учебното съдържание на олимпиадите. Всичко останало, което може да ви бъде интересно.
      <br/>
      Материал, който не ви трябва за олимпиадите, но задълбочава познанията.
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

  const section = getModulesForDivision(allModules, division);

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
                className={`${HeroTextColor[division]} text-center mb-8 sm:mb-12 px-4`}
              >
                {SECTION_DESCRIPTION[division]}
              </p>
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
            {section.map(category => (
              <SectionContainer key={category.name}>
                <div className="flex-1 md:text-right pr-12 group">
                  <h2 className="text-2xl font-semibold leading-6 py-3 text-gray-500 dark:text-dark-med-emphasis group-hover:text-gray-800 dark:group-hover:text-dark-high-emphasis transition">
                    {category.name}
                  </h2>
                  <div className="leading-6 py-3 text-gray-500 dark:text-dark-med-emphasis group-hover:text-gray-800 dark:group-hover:text-dark-high-emphasis transition">
                    {/* eslint-disable-next-line react-hooks/rules-of-hooks */}
                    {useProgressBarForCategory(category)}
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
            ))}
          </DottedLineContainer>
        </main>
      </div>
    </Layout>
  );
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
