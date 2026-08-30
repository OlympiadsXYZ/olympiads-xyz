export type ArchiveItem = {
  title: string;
  path: string;
};

export type ArchiveSubsection = {
  name: string;
  sections?: ArchiveSection[];
  items?: ArchiveItem[];
  subsections?: ArchiveSubsection[];
};

export type ArchiveSection = ArchiveSubsection;

export const ARCHIVE_DATA: Record<string, ArchiveSection> = {};
