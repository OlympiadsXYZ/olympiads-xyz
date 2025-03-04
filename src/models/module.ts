import { BaseHit, Hit } from 'instantsearch.js';
import { SectionID } from '../../content/ordering';
import { useTranslation } from 'react-i18next';
import '../i18n';

export type MarkdownLayoutSidebarModuleLinkInfo = {
  id: string;
  section: SectionID;
  title: string;
  url: string;
};

export class ModuleLinkInfo {
  public url: string;

  constructor(
    public id: string,
    public section: SectionID,
    public title: string,
    public description?: string | null,
    public frequency?: ModuleFrequency,
    public isIncomplete?: boolean | null,
    public cppOc: number | null = 0,
    public javaOc: number | null = 0,
    public pyOc: number | null = 0,
    public gitAuthorTime?: any,
    public probs?: any
  ) {
    if (this.id === 'editor-work-mdx') {
      // The "Using This Guide" module is complete already, but it contains an <IncompleteModule> tag
      // We want to ignore it and manually mark it as complete
      this.isIncomplete = false;
    }
    this.url = `/${section}/${id}`;
  }
}

export type ModuleFrequency = 0 | 1 | 2 | 3 | 4;

export type TOCHeading = {
  depth: number;
  value: string;
  slug: string;
};

export type TableOfContents = {
  cpp: TOCHeading[];
  java: TOCHeading[];
  py: TOCHeading[];
};

export class ModuleInfo extends ModuleLinkInfo {
  constructor(
    public id: string,
    public section: SectionID,
    public title: string,
    public body: any,
    public author: string,
    public contributors: string,
    public prerequisites: string[],
    public description: string,
    public frequency: ModuleFrequency,
    public toc: TableOfContents,
    public fileRelativePath: string,
    public gitAuthorTime: any
  ) {
    super(id, section, title);
  }
}

export type ModuleProgress =
  | 'Not Started'
  | 'Reading'
  | 'Practicing'
  | 'Complete'
  | 'Skipped'
  | 'Ignored';

export const ModuleProgressOptions: ModuleProgress[] = [
  'Not Started',
  'Reading',
  'Practicing',
  'Complete',
  'Skipped',
  'Ignored',
];

export type AlgoliaModuleInfo = {
  title: string;
  description: string;
  content: string;
  id: string;
  division: SectionID;
};

export type AlgoliaModuleInfoHit = Hit<BaseHit> & AlgoliaModuleInfo;
