import codes from './symbolCodes.json';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

// Bundled fallback; the installed distribution replaces this at startup.
let symbols: Readonly<Record<string, string>> = codes;
const superscripts: Readonly<Record<string, string>> = Object.fromEntries(
  [...'0123456789+-=()abcdefghijklmnopqrstuvwxyz'].map((char, i) =>
    [char, [...'⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖ?ʳˢᵗᵘᵛʷˣʸᶻ'][i]])
    .filter(([, value]) => value !== '?'));
const subscripts: Readonly<Record<string, string>> = Object.fromEntries(
  [...'0123456789+-=()aehijklmnoprstuvx'].map((char, i) => [char, [...'₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ'][i]]));

export function parseSymbolTable(source: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const line of source.split('\n')) {
    const match = /^\\<([^>]+)>\s+.*?\bcode:\s+0x([\da-f]+)/i.exec(line);
    if (!match) continue;
    const code = parseInt(match[2], 16);
    if (code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) result[match[1]] = String.fromCodePoint(code);
  }
  return result;
}

export async function loadSymbols(executable: string): Promise<{ path: string; count: number }> {
  const { stdout } = await promisify(execFile)(executable, ['getenv', '-b', 'ISABELLE_HOME'], { timeout: 15000 });
  const path = join(stdout.trim(), 'etc/symbols');
  const loaded = parseSymbolTable(await readFile(path, 'utf8'));
  if (!Object.keys(loaded).length) throw new Error('No Unicode assignments in ' + path);
  symbols = loaded;
  return { path, count: Object.keys(loaded).length };
}

export function unicodeSymbols(text: string): string {
  return text.replace(/\\<(\^?[A-Za-z][A-Za-z0-9_]*)>/g,
    (encoded, name: string) => Object.hasOwn(symbols, name) ? symbols[name] : encoded)
    .replace(/[⇧⇩](.)/gu, (encoded, char: string) =>
      (encoded[0] === '⇧' ? superscripts : subscripts)[char] ?? encoded)
    .replace(/\^([A-Za-z0-9])(?![\p{L}\p{N}_'])/gu, (encoded, char: string) => superscripts[char] ?? encoded)
    .replace(/∑(?=[\p{L}\\])/gu, '∑\u2009');
}

export interface SymbolReplacement { start: number; end: number; text: string }
export function symbolReplacements(source: string): SymbolReplacement[] {
  const result: SymbolReplacement[] = [];
  const pattern = /\\<([^>\n]+)>|\^([A-Za-z0-9])(?![\p{L}\p{N}_'])/gu;
  for (const match of source.matchAll(pattern)) {
    const text = match[1] ? (Object.hasOwn(symbols, match[1]) ? symbols[match[1]] : undefined) : superscripts[match[2]];
    if (text) result.push({ start: match.index, end: match.index + match[0].length, text });
  }
  return result;
}
