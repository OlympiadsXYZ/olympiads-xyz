import { entryUrl, SCIENCE_LABELS } from './labels';

// Legacy module links used the site's archive rewrite as a file server. Render
// PDFs at the same hosted URL as catalog entries, including in static previews.
// Keep page routes and the exact Unicode spelling of object keys unchanged.
export function archiveHref(href: string | undefined): string | undefined {
  if (!href) return href;
  const match = href.match(/^\/archive\/([a-z]+)\/(.+\.pdf)([?#].*)?$/i);
  if (!match) return href;
  const science = match[1] === 'math' ? 'mathematics' : match[1];
  const subject = SCIENCE_LABELS[science];
  if (!subject) return href;
  try {
    const segments = match[2].split('/').map(decodeURIComponent);
    if (segments.some(s => !s || s === '.' || s === '..' || /[/\\]/.test(s))) {
      return href;
    }
    const url = entryUrl([subject, ...segments].join('/'));
    return url ? url + (match[3] || '') : href;
  } catch {
    return href;
  }
}
