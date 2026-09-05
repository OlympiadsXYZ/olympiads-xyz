import { ExternalLinkIcon, XIcon } from '@heroicons/react/solid';
import classNames from 'classnames';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useProblemSolutions } from '../../context/ProblemSolutionContext';
import {
  CompareDoc,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  useComparePanel,
} from './ComparePanelContext';

/** "…/2019/NOF3_2019_9problems.pdf" -> "NOF3_2019_9problems.pdf" */
export function pdfFileName(url: string): string {
  const last = url.split('#')[0].split('?')[0].split('/').pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// Sticks to the top of the viewport for the whole height. Below lg the
// MobileAppBar (h-12 + pt-1) is sticky at the top too, so start under it.
const STICKY_FULL_HEIGHT =
  'sticky top-[3.25rem] h-[calc(100vh-3.25rem)] lg:top-0 lg:h-screen';

/**
 * The right-hand half of the split view on a problem page: a draggable
 * vertical divider followed by a full-height panel with the original PDF
 * (problems, or the official solutions when the paper has them) in an iframe.
 *
 * Rendered by MarkdownLayout's ContentContainer as flex siblings of the
 * content column, so `containerRef` must point at that flex container: the
 * divider converts pointer positions into a percentage of its width.
 */
export default function ComparePanel({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLElement>;
}): JSX.Element {
  const { t } = useTranslation();
  const { problem } = useProblemSolutions();
  const compare = useComparePanel();
  const [isDragging, setIsDragging] = React.useState(false);
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);

  const hasSolutions = !!problem.solutionUrl;
  const doc: CompareDoc =
    compare.doc === 'solutions' && hasSolutions ? 'solutions' : 'problems';
  const url =
    doc === 'solutions' && problem.solutionUrl
      ? problem.solutionUrl
      : problem.url;
  const fileName = pdfFileName(url);
  const docLabel =
    doc === 'solutions'
      ? t('compare_solutions_pdf')
      : t('compare_problems_pdf');

  // --- divider: mouse + touch drag, keyboard arrows ---
  const startDrag = (getX: (e: MouseEvent | TouchEvent) => number | null) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setIsDragging(true);
    const onMove = (e: MouseEvent | TouchEvent) => {
      const x = getX(e);
      if (x === null) return;
      compare.setWidth(((rect.right - x) / rect.width) * 100);
    };
    const stop = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchend', stop);
      window.removeEventListener('touchcancel', stop);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchend', stop);
    window.addEventListener('touchcancel', stop);
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startDrag(ev => ('clientX' in ev ? ev.clientX : null));
  };
  const onTouchStart = () => {
    startDrag(ev =>
      'touches' in ev && ev.touches.length > 0 ? ev.touches[0].clientX : null
    );
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    // the panel is on the right: ArrowLeft moves the divider left = wider panel
    if (e.key === 'ArrowLeft') compare.setWidth(compare.width + step);
    else if (e.key === 'ArrowRight') compare.setWidth(compare.width - step);
    else if (e.key === 'Home') compare.setWidth(MIN_PANEL_WIDTH);
    else if (e.key === 'End') compare.setWidth(MAX_PANEL_WIDTH);
    else return;
    e.preventDefault();
  };

  React.useEffect(() => {
    if (!isDragging) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    return () => {
      document.body.style.cursor = prev;
    };
  }, [isDragging]);

  const segmentClass = (active: boolean) =>
    classNames(
      'px-2.5 py-1 text-xs font-medium rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition',
      active
        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
    );
  const iconButtonClass =
    'p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('compare_resize_handle')}
        aria-valuenow={compare.width}
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={MAX_PANEL_WIDTH}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onKeyDown={onKeyDown}
        className={classNames(
          STICKY_FULL_HEIGHT,
          'group z-10 w-3 -mx-1.5 flex-shrink-0 flex justify-center cursor-col-resize select-none touch-none focus:outline-none'
        )}
      >
        <div
          className={classNames(
            'h-full transition-colors',
            isDragging
              ? 'w-0.5 bg-blue-500'
              : 'w-px bg-gray-200 dark:bg-gray-700 group-hover:w-0.5 group-hover:bg-blue-500 group-focus-visible:w-0.5 group-focus-visible:bg-blue-500'
          )}
        />
      </div>

      <aside
        aria-label={`${t('compare_with_original')}: ${docLabel}`}
        className={classNames(
          STICKY_FULL_HEIGHT,
          'flex-shrink-0 flex flex-col min-w-0 bg-gray-50 dark:bg-gray-900'
        )}
        style={{ width: `${compare.width}%` }}
      >
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-dark-surface">
          <div
            role="group"
            aria-label={t('compare_with_original')}
            className="flex-shrink-0 inline-flex p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800"
          >
            <button
              type="button"
              aria-pressed={doc === 'problems'}
              onClick={() => compare.setDoc('problems')}
              className={segmentClass(doc === 'problems')}
            >
              {t('compare_problems_pdf')}
            </button>
            {hasSolutions && (
              <button
                type="button"
                aria-pressed={doc === 'solutions'}
                onClick={() => compare.setDoc('solutions')}
                className={segmentClass(doc === 'solutions')}
              >
                {t('compare_solutions_pdf')}
              </button>
            )}
          </div>
          <span
            className="flex-1 min-w-0 truncate text-xs text-gray-500 dark:text-gray-400"
            title={fileName}
          >
            {fileName}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={t('compare_open_new_tab')}
            title={t('compare_open_new_tab')}
            className={iconButtonClass}
          >
            <ExternalLinkIcon className="h-4 w-4" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={compare.close}
            aria-label={t('compare_close')}
            title={t('compare_close')}
            className={iconButtonClass}
          >
            <XIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="relative flex-1 min-h-0">
          {/* Behind the iframe: visible when the browser leaves the frame
              blank (no PDF viewer) or refuses to embed the file. */}
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>
              {t('compare_embed_fallback')}{' '}
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="underline text-blue-600 dark:text-blue-400"
              >
                {t('compare_embed_fallback_link')}
              </a>
            </p>
          </div>
          {failedUrl !== url && (
            <iframe
              key={url}
              src={url}
              title={`${docLabel} — ${fileName}`}
              loading="lazy"
              onError={() => setFailedUrl(url)}
              className={classNames(
                'absolute inset-0 w-full h-full border-0',
                // an iframe swallows mouse events, which would end the drag
                isDragging && 'pointer-events-none'
              )}
            />
          )}
        </div>
      </aside>
    </>
  );
}
