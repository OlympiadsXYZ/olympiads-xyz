import { Link } from 'gatsby';
import * as React from 'react';
import type { ClientEntry } from '../../archive/catalog-node';
import {
  competitionName,
  competitionShort,
  plural,
  ROUND_ORDER,
  roundLabel,
  SCIENCE_COLORS,
  SCIENCE_LABELS,
} from '../../archive/labels';
import { Crumbs, EntryList } from '../../components/Archive/ArchiveUI';
import TopNavigationBar from '../../components/TopNavigationBar/TopNavigationBar';
import Layout from '../../components/layout';
import SEO from '../../components/seo';

type Props = {
  pageContext: {
    science: string;
    competition: string;
    slug: string;
    year: number;
    entries: ClientEntry[];
    prevYear: number | null;
    nextYear: number | null;
  };
};

// „Национална олимпиада по астрономия 2025 (НОА): оригиналните условия,
// решения и протоколи — I кръг, II кръг, III кръг. 12 задачи са и на сайта.“
function yearDescription(competition: string, year: number, entries: ClientEntry[]): string {
  const kinds: string[] = [];
  const has = (...types: string[]) => entries.some(e => types.includes(e.type));
  if (has('problems')) kinds.push('условия');
  if (has('solutions', 'answers', 'criteria')) kinds.push('решения');
  if (has('results')) kinds.push('протоколи');
  const what = kinds.length
    ? kinds.length > 1
      ? `${kinds.slice(0, -1).join(', ')} и ${kinds[kinds.length - 1]}`
      : kinds[0]
    : 'материали';
  const rounds = [...new Set(entries.map(e => e.round).filter((r): r is string => !!r))]
    .sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
    .map(r => roundLabel(r, competition));
  const onSite = new Map<string, number>();
  entries.forEach(e => {
    if (e.onSite) onSite.set(e.onSite.url, e.onSite.count);
  });
  const problems = [...onSite.values()].reduce((a, b) => a + b, 0);
  return (
    `${competitionName(competition)} ${year} (${competitionShort(competition)}): оригиналните ${what}` +
    (rounds.length ? ` — ${rounds.join(', ')}.` : '.') +
    (problems ? ` ${plural(problems, 'задача е', 'задачи са')} и на сайта, с решения.` : '')
  );
}

export default function ArchiveYearTemplate({ pageContext }: Props): JSX.Element {
  const { science, competition, slug, year, entries, prevYear, nextYear } = pageContext;
  const scienceName = SCIENCE_LABELS[science] ?? science;
  const colors = SCIENCE_COLORS[science] ?? { bg: 'bg-gray-700', text: 'text-gray-100' };
  const description = yearDescription(competition, year, entries);

  return (
    <Layout>
      <SEO
        title={`Архив · ${scienceName} · ${competitionShort(competition)} ${year}`}
        description={description}
        pathname={`/archive/${science}/${slug}/${year}/`}
      />
      <div className="min-h-screen bg-gray-100 dark:bg-dark-surface">
        <TopNavigationBar />
        <main>
        <div className={`${colors.bg} py-10 px-5`}>
          <div className="max-w-5xl mx-auto flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-3xl sm:text-4xl font-black text-white">
              {competitionShort(competition)} {year}
            </h1>
            <div className="flex gap-2 text-sm">
              {prevYear && (
                <Link
                  to={`/archive/${science}/${slug}/${prevYear}/`}
                  className={`${colors.text} hover:underline`}
                >
                  ← {prevYear}
                </Link>
              )}
              {nextYear && (
                <Link
                  to={`/archive/${science}/${slug}/${nextYear}/`}
                  className={`${colors.text} hover:underline`}
                >
                  {nextYear} →
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-5 py-8">
          <Crumbs
            parts={[
              { name: 'Архив', href: '/archive/' },
              { name: scienceName, href: `/archive/${science}/` },
              { name: competitionName(competition), href: `/archive/${science}/${slug}/` },
              { name: String(year) },
            ]}
          />
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <EntryList
              entries={entries}
              groupByRound
              competition={competition}
              cutTitles
            />
          </div>
        </div>
        </main>
      </div>
    </Layout>
  );
}
