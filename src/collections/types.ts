export type CollectionBody = {
  file: string;
  sha256: string;
  bytes: number;
};

export type CollectionAnnualLink = {
  language: string;
  label: string;
  url: string;
  primary: boolean;
};

export type CollectionChapter = {
  id: string;
  title: string;
  number: number;
  keyNumber: number;
  questionNativePages: number[];
  keyNativePages: number[];
  contextBlocks?: CollectionContextBlock[];
};

export type CollectionNativeAsset = {
  id: string;
  role: 'question' | 'key';
  nativePage: number;
  width: number;
  height: number;
  original: CollectionBody;
  privateCopy: CollectionBody;
  url: string;
  sourceBinding: { container: CollectionBody; pointer: string };
  display: 'already-in-body' | 'append-to-body' | 'detail-only';
};

export type CollectionContextBlock = {
  id: string;
  placement: 'prefix' | 'suffix' | 'before-question' | 'before-key';
  taskId: string | null;
  nativePages: number[];
  body: CollectionBody;
};

export type CollectionTask = {
  id: string;
  chapterId: string;
  section: string;
  printedNumber: string;
  printedTags: string[];
  questionNativePages: number[];
  keyNativePages: number[];
  sourceTask: { container: CollectionBody; pointer: string };
  annualCorrespondence:
    | { status: 'unestablished'; links: []; evidence: null }
    | {
        status: 'same-original' | 'edited-variant';
        links: CollectionAnnualLink[];
        evidence: CollectionBody;
      };
  nativeAssets?: CollectionNativeAsset[];
  presentation: null | {
    question: CollectionBody;
    key: CollectionBody;
    completeSourceNoLoss: CollectionBody;
  };
};

export type CollectionDocument = {
  version: 1;
  collection: {
    id: string;
    title: string;
    subject: string;
    competition: string;
    language: string;
    edition: 'edited-compilation';
    contestYear: null;
    round: null;
    publicationYear: number | null;
    publicationYearEvidence: CollectionBody | null;
    contestYears: number[];
  };
  source: {
    document: CollectionBody;
    publicUrl: string | null;
    pageCount: number;
    attribution: string;
    printedConditions: string;
    conditionsEvidence: CollectionBody;
  };
  chapters: CollectionChapter[];
  tasks: CollectionTask[];
  introduction: CollectionBody | null;
  referenceAppendix: CollectionBody | null;
};

// One result for a collection. Chapter pages and their tasks are deliberately
// outside ProblemsIndexEntry, problem progress and the annual language groups.
export type CollectionSearchEntry = {
  id: string;
  kind: 'collection';
  title: string;
  url: string;
  subject: string;
  competition: string;
  language: string;
  publicationYear: number | null;
  contestYears: number[];
  chapterTitles: string[];
  taskCount: number;
  printedTags: string[];
};

export type CollectionPageContext = {
  id: string;
  collection: CollectionSearchEntry;
  attribution: string;
  printedConditions: string;
  chapters: { id: string; title: string; url: string }[];
  chapterId: string | null;
  taskSections: {
    section: string;
    tasks: { id: string; printedNumber: string; printedTags: string[] }[];
  }[];
};
