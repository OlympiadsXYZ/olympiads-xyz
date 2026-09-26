// The file format of an original in the archive, read from its URL: most are
// PDFs, but ~650 papers were transcribed from Word documents and plain-text
// files. The label of the original's link names the format, and the compare
// panel embeds only what a browser can show in a frame (a Word file would
// download instead).

export type OriginalFormat = 'pdf' | 'word' | 'text' | 'image' | 'other';

const EXTENSIONS: { [ext: string]: OriginalFormat } = {
  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  odt: 'word',
  rtf: 'word',
  txt: 'text',
  tex: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
};

/** "…/2004/st_sen2.doc#page=2" -> "word"; a URL without a known extension -> "other". */
export function originalFormat(url: string | null | undefined): OriginalFormat {
  const file = String(url ?? '')
    .split('#')[0]
    .split('?')[0]
    .split('/')
    .pop();
  const dot = file ? file.lastIndexOf('.') : -1;
  if (!file || dot === -1) return 'other';
  return EXTENSIONS[file.slice(dot + 1).toLowerCase()] ?? 'other';
}

/** Can a browser show this format in an iframe (the compare panel)? */
export function isEmbeddable(format: OriginalFormat): boolean {
  return format === 'pdf' || format === 'text' || format === 'image';
}

/**
 * A URL for an iframe: a '#page=N' fragment only means something to a PDF
 * viewer, so any other format drops it.
 */
export function embedUrl(url: string, format: OriginalFormat): string {
  return format === 'pdf' ? url : url.split('#')[0];
}
