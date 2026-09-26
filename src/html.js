import React from 'react';

// Inter is self-hosted (static/fonts, built by scripts/subset-inter.py): the
// 4.1 variable font cut to weights 400-900 and split by unicode-range, so a
// page downloads only the scripts it prints (the core file for most). The
// ranges must match RANGES in the script (scripts/tests/fonts.test.mjs checks).
// The file names carry the version because /fonts/* is served immutable.
const INTER_VERSION = '4.1';
const INTER_RANGES = {
  core: 'U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+0400-045F,U+0490-0491,U+2000-206F,U+20AC,U+2116,U+2122,U+2212',
  symbols:
    'U+0370-03FF,U+2070-209F,U+20A0-20AB,U+20AD-20CF,U+2100-2115,U+2117-2121,U+2123-214F,U+2150-218F,U+2190-21FF,U+2200-2211,U+2213-22FF,U+2460-24FF,U+25A0-25FF,U+2605,U+2713,U+2717,U+2756',
  ext: 'U+0100-0130,U+0132-0151,U+0154-024F,U+0250-02C5,U+02C7-02D9,U+02DB,U+02DD-02FF,U+0300-036F,U+0460-048F,U+0492-052F,U+1D00-1DBF,U+1E00-1EFF',
};
const interFile = (style, part) =>
  `/fonts/inter-${INTER_VERSION}-${style}-${part}.woff2`;
const INTER_FONT_FACES = [
  ['normal', 'roman'],
  ['italic', 'italic'],
]
  .flatMap(([fontStyle, style]) =>
    Object.entries(INTER_RANGES).map(([part, range]) => {
      const src = interFile(style, part);
      return (
        `@font-face{font-family:'Inter var';font-style:${fontStyle};font-weight:400 900;font-display:swap;` +
        `src:url(${src}) format('woff2');unicode-range:${range}}`
      );
    })
  )
  .join('\n');

export default function HTML(props) {
  return (
    <html {...props.htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="x-ua-compatible" content="ie=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <link
          rel="preload"
          href={interFile('roman', 'core')}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <style dangerouslySetInnerHTML={{ __html: INTER_FONT_FACES }} />
        {props.headComponents}
        {/* Appzi: Capture Insightful Feedback */}
        {/*<script*/}
        {/*  async*/}
        {/*  src="https://w.appzi.io/bootstrap/bundle.js?token=iIhbb"*/}
        {/*/>*/}
        {/* End Appzi */}
      </head>
      <body {...props.bodyAttributes}>
        {props.preBodyComponents}
        <div
          key={`body`}
          id="___gatsby"
          dangerouslySetInnerHTML={{ __html: props.body }}
        />
        {props.postBodyComponents}
      </body>
    </html>
  );
}
