import * as React from 'react';
import Tooltip from '../Tooltip/Tooltip';
import { useTranslation } from 'react-i18next';
import '../../i18n';
import { FaCheck } from "react-icons/fa";
import { FaPenToSquare } from "react-icons/fa6";
import { MdDoubleArrow } from "react-icons/md";
import { PiEmptyBold } from "react-icons/pi";

const ProgressBar = ({ text, green, yellow, blue }) => {
  return (
    <div className="relative">
      <div className="overflow-hidden h-4 text-xs flex bg-gray-200 dark:bg-gray-700">
        <div
          style={{ width: `${green}%` }}
          className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-green-500 dark:bg-green-800"
        />
        <div
          style={{ width: `${yellow}%` }}
          className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-yellow-300 dark:bg-yellow-800"
        />
        <div
          style={{ width: `${blue}%` }}
          className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-blue-500 dark:bg-blue-800"
        />
      </div>
      <div className="text-right">
        <span className="text-sm font-semibold inline-block text-gray-800 dark:text-dark-med-emphasis">
          {text}
        </span>
      </div>
    </div>
  );
};

const FancyNumber = ({
  number,
  text,
  textColor,
  bgColor,
  subTextColor = null as string | null,
  icon = null as React.ComponentType<React.SVGProps<SVGSVGElement>> | null,
}) => {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  const Icon = icon;

  return (
    <div className="text-center">
      <span
        className={`text-3xl font-bold ${textColor} ${bgColor} rounded-full h-16 w-16 inline-block inline-flex items-center justify-center`}
      >
        {number}
      </span>
      <span
        className={`block mt-1 text-sm font-medium uppercase ${
          subTextColor ? subTextColor : textColor
        }`}
      >
        {isMobile && Icon ? <Icon className="h-5 w-5 mx-auto" /> : text}
      </span>
    </div>
  );
};

type ProgressCounts = {
  completed: number;
  inProgress: number;
  skipped: number;
  notStarted: number;
  total: number;
};

export default function DashboardProgress({
  completed,
  inProgress,
  skipped,
  notStarted,
  total,
}: ProgressCounts): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <div className="grid grid-cols-4 gap-2 mb-4">
        <FancyNumber
          number={completed}
          text={t('dashboard_completed')}
          icon={FaCheck}
          textColor="text-green-800 dark:text-green-100"
          bgColor="bg-green-100 dark:bg-green-800"
        />
        <FancyNumber
          number={inProgress}
          text={t('dashboard_in-progress')}
          icon={FaPenToSquare}
          textColor="text-yellow-800 dark:text-yellow-100"
          bgColor="bg-yellow-100 dark:bg-yellow-800"
        />
        <FancyNumber
          number={skipped}
          text={t('dashboard_skipped')}
          icon={MdDoubleArrow}
          textColor="text-blue-800 dark:text-blue-50"
          bgColor="bg-blue-50 dark:bg-blue-800"
        />
        <FancyNumber
          number={notStarted}
          text={t('dashboard_not-started')}
          icon={PiEmptyBold}
          textColor="text-gray-800"
          bgColor="bg-gray-100"
          subTextColor="text-gray-800 dark:text-gray-100"
        />
      </div>
      <ProgressBar
        green={total === 0 ? 0 : (completed / total) * 100}
        yellow={total === 0 ? 0 : (inProgress / total) * 100}
        blue={total === 0 ? 0 : (skipped / total) * 100}
        text={`${total} ${t('dashboard_total')}`}
      />
    </div>
  );
}

const ProgressBarSmall = ({
  className = undefined as string | undefined,
  text,
  green,
  yellow,
  blue,
}) => {
  return (
    <div className={className}>
      <div className="inline-block">
        <div className="overflow-hidden h-2 text-xs flex items-center bg-gray-200 rounded-full w-24 dark:bg-gray-700">
          <div
            style={{ width: `${green}%` }}
            className="h-2 bg-green-500 dark:bg-green-800"
          />
          <div
            style={{ width: `${yellow}%` }}
            className="h-2 bg-yellow-300 dark:bg-yellow-800"
          />
          <div
            style={{ width: `${blue}%` }}
            className="h-2 bg-blue-500 dark:bg-blue-800"
          />
        </div>
      </div>
      {/*  text-gray-800 dark:text-dark-med-emphasis */}
      <div className="inline-block ml-1">
        {text && <span className="text-sm font-semibold">&nbsp;{text}</span>}
      </div>
    </div>
  );
};

export function DashboardProgressSmall({
  completed,
  inProgress,
  skipped,
  total,
}: ProgressCounts): JSX.Element {
  return (
    <ProgressBarSmall
      text={completed + '/' + total}
      green={total === 0 ? 0 : (completed / total) * 100}
      yellow={total === 0 ? 0 : (inProgress / total) * 100}
      blue={total === 0 ? 0 : (skipped / total) * 100}
    />
  );
}

export function UsacoTableProgress({
  completed,
}: {
  completed: number;
}): JSX.Element {
  let is_nan = false;
  if (isNaN(completed)) {
    completed = 0;
    is_nan = true;
  }
  let green = completed * 100;
  let yellow = 0;
  let blue = 0;
  if (green <= 95) {
    yellow = green;
    green = 0;
  }
  if (yellow <= 85) {
    blue = yellow;
    yellow = 0;
  }
  const { t } = useTranslation();
  return (
    <Tooltip
      content={
        is_nan
          ? t('table-progress_no-information-available')
          : `${Math.round(completed * 1000) / 10}%`
      }
    >
      {/* The span wrapper is needed for tippy to work */}
      <span className="cursor-pointer">
        <ProgressBarSmall
          text={''}
          green={green}
          yellow={yellow}
          blue={blue}
          className="h-2 inline-flex"
        />
      </span>
    </Tooltip>
  );
}
