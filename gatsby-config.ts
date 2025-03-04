require('dotenv').config();

const flags = {
  FAST_DEV: true,
};

const siteMetadata = {
  title: `Olympiads XYZ`,
  description: `A free comprehensive, well-organized resource from bulgarian science olympiad contenders designed to help students prepare for science olympiads, with a current focus on physics. Made by students, for students.`,
  author: `@olympiadsxyz`,
  siteUrl: `https://olympiads-xyz-bg.vercel.app/`, // TODO: change to new domain
  keywords: ['Olympiads XYZ', 'Physics', 'Student olympiads'],
};

const plugins = [
  
  {
    resolve: 'gatsby-plugin-sitemap',
    options: {
      excludes: ['/license/', '/editor/'],
    },
  },
  {
    resolve: `gatsby-plugin-typescript`,
    options: {
      allowNamespaces: true,
    },
  },
  /* any images referenced by .mdx needs to be loaded before the mdx file is loaded. */
  {
    resolve: `gatsby-source-filesystem`,
    options: {
      name: `archive`,
      path: `${__dirname}/archive`,
    },
  },
  {
    resolve: `gatsby-source-filesystem`,
    options: {
      path: `${__dirname}/src/assets`,
      name: `assets`,
    },
  },
  {
    resolve: `gatsby-source-filesystem`,
    options: {
      path: `${__dirname}/content`,
      name: `content-images`,
      ignore: [`**/*.json`, `**/*.mdx`],
    },
  },
  {
    resolve: `gatsby-source-filesystem`,
    options: {
      path: `${__dirname}/solutions`,
      name: `solution-images`,
      ignore: [`**/*.json`, `**/*.mdx`],
    },
  },
  {
    resolve: `gatsby-source-filesystem`,
    options: {
      path: `${__dirname}/content`,
      name: `content`,
    },
  },
  {
    resolve: `gatsby-source-filesystem`,
    options: {
      path: `${__dirname}/solutions`,
      name: `solutions`,
    },
  },
  {
    resolve: `gatsby-source-filesystem`,
    options: {
      path: `${__dirname}/announcements`,
      name: `announcements`,
    },
  },
  `gatsby-plugin-image`,
  `gatsby-plugin-sharp`,
  {
    resolve: `gatsby-plugin-postcss`,
  },
  `gatsby-plugin-styled-components`,
  `gatsby-plugin-react-helmet`,
  `gatsby-plugin-catch-links`,
  `gatsby-transformer-sharp`,
  {
    resolve: `gatsby-plugin-manifest`,
    options: {
      name: `Olympiads XYZ`,
      short_name: `OlympXYZ`,
      start_url: `/`,
      background_color: `#113399`,
      theme_color: `#113399`,
      display: `minimal-ui`,
      icon: `src/assets/icon.png`, // This path is relative to the root of the site.
    },
  },
  {
    resolve: `gatsby-plugin-google-gtag`,
    options: {
      trackingIds: ['G-PK3S0MFEFQ'], // TODO: change from google analytics to the new one
      pluginConfig: {
        head: false,
      },
    },
  },
  {
    resolve: '@sentry/gatsby',
    options: {
      dsn: 'https://2e28bddc353b46e7bead85347a099a04@o423042.ingest.sentry.io/5352677',
      denyUrls: [/extensions\//i, /^chrome:\/\//i],
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : {
            defaultIntegrations: false,
          }),
    },
  },
  {
    // This plugin must be placed last in your list of plugins to ensure that it can query all the GraphQL data
    resolve: 'gatsby-plugin-algolia',
    options: {
      appId: process.env.GATSBY_ALGOLIA_APP_ID,
      apiKey: process.env.ALGOLIA_API_KEY,
      queries: require('./src/utils/algolia-queries'),
      enablePartialUpdates: true,
      skipIndexing: !process.env.GATSBY_ALGOLIA_APP_ID,
    },
  },
  // devMode currently has some sketchy output
  // See https://github.com/JimmyBeldone/gatsby-plugin-webpack-bundle-analyser-v2/issues/343
  // {
  //   resolve: 'gatsby-plugin-webpack-bundle-analyser-v2',
  //   options: {
  //     devMode: false,
  //   },
  // },
  // {
  //   resolve: `gatsby-plugin-hotjar`,
  //   options: {
  //     includeInDevelopment: false, // optional parameter to include script in development
  //     id: 2173658,
  //     sv: 6,
  //   },
  // },
  `gatsby-plugin-meta-redirect`,
  // this (optional) plugin enables Progressive Web App + Offline functionality
  // To learn more, visit: https://gatsby.dev/offline
  // `gatsby-plugin-offline`,
];

module.exports = {
  flags,
  siteMetadata,
  plugins,
  graphqlTypegen: {
    generateOnBuild: true,
  },
};
