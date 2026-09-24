// organize-imports-ignore
// note that reordering the css file imports will break some styles
import { wrapRootElement as wrap } from './root-wrapper';
import 'katex/dist/katex.min.css';
import './src/styles/main.css';
import { injectSpeedInsights } from '@vercel/speed-insights';
import i18n from './src/i18n';
import { LANGUAGE_STORAGE_KEY } from './src/components/LanguageSwitcher';
// import './build.css';

export const wrapRootElement = wrap;

export const onClientEntry = () => {
  // Source (modified): https://github.com/KaTeX/KaTeX/blob/master/contrib/copy-tex/copy-tex.js

  // Global copy handler to modify behavior on .katex elements.
  document.addEventListener('copy', function (event) {
    const selection = window.getSelection();
    if (selection.isCollapsed) {
      return; // default action OK if selection is empty
    }
    const fragment = selection.getRangeAt(0).cloneContents();
    if (fragment.querySelectorAll('[data-latex]').length === 0) {
      return; // the following code breaks copy-pasting of code blocks; see #464
    }
    // Preserve usual HTML copy/paste behavior.
    const html = [];
    for (let i = 0; i < fragment.childNodes.length; i++) {
      html.push((fragment.childNodes[i] as HTMLElement).outerHTML);
    }
    event.clipboardData.setData('text/html', html.join(''));

    const katexElements = fragment.querySelectorAll('[data-latex]');
    for (let i = 0; i < katexElements.length; i++) {
      const element = katexElements[i];
      element.innerHTML = (element as any).dataset.latex;
    }

    const displayElements = fragment.querySelectorAll('.katex-display');
    for (let i = 0; i < displayElements.length; i++) {
      const element = displayElements[i];
      // fromCharCode(13) = newline
      element.innerHTML =
        String.fromCharCode(13) + element.innerHTML + String.fromCharCode(13);
    }

    const plaintext = Array.from(fragment.childNodes)
      .map(node => node.textContent)
      .join(String.fromCharCode(13));

    // Rewrite plain-text version.
    event.clipboardData.setData('text/plain', plaintext);
    // Prevent normal copy handling.
    event.preventDefault();
  });

  // Vercel Web Analytics is loaded by the script tag gatsby-ssr.tsx puts in every page; inject() loaded it a
  // second time (two requests for /_vercel/insights/script.js on each page view)
  injectSpeedInsights();
};

// The interface language picked in the switcher. Applied after hydration, so the first client render matches the
// Bulgarian HTML of the static build.
export const onInitialClientRender = () => {
  try {
    const lang = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (lang && lang !== i18n.language && ['bg', 'en'].includes(lang)) {
      i18n.changeLanguage(lang);
    }
  } catch (e) {
    // storage unavailable
  }
};
