import { Link, PageProps } from 'gatsby';
import * as React from 'react';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';
import Layout from '../components/layout';
import SEO from '../components/seo';
import '../i18n';
import { useTranslation } from 'react-i18next';

const linkClasses =
  'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline';

export default function LicensePage(props: PageProps) {
  const { t } = useTranslation();
  return (
    <Layout>
      <SEO title={t('license_title')} />

      <TopNavigationBar />
      <main>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="mt-8 text-4xl font-extrabold">{t('license_title')}</h1>

        <div className="mt-6 text-gray-900 text-lg dark:text-dark-high-emphasis">
          <p className="mb-4">
            Собственото съдържание на Olympiads XYZ (текстовете на модулите,
            подборът и подредбата на задачите и ресурсите) и изходният код на
            сайта се разпространяват под лиценза{' '}
            <a
              rel="license noreferrer"
              className={linkClasses}
              href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.bg"
              target="_blank"
            >
              Creative Commons Attribution-NonCommercial-ShareAlike 4.0
              International (CC BY-NC-SA 4.0)
            </a>
            . Пълният текст на лиценза е във файла{' '}
            <a
              rel="noreferrer"
              className={linkClasses}
              href="https://github.com/OlympiadsXYZ/olympiads-xyz/blob/HEAD/LICENSE"
              target="_blank"
            >
              LICENSE
            </a>{' '}
            в хранилището на проекта.
          </p>
          <p className="mb-2">
            Накратко, можете свободно да копирате, разпространявате и
            преработвате материалите, при условие че спазвате следното:
          </p>
          <ul className="list-disc pl-10 mb-4">
            <li>
              <strong>Признание</strong> — посочвате Olympiads XYZ като
              източник, давате линк към сайта и към лиценза и отбелязвате, ако
              сте направили промени;
            </li>
            <li>
              <strong>Некомерсиално</strong> — не използвате материалите с
              търговска цел (например в платени курсове или за продажба);
            </li>
            <li>
              <strong>Споделяне на споделеното</strong> — ако преработите
              материалите, разпространявате резултата под същия лиценз.
            </li>
          </ul>
          <p className="mb-4">
            Това резюме не замества текста на лиценза; при разминаване важи
            пълният текст.
          </p>
          <p className="mb-4">
            Условията и официалните решения на олимпиадните задачи, както и
            файловете в{' '}
            <Link to="/archive/" className={linkClasses}>
              Архива
            </Link>
            , са дело на съответните организатори и автори и авторските права
            върху тях принадлежат на тях; лицензът по-горе не се отнася за тях.
          </p>
          <p className="mb-4">
            Сайтът е изграден върху отворения код на{' '}
            <a
              rel="noreferrer"
              className={linkClasses}
              href="https://usaco.guide"
              target="_blank"
            >
              USACO Guide
            </a>
            .
          </p>
          <p className="mb-6">
            Ако имате въпроси за използването на материалите или искате да ги
            използвате извън условията на лиценза, пишете ни на{' '}
            <a href="mailto:olympiads.xyz@gmail.com" className={linkClasses}>
              olympiads.xyz@gmail.com
            </a>
            .
          </p>
          <Link
            to="/"
            className="block mb-4 underline text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            &larr; {t('license_back-to-home')}
          </Link>
        </div>
      </div>
      </main>
    </Layout>
  );
}
