/**
 * Translation keys for the link to an original in the archive, by its format
 * (a PDF, a Word document, a plain-text file, an image): a Word or text
 * original must not be labelled "(PDF)". The format itself is read by
 * originalFormat() in components/ComparePanel/originalFormat.ts; only a PDF
 * opens at a page ("#page=N"; scripts/problems-to-site.mjs adds it only to
 * .pdf links).
 */
import { originalFormat } from '../components/ComparePanel/originalFormat';

export { originalFormat };
export type { OriginalFormat } from '../components/ComparePanel/originalFormat';

/** The translation key of "Оригинал на условието (PDF)" for this original's format. */
export function viewStatementKey(url?: string | null): string {
  const format = originalFormat(url);
  return format === 'pdf'
    ? 'view_problem_statement'
    : `original_statement_${format}`;
}

/** The translation key of "Оригинал (PDF)" for this original's format. */
export function originalLinkKey(url?: string | null): string {
  return `original-${originalFormat(url)}`;
}
