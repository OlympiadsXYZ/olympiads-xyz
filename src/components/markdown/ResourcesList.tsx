import * as React from 'react';
import { useUserLangSetting } from '../../context/UserDataContext/properties/simpleProperties';
import { ResourceInfo } from '../../models/resource';
import { books } from '../../utils/books';
import PGS from './PGS';
import ResourcesListItem from './ResourcesListItem';
import { useTranslation } from 'react-i18next';

export function ResourcesList({
  title,
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="-mx-4 sm:-mx-6 md:mx-0">
      <div className="flex flex-col mb-4">
        <div className={`overflow-x-auto md:-mx-4 md:px-4 -my-2 py-2`}>
          <div
            className={`align-middle inline-block min-w-full shadow overflow-hidden md:rounded-lg border-b border-gray-200 dark:border-transparent`}
          >
            <table className="min-w-full no-markdown">
              <thead>
                <tr>
                  <th
                    colSpan={5}
                    className={`px-4 sm:px-6 border-b text-left font-medium text-sm uppercase py-3 border-gray-200 dark:border-transparent bg-purple-50 text-purple-500 dark:bg-purple-700 dark:bg-opacity-25 dark:text-purple-200`}
                  >
                    {t('resources')}{title ? `: ${title}` : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="table-alternating-stripes">{children}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const moduleSources = {
  Zhou: [
    'https://knzhou.github.io/',
    'Kevin Zhou Handouts',
  ],
  Kalda: [
    'https://www.ioc.ee/~kalda/ipho/', 
    'Jaan Kalda Handouts',
  ],
  IPhO: [
    'https://www.ipho-new.org',
    'https://ipho-unofficial.org/',
  ],
  EuPhO: [
    'https://eupho.ee/',
  ],
  APhO: [
    '', 
    'Asian Physics Olympiad'
  ],
  'НОФ': [
    'https://www.prirodninauki.bg/archives/category/%D0%BE%D0%BB%D0%B8%D0%BC%D0%BF%D0%B8%D0%B0%D0%B4%D0%B0-%D0%BF%D0%BE-%D1%84%D0%B8%D0%B7%D0%B8%D0%BA%D0%B0', 
    'Национална олимпиада по физика', 
    'Bulgaria National Olympiad in Physics'
  ],
  'Есенни': [
    'https://www.prirodninauki.bg/archives/category/%D1%81%D1%8A%D1%81%D1%82%D0%B5%D0%B7%D0%B0%D0%BD%D0%B8%D0%B5-%D0%BF%D0%BE-%D1%84%D0%B8%D0%B7%D0%B8%D0%BA%D0%B0', 
    'Национално есенно състезание по физика', 
    'Bulgaria National Fall Competition in Physics'
  ],
  'Пролетни': [
    'https://www.prirodninauki.bg/archives/category/%D1%81%D1%8A%D1%81%D1%82%D0%B5%D0%B7%D0%B0%D0%BD%D0%B8%D0%B5-%D0%BF%D0%BE-%D1%84%D0%B8%D0%B7%D0%B8%D0%BA%D0%B0',
    'Национално пролетно състезание по физика', 
    'Bulgaria National Spring Competition in Physics'
  ],
  NBPhO: [
    'https://nbpho.ee/', 
    'Nord-Baltic Physics Olympiad',
  ]
};

export function Resource({
  source,
  sourceDescription,
  url,
  starred,
  title,
  children,
}: {
  source?: string;
  sourceDescription?: string;
  url?: string;
  starred?: boolean;
  title?: string;
  children?: React.ReactNode;
}): JSX.Element {
  const lang = useUserLangSetting();
  source = source ?? '';
  sourceDescription = sourceDescription ?? '';
  if (source in books) {
    sourceDescription = books[source][1];
    if (!url) {
      // auto-gen page #
      const getSec = (dictKey, book, title) => {
        const parts = title.split(' ');
        let url = book;
        let sec = parts[0];
        if (sec[sec.length - 1] == ',') sec = sec.substring(0, sec.length - 1);
        if (!/^\d.*$/.test(sec)) return url;
        if (!(sec in PGS[dictKey])) {
          throw `Could not find section ${sec} in source ${dictKey} (title ${title})`;
        }
        url += '#page=' + PGS[dictKey][sec];
        return url;
      };
      if (source === 'IUSACO') {
        if (lang === 'java') {
          url = getSec(
            'JAVA',
            'https://darrenyao.com/usacobook/java.pdf',
            title
          );
        } else {
          url = getSec('CPP', 'https://darrenyao.com/usacobook/cpp.pdf', title);
        }
      } else if (source in PGS) {
        url = getSec(source, books[source][0], title);
      } else url = books[source][0];
    }
  } else if (source in moduleSources) {
    if (!url?.startsWith('http')) url = moduleSources[source][0] + url;
    sourceDescription = moduleSources[source][1];
  } else {
    if (!url?.startsWith('http')) {
      throw `URL ${url} is not valid. Did you make a typo in the source (${source}), or in the URL? Resource name: ${title}`;
    }
  }
  const resource: ResourceInfo = {
    source,
    sourceDescription,
    url,
    starred,
    title,
    children,
  };
  return <ResourcesListItem resource={resource} />;
}
