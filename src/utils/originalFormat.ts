/**
 * What an original in the archive is, from its link: a PDF, a Word document or
 * a plain-text file. A Word or text original must not be labelled "(PDF)", and
 * only a PDF opens at a page ("#page=N"; scripts/problems-to-site.mjs adds it
 * only to .pdf links). Same rule as originalFormat() in the generator.
 */
export type OriginalFormat = 'pdf' | 'word' | 'text' | 'other';

export function originalFormat(url?: string | null): OriginalFormat {
  const ext = /\.([A-Za-z0-9]+)$/
    .exec(String(url ?? '').replace(/[?#].*$/, ''))?.[1]
    ?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext && ['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'word';
  if (ext === 'txt') return 'text';
  return 'other';
}

/** The translation key of "Оригинал на условието (PDF)" for this original's format. */
export function viewStatementKey(url?: string | null): string {
  const format = originalFormat(url);
  return format === 'pdf'
    ? 'view_problem_statement'
    : `view_problem_statement_${format}`;
}

/** The translation key of "Оригинал (PDF)" for this original's format. */
export function originalLinkKey(url?: string | null): string {
  const format = originalFormat(url);
  return format === 'pdf' ? 'original-pdf' : `original-${format}`;
}
