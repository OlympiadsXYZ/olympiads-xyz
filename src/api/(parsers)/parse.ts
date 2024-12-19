import axios from 'axios';
import parseAc from './ac';
import parseCf from './cf';
import parseCses from './cses';
import parseUsaco from './usaco';
import urlParser from './urlParser';
import parseOriginal from './originalParser';

export const parsers = {
  'codeforces.com': parseCf,
  'usaco.org': parseUsaco,
  'cses.fi': parseCses,
  'atcoder.jp': parseAc,
  'urlParser': urlParser,
  'originalParser': parseOriginal
};
// Fall back to generic parser if no specific parser found
//TODO: make more parsers for specific domains like the archive section of olympiadsXYZ

export default async function parse(url: string) {
  try {
    // First try to validate URL format
    new URL(url);
    
    // If valid URL, proceed with HTML fetch and parsing
    const html = (await axios.get(url)).data;
    for (const [domain, parser] of Object.entries(parsers)) {
      if (url.includes(domain)) {
        return parser(url, html);
      }
    }
    
    // Fall back to generic URL parser
    try {
      return parsers.urlParser(url);
    } catch (error) {
      throw new Error(`No parser found for this url.
Available parsers:
${Object.keys(parsers)
  .map(key => `  - ${key}`)
  .join('\n')}`);
    }

  } catch (error) {
    // URL validation failed, try original parser
    try {
      return parsers.originalParser();
    } catch (originalError) {
      throw new Error('Invalid input: Not a valid URL and original parser failed');
    }
  }
}
