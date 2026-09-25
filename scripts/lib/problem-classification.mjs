import fs from 'node:fs';

export const problemTaxonomy = JSON.parse(fs.readFileSync(new URL('../../content/problem-taxonomy.json', import.meta.url), 'utf8'));
const concepts = new Map(problemTaxonomy.topics.map(t => [t.id, t]));
const fields = new Map(problemTaxonomy.fields.map(t => [t.id, t]));
const vocabulary = {
  conceptIds: concepts,
  methodIds: new Map(problemTaxonomy.facets.methods.map(t => [t.id, t])),
  mathIds: new Map(problemTaxonomy.facets.math.map(t => [t.id, t])),
  representationIds: new Map(problemTaxonomy.facets.representations.map(t => [t.id, t])),
  prerequisiteLevels: new Map(problemTaxonomy.facets.prerequisiteLevels.map(t => [t.id, t])),
};
const label = (entry, language = 'bg') => entry?.label?.[language] || entry?.label?.en || entry?.id;

// Cross-field checks supplement the committed schema; never assign classifications.
export function problemMetadataErrors(data, manifest = null) {
  const errors = [];
  const error = (path, message) => errors.push({ path, message });
  for (const [i, problem] of (data.problems || []).entries()) {
    const root = `/problems/${i}`, c = problem.classification;
    if (c) {
      if (c.problemId !== problem.id) error(`${root}/classification/problemId`, 'must match the owning problem id');
      if (c.taxonomyVersion !== problemTaxonomy.version) error(`${root}/classification/taxonomyVersion`, 'unknown taxonomy version');
      for (const [key, entries] of Object.entries(vocabulary)) for (const id of c[key] || []) {
        if (!entries.has(id)) error(`${root}/classification/${key}`, `unknown ID: ${id}`);
      }
      const allConcepts = [...(c.conceptIds || []), ...(c.partAssessments || []).flatMap(p => p.conceptIds || [])];
      for (const id of allConcepts) if (!concepts.has(id)) error(`${root}/classification/conceptIds`, `unknown concept: ${id}`);
      const seen = new Set();
      for (const part of c.partAssessments || []) {
        if (seen.has(part.label) || !(problem.parts || []).some(p => p.label === part.label)) error(`${root}/classification/partAssessments`, `duplicate or missing part label: ${part.label}`);
        seen.add(part.label);
      }
      const ratings = [c.difficulty, ...(c.partAssessments || []).map(p => p.difficulty)].filter(Boolean);
      if (ratings.some(d => d.status !== 'unrated') && (c.sourceRef?.kind === 'index-record' || !['statement', 'statement-and-solution'].includes(c.provenance?.basis) || !c.prerequisiteLevels?.length)) error(`${root}/classification/difficulty`, 'rating requires actual problem content and stated prerequisites');
      if (ratings.some(d => d.status === 'calibrated')) error(`${root}/classification/difficulty`, 'no accepted human calibration anchors exist in taxonomy v1');
      const sourceHashes = Object.values(manifest?.documents || {}).map(d => d.sha256);
      const stamped = data.paper.transcription?.sourceSha256;
      if (!sourceHashes.length && stamped) sourceHashes.push(...(typeof stamped === 'string' ? [stamped] : Object.values(stamped)));
      if (c.sourceRef?.kind === 'source-pdf' && sourceHashes.length && !sourceHashes.includes(c.sourceRef.sha256)) error(`${root}/classification/sourceRef`, 'source hash does not match a prepared source PDF');
    }
    const bodyText = body => [body?.title, body?.statement, body?.statementAfterParts, ...(body?.parts || []).flatMap(p => [p.statement, p.statementAfter])];
    const text = [...bodyText(problem), ...(problem.sections || []).flatMap(bodyText), ...bodyText(problem.solution), ...(problem.solution?.sections || []).flatMap(bodyText)].filter(Boolean).join('\n');
    for (const value of problem.sourceLayout?.underlines || []) if (!text.includes(value)) error(`${root}/sourceLayout/underlines`, `underlined passage not present in problem text: ${value}`);
    for (const { passage, context } of problem.sourceLayout?.scopedUnderlines || []) {
      if (typeof passage !== 'string' || !passage || typeof context !== 'string' || !context || context.split(passage).length !== 2 || text.split(context).length !== 2) {
        error(`${root}/sourceLayout/scopedUnderlines`, 'underline needs one exact passage in one unique source context');
      }
    }
  }
  const notes = data.paper?.documentNotes;
  if (notes !== undefined && !Array.isArray(notes)) error('/paper/documentNotes', 'documentNotes must be an array of notes');
  for (const [i, note] of (Array.isArray(notes) ? notes : []).entries()) {
    if (!note || typeof note !== 'object') { error(`/paper/documentNotes/${i}`, 'note must be an object'); continue; }
    if (manifest && (!manifest.documents?.[note.document] || note.page > manifest.documents[note.document].pages)) error(`/paper/documentNotes/${i}`, 'note references a missing source page');
  }
  return errors;
}

export function classificationSearch(c) {
  if (!c) return null;
  const chosen = (c.conceptIds || []).map(id => concepts.get(id)).filter(Boolean);
  const fieldIds = [...new Set(chosen.map(t => t.field))];
  const labels = chosen.map(t => label(t));
  const fieldLabels = fieldIds.map(id => label(fields.get(id))).filter(Boolean);
  const terms = [];
  for (const [key, entries] of Object.entries(vocabulary)) for (const id of c[key] || []) {
    const entry = entries.get(id);
    terms.push(id, label(entry), label(entry, 'en'));
  }
  const d = c.difficulty;
  const assessmentLabel = d?.status === 'estimated' ? `Оценена трудност: ${d.level}/5` : d?.status === 'calibrated' ? `Калибрирана трудност: ${d.level}/5` : 'Трудност: неоценена';
  return { conceptIds: c.conceptIds, fieldIds, fields: fieldLabels, prerequisiteLabels: (c.prerequisiteLevels || []).map(id => label(vocabulary.prerequisiteLevels.get(id))), tags: [...new Set([...fieldLabels, ...labels])], classificationTerms: [...new Set([...terms, ...fieldIds, ...fieldLabels].filter(Boolean))], assessmentLabel };
}
