// import algoliasearch from 'algoliasearch/lite';

// export const searchClient = algoliasearch(
//   'XCYSY3AE5Z',
//   'de93117196cbb647e623acf36f4366e3'
// );
// TODO: add data to the algolia indicies 
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
