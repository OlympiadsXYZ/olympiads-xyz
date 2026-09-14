// Pure validation of isolated page-reader drafts. Never sends requests or writes
// canonical data. These fixtures preserve archive-specific text/figure hazards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePage } from '../tx/pilot-page.mjs';

const block = (id, type, text, bbox, problemNumber = '3') => ({ id, type, text, bbox, problemNumber, continuation: false });
const page = () => ({ schemaVersion: 1, blocks: [
  block('title', 'heading', 'Задача 3. Превключватели', [40, 30, 900, 65]),
  block('part-a', 'paragraph', 'а) Разгледайте първата схема. [1 т.]', [40, 100, 950, 180]),
  block('figure-a', 'figure', '', [80, 190, 420, 390]),
  block('part-b', 'paragraph', 'б) Разгледайте втората схема. [0,5 т.]', [40, 430, 950, 510]),
  block('figure-b', 'figure', '', [80, 520, 420, 720]),
  block('shared-hint', 'paragraph', 'Упътване: Приемете, че съпротивлението на проводниците е нула.', [40, 780, 950, 860]),
  block('footer', 'footer', 'Време за работа: 4 часа.', [40, 920, 950, 965], null),
], uncertainties: [], normalizations: [] });

test('source order, shared hint, two source figures and separate point awards survive validation', () => {
  const original = page();
  const before = JSON.stringify(original);
  assert.deepEqual(validatePage(original), []);
  assert.equal(JSON.stringify(original), before, 'Validation must not normalize source text or reorder blocks');
  assert.deepEqual(original.blocks.filter(b => b.type === 'figure').map(b => b.id), ['figure-a', 'figure-b']);
  assert.match(original.blocks[1].text, /\[1 т\.\]/);
  assert.match(original.blocks[3].text, /\[0,5 т\.\]/);
  assert.equal(original.blocks.at(-2).id, 'shared-hint');
});

test('rejects clipped-coordinate proposals, empty boxes, and diagram descriptions', () => {
  for (const bbox of [[-1, 0, 300, 400], [0, 0, 1001, 400], [1, 1, 1, 2], [1, 2, 3, 2], [1, 3, 2, 1], [0, 0, NaN, 20], [0, 0, Infinity, 20], [0, 0, 20], ['0', 0, 20, 20]]) {
    const candidate = page(); candidate.blocks[2].bbox = bbox;
    assert.ok(validatePage(candidate).length, `Must reject ${String(bbox)}`);
  }
  const proseDiagram = page(); proseDiagram.blocks[2].text = 'The diagram has two resistors.';
  assert.ok(validatePage(proseDiagram).some(e => /figure/i.test(e)));
  // Overlapping prose/figure boxes themselves are allowed. The source can have
  // that layout; a rectangle validator cannot decide whether a label is cut.
  const overlap = page(); overlap.blocks[2].bbox = [30, 160, 960, 460];
  assert.deepEqual(validatePage(overlap), []);
});

test('requires unique owned blocks and rejects unsupported model-generated fields', () => {
  const duplicate = page(); duplicate.blocks[2].id = duplicate.blocks[1].id;
  assert.ok(validatePage(duplicate).length);
  const guessedMetadata = page(); guessedMetadata.paper = { year: 2002 };
  assert.ok(validatePage(guessedMetadata).length);
  const extraField = page(); extraField.blocks[0].solution = 'Invented answer';
  assert.ok(validatePage(extraField).length);
  const missingFlags = page(); delete missingFlags.blocks[0].continuation;
  assert.ok(validatePage(missingFlags).length);
  const invalidUncertainty = page(); invalidUncertainty.uncertainties.push({ blockId: 'missing-block', note: 'Cannot read it' });
  assert.ok(validatePage(invalidUncertainty).length);
  const invalidNormalization = page(); invalidNormalization.normalizations.push({ blockId: 'missing-block', source: 'й', replacement: 'ѝ', reason: 'pronoun' });
  assert.ok(validatePage(invalidNormalization).length);
});

test('tracks unreadable source spans instead of silently accepting an unexplained placeholder', () => {
  const candidate = page(); candidate.blocks[1].text = 'Свържете [нечетливо] към източника.';
  assert.ok(validatePage(candidate).length, 'An unreadable marker needs an uncertainty on its own block');
  candidate.uncertainties.push({ blockId: 'part-a', note: 'The conjunction is overwritten in the source.' });
  assert.deepEqual(validatePage(candidate), []);
  candidate.uncertainties[0].blockId = 'part-b';
  assert.ok(validatePage(candidate).length, 'An unrelated block uncertainty must not cover the unreadable span');
});

test('allows the explicit Bulgarian pronoun exception and spacing, rejects scientific corrections', () => {
  const candidate = page(); candidate.blocks[1].text = 'Намерете масата ѝ и скоростта $v = 0,5\\,\\mathrm{m/s}$.';
  candidate.normalizations.push({ blockId: 'part-a', source: 'й', replacement: 'ѝ', reason: 'Clearly printed standalone possessive pronoun.' });
  assert.deepEqual(validatePage(candidate), []);
  const spacing = page(); spacing.blocks[1].text = 'Намерете масата на тялото.';
  spacing.normalizations.push({ blockId: 'part-a', source: 'масата  на', replacement: 'масата на', reason: 'Unambiguous prose spacing.' });
  assert.deepEqual(validatePage(spacing), []);
  for (const [source, replacement] of [['0,5', '0.5'], ['m', 'M'], ['g = 9,8', 'g = 10'], ['разноименни', 'разнозначни'], ['йод', 'ѝод']]) {
    const changed = page(); changed.blocks[1].text = replacement;
    changed.normalizations.push({ blockId: 'part-a', source, replacement, reason: 'Corrected the source.' });
    assert.ok(validatePage(changed).length, `Unauthorized source correction: ${source} -> ${replacement}`);
  }
  const absentReplacement = page(); absentReplacement.normalizations.push({ blockId: 'part-a', source: 'й', replacement: 'ѝ', reason: 'pronoun' });
  assert.ok(validatePage(absentReplacement).length, 'Normalization must point to its displayed replacement');
  const withinWord = page(); withinWord.blocks[1].text = 'ѝод';
  withinWord.normalizations.push({ blockId: 'part-a', source: 'й', replacement: 'ѝ', reason: 'pronoun' });
  assert.ok(validatePage(withinWord).length, 'Pronoun exception applies only to standalone characters, never letters within words');
  const joinedNumber = page(); joinedNumber.blocks[1].text = '10';
  joinedNumber.normalizations.push({ blockId: 'part-a', source: '1 0', replacement: '10', reason: 'spacing' });
  assert.ok(validatePage(joinedNumber).length, 'Whitespace normalization cannot join separate numeric tokens');
});

test('malformed provider JSON returns validation errors instead of throwing', () => {
  const nullBlock = page(); nullBlock.blocks = [null];
  const badUncertainties = page(); badUncertainties.blocks[1].text = '[нечетливо]'; badUncertainties.uncertainties = {};
  const badText = page(); badText.blocks[1].text = 12;
  badText.normalizations = [{ blockId: 'part-a', source: 'й', replacement: 'ѝ', reason: 'pronoun' }];
  const nullUncertainty = page(); nullUncertainty.blocks[1].text = '[нечетливо]'; nullUncertainty.uncertainties = [null];
  for (const candidate of [nullBlock, badUncertainties, badText, nullUncertainty]) {
    assert.doesNotThrow(() => validatePage(candidate));
    assert.ok(validatePage(candidate).length);
  }
});

test('enforces strict uncertainty/normalization objects and nonempty printed text', () => {
  const empty = page(); empty.blocks[1].text = '   ';
  assert.ok(validatePage(empty).length, 'Empty prose can hide dropped source content');
  const extraUncertainty = page(); extraUncertainty.uncertainties.push({ blockId: 'part-a', note: 'Ambiguous digit', resolved: true });
  assert.ok(validatePage(extraUncertainty).length);
  const extraNormalization = page(); extraNormalization.blocks[1].text = 'масата ѝ';
  extraNormalization.normalizations.push({ blockId: 'part-a', source: 'й', replacement: 'ѝ', reason: 'pronoun', confidence: 1 });
  assert.ok(validatePage(extraNormalization).length);
});

test('trusted reference checkpoints catch missing task numbers, shared hints and options', () => {
  const full = page();
  assert.deepEqual(validatePage(full, { expectedProblemNumbers: ['3'], requiredText: ['Упътване:', '[0,5 т.]'] }), []);
  assert.ok(validatePage(full, { expectedProblemNumbers: ['3', '4'] }).length, 'Missing optional fourth tasks are a known archive hazard');
  const omittedHint = page(); omittedHint.blocks = omittedHint.blocks.filter(b => b.id !== 'shared-hint');
  assert.ok(validatePage(omittedHint, { requiredText: ['Упътване: Приемете, че съпротивлението на проводниците е нула.'] }).length);
  const options = page();
  options.blocks[1].type = 'table';
  options.blocks[1].text = '| а) 1,5 | б) 2,5 | в) 3,5 | г) 4,5 |';
  assert.deepEqual(validatePage(options, { requiredText: ['г) 4,5'] }), []);
  options.blocks[1].text = '| а) 1,5 | б) 2,5 | в) 3,5 |';
  assert.ok(validatePage(options, { requiredText: ['г) 4,5'] }).length, 'A table with one dropped answer option still has valid schema');
});

test('without reference checkpoints, omitted figures or instructions still need source review', () => {
  const omitted = page(); omitted.blocks = omitted.blocks.filter(b => !['figure-b', 'shared-hint'].includes(b.id));
  // Deliberately document the scope of this validator: it cannot infer missing
  // blocks from the candidate alone. A clean schema result is never acceptance.
  assert.deepEqual(validatePage(omitted), []);
  assert.ok(!omitted.blocks.some(b => b.id === 'shared-hint'));
  assert.ok(!omitted.blocks.some(b => b.id === 'figure-b'));
});
