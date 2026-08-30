import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as freshOrdering from './content/ordering';
import { typeDefs } from './graphql-types';
import { createXdmNode } from './src/gatsby/create-xdm-node';
import {
  checkInvalidUsacoMetadata,
  getProblemInfo,
  getProblemURL,
  ProblemMetadata,
  ShortProblemInfo,
} from './src/models/problem';

const ARCHIVE_ENABLED =
  process.env.GATSBY_ARCHIVE_ENABLED === 'true' ||
  process.env.ARCHIVE_ENABLED === 'true';

// Questionable hack to get full commit history so that timestamps work
try {
  execSync(
    `git fetch --unshallow https://github.com/OlympiadsXYZ/olympiads-xyz.git`
  );
} catch (e) {
  console.warn(
    'Git fetch failed. Ignore this if developing or building locally.'
  );
}

const copyDirectory = (source, destination) => {
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }

  const files = fs.readdirSync(source);

  files.forEach(file => {
    const sourcePath = path.join(source, file);
    const destPath = path.join(destination, file);

    if (fs.lstatSync(sourcePath).isDirectory()) {
      copyDirectory(sourcePath, destPath);
    } else {
      fs.copyFileSync(sourcePath, destPath);
    }
  });
};

// ideally problems would be its own query with
// source nodes: https://www.gatsbyjs.com/docs/reference/config-files/gatsby-node/#sourceNodes
const stream = process.env.CI
  ? fs.createWriteStream('ids.log', { flags: 'a' })
  : null;
exports.onCreateNode = async api => {
  const { node, actions, loadNodeContent, createContentDigest, createNodeId } =
    api;
  const { createNodeField, createNode, createParentChildLink } = actions;
  if (node.internal.type === `File` && node.ext === '.mdx') {
    const content = await loadNodeContent(node);
    const xdmNode = await createXdmNode(
      {
        id: createNodeId(`${node.id} >>> Xdm`),
        node,
        content,
      },
      api
    );
    createNode(xdmNode);
    createParentChildLink({ parent: node, child: xdmNode });
  }
  function transformObject(obj, id) {
    const problemInfoNode = {
      ...obj,
      id,
      children: [],
      parent: node.id,
      internal: {
        contentDigest: createContentDigest(obj),
        type: 'ProblemInfo',
      },
    };
    createNode(problemInfoNode);
    createParentChildLink({ parent: node, child: problemInfoNode });
  }
  const isExtraProblems =
    node.internal.mediaType === 'application/json' &&
    node.sourceInstanceName === 'content' &&
    node.relativePath.endsWith('extraProblems.json');
  if (
    node.internal.mediaType === 'application/json' &&
    node.sourceInstanceName === 'content' &&
    (node.relativePath.endsWith('.problems.json') || isExtraProblems)
  ) {
    const content = await loadNodeContent(node);
    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      const hint = node.absolutePath
        ? `file ${node.absolutePath}`
        : `in node ${node.id}`;
      throw new Error(`Unable to parse JSON: ${hint}`);
    }
    const moduleId = parsedContent['MODULE_ID'];
    if (!moduleId && !isExtraProblems) {
      throw new Error(
        'Module ID not found in problem JSON file: ' + node.absolutePath
      );
    }
    //const freshOrdering = importFresh<any>(
    //  path.join(__dirname, './content/ordering.ts')
    //);
    if (!isExtraProblems && !(moduleId in freshOrdering.moduleIDToSectionMap)) {
      throw new Error(
        '.problems.json moduleId does not correspond to module: ' +
          moduleId +
          ', path: ' +
          node.absolutePath
      );
    }
    Object.keys(parsedContent).forEach(tableId => {
      if (tableId === 'MODULE_ID') return;
      try {
        parsedContent[tableId].forEach((metadata: ProblemMetadata) => {
          checkInvalidUsacoMetadata(metadata);
          if (stream) stream.write(metadata.uniqueId + '\n');
          transformObject(
            {
              ...getProblemInfo(metadata, freshOrdering),
              module: moduleId,
            },
            createNodeId(
              `${node.id} ${tableId} ${metadata.uniqueId} >>> ProblemInfo`
            )
          );
        });
      } catch (e) {
        console.error(
          'Failed to create problem info for',
          parsedContent[tableId]
        );
        throw new Error(e);
      }
    });
    if (moduleId) {
      // create a node that contains all of a module's problems
      const id = createNodeId(`${node.id} >>> ModuleProblemLists`);
      const problemLists = Object.keys(parsedContent)
        .filter(x => x !== 'MODULE_ID')
        .map(listId => ({
          listId,
          problems: parsedContent[listId].map(x => {
            return {
              ...getProblemInfo(x, freshOrdering),
            };
          }),
        }));
      const data = {
        problemLists,
        moduleId,
      };
      const problemInfoNode = {
        ...data,
        id,
        children: [],
        parent: node.id,
        internal: {
          contentDigest: createContentDigest(data),
          type: 'ModuleProblemLists',
        },
      };
      createNode(problemInfoNode);
      createParentChildLink({ parent: node, child: problemInfoNode });
    }
  } else if (
    node.internal.type === 'Xdm' &&
    node.fileAbsolutePath.includes('content')
  ) {
    // const ordering = importFresh<any>('./content/ordering.ts');
    if (!(node.frontmatter.id in freshOrdering.moduleIDToSectionMap)) {
      throw new Error(
        'module id does not show up in ordering: ' +
          node.frontmatter.id +
          ', path: ' +
          node.absolutePath
      );
    }
    createNodeField({
      name: 'division',
      node,
      value: freshOrdering.moduleIDToSectionMap[node.frontmatter.id],
    });
    // https://angelos.dev/2019/09/add-support-for-modification-times-in-gatsby/
    // Decided to do a custom function for better implementation and readability
    const gitAuthorTime = getGitAuthorTime(node.fileAbsolutePath);
    createNodeField({
      node,
      name: 'gitAuthorTime',
      value: gitAuthorTime,
    });
  }
};

exports.createPages = async ({ graphql, actions, reporter }) => {
  const { createPage, createRedirect } = actions;
  const redirectsData = fs.readFileSync('./src/redirects.txt');
  (redirectsData + '')
    .split('\n')
    .filter(line => line != '')
    .filter(line => line.charAt(0) !== '#')
    .map(line => {
      const tokens = line.split('\t');
      return {
        from: tokens[0],
        to: tokens[1],
      };
    })
    .forEach(({ from, to }) => {
      createRedirect({
        fromPath: from,
        toPath: to,
        isPermanent: true,
      });
    });
  const result = await graphql(`
    query {
      modules: allXdm(filter: { fileAbsolutePath: { regex: "/content/" } }) {
        edges {
          node {
            frontmatter {
              id
              redirects
              prerequisites
            }
            fields {
              division
            }
            fileAbsolutePath
          }
        }
      }
      solutions: allXdm(
        filter: { fileAbsolutePath: { regex: "/solutions/" } }
      ) {
        edges {
          node {
            frontmatter {
              title
              id
              redirects
            }
          }
        }
      }
      problems: allProblemInfo {
        edges {
          node {
            uniqueId
            name
            url
            tags
            source
            solution {
              kind
              label
              labelTooltip
              sketch
              url
              hasHints
            }
            difficulty
            module {
              frontmatter {
                id
                title
              }
            }
          }
        }
      }
    }
  `);
  if (result.errors) {
    reporter.panicOnBuild('🚨 ERROR: Loading "createPages" query');
  }

  if (ARCHIVE_ENABLED) {
    // Catalog-driven archive: pages are generated from archive-catalog/*.json;
    // the site never touches the actual archive files (they live on external
    // hosting, linked via GATSBY_ARCHIVE_BASE_URL). See docs/Archive-Architecture.md.
    const {
      loadCatalog,
      groupCatalog,
      competitionSummaries,
    } = require('./src/archive/catalog-node');
    const { competitionSlug } = require('./src/archive/labels');
    const grouped = groupCatalog(loadCatalog(__dirname));
    const sciences = Object.keys(grouped).sort();

    createPage({
      path: `/archive/`,
      component: path.resolve(`./src/templates/archive/archiveIndexTemplate.tsx`),
      context: {
        sciences: sciences.map(science => {
          const s = grouped[science];
          const all = [
            ...Object.values(s.competitions).flat(),
            ...s.library,
            ...s.uncategorized,
          ];
          return {
            science,
            count: all.length,
            bytes: all.reduce((a, b) => a + b.size, 0),
          };
        }),
      },
    });

    sciences.forEach(science => {
      const s = grouped[science];
      createPage({
        path: `/archive/${science}/`,
        component: path.resolve(
          `./src/templates/archive/archiveScienceTemplate.tsx`
        ),
        context: {
          science,
          competitions: competitionSummaries(s),
          library: s.library,
          uncategorized: s.uncategorized,
        },
      });

      Object.keys(s.competitions).forEach(code => {
        const slug = competitionSlug(code);
        const entries = s.competitions[code];
        const years = [
          ...new Set(
            entries.map(e => e.year).filter(y => y != null)
          ),
        ].sort((a, b) => (b as number) - (a as number)) as number[];
        createPage({
          path: `/archive/${science}/${slug}/`,
          component: path.resolve(
            `./src/templates/archive/archiveCompetitionTemplate.tsx`
          ),
          context: {
            science,
            competition: code,
            slug,
            years,
            undatedCount: entries.filter(e => e.year == null).length,
            entries,
          },
        });
        years.forEach((year, i) => {
          createPage({
            path: `/archive/${science}/${slug}/${year}/`,
            component: path.resolve(
              `./src/templates/archive/archiveYearTemplate.tsx`
            ),
            context: {
              science,
              competition: code,
              slug,
              year,
              entries: entries.filter(e => e.year === year),
              prevYear: years[i + 1] ?? null,
              nextYear: years[i - 1] ?? null,
            },
          });
        });
      });
    });
  }

  // Check to make sure problems with the same unique ID have consistent information, and that there aren't duplicate slugs
  // Also creates user solution pages for each problem
  const problems = result.data.problems.edges;
  let problemSlugs = {}; // maps slug to problem unique ID
  let problemInfo = {}; // maps unique problem ID to problem info
  let problemURLToUniqueID = {}; // maps problem URL to problem unique ID
  let urlsThatCanHaveMultipleUniqueIDs = ['https://cses.fi/107/list/'];
  problems.forEach(({ node }) => {
    let slug = getProblemURL(node);
    if (
      problemSlugs.hasOwnProperty(slug) &&
      problemSlugs[slug] !== node.uniqueId
    ) {
      throw new Error(
        `The problems ${problemSlugs[slug]} and ${node.uniqueId} have the same slugs!`
      );
    }
    if (problemInfo.hasOwnProperty(node.uniqueId)) {
      const a = node,
        b = problemInfo[node.uniqueId];
      // Some problems with no corresponding module gets put into extraProblems.json.
      // If a problem has a module, then it should be removed from extraProblems.json.
      if (!a.module || !b.module) {
        throw new Error(
          `The problem ${node.uniqueId} is in both extraProblems.json and in another module at the same time. Remove this problem from extraProblems.json.`
        );
      }
      if (a.name !== b.name || a.url !== b.url || a.source !== b.source) {
        throw new Error(
          `The problem ${node.uniqueId} appears in both ${
            node.module.frontmatter.id
          } - ${node.module.frontmatter.title} and ${
            problemInfo[node.uniqueId].module.frontmatter.id
          } - ${
            problemInfo[node.uniqueId].module.frontmatter.title
          } but has different information! They need to have the same name / url / source.`
        );
      }
    }
    if (
      problemURLToUniqueID.hasOwnProperty(node.url) &&
      problemURLToUniqueID[node.url] !== node.uniqueId &&
      !urlsThatCanHaveMultipleUniqueIDs.includes(node.url)
    ) {
      throw new Error(
        `The URL ${node.url} is assigned to both problem unique ID ${
          problemURLToUniqueID[node.url]
        } and ${
          node.uniqueId
        }. Is this correct? (If this is correct, add the URL to \`urlsThatCanHaveMultipleUniqueIDs\` in gatsby-node.ts)`
      );
    }

    problemSlugs[slug] = node.uniqueId;
    problemInfo[node.uniqueId] = node;
    problemURLToUniqueID[node.url] = node.uniqueId;
  });

  // End problems check
  const moduleTemplate = path.resolve(`./src/templates/moduleTemplate.tsx`);
  const modules = result.data.modules.edges;
  modules.forEach(({ node }) => {
    if (!node.fields?.division) return;
    const path = `/${node.fields.division}/${node.frontmatter.id}`;
    if (node.frontmatter.redirects) {
      node.frontmatter.redirects.forEach(fromPath => {
        createRedirect({
          fromPath,
          toPath: path,
          redirectInBrowser: true,
          isPermanent: true,
        });
      });
    }
    createPage({
      path,
      component: moduleTemplate,
      context: {
        id: node.frontmatter.id,
      },
    });

    // const freshOrdering = importFresh<any>(
    //   path.join(__dirname, './content/ordering.ts')
    // );
    if (node.frontmatter.prerequisites)
      for (const prereq of node.frontmatter.prerequisites) {
        if (!(prereq in freshOrdering.moduleIDToSectionMap)) {
          console.warn(
            'Module ' +
              node.fileAbsolutePath +
              ': Prerequisite "' +
              prereq +
              '" is not a module'
          );
        }
      }
  });
  const solutionTemplate = path.resolve(`./src/templates/solutionTemplate.tsx`);
  const solutions = result.data.solutions.edges;
  const problemsWithInternalSolutions = new Set<string>();
  solutions.forEach(({ node }) => {
    try {
      // we want to find all problems that this solution can be an internal solution for
      const problemsForThisSolution = problems.filter(
        ({ node: problemNode }) => problemNode.uniqueId === node.frontmatter.id
      );
      problemsWithInternalSolutions.add(node.frontmatter.id);
      if (problemsForThisSolution.length === 0) {
        throw new Error(
          "Couldn't find corresponding problem for internal solution with frontmatter ID " +
            node.frontmatter.id +
            '. If this problem is no longer in any module, add it to content/extraProblems.json.'
        );
      }
      // let's also check that every problem has this as its internal solution -- if an internal solution exists, we should always use it
      const problemsThatAreMissingInternalSolution =
        problemsForThisSolution.filter(
          x => x.node.solution?.kind !== 'internal'
        );
      if (problemsThatAreMissingInternalSolution.length > 0) {
        problemsThatAreMissingInternalSolution.forEach(({ node }) => {
          console.error(
            'Problem ' +
              node.uniqueId +
              " isn't linked to its corresponding internal solution in module " +
              node.module.frontmatter.title +
              ' - ' +
              node.module.frontmatter.id
          );
        });
        throw new Error(
          'Internal solution ' +
            node.frontmatter.id +
            " isn't linked to all of its problems (see above). Did you forget to update the solution metadata of a module after adding an internal solution?"
        );
      }
      const problem = problemsForThisSolution[0];
      const path = `${getProblemURL({
        uniqueId: problem.node.uniqueId,
        source: problem.node.source,
        name: problem.node.name,
      })}/solution`;
      if (node.frontmatter.redirects) {
        node.frontmatter.redirects.forEach(fromPath => {
          createRedirect({
            fromPath,
            toPath: path,
            isPermanent: true,
          });
        });
      }
      createPage({
        path: path,
        component: solutionTemplate,
        context: {
          id: node.frontmatter.id,
        },
      });
    } catch (e) {
      console.error(
        'Failed to generate internal solution for ' + node.frontmatter.id
      );
      throw e;
    }
  });
  let hasProblemMissingInternalSolution = false;
  problems
    .filter(x => x.node.solution?.kind === 'internal')
    .forEach(({ node: problemNode }) => {
      if (!problemsWithInternalSolutions.has(problemNode.uniqueId)) {
        hasProblemMissingInternalSolution = true;
        reporter.error(
          `Problem ${problemNode.uniqueId} claims to have an internal solution but doesn't`
        );
      }
    });
  if (hasProblemMissingInternalSolution) {
    // Without this, gatsby build will hang indefinitely for unclear reasons.
    // My best guess is the multiprocessing Gatsby does fails to exit cleanly.
    // However, somehow sending SIGINT to this process exits fine.
    process.kill(process.pid, 'SIGINT');
  }
  // Generate Syllabus Pages //
  const syllabusTemplate = path.resolve(`./src/templates/syllabusTemplate.tsx`);
  freshOrdering.SECTIONS.forEach(division => {
    createPage({
      path: `/${division}`,
      component: syllabusTemplate,
      context: {
        division: division,
      },
    });
  });
  // End Generate Syllabus Pages //
};

exports.onPostBuild = () => {
  if (stream) {
    stream.end();
  }
};

// Write the per-science archive search indexes into static/ so the science
// pages can lazily fetch them client-side.
exports.onPreBootstrap = () => {
  if (!ARCHIVE_ENABLED) return;
  const {
    loadCatalog,
    groupCatalog,
    writeSearchIndexes,
  } = require('./src/archive/catalog-node');
  writeSearchIndexes(__dirname, groupCatalog(loadCatalog(__dirname)));
};

// When the archive is enabled, the built /archive/ index page replaces the
// static maintenance page (which stays in the tree as the flag-off fallback).
exports.onCreatePage = ({ page, actions }) => {
  // Static src/pages are created AFTER the createPages API, so the maintenance
  // page would otherwise shadow the catalog-built /archive/ index. Replace it
  // here (the maintenance page stays in the tree as the flag-off fallback).
  if (ARCHIVE_ENABLED && page.path === '/archive/') {
    if (
      page.component &&
      page.component.indexOf('src/pages/archive.tsx') !== -1
    ) {
      actions.deletePage(page);
      const {
        loadCatalog,
        groupCatalog,
      } = require('./src/archive/catalog-node');
      const grouped = groupCatalog(loadCatalog(__dirname));
      actions.createPage({
        path: `/archive/`,
        component: path.resolve(
          `./src/templates/archive/archiveIndexTemplate.tsx`
        ),
        context: {
          sciences: Object.keys(grouped)
            .sort()
            .map(science => {
              const s = grouped[science];
              const all = [
                ...Object.values(s.competitions).flat(),
                ...s.library,
                ...s.uncategorized,
              ];
              return {
                science,
                count: all.length,
                bytes: all.reduce((a, b) => a + b.size, 0),
              };
            }),
        },
      });
    }
  }
};

exports.createSchemaCustomization = ({ actions }) => {
  const { createTypes } = actions;
  createTypes(typeDefs);
};
const FilterWarningsPlugin = require('webpack-filter-warnings-plugin');
exports.onCreateWebpackConfig = ({ actions, stage, loaders, plugins }) => {
  actions.setWebpackConfig({
    resolve: {
      alias: {
        path: path.resolve('path-browserify'),
      },
      fallback: {
        fs: false,
      },
    },
    module: {
      rules: [
        {
          test: /\.mdx$/,
          use: [
            loaders.js(),
            {
              loader: path.resolve(__dirname, 'src/gatsby/webpack-xdm.js'),
              options: {},
            },
          ],
        },
      ],
    },
    // plugins: [
    //   new FilterWarningsPlugin({
    //     exclude:
    //       /mini-css-extract-plugin[^]*Conflicting order. Following module has been added:/,
    //   }),
    // ],
  });
  if (stage === 'build-javascript' || stage === 'develop') {
    actions.setWebpackConfig({
      plugins: [plugins.provide({ process: 'process/browser' })],
    });
  }
  if (stage === 'build-html' || stage === 'develop-html') {
    actions.setWebpackConfig({
      module: {
        rules: [
          {
            test: /firebase/,
            use: loaders.null(),
          },
        ],
      },
    });
  }
};

const getGitAuthorTime = (filePath: string): string => {
  try {
    // Handle paths with spaces or special characters
    const escapedPath = filePath.replace(/(\s+)/g, '\\$1');
    
    // Get the last meaningful content change (not just formatting)
    // The -w flag ignores whitespace changes
    const lastContentChange = execSync(
      `git log -1 --format=%aI --follow -w -- "${escapedPath}"`
    ).toString().trim();
    
    if (lastContentChange) {
      return lastContentChange;
    }
    
    // Fallback to file creation date if no content changes found
    const fileCreationDate = execSync(
      `git log --diff-filter=A --format=%aI -- "${escapedPath}"`
    ).toString().trim();
    
    return fileCreationDate || new Date().toISOString();
  } catch (e) {
    console.warn(`Failed to get git history for ${filePath}`, e);
    // Provide a fallback value to prevent build failures
    return new Date().toISOString();
  }
};
