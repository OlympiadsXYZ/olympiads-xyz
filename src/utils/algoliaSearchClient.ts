// Algolia is not configured for this site: GATSBY_ALGOLIA_APP_ID and
// GATSBY_ALGOLIA_SEARCH_KEY are unset in production, so this client points at
// "undefined-dsn.algolia.net" and every query fails. The site search (top bar
// search modal) and /problems no longer use it — they search static indexes
// client-side (see src/components/ProblemsPage/problemSearch.ts). Only the
// legacy editor and group problem-autocomplete components still import it.
import algoliasearch from 'algoliasearch/lite';

export const searchClient = algoliasearch(
  process.env.GATSBY_ALGOLIA_APP_ID!,
  process.env.GATSBY_ALGOLIA_SEARCH_KEY!
);

export const ALGOLIA_INDEX_NAME = process.env.GATSBY_ALGOLIA_INDEX_NAME || 'dev';

export const searchIndices = {
  modules: `${ALGOLIA_INDEX_NAME}_modules`,
  problems: `${ALGOLIA_INDEX_NAME}_problems`,
  editorFiles: `${ALGOLIA_INDEX_NAME}_editorFiles`,
};
