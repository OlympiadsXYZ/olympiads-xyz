import { Link } from 'gatsby';
import * as React from 'react';
import styled, { css } from 'styled-components';
import tw from 'twin.macro';
import {
  LANGUAGE_LABELS,
  useUserLangSetting,
} from '../../context/UserDataContext/properties/simpleProperties';
import { useUserProgressOnModules } from '../../context/UserDataContext/properties/userProgress';
import { ModuleLinkInfo } from '../../models/module';
import { FrequencyLabels } from '../Frequency';
import ModuleFrequencyDots from '../MarkdownLayout/ModuleFrequencyDots';
import { LinkWithProgress as SidebarLinkWithProgress } from '../MarkdownLayout/SidebarNav/ItemLink';
import Tooltip from '../Tooltip/Tooltip';
import { useTranslation } from 'react-i18next';
import moment from 'moment';
import 'moment/locale/bg' 
import 'moment/locale/de'
import 'moment/locale/en-gb'

import i18next from 'i18next';


const LinkWithProgress = styled(SidebarLinkWithProgress)<{ small: boolean }>`
  &&::after {
    ${({ small }) => css`
      // prettier-ignore
      left: calc(-1.75rem - ${small
        ? '8px'
        : '10px'}); // -(3rem padding plus half of width)
      // prettier-ignore
      top: calc(1.5rem - ${small
        ? '8px'
        : '10px'}); // half of (1.5 + 1.5padding) rem minus half of height
      height: ${small ? '16px' : '20px'};
      width: ${small ? '16px' : '20px'};
    `}

    @media (min-width: 768px) {
      ${({ small }) => css`
        // prettier-ignore
        left: calc(-3rem - ${small
          ? '8px'
          : '10px'}); // -(3rem padding plus half of width)
      `}
    }
  }

  &&::after {
    ${({ small }) => small && tw`border-2 border-gray-200 bg-white`}
  }
  // lol no clue why two ampersands are needed but they are...
  .dark &&::after {
    ${({ small }) => (small ? tw`border-2 border-gray-500` : tw`border-0`)}
  }

  &&::before {
    left: calc(-1.75rem - 1px);
    @media (min-width: 768px) {
      left: calc(-3rem - 1px); // -(3rem padding plus half of width)
    }
  }
`;

const StyledLink = styled.div<{ showDot?: boolean }>`
  ${tw`focus:outline-none transition ease-in-out duration-150 text-gray-800 hover:text-blue-700 text-xl leading-6 py-3`}

  &::before {
    content: '';
    left: calc(-1.75rem - 11px);
    @media (min-width: 768px) {
      left: calc(-3rem - 11px); // -(3rem padding plus half of width)
    }
    top: calc(1.5rem - 11px); // half of 1.5rem minus half of height
    height: 22px;
    width: 22px;
    position: absolute;
    transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1) 0s;
  }

  &::before {
    transform: ${({ showDot }) => (showDot ? 'scale(1)' : 'scale(0.1)')};
    border-radius: 100%;
    z-index: 1;
  }

  &:hover {
    &::before {
      transform: scale(1);
      ${tw`bg-blue-600`}
    }
  }
  .dark &:hover {
    &::before {
      ${tw`bg-gray-400`}
    }
  }
`;

const FrequencyCircleColors = [
  'group-hover:text-red-600 dark:group-hover:text-red-400',
  'group-hover:text-orange-600 dark:group-hover:text-orange-400',
  'group-hover:text-yellow-600 dark:group-hover:text-yellow-400',
  'group-hover:text-teal-600 dark:group-hover:text-teal-400',
  'group-hover:text-green-600 dark:group-hover:text-green-400',
];

const FrequencyTextColors = [
  'group-hover:text-red-700 dark:group-hover:text-red-400',
  'group-hover:text-orange-700 dark:group-hover:text-orange-400',
  'group-hover:text-yellow-700 dark:group-hover:text-yellow-400',
  'group-hover:text-teal-700 dark:group-hover:text-teal-400',
  'group-hover:text-green-700 dark:group-hover:text-green-400',
];




const ModuleLink = ({ link }: { link: ModuleLinkInfo }): JSX.Element => {
  const { t } = useTranslation();
  // https://stackoverflow.com/questions/3177836/how-to-format-time-since-xxx-e-g-4-minutes-ago-similar-to-stack-exchange-site
function time_ago(time: unknown): string {
  if (typeof time == 'string') time = +new Date(time);
  else if (time instanceof Date) time = time.getTime();
  else time = +new Date();
  moment.locale(i18next.language);
  let seconds = (+new Date() - (time as number)) / 1000
  if (seconds > 4838400) {
    return '';
  }
  else {
    //works fantastically omfg
    return moment(time as string).fromNow();
  }
}
  function timeAgoString(time: unknown): string {
    const res = time_ago(time);
    return res && `${t('updated')}: ${res}`;
  }
  const userProgressOnModules = useUserProgressOnModules();
  const progress = userProgressOnModules[link.id] || 'Not Started';

  let lineColorStyle = tw`bg-gray-200`;
  let dotColorStyle = tw`bg-gray-200`;
  let darkLineColorStyle = tw`bg-gray-700`;
  let darkDotColorStyle = tw`bg-gray-700`;

  if (progress === 'Reading') {
    lineColorStyle = tw`bg-yellow-300`;
    dotColorStyle = tw`bg-yellow-300`;
    darkLineColorStyle = tw`bg-yellow-400`;
    darkDotColorStyle = tw`bg-yellow-400`;
  } else if (progress === 'Practicing') {
    lineColorStyle = tw`bg-orange-400`;
    dotColorStyle = tw`bg-orange-400`;
    darkLineColorStyle = tw`bg-orange-500`;
    darkDotColorStyle = tw`bg-orange-500`;
  } else if (progress === 'Complete') {
    lineColorStyle = tw`bg-green-400`;
    dotColorStyle = tw`bg-green-400`;
    darkLineColorStyle = tw`bg-green-400`;
    darkDotColorStyle = tw`bg-green-400`;
  } else if (progress === 'Skipped') {
    lineColorStyle = tw`bg-blue-300`;
    dotColorStyle = tw`bg-blue-300`;
    darkLineColorStyle = tw`bg-blue-700`;
    darkDotColorStyle = tw`bg-blue-700`;
  } else if (progress === 'Ignored') {
    lineColorStyle = tw`bg-gray-100`;
    dotColorStyle = tw`bg-gray-100`;
    darkLineColorStyle = tw`bg-gray-800`;
    darkDotColorStyle = tw`bg-gray-800`;
  }
  const userLang = useUserLangSetting();
  const maxLangOc = Math.max(link.cppOc ?? 0, link.javaOc ?? 0, link.pyOc ?? 0);
  const langToOc = {
    cpp: link.cppOc,
    java: link.javaOc,
    py: link.pyOc,
    showAll: maxLangOc,
  };
  const isMissingLang = (langToOc[userLang] ?? 0) < maxLangOc;
  return (
    <LinkWithProgress
      lineColorStyle={lineColorStyle}
      dotColorStyle={dotColorStyle}
      darkLineColorStyle={darkLineColorStyle}
      darkDotColorStyle={darkDotColorStyle}
      small={progress === 'Not Started' || progress === 'Ignored'}
    >
      <Link to={link.url}>
        <StyledLink className="group">
          <p
            className={`${
              progress === 'Ignored'
                ? 'text-gray-400 dark:text-gray-600'
                : 'text-gray-700 dark:text-gray-400'
            } group-hover:text-blue-800 dark:group-hover:text-dark-high-emphasis transition mb-1 flex items-center`}
          >
            <span className="mr-2 inline-flex items-end">
              {link.title}{' '}
              {link.isIncomplete || isMissingLang ? (
                <Tooltip
                  content={
                    link.isIncomplete
                      ? t('module_incomplete')
                      : t('module_something-missing')
                  }
                >
                  <svg
                    className="h-5 w-5 text-gray-300 group-hover:text-yellow-300 ml-1.5 transition ease-in-out duration-150"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </Tooltip>
              ) : null}
            </span>
          </p>
          {link.frequency !== null && (
            <p className="text-sm flex items-center leading-4 mb-1">
              <ModuleFrequencyDots
                count={link.frequency}
                totalCount={4}
                color={
                  'transition text-gray-400 ' +
                  FrequencyCircleColors[link.frequency ?? 0]
                }
              />
              <span
                className={
                  `ml-1 transition text-gray-500 ` +
                  FrequencyTextColors[link.frequency ?? 0]
                }
              >
                {FrequencyLabels[link.frequency ?? 0] === 'Has Not Appeared' && t('has-not-appeared')}
                {FrequencyLabels[link.frequency ?? 0] === 'Rare' && t('rare')}
                {FrequencyLabels[link.frequency ?? 0] === 'Not Frequent' && t('not-frequent')}
                {FrequencyLabels[link.frequency ?? 0] === 'Somewhat Frequent' && t('somewhat-frequent')}
                {FrequencyLabels[link.frequency ?? 0] === 'Very Frequent' && t('very-frequent')}
              </span>
            </p>
          )}
          {/* https://stackoverflow.com/questions/9229213/convert-iso-date-to-milliseconds-in-javascript */}
          <p className="block text-sm text-gray-400 group-hover:text-blue-700 dark:group-hover:text-dark-high-emphasis transition leading-5">
            {link.description}

            <i>
              <br />
              {timeAgoString(link.gitAuthorTime)}
            </i>
          </p>
        </StyledLink>
      </Link>
    </LinkWithProgress>
  );
};

export default ModuleLink;
