// Loads src/problems/tree.ts (the sidebar's tree assembly, TypeScript shared with the Gatsby build) into node, so
// the navigation gate and the tests check the very code that builds static/problems-data/tree.json instead of a
// copy of it. tree.ts imports only src/archive/labels.ts; both are transpiled with the repository's typescript.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadTreeModule(repo = REPO) {
  return loadTsModule(path.join(repo, 'src', 'problems', 'tree.ts'), repo);
}

/** Any shared-safe TypeScript module of src/ (relative imports only, no JSX), loaded the same way. */
export function loadTsModule(file, repo = REPO) {
  const require = createRequire(path.join(repo, 'package.json'));
  const ts = require('typescript');
  const modules = new Map();
  const load = file => {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const dependency = specifier => {
      if (!specifier.startsWith('.')) return require(specifier);
      const base = path.resolve(path.dirname(file), specifier);
      for (const extension of ['.ts', '.tsx']) if (fs.existsSync(base + extension)) return load(base + extension);
      throw new Error(`load-tree: cannot resolve ${specifier} from ${file}`);
    };
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', compiled)(dependency, module, module.exports);
    return module.exports;
  };
  return load(file);
}
