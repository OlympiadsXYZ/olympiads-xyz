// Named supplementary PDFs retain their own source identity, pages and hashes.
// Never concatenate them into the problems PDF and attribute them to its key.
export const SUPPLEMENT_ID = /^supplement-[1-9][0-9]*$/;
export const isDocumentId = id => id === 'problems' || id === 'solutions' || SUPPLEMENT_ID.test(id);

export function supplementKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('supplements must be an object mapping supplement-N to an archive key');
  const keys = {};
  for (const [id, entry] of Object.entries(value)) {
    const key = typeof entry === 'string' ? entry : entry?.archiveKey;
    if (!SUPPLEMENT_ID.test(id) || typeof key !== 'string' || !key.trim()) throw new Error(`invalid supplement ${id}`);
    keys[id] = key;
  }
  return keys;
}

export function supplementarySourceErrors(candidate, manifest) {
  const errors = [];
  const sources = candidate.paper?.supplementarySources || {};
  for (const [id, rawSource] of Object.entries(sources)) {
    const source = rawSource || {};
    const doc = manifest?.documents?.[id];
    const field = `/paper/supplementarySources/${id}`;
    if (!SUPPLEMENT_ID.test(id)) errors.push({ path: field, message: 'invalid supplementary document id' });
    if (!Array.isArray(source.pages) || !source.pages.length || new Set(source.pages).size !== source.pages.length) errors.push({ path: field, message: 'supplementary pages must be a nonempty list of distinct page numbers' });
    if (manifest && (!doc || source.archiveKey !== doc.key)) errors.push({ path: field, message: 'does not match a prepared supplementary document' });
    for (const pg of Array.isArray(source.pages) ? source.pages : []) if (!Number.isInteger(pg) || pg < 1 || (doc && pg > doc.pages)) errors.push({ path: field, message: `page ${pg} outside ${id}` });
  }
  for (const id of Object.keys(manifest?.documents || {})) if (SUPPLEMENT_ID.test(id) && !sources[id]) errors.push({ path: '/paper/supplementarySources', message: `prepared ${id} is not declared in the paper` });
  const inspect = (value, pointer = '') => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.document === 'string' && SUPPLEMENT_ID.test(value.document) && !sources[value.document]) errors.push({ path: pointer, message: `undeclared supplementary document ${value.document}` });
    for (const [key, child] of Object.entries(value)) inspect(child, `${pointer}/${key}`);
  };
  inspect(candidate);
  for (const [i, note] of (candidate.paper?.documentNotes || []).entries()) {
    const doc = manifest?.documents?.[note.document];
    if (manifest && (!doc || note.page < 1 || note.page > doc.pages)) errors.push({ path: `/paper/documentNotes/${i}`, message: 'note does not identify a prepared source page' });
  }
  return errors;
}

export function sourceHashErrors(manifest, hashes = {}) {
  hashes ||= {};
  return [...new Set([...Object.keys(manifest.documents || {}), ...Object.keys(hashes)])]
    .filter(id => !hashes[id] || manifest.documents?.[id]?.sha256 !== hashes[id])
    .map(id => `source hash mismatch or missing hash for ${id} document`);
}
