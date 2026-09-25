#!/usr/bin/env node
// Select a complete relevant section of a larger source without extracting or renumbering its PDF.
import {parseArgs, fail, readManifest, manifestFile, writeJson} from './lib.mjs';
import {readScopeErrors, sourceReadScopes} from './source-read-scope.mjs';
const args=parseArgs(process.argv.slice(2));
const id=args._[0], manifest=id && readManifest(id), document=args.document;
if (!manifest?.documents?.[document] || !args.pages || !args.reason) fail('usage: set-source-scope.mjs ID --document solutions --pages 47-67 --reason "Complete theory solutions; following page starts practical round"');
const pages=[];
for (const term of String(args.pages).split(',')) {
  const match=/^(\d+)(?:-(\d+))?$/.exec(term.trim());
  if (!match) fail(`invalid page range ${term}`);
  const from=Number(match[1]), to=Number(match[2] || match[1]);
  if (to<from || to>manifest.documents[document].pages) fail(`page range outside original document: ${term}`);
  for(let page=from;page<=to;page++)pages.push(page);
}
const scope={pages,reason:args.reason};
for(const error of readScopeErrors(scope,manifest.documents[document].pages))fail(error);
manifest.documents[document].readScope=scope;
writeJson(manifestFile(id),manifest);
console.log(JSON.stringify(sourceReadScopes(manifest),null,2));
