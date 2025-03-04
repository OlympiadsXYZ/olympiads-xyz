import { graphql, Link, PageProps } from 'gatsby';
import * as React from 'react';
import {
  moduleIDToSectionMap,
  moduleIDToURLMap,
  SECTION_LABELS,
} from '../../content/ordering';
import ActiveItems, { ActiveItem } from '../components/Dashboard/ActiveItems';
import Activity from '../components/Dashboard/Activity';
import Announcements from '../components/Dashboard/Announcements';
import DailyStreak from '../components/Dashboard/DailyStreak';
import Card from '../components/Dashboard/DashboardCard';
import DashboardProgress from '../components/Dashboard/DashboardProgress';
import WelcomeBackBanner from '../components/Dashboard/WelcomeBackBanner';
import Layout from '../components/layout';
import divToProbs from '../components/markdown/ProblemsList/DivisionList/div_to_probs.json';
import SEO from '../components/seo';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import { useSignIn } from '../context/SignInContext';
import { useLastVisitInfo } from '../context/UserDataContext/properties/lastVisit';
import {
  useLastReadAnnouncement,
  useLastViewedModule,
  useSetLastReadAnnouncement,
  useShowIgnoredSetting,
} from '../context/UserDataContext/properties/simpleProperties';
import {
  useUserProgressOnModules,
  useUserProgressOnProblems,
} from '../context/UserDataContext/properties/userProgress';
import { useFirebaseUser } from '../context/UserDataContext/UserDataContext';
import {
  AnnouncementInfo,
  graphqlToAnnouncementInfo,
} from '../models/announcement';
import {
  useModulesProgressInfo,
  useProblemsProgressInfo,
} from '../utils/getProgressInfo';

import '../i18n';
import { useTranslation } from 'react-i18next';

export default function DashboardPage(props: PageProps) {
  const { navigate, modules, announcements, problems } = props.data as any;
  const moduleIDToName = modules.edges.reduce((acc, cur) => {
    acc[cur.node.frontmatter.id] = cur.node.frontmatter.title;
    return acc;
  }, {});
  const { t } = useTranslation();
  const problemIDMap = React.useMemo(() => {
    // 1. problems in modules
    const res = problems.edges.reduce((acc, cur) => {
      const problem = cur.node;
      // ignore problems that don't have an associated module (extraProblems.json)
      if (problem.module) {
        if (!(problem.uniqueId in acc)) {
          acc[problem.uniqueId] = {
            label: `${problem.source}: ${problem.name}`,
            modules: [],
          };
        }
        acc[problem.uniqueId].modules.push({
          url: `${moduleIDToURLMap[problem.module.frontmatter.id]}/#problem-${
            problem.uniqueId
          }`,
          moduleId: problem.module.frontmatter.id,
        });
      }
      return acc;
    }, {});

    // 2. problems in USACO monthly table
    const divisions = ['Bronze', 'Silver', 'Gold', 'Platinum'];
    for (const division of divisions) {
      for (const probInfo of divToProbs[division]) {
        const id = `usaco-${probInfo[0]}`;
        if (!(id in res)) {
          res[id] = {
            label: `${division}: ${probInfo[2]}`,
            modules: [
              {
                url: `/general/usaco-monthlies/#problem-${id}`,
              },
            ],
          };
        }
      }
    }
    return res;
  }, [problems]);
  const lastViewedModuleID = useLastViewedModule();
  const userProgressOnModules = useUserProgressOnModules();
  const userProgressOnProblems = useUserProgressOnProblems();
  const lastReadAnnouncement = useLastReadAnnouncement();
  const setLastReadAnnouncement = useSetLastReadAnnouncement();
  const firebaseUser = useFirebaseUser();
  const { consecutiveVisits, numPageviews } = useLastVisitInfo();
  const showIgnored = useShowIgnoredSetting();
  const { signIn } = useSignIn();

  const lastViewedModuleURL = moduleIDToURLMap[lastViewedModuleID];
  const activeModules: ActiveItem[] = React.useMemo(() => {
    return Object.keys(userProgressOnModules)
      .filter(
        x =>
          (userProgressOnModules[x] === 'Reading' ||
            userProgressOnModules[x] === 'Practicing' ||
            userProgressOnModules[x] === 'Skipped' ||
            (showIgnored && userProgressOnModules[x] === 'Ignored')) &&
          moduleIDToSectionMap.hasOwnProperty(x)
      )
      .map(x => ({
        label: `${SECTION_LABELS[moduleIDToSectionMap[x]]}: ${
          moduleIDToName[x]
        }`,
        url: moduleIDToURLMap[x],
        status: userProgressOnModules[x] as
          | 'Skipped'
          | 'Reading'
          | 'Practicing'
          | 'Ignored',
      }));
  }, [userProgressOnModules, showIgnored]);
  const activeProblems: ActiveItem[] = React.useMemo(() => {
    return Object.keys(userProgressOnProblems)
      .filter(
        x =>
          (userProgressOnProblems[x] === 'Reviewing' ||
            userProgressOnProblems[x] === 'Solving' ||
            userProgressOnProblems[x] === 'Skipped' ||
            (showIgnored && userProgressOnProblems[x] === 'Ignored')) &&
          problemIDMap.hasOwnProperty(x)
      )
      .map(x => ({
        label: problemIDMap[x].label,
        url: problemIDMap[x].modules[0].url,
        status: userProgressOnProblems[x] as
          | 'Reviewing'
          | 'Solving'
          | 'Skipped'
          | 'Ignored',
      }));
  }, [userProgressOnProblems, showIgnored]);

  const lastViewedSection =
    moduleIDToSectionMap[lastViewedModuleID] || 'general';
  const moduleProgressIDs = Object.keys(moduleIDToName).filter(
    x => moduleIDToSectionMap[x] === lastViewedSection
  );
  const allModulesProgressInfo = useModulesProgressInfo(moduleProgressIDs);

  const problemStatisticsIDs = React.useMemo(() => {
    return Object.keys(problemIDMap).filter(problemID =>
      problemIDMap[problemID].modules.some(
        (module: { url: string; moduleId: string }) =>
          moduleIDToSectionMap[module.moduleId] === lastViewedSection
      )
    );
  }, [problemIDMap, lastViewedSection]);
  const allProblemsProgressInfo = useProblemsProgressInfo(problemStatisticsIDs);

  const parsedAnnouncements: AnnouncementInfo[] = React.useMemo(() => {
    return announcements.edges.map(node =>
      graphqlToAnnouncementInfo(node.node)
    );
  }, []);

  return (
    <Layout>
      <SEO title={t('dashboard_title')} />

      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar linkLogoToIndex={true} redirectToDashboard={false} />

        <main className="pb-12">
          <div className="max-w-7xl mx-auto mb-4">
            <div className="lg:px-8 pt-4 pb-6">
              <div className="flex flex-wrap mb-4">
                <div className="w-full text-center">
                  {firebaseUser ? (
                    <>
                      {t('dashboard_signed-in-as')} <i>{firebaseUser.email}</i>.
                    </>
                  ) : (
                    <span>
                      {t('dashboard_not-signed-in')}.{' '}
                      <a
                        href="#"
                        onClick={e => {
                          e.preventDefault();
                          signIn();
                        }}
                        className="text-blue-600 dark:text-blue-300 underline"
                      >
                        {t('dashboard_sign-in-now')}
                      </a>{' '}
                    </span>
                  )}
                </div>
              </div>
              <WelcomeBackBanner
                lastViewedModuleURL={lastViewedModuleURL}
                lastViewedModuleLabel={moduleIDToName[lastViewedModuleID]}
              />
            </div>
          </div>
          <header id="announcements">
            <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10">
              <h1 className="text-3xl font-bold leading-tight text-gray-900 dark:text-dark-high-emphasis">
                {t('dashboard_announcements')}
              </h1>
              <Link
                to="/announcements"
                className="hover:underline transition-all duration-300"
              >
                {t('dashboard_view-all')} &rarr;
              </Link>
            </div>
          </header>
          <div className="max-w-7xl mx-auto mb-8">
            {/* Only show announcements in the current year by passing in a filter function */}
            <Announcements
              filterFn={announcement =>
                parseInt(announcement.date.split(', ')[1]) ===
                new Date().getFullYear()
              }
              announcements={parsedAnnouncements}
            />
          </div>
          <div className="max-w-7xl mx-auto sm:px-6 lg:px-8 lg:grid lg:grid-cols-2 lg:gap-8">
            {activeProblems.length > 0 && (
              <div className="mb-8">
                <ActiveItems type="problems" items={activeProblems} />
              </div>
            )}
            {activeModules.length > 0 && (
              <div className="mb-8">
                <ActiveItems type="modules" items={activeModules} />
              </div>
            )}
          </div>
          <header>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h1 className="text-3xl font-bold leading-tight text-gray-900 dark:text-dark-high-emphasis">
                {t('dashboard_activity')}
              </h1>
            </div>
          </header>
          <div className="max-w-7xl mx-auto mb-8">
            <Activity />
          </div>
          <header>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h1 className="text-3xl font-bold leading-tight text-gray-900 dark:text-dark-high-emphasis">
                {t('dashboard_statistics')}
              </h1>
            </div>
          </header>
          <div className="max-w-7xl mx-auto">
            <div className="sm:px-6 lg:px-8 py-4 lg:grid lg:grid-cols-2 lg:gap-8 space-y-8 lg:space-y-0">
              <div className="space-y-8">
                <Card>
                  <div className="px-4 py-5 sm:p-6">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-dark-high-emphasis">
                      {t('dashboard_module-progress')} - {SECTION_LABELS[lastViewedSection]}
                    </h3>
                    <div className="mt-6">
                      <DashboardProgress
                        {...allModulesProgressInfo}
                        total={moduleProgressIDs.length}
                      />
                    </div>
                  </div>
                </Card>
              </div>
              <div className="space-y-8">
                <Card>
                  <div className="px-4 py-5 sm:p-6">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-dark-high-emphasis">
                      {t('dashboard_problems-progress')} - {SECTION_LABELS[lastViewedSection]}
                    </h3>
                    <div className="mt-6">
                      <DashboardProgress
                        {...allProblemsProgressInfo}
                        total={Object.keys(problemStatisticsIDs).length}
                      />
                    </div>
                  </div>
                </Card>
                {/*<div className="bg-white shadow sm:rounded-lg">*/}
                {/*  <div className="px-4 py-5 sm:p-6">*/}
                {/*    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-dark-high-emphasis">*/}
                {/*      Section Breakdown*/}
                {/*    </h3>*/}
                {/*    <div className="mt-2 max-w-xl text-sm leading-5 text-gray-500">*/}
                {/*      <p>Below is your progress on modules for each section.</p>*/}
                {/*    </div>*/}
                {/*    <div className="mt-4">*/}
                {/*      <SectionProgressBar title="Intro" />*/}
                {/*      <SectionProgressBar title="Bronze" />*/}
                {/*      <SectionProgressBar title="Silver" />*/}
                {/*      <SectionProgressBar title="Gold" />*/}
                {/*      <SectionProgressBar title="Platinum" />*/}
                {/*      <SectionProgressBar title="Advanced" />*/}
                {/*    </div>*/}
                {/*  </div>*/}
                {/*</div>*/}
              </div>
              {/* TODO: Tova mozhe da se napravi po-qko i togava da go slozhim */}
              {/* <DailyStreak streak={consecutiveVisits} /> */}
            </div>
          </div>
        </main>
      </div>

      {/* {parsedAnnouncements[0].id !== lastReadAnnouncement &&
        numPageviews > 12 && (
          <div className="h-12">
            <AnnouncementBanner
              announcement={parsedAnnouncements[0]}
              onDismiss={() =>
                setLastReadAnnouncement(parsedAnnouncements[0].id)
              }
            />
          </div>
        )} */}
    </Layout>
  );
}

export const pageQuery = graphql`
  query {
    modules: allXdm(filter: { fileAbsolutePath: { regex: "/content/" } }) {
      edges {
        node {
          frontmatter {
            title
            id
          }
        }
      }
    }
    problems: allProblemInfo {
      edges {
        node {
          uniqueId
          name
          source
          module {
            frontmatter {
              id
            }
          }
        }
      }
    }
    announcements: allXdm(
      filter: { fileAbsolutePath: { regex: "/announcements/" } }
      sort: { order: DESC, fields: frontmatter___order }
    ) {
      edges {
        node {
          frontmatter {
            title
            id
            date
          }
          body
        }
      }
    }
  }
`;
