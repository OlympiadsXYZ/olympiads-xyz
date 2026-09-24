import { Dialog, Transition } from '@headlessui/react';
import { graphql, useStaticQuery } from 'gatsby';
import React, { Fragment, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import MODULE_ORDERING, {
  SECTION_LABELS,
  SectionID,
} from '../../../content/ordering';
import type { SearchModule } from './SearchModalInterface';

const SearchModalInterface = React.lazy(() => import('./SearchModalInterface'));

type SearchModulesQuery = {
  allXdm: {
    nodes: {
      frontmatter: {
        id: string;
        title: string | null;
        description: string | null;
      } | null;
      fields: { division: string | null } | null;
    }[];
  };
};

/**
 * The module pages the search modal looks through: title and description
 * (a few KB), plus the section and chapters that list each module.
 */
function useSearchModules(): SearchModule[] {
  const data: SearchModulesQuery = useStaticQuery(graphql`
    query {
      allXdm(filter: { fileAbsolutePath: { regex: "/content/" } }) {
        nodes {
          frontmatter {
            id
            title
            description
          }
          fields {
            division
          }
        }
      }
    }
  `);
  return React.useMemo(() => {
    const chapters: { [id: string]: string[] } = {};
    Object.values(MODULE_ORDERING).forEach(section =>
      section.forEach(chapter =>
        chapter.items.forEach(id => {
          chapters[id] = [...new Set([...(chapters[id] ?? []), chapter.name])];
        })
      )
    );
    return (data?.allXdm?.nodes ?? []).flatMap(({ frontmatter, fields }) => {
      const division = fields?.division as SectionID | null | undefined;
      if (!frontmatter?.id || !frontmatter.title || !division) return [];
      return [
        {
          id: frontmatter.id,
          title: frontmatter.title,
          description: frontmatter.description ?? '',
          url: `/${division}/${frontmatter.id}`,
          section: SECTION_LABELS[division] ?? division,
          chapters: chapters[frontmatter.id] ?? [],
        },
      ];
    });
  }, [data]);
}

export interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const modules = useSearchModules();
  // Dialog throws an error if there isn't something to focus on initially
  // But since we're lazy loading search modal, there will be a period of time
  // where we have to focus the loading text until the modal loads (and auto focuses the input).
  const loadingFocusRef = React.useRef(null);

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        static
        // z-20 is on the top navigation bar
        className="fixed z-30 inset-0 overflow-y-auto"
        open={isOpen}
        onClose={() => onClose()}
        initialFocus={loadingFocusRef}
      >
        <div className="min-h-screen text-center sm:p-0">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Dialog.Overlay className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-gray-900 dark:bg-opacity-75 transition-opacity" />
          </Transition.Child>

          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            enterTo="opacity-100 translate-y-0 sm:scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 translate-y-0 sm:scale-100"
            leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
          >
            <div className="inline-block bg-white dark:bg-dark-surface rounded-lg text-left overflow-hidden shadow-xl transform transition-all my-8 sm:my-16 sm:align-middle sm:max-w-lg w-full">
              <Suspense
                fallback={
                  <p
                    className="px-5 py-4 text-gray-700 dark:text-gray-300"
                    ref={loadingFocusRef}
                  >
                    {t('loading-search')}...
                  </p>
                }
              >
                <SearchModalInterface modules={modules} onClose={onClose} />
              </Suspense>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  );
};
