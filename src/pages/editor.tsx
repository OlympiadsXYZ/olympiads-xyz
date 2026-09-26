// import * as React from 'react';

// export default function Placeholder() {
//   return (
//     <div data-testid="build-placeholder">
//       This placeholder greatly speeds up build times. Uncomment this code and
//       comment out everything below it. Make sure to undo before pushing.
//     </div>
//   );
// }

import { Link, PageProps } from 'gatsby';
import React, { useEffect, useState } from 'react';
import EditorPage from '../components/Editor/EditorPage';
import Layout from '../components/layout';
import SEO from '../components/seo';
import TopNavigationBar from '../components/TopNavigationBar/TopNavigationBar';

// The editor's split panes need at least 768px (EditorPage's min-w-[768px]);
// narrower screens get a notice instead of a page wider than the phone.
const EDITOR_MEDIA_QUERY = '(min-width: 768px)';

function EditorNeedsWideScreen(): JSX.Element {
  return (
    <Layout>
      <SEO title="Редактор" />
      <TopNavigationBar />
      <main className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-dark-high-emphasis">
          Редакторът работи на компютър
        </h1>
        <p className="mt-4 text-gray-600 dark:text-dark-med-emphasis">
          Редакторът на модули има нужда от широк екран. Отворете тази
          страница на компютър или таблет в хоризонтално положение. Модулите
          и задачите можете да четете и на телефон.
        </p>
        <p className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link
            to="/general/editor-work-mdx/"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Как се пише модул
          </Link>
          <Link to="/" className="text-blue-600 dark:text-blue-400 hover:underline">
            Към началната страница
          </Link>
        </p>
      </main>
    </Layout>
  );
}

export default function EditorPageContainer(
  props: PageProps
): JSX.Element | null {
  const [isWide, setIsWide] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia(EDITOR_MEDIA_QUERY);
    const update = () => setIsWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  if (isWide === null) return null;
  if (!isWide) return <EditorNeedsWideScreen />;
  return <EditorPage {...props} />;
}
