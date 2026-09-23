import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const { nodeSchema } = require('gatsby/dist/joi-schemas/joi');
const { buildSchema, graphql } = require('graphql');

// Load the actual hooks and model without running Gatsby, fetching git history,
// compiling MDX, or writing generated indexes. Only those side effects are stubbed.
function loadHooks() {
  const modules = new Map();
  const captured = {};
  const sandboxProcess = { ...process, env: { ...process.env, CI: '', ARCHIVE_ENABLED: 'false', GATSBY_ARCHIVE_ENABLED: 'false', GATSBY_INCLUDE_DRAFTS: 'false' } };
  const load = file => {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const localRequire = createRequire(file);
    const dependency = specifier => {
      if (specifier === 'child_process') return { execSync: () => Buffer.from('') };
      if (specifier === './src/gatsby/create-xdm-node') return { createXdmNode: () => { throw new Error('Unexpected MDX compilation'); } };
      if (specifier === './src/problems/index-node') return {
        writeProblemsIndex: (_root, nodes) => { captured.indexNodes = nodes; return nodes.length; },
        writeProblemsTree: (_root, nodes) => ({ count: nodes.length }),
      };
      if (specifier.startsWith('.')) {
        const base = path.resolve(path.dirname(file), specifier);
        for (const extension of ['.ts', '.tsx']) {
          if (fs.existsSync(base + extension)) return load(base + extension);
        }
      }
      return localRequire(specifier);
    };
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.React },
    }).outputText;
    new Function('require', 'module', 'exports', '__filename', '__dirname', 'process', compiled)(dependency, module, module.exports, file, path.dirname(file), sandboxProcess);
    return module.exports;
  };
  return { hooks: load(path.join(repo, 'gatsby-node.ts')), load, captured };
}

async function sourceProblems(hooks, metadata, { moduleId = 'EXTRA_PROBLEMS', relativePath = 'extraProblems.json' } = {}) {
  const nodes = [], links = [];
  const source = { id: 'problem-file', ext: '.json', relativePath, absolutePath: path.join(repo, 'content', relativePath), sourceInstanceName: 'content', internal: { type: 'File', mediaType: 'application/json' } };
  await hooks.onCreateNode({
    node: source,
    loadNodeContent: async () => JSON.stringify({ MODULE_ID: moduleId, practice: metadata }),
    createNodeId: value => value,
    createContentDigest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    actions: {
      createNode: node => {
        // Gatsby adds internal.owner before applying this exact validator.
        const result = nodeSchema.validate({ ...node, internal: { ...node.internal, owner: 'default-site-plugin' } });
        assert.equal(result.error, undefined, `${node.uniqueId ?? node.internal.type}: ${result.error?.message}`);
        nodes.push(node);
      },
      createParentChildLink: link => links.push(link),
      createNodeField: () => { throw new Error('Unexpected node field'); },
    },
  });
  return { nodes, links, problems: nodes.filter(node => node.internal.type === 'ProblemInfo') };
}

function classifiedRecord(uniqueId = 'fixture-p1') {
  return { uniqueId, name: 'Problem', source: 'NOF', url: 'https://example.org/archive/paper.pdf', isStarred: false, difficulty: 'Normal', tags: ['Mechanics'],
    fields: ['Mechanics'], assessmentLabel: 'Estimated: 2/5', conceptIds: ['physics/mechanics/kinematics'], classificationTerms: ['Kinematics'], solutionMetadata: { kind: 'internal' } };
}

test('classified extra problems pass Gatsby node validation without occupying reserved fields', async () => {
  const { hooks } = loadHooks();
  const metadata = classifiedRecord();
  const { problems, links } = await sourceProblems(hooks, [metadata]);
  assert.equal(problems.length, 1);
  const node = problems[0];
  assert.equal(Object.hasOwn(node, 'fields'), false);
  assert.deepEqual(node.classificationFields, metadata.fields);
  assert.deepEqual(node.conceptIds, metadata.conceptIds);
  assert.deepEqual(node.classificationTerms, metadata.classificationTerms);
  assert.equal(node.assessmentLabel, metadata.assessmentLabel);
  assert.equal(node.difficulty, metadata.difficulty);
  assert.equal(node.id, 'problem-file practice fixture-p1 >>> ProblemInfo');
  assert.equal(node.parent, 'problem-file');
  // not linked as the file's child: one link per problem re-wrote the parent with its whole children list, a sourcing
  // cost that grew with the square of the problem count (see gatsby-node.ts)
  assert.ok(!links.some(link => link.child === node));
  assert.deepEqual(metadata.fields, ['Mechanics'], 'input metadata is not mutated');
});

test('legacy and curated module records retain metadata, links, and stable node IDs', async () => {
  const { hooks } = loadHooks();
  const legacy = classifiedRecord('legacy-p1');
  for (const key of ['fields', 'assessmentLabel', 'conceptIds', 'classificationTerms']) delete legacy[key];
  const { problems } = await sourceProblems(hooks, [legacy, { ...classifiedRecord('empty-p1'), fields: [] }]);
  assert.equal(Object.hasOwn(problems[0], 'classificationFields'), false);
  assert.equal(problems[0].solution.kind, 'internal');
  assert.deepEqual(problems[1].classificationFields, []);
  const curated = await sourceProblems(hooks, [classifiedRecord()], { moduleId: 'st-kin-tricks', relativePath: 'fixture.problems.json' });
  assert.equal(curated.problems[0].module, 'st-kin-tricks');
  assert.deepEqual(curated.problems[0].classificationFields, ['Mechanics']);
  assert.deepEqual(curated.nodes.find(node => node.internal.type === 'ModuleProblemLists').problemLists[0].problems[0].fields, ['Mechanics']);
});

test('the six rejected production IDs reach solution pages and keep the search index fields array', async () => {
  const expected = ['nof-2020-i-10', 'nof-2025-ii-9'].flatMap(id => [1, 2, 3].map(n => `${id}-p${n}`));
  const extra = JSON.parse(fs.readFileSync(path.join(repo, 'content/extraProblems.json'), 'utf8'));
  const metadata = Object.values(extra).filter(Array.isArray).flat().filter(row => expected.includes(row.uniqueId));
  assert.deepEqual(metadata.map(row => row.uniqueId).sort(), [...expected].sort());
  const { hooks, load, captured } = loadHooks();
  const { problems } = await sourceProblems(hooks, metadata);
  const { typeDefs } = load(path.join(repo, 'graphql-types.ts'));
  // Gatsby supplies Node interfaces, filtering and link resolution. The focused
  // schema supplies those wrappers while using our real ProblemInfo definition
  // and the exact createPages query (including its field alias).
  const schema = buildSchema(typeDefs.replaceAll(' implements Node', '') + `
    scalar Date
    directive @dateformat on FIELD_DEFINITION
    directive @link(by: String) on FIELD_DEFINITION
    input StringFilter { regex: String }
    input XdmFilter { fileAbsolutePath: StringFilter }
    type XdmEdge { node: Xdm }
    type XdmConnection { edges: [XdmEdge!]! }
    type ProblemInfoEdge { node: ProblemInfo }
    type ProblemInfoConnection { edges: [ProblemInfoEdge!]! }
    type Query { allXdm(filter: XdmFilter): XdmConnection! allProblemInfo: ProblemInfoConnection! }
  `);
  const pages = [];
  await hooks.createPages({
    graphql: query => graphql({ schema, source: query, rootValue: {
      allXdm: ({ filter }) => ({ edges: filter?.fileAbsolutePath?.regex === '/solutions/' ? metadata.map(row => ({ node: { frontmatter: { id: row.uniqueId, title: row.name } } })) : [] }),
      allProblemInfo: () => ({ edges: problems.map(node => ({ node: { ...node, module: null } })) }),
    } }),
    actions: { createPage: page => pages.push(page), createRedirect: () => {} },
    reporter: { panicOnBuild: message => { throw new Error(message); }, error: message => { throw new Error(message); } },
  });
  assert.deepEqual(pages.filter(page => page.path.endsWith('/solution')).map(page => page.context.id).sort(), [...expected].sort());
  const { buildProblemsIndex } = load(path.join(repo, 'src/problems/index-node.ts'));
  const index = buildProblemsIndex(captured.indexNodes);
  for (const row of metadata) {
    const result = index.find(entry => entry.uniqueId === row.uniqueId);
    assert.ok(result, row.uniqueId);
    assert.deepEqual(result.fields, row.fields);
    assert.deepEqual(result.conceptIds, row.conceptIds);
    assert.equal(result.assessmentLabel, row.assessmentLabel);
    assert.equal(result.solution.kind, 'internal');
  }
});
