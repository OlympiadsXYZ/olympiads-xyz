// Pure helpers of the problems sidebar (ProblemsTree.tsx), kept free of JSX
// and Gatsby imports so the node tests can load them.

/** "1 задача", "50 задачи" */
export function problemCount(n: number, english = false): string {
  if (english) return `${n} ${n === 1 ? 'problem' : 'problems'}`;
  return `${n} ${n === 1 ? 'задача' : 'задачи'}`;
}

/**
 * The scrollTop that shows the current problem in the sidebar: the open
 * competition's row (with the year picker under it) at the top when the
 * problem's row still fits below it, else the problem's row in the middle
 * (the year picker is sticky, so it stays in view). Offsets are relative to
 * the scroll container's content.
 */
export function sidebarScrollTop({
  anchorTop,
  itemTop,
  itemHeight,
  viewHeight,
}: {
  anchorTop: number | null;
  itemTop: number;
  itemHeight: number;
  viewHeight: number;
}): number {
  if (anchorTop !== null && itemTop + itemHeight - anchorTop <= viewHeight) {
    return Math.max(0, anchorTop);
  }
  return Math.max(0, itemTop - (viewHeight - itemHeight) / 2);
}
