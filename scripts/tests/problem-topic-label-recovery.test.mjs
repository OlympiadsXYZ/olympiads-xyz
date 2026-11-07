import assert from 'node:assert/strict';
import test from 'node:test';
import { controlledTopics } from '../lib/problem-data.mjs';

const taxonomy = {
  topics: [
    {
      id: 'electricity',
      label: 'Електричество',
      aliases: ['electromagnetism'],
    },
    {
      id: 'magnetism',
      label: 'Магнетизъм и индукция',
      aliases: ['electromagnetism/induction'],
    },
    { id: 'optics', label: 'Оптика', aliases: ['light'] },
  ],
};

test('exact existing displayed labels recover while preserving sorted deduplication', () => {
  assert.deepEqual(
    controlledTopics(
      [' ЕЛЕКТРИЧЕСТВО ', 'Оптика', 'оптика', 'electricity'],
      taxonomy
    ),
    ['electricity', 'optics']
  );
});

test('existing IDs, aliases, subject normalization, and longest-prefix priority stay authoritative', () => {
  assert.deepEqual(
    controlledTopics(
      [
        'physics/electromagnetism/induction/faraday',
        'astronomy/light/geometric',
      ],
      taxonomy
    ),
    ['magnetism', 'optics']
  );
  const collision = {
    topics: [
      ...taxonomy.topics,
      { id: 'other', label: 'electromagnetism/induction/faraday', aliases: [] },
    ],
  };
  assert.deepEqual(
    controlledTopics(['electromagnetism/induction/faraday'], collision),
    ['magnetism']
  );
});

test('label fallback never matches prose, descendants, or a subject-prefixed label', () => {
  assert.deepEqual(
    controlledTopics(
      [
        'Оптика/лещи',
        'Оптика и вълни',
        'за Оптика',
        'physics/Оптика',
        'неизвестна тема',
      ],
      taxonomy
    ),
    []
  );
});

test('normalized labels shared by different IDs are rejected without changing key matches', () => {
  const ambiguous = {
    topics: [
      ...taxonomy.topics,
      { id: 'other', label: '  ЕЛЕКТРИЧЕСТВО  ', aliases: [] },
    ],
  };
  assert.deepEqual(controlledTopics(['Електричество'], ambiguous), []);
  assert.deepEqual(
    controlledTopics(['electricity', 'electromagnetism/induction'], ambiguous),
    ['electricity', 'magnetism']
  );
});

test('empty and missing labels cannot become fallback matches', () => {
  const incomplete = {
    topics: [
      { id: 'empty', label: ' ', aliases: [] },
      { id: 'missing', aliases: [] },
    ],
  };
  assert.deepEqual(controlledTopics(['', '   ', 'undefined'], incomplete), []);
  assert.deepEqual(controlledTopics(['empty', 'missing'], incomplete), [
    'empty',
    'missing',
  ]);
});
