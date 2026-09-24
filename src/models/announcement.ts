const BG_MONTHS: { [prefix: string]: string } = {
  jan: 'януари',
  feb: 'февруари',
  mar: 'март',
  apr: 'април',
  may: 'май',
  jun: 'юни',
  jul: 'юли',
  aug: 'август',
  sep: 'септември',
  oct: 'октомври',
  nov: 'ноември',
  dec: 'декември',
};

/**
 * Announcement dates are free-form English frontmatter strings such as
 * 'Aug 30, 2026', 'Sept 5, 2021' or 'March 14-16, 2025' (the ranges are why
 * they are not real dates). Print them in Bulgarian ('30 август 2026 г.',
 * '14–16 март 2025 г.') by hand rather than through Date/Intl, so the build
 * and every browser render exactly the same text. Anything unrecognised is
 * returned unchanged.
 */
export function formatAnnouncementDate(raw: string): string {
  const match =
    /^([A-Za-z]+)\.?\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?,\s*(\d{4})$/.exec(
      raw.trim()
    );
  const month = match && BG_MONTHS[match[1].slice(0, 3).toLowerCase()];
  if (!match || !month) return raw;
  const days = match[3] ? `${match[2]}–${match[3]}` : match[2];
  return `${days} ${month} ${match[4]} г.`;
}

export class AnnouncementInfo {
  constructor(
    public id: string,
    public title: string,
    // raw frontmatter string; the dashboard reads the year from it
    public date: string,
    public body: any
  ) {}

  get displayDate(): string {
    return formatAnnouncementDate(this.date);
  }
}

export function graphqlToAnnouncementInfo(mdx: any): AnnouncementInfo {
  return new AnnouncementInfo(
    mdx.frontmatter.id,
    mdx.frontmatter.title,
    mdx.frontmatter.date,
    mdx.body
  );
}
