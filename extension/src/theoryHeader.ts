import { isAbsolute, join, resolve } from 'node:path';

// Read `theory Name imports A "B" "../C" keywords … begin` from a theory's source.
// Comments, cartouches and text before the header are skipped. Returns undefined
// when there is no complete header yet, e.g. while the user is still typing it.
export function theoryHeader(source: string): { name: string; imports: string[] } | undefined {
  const tokens: string[] = [];
  const word = /[A-Za-z0-9_'.\-/~$+]+/y;
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('(*', i)) {
      let depth = 0;
      while (i < source.length) {
        if (source.startsWith('(*', i)) { depth++; i += 2; }
        else if (source.startsWith('*)', i)) { depth--; i += 2; if (!depth) break; }
        else i++;
      }
    } else if (source.startsWith('\\<open>', i) || source[i] === '‹') {
      let depth = 0;
      while (i < source.length) {
        if (source.startsWith('\\<open>', i)) { depth++; i += 7; }
        else if (source[i] === '‹') { depth++; i++; }
        else if (source.startsWith('\\<close>', i)) { depth--; i += 8; if (!depth) break; }
        else if (source[i] === '›') { depth--; i++; if (!depth) break; }
        else i++;
      }
    } else if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
      tokens.push(source.slice(i, j + 1));
      i = j + 1;
    } else {
      word.lastIndex = i;
      const match = word.exec(source);
      if (match) {
        tokens.push(match[0]);
        i += match[0].length;
        if (match[0] === 'begin') break;
      } else i++;
    }
  }
  const start = tokens.indexOf('theory');
  if (start < 0 || !tokens.includes('begin')) return undefined;
  const name = tokens[start + 1]?.replace(/^"|"$/g, '');
  if (!name || name === 'begin') return undefined;
  const imports: string[] = [];
  if (tokens[start + 2] === 'imports') {
    for (const token of tokens.slice(start + 3)) {
      if (['keywords', 'abbrevs', 'begin'].includes(token)) break;
      imports.push(token.replace(/^"|"$/g, ''));
    }
  }
  return { name, imports };
}

// The file of a local import, or undefined for a session or library theory
// (session-qualified like HOL-Library.Multiset, or found in the logic image).
export function importFile(name: string, directory: string, exists: (file: string) => boolean): string | undefined {
  if (name.startsWith('~') || name.startsWith('$')) return undefined;
  let file: string;
  if (name.includes('/')) file = isAbsolute(name) ? name + '.thy' : resolve(directory, name + '.thy');
  else if (name.includes('.')) return undefined;
  else file = join(directory, name + '.thy');
  return exists(file) ? file : undefined;
}
