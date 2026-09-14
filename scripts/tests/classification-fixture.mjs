export function classificationFixture(problemId) {
  return {
    schemaVersion: '1.0.0', taxonomyVersion: '1.0.0', problemId,
    sourceRef: { kind: 'source-pdf', sha256: 'a'.repeat(64) },
    conceptIds: ['physics/fluids/hydrostatics'], methodIds: ['equilibrium-balance'],
    mathIds: ['algebra'], representationIds: ['text'], prerequisiteLevels: ['olympiad-extension'],
    difficulty: { level: 3, status: 'estimated', rationale: 'Requires combining equilibrium and pressure.', confidence: 'medium' },
    provenance: { method: 'model-assessment', assessedAt: '2026-09-14T12:00:00.000Z', basis: 'statement-and-solution', reviewStatus: 'unreviewed', rater: 'test' },
  };
}
