import { useLocation } from '@gatsbyjs/reach-router';
import { graphql, useStaticQuery } from 'gatsby';
import PropTypes from 'prop-types';
import React from 'react';
import { Helmet } from 'react-helmet';

const OG_LOCALES = { bg: 'bg_BG', en: 'en_US' };

function SEO({
  description,
  lang = 'bg',
  meta,
  image: metaImage,
  title,
  pathname,
}) {
  const location = useLocation();
  const { site, image: defaultImage } = useStaticQuery(graphql`
    query {
      site {
        siteMetadata {
          title
          description
          author
          keywords
          siteUrl
        }
      }
      image: file(relativePath: { eq: "social-media-image.png" }) {
        childImageSharp {
          resize(width: 1200, quality: 100) {
            src
            height
            width
          }
        }
      }
    }
  `);
  if (!metaImage) {
    metaImage = defaultImage.childImageSharp.resize;
  }

  const siteUrl = site.siteMetadata.siteUrl.replace(/\/$/, '');
  // Without an explicit `pathname` the page's own URL is canonical. During SSR
  // this is the path the page was created with, i.e. the URL the sitemap
  // lists, so each page keeps its own trailing-slash convention.
  const path = pathname || location.pathname || '/';
  let normalizedPathname = path.startsWith('/') ? path : `/${path}`;
  // SSR sees the raw path (Cyrillic problem ids) and the browser the
  // percent-encoded one: emit the encoded form in both cases.
  try {
    normalizedPathname = encodeURI(decodeURI(normalizedPathname));
  } catch {
    // malformed escape sequence: keep the path as it is
  }
  const metaDescription = description || site.siteMetadata.description;
  const image =
    metaImage && metaImage.src ? `${siteUrl}${metaImage.src}` : null;
  const canonical = `${siteUrl}${normalizedPathname}`;
  return (
    <Helmet
      htmlAttributes={{
        lang,
      }}
      title={title}
      titleTemplate={`%s · ${site.siteMetadata.title}`}
      defaultTitle={site.siteMetadata.title}
      link={[
        {
          rel: 'canonical',
          href: canonical,
        },
      ]}
      meta={[
        {
          name: `description`,
          content: metaDescription,
        },
        {
          name: 'keywords',
          content: site.siteMetadata.keywords.join(','),
        },
        {
          property: `og:title`,
          content: title || 'Olympiads XYZ',
        },
        {
          property: `og:description`,
          content: metaDescription,
        },
        {
          property: `og:site_name`,
          content: 'Olympiads XYZ',
        },
        {
          property: `og:url`,
          content: canonical,
        },
        {
          property: `og:type`,
          content: `website`,
        },
        {
          property: `og:locale`,
          content: OG_LOCALES[lang] || lang,
        },
        {
          name: `twitter:creator`,
          content: site.siteMetadata.author,
        },
        {
          name: `twitter:title`,
          content: title || 'Olympiads XYZ',
        },
        {
          name: `twitter:description`,
          content: metaDescription,
        },
      ]
        .concat(
          metaImage
            ? [
                {
                  property: 'og:image',
                  content: image,
                },
                {
                  property: 'og:image:width',
                  content: metaImage.width,
                },
                {
                  property: 'og:image:height',
                  content: metaImage.height,
                },
                {
                  name: 'twitter:image',
                  content: image,
                },
                {
                  name: 'twitter:card',
                  content: 'summary_large_image',
                },
              ]
            : [
                {
                  name: 'twitter:card',
                  content: 'Olympiads XYZ',
                },
              ]
        )
        .concat(meta)}
    />
  );
}
SEO.defaultProps = {
  lang: `bg`,
  meta: [],
  description: ``,
};
SEO.propTypes = {
  description: PropTypes.string,
  lang: PropTypes.string,
  meta: PropTypes.arrayOf(PropTypes.object),
  title: PropTypes.string,
  image: PropTypes.shape({
    src: PropTypes.string.isRequired,
    height: PropTypes.number.isRequired,
    width: PropTypes.number.isRequired,
  }),
  pathname: PropTypes.string,
};
export default SEO;

// /**
//  * SEO component that queries for data with
//  *  Gatsby's useStaticQuery React hook
//  *
//  * See: https://www.gatsbyjs.org/docs/use-static-query/
//  */
//
// import * as React from 'react';
// import { Helmet } from 'react-helmet';
// import { useStaticQuery, graphql } from 'gatsby';
//
// function SEO({ description = '', lang = 'en', meta = [], title }) {
//   const { site } = useStaticQuery(
//     graphql`
//       query {
//         site {
//           siteMetadata {
//             title
//             description
//             author
//           }
//         }
//       }
//     `
//   );
//
//   const metaDescription = description || site.siteMetadata.description;
//
//   return (
//     <Helmet
//       htmlAttributes={{
//         lang,
//       }}
//       title={title}
//       titleTemplate={`%s | ${site.siteMetadata.title}`}
//       defaultTitle={site.siteMetadata.title}
//       meta={[
//         {
//           name: `description`,
//           content: metaDescription,
//         },
//         {
//           property: `og:title`,
//           content: title,
//         },
//         {
//           property: `og:description`,
//           content: metaDescription,
//         },
//         {
//           property: `og:type`,
//           content: `website`,
//         },
//         {
//           name: `twitter:card`,
//           content: `summary`,
//         },
//         {
//           name: `twitter:creator`,
//           content: site.siteMetadata.author,
//         },
//         {
//           name: `twitter:title`,
//           content: title,
//         },
//         {
//           name: `twitter:description`,
//           content: metaDescription,
//         },
//       ].concat(meta)}
//     />
//   );
// }
//
// export default SEO;
