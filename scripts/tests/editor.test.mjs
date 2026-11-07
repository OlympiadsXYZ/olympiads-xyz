import { test, test as publicationNodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const matter = require('gray-matter');
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
function load(relative, overrides = {}, suffix = '') {
  const module = { exports: {} };
  const compiled = ts.transpileModule(
    fs.readFileSync(path.join(repo, relative), 'utf8') + suffix,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
      },
    }
  ).outputText;
  const localRequire = name =>
    Object.hasOwn(overrides, name) ? overrides[name] : require(name);
  new Function('require', 'exports', 'module', compiled)(
    localRequire,
    module.exports,
    module
  );
  return module.exports;
}
const { editorFileURL, fetchFileContent } = load(
  'src/components/Editor/editorUtils.ts'
);

test('editor sends existing and new files to this repository and rejects traversal', () => {
  assert.equal(
    editorFileURL('content/1_General/Файл.mdx'),
    'https://github.com/OlympiadsXYZ/olympiads-xyz/edit/master/content/1_General/%D0%A4%D0%B0%D0%B9%D0%BB.mdx'
  );
  assert.equal(
    editorFileURL('solutions/physics/new.mdx', true),
    'https://github.com/OlympiadsXYZ/olympiads-xyz/new/master/solutions/physics?filename=new.mdx'
  );
  for (const file of [
    '../secrets',
    'content/../secrets',
    'content//bad',
    'https://evil.example/file',
  ]) {
    assert.throws(() => editorFileURL(file));
  }
});

test('adding a catalogue problem preserves its metadata and emits supported solution metadata', () => {
  const { editorProblemMetadata } = load(
    'src/components/Editor/editorUtils.ts'
  );
  const problem = {
    uniqueId: 'p1',
    name: 'Problem',
    url: 'https://example.org/problem',
    source: 'NOF',
    difficulty: 'Easy',
    tags: ['Механика'],
    solution: {
      kind: 'link',
      url: 'https://example.org/solution',
      label: 'Solution',
    },
  };
  const metadata = editorProblemMetadata(problem);
  assert.equal(metadata.difficulty, 'Easy');
  assert.deepEqual(metadata.tags, ['Механика']);
  assert.deepEqual(metadata.solutionMetadata, {
    kind: 'link',
    url: 'https://example.org/solution',
  });
  assert.deepEqual(
    editorProblemMetadata({
      ...problem,
      solution: { kind: 'label', label: 'Check source' },
    }).solutionMetadata,
    { kind: 'none' }
  );
});

test('editor never turns failed HTTP responses into drafts; missing optional problem lists are allowed', async t => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  await assert.rejects(
    fetchFileContent('solutions/physics/missing.mdx'),
    /404/
  );
  globalThis.fetch = async url =>
    new Response(url.endsWith('.mdx') ? 'draft' : 'missing', {
      status: url.endsWith('.mdx') ? 200 : 404,
    });
  assert.deepEqual(await fetchFileContent('content/1_General/draft.mdx'), {
    markdown: 'draft',
    problems: '',
  });
  globalThis.fetch = async url =>
    new Response('error', { status: url.endsWith('.mdx') ? 200 : 503 });
  await assert.rejects(
    fetchFileContent('content/1_General/draft.mdx'),
    /не са заредени/
  );
});

test('new module and solution metadata survives punctuation and multi-line user input', () => {
  const { moduleTemplate, solutionTemplate } = load(
    'src/components/Editor/editorTemplates.ts'
  );
  const input = {
    id: 'new-file',
    title: 'A: "B"\nC',
    source: 'Book: Volume 2',
    description: "It's a test: yes",
    section: 'physics',
  };
  for (const template of [moduleTemplate, solutionTemplate]) {
    const { data } = matter(template(input));
    assert.equal(data.title, input.title);
    assert.equal(data.id, input.id);
  }
  const { data } = matter(moduleTemplate(input));
  assert.equal(data.description, input.description);
  assert.equal(data.frequency, 0);
  assert.deepEqual(data.prerequisites, []);
});

test('local editor index includes authored files and excludes generated transcriptions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'olympiads-editor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'content/physics'), { recursive: true });
  fs.mkdirSync(path.join(root, 'solutions/physics'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'content/physics/m.mdx'),
    '---\nid: m\ntitle: Module\n---\nText'
  );
  fs.writeFileSync(
    path.join(root, 'solutions/physics/s.mdx'),
    '---\nid: s\ntitle: Solution\n---\nText'
  );
  fs.writeFileSync(
    path.join(root, 'solutions/physics/generated.mdx'),
    '---\nid: g\ncanonicalSource: content/problems/g.json\n---\nText'
  );
  const { writeEditorIndex } = load('src/editor/index-node.ts');
  assert.equal(writeEditorIndex(root), 2);
  const files = JSON.parse(
    fs.readFileSync(path.join(root, 'static/editor-data/files.json'))
  );
  assert.deepEqual(
    files.map(f => [f.id, f.kind]),
    [
      ['m', 'module'],
      ['s', 'solution'],
    ]
  );
});

test('archive label reader handles Prettier-formatted Cyrillic identifiers', async () => {
  const { readArchiveLabels } = await import('../lib/labels.mjs');
  const { competitionShort, roundLabels } = readArchiveLabels();
  assert.equal(competitionShort['Всерусийска'], 'ВсОШ');
  assert.equal(competitionShort.NOF, 'НОФ');
  assert.equal(roundLabels.III, 'III кръг (национален)');
});

// Execute the actual import handler and editor callbacks; replace only UI/network boundaries.
function metadataEditorHarness(problem) {
  const { createStore } = require('jotai/vanilla');
  const store = createStore();
  const ui = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    lazy: () => Symbol('lazy component'),
    useState: initial => [initial, () => {}],
    useEffect: () => {},
    useContext: () => false,
    Suspense: Symbol('suspense'),
  };
  const utils = load('src/components/Editor/editorUtils.ts');
  const atoms = load('src/atoms/editor.ts', {
    '../components/Editor/editorUtils': utils,
    '../utils/prettierFormatter': {},
    '../components/Editor/editorTemplates': {},
  });
  const hooks = {
    useAtomValue: atom => store.get(atom),
    useSetAtom: atom => value => store.set(atom, value),
  };
  const initialFile = {
    path: 'content/physics/metadata-fixture.mdx',
    markdown: 'Unchanged module text',
    problems: JSON.stringify({
      MODULE_ID: 'metadata-fixture',
      module_problem: [
        {
          uniqueId: 'already-present',
          name: 'Existing row',
          url: 'https://example.org/existing',
          source: 'NOF',
          difficulty: 'Easy',
          isStarred: true,
          tags: ['existing'],
          solutionMetadata: { kind: 'none' },
          assessmentLabel: 'Existing label',
          fields: ['existing-field'],
          conceptIds: ['existing-concept'],
          classificationTerms: ['existing term'],
          customProperty: { keep: true },
        },
      ],
    }),
  };
  store.set(atoms.saveFileAtom, initialFile);
  store.set(atoms.activeFileAtom, initialFile.path);
  store.set(atoms.baseTabAtom, 'problems');
  const { addProblem } = load(
    'src/components/Editor/AddProblemModal.tsx',
    {
      '@headlessui/react': { Dialog: {} },
      react: ui,
      '../Modal': {},
      './CopyButton': {},
      '../ProblemsPage/problemSearch': {
        loadProblemsIndex: async () => [problem],
      },
      './editorUtils': utils,
      'react-i18next': {},
    },
    '\nexports.addProblem = addProblem;'
  );
  const { MainEditorInterface } = load(
    'src/components/Editor/MainEditorInterface.tsx',
    {
      jotai: hooks,
      react: ui,
      '../../../content/problems.schema.json': {},
      '../../atoms/editor': atoms,
      '../../context/DarkModeContext': {},
      './EditorTabBar': Symbol('tab bar'),
      './mdx-lang': {},
    }
  );
  const model = load('src/models/problem.ts', {
    '../../content/problem-routes.client.json': {},
    '../../content/ordering': {},
    '../components/markdown/PGS': {},
    '../components/markdown/ProblemsList/DivisionList/id_to_sol.json': {},
    '../utils/books': {},
  });
  const { EditorOutput } = load('src/components/Editor/EditorOutput.tsx', {
    jotai: hooks,
    react: ui,
    '../../atoms/editor': atoms,
    '../../context/EditorContext': {
      EditorContext: { Provider: Symbol('editor context') },
    },
    '../../context/MarkdownProblemListsContext': {
      MarkdownProblemListsProvider: Symbol('lists'),
    },
    '../../context/ProblemSuggestionModalContext': {
      ProblemSuggestionModalProvider: Symbol('suggestions'),
    },
    '../../models/problem': model,
    '../QuizGeneratorModal': Symbol('quiz'),
  });
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    return (node.props?.children ?? [])
      .flat(Infinity)
      .map(child => find(child, predicate))
      .find(Boolean);
  }
  return {
    utils,
    model,
    initialFile,
    saved: () => store.get(atoms.activeFileAtom),
    exported: () => store.get(atoms.trueFileAtom),
    async copiedMetadata() {
      let copied;
      const statuses = [];
      await addProblem(
        problem.uniqueId,
        value => {
          copied = value;
        },
        value => statuses.push(value)
      );
      assert.deepEqual(statuses, ['Fetching metadata...', 'Get Metadata']);
      return copied;
    },
    pasteAndFormat(text) {
      find(
        MainEditorInterface({}),
        node => node.props?.language === 'json'
      ).props.onChange(text);
      find(
        MainEditorInterface({}),
        node => typeof node.props?.onFormatCode === 'function'
      ).props.onFormatCode();
    },
    append(metadata) {
      find(
        EditorOutput(),
        node => typeof node.props?.value?.addProblem === 'function'
      ).props.value.addProblem('module_problem', metadata);
    },
  };
}

const metadataFixture = {
  uniqueId: 'imported-assessment',
  name: 'Imported row',
  url: 'https://example.org/imported',
  source: 'NOF',
  difficulty: 'Easy',
  isStarred: true,
  tags: ['kept tag'],
  problemURL: '/problems/imported-assessment',
  problemModules: [],
  solution: { kind: 'internal', hasHints: true },
};
const optionalAssessment = {
  assessmentLabel: 'Оценена трудност: 3/5',
  fields: ['physics', 'physics'],
  conceptIds: ['mechanics.fixture', 'mechanics.other'],
  classificationTerms: ['Тестов термин', 'quoted "term"\nnext line'],
};

publicationNodeTest(
  'catalogue import retains assessment through copied JSON, editor paste, saved file and model',
  async () => {
    const problem = { ...metadataFixture, ...optionalAssessment };
    const before = structuredClone(problem);
    const harness = metadataEditorHarness(problem);
    const document = JSON.parse(harness.initialFile.problems);
    document.module_problem.push(JSON.parse(await harness.copiedMetadata()));
    harness.pasteAndFormat(JSON.stringify(document));
    const saved = JSON.parse(harness.exported());
    assert.deepEqual(
      saved.module_problem[0],
      JSON.parse(harness.initialFile.problems).module_problem[0]
    );
    assert.equal(saved.MODULE_ID, 'metadata-fixture');
    assert.equal(harness.saved().markdown, harness.initialFile.markdown);
    const imported = saved.module_problem[1];
    const expected = {
      uniqueId: problem.uniqueId,
      name: problem.name,
      url: problem.url,
      source: problem.source,
      difficulty: problem.difficulty,
      ...optionalAssessment,
      isStarred: false,
      tags: problem.tags,
      solutionMetadata: { kind: 'internal', hasHints: true },
    };
    assert.deepEqual(imported, expected);
    const { solutionMetadata, ...expectedInfo } = expected;
    assert.deepEqual(harness.model.getProblemInfo(imported, {}), {
      ...expectedInfo,
      solution: { kind: 'internal', hasHints: solutionMetadata.hasHints },
    });
    assert.deepEqual(problem, before);
  }
);

publicationNodeTest(
  'editor assessment import preserves independent fields and empty values without inventing absent metadata',
  () => {
    const { editorProblemMetadata } = load(
      'src/components/Editor/editorUtils.ts'
    );
    const keys = Object.keys(optionalAssessment);
    for (const [key, value] of Object.entries(optionalAssessment)) {
      const imported = JSON.parse(
        JSON.stringify(
          editorProblemMetadata({ ...metadataFixture, [key]: value })
        )
      );
      assert.deepEqual(imported[key], value, key);
      for (const other of keys.filter(other => other !== key)) {
        assert.equal(Object.hasOwn(imported, other), false, other);
      }
    }
    for (const absent of [
      {},
      Object.fromEntries(keys.map(key => [key, undefined])),
      Object.fromEntries(keys.map(key => [key, null])),
    ]) {
      const metadata = editorProblemMetadata({ ...metadataFixture, ...absent });
      for (const key of keys) {
        assert.equal(Object.hasOwn(metadata, key), false, key);
      }
    }
    const empty = {
      assessmentLabel: '',
      fields: [],
      conceptIds: [],
      classificationTerms: [],
    };
    const imported = JSON.parse(
      JSON.stringify(editorProblemMetadata({ ...metadataFixture, ...empty }))
    );
    for (const key of keys) assert.deepEqual(imported[key], empty[key], key);
  }
);

publicationNodeTest(
  'editor assessment metadata survives the separate EditorOutput insertion serializer',
  () => {
    const harness = metadataEditorHarness(metadataFixture);
    const metadata = harness.utils.editorProblemMetadata({
      ...metadataFixture,
      ...optionalAssessment,
    });
    harness.append(metadata);
    const saved = JSON.parse(harness.exported());
    assert.deepEqual(
      saved.module_problem[0],
      JSON.parse(harness.initialFile.problems).module_problem[0]
    );
    assert.deepEqual(saved.module_problem[1], {
      uniqueId: metadataFixture.uniqueId,
      name: metadataFixture.name,
      url: metadataFixture.url,
      source: metadataFixture.source,
      difficulty: metadataFixture.difficulty,
      ...optionalAssessment,
      isStarred: false,
      tags: metadataFixture.tags,
      solutionMetadata: { kind: 'internal', hasHints: true },
    });
  }
);
