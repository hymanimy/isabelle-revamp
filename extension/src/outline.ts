import { DocumentSymbol, DocumentSymbolProvider, Range, SymbolKind, TextDocument } from 'vscode';
import { unicodeSymbols } from './symbols';

// The Outline view, breadcrumbs, Go to Symbol and sticky scroll for a theory.
// Isabelle's language server offers no document symbols, so the theory's commands
// are read here: comments, strings and cartouches are skipped, `begin` … `end`
// blocks and section headings nest, and a lemma runs until the next command at
// theory level, so it covers its proof.
export interface OutlineItem {
  name: string; detail: string; kind: string;
  start: number; end: number; nameStart: number; nameEnd: number;
  children: OutlineItem[];
}

type Parse = 'statement' | 'name' | 'type' | 'rest' | 'heading' | 'keyword';
const entries: Record<string, [kind: string, parse: Parse]> = {};
const add = (kind: string, parse: Parse, words: string) => words.split(' ').forEach(word => { entries[word] = [kind, parse]; });
add('theorem', 'statement', 'lemma theorem corollary proposition schematic_goal');
add('theorem', 'name', 'lemmas');
add('definition', 'name', 'definition abbreviation fun function primrec primcorec corec corecursive partial_function inductive inductive_set coinductive coinductive_set lift_definition');
add('constant', 'name', 'consts axiomatization');
add('type', 'type', 'type_synonym typedef typedecl record');
add('datatype', 'type', 'datatype codatatype');
add('theory', 'name', 'theory');
add('locale', 'name', 'locale');
add('class', 'name', 'class');
add('context', 'name', 'context bundle');
add('context', 'keyword', 'experiment notepad');
add('instance', 'rest', 'instantiation');
add('instance', 'keyword', 'overloading');
const headings = ['chapter', 'section', 'subsection', 'subsubsection', 'paragraph'];
headings.forEach(word => { entries[word] = ['heading', 'heading']; });
// Commands that may own a begin … end block.
const blocks = new Set(['theory', 'context', 'bundle', 'locale', 'class', 'instantiation', 'overloading', 'experiment', 'notepad']);
// Theory-level commands that end the lemma before them without appearing in the outline.
const stops = new Set(('begin end declare notation no_notation type_notation no_type_notation syntax no_syntax translations '
  + 'no_translations hide_const hide_fact hide_type hide_class ML ML_file SML_file setup local_setup method_setup '
  + 'attribute_setup simproc_setup declaration text_raw interpretation global_interpretation sublocale instance '
  + 'termination export_code code_printing code_datatype setup_lifting unbundle named_theorems').split(' '));
// Commands that may also appear inside a proof: they end a lemma only when they start a line.
const unindented = new Set(['text', 'value', 'term', 'typ', 'thm', 'find_theorems', 'ML_val', 'ML_command']);
// Words after a block keyword that start its specification, not its name.
const unnamed = new Set(['fixes', 'assumes', 'includes', 'notes', 'defines', 'constrains', 'imports', 'where', 'for', 'and', 'begin']);
// Words that start a proof: a statement is searched for only before them.
const proofStart = new Set(['proof', 'by', 'apply', 'using', 'unfolding', 'including', 'supply', 'sorry', 'oops', 'subgoal']);

interface Token { text: string; start: number; end: number; type: 'word' | 'quoted' | 'group' | 'other' }
// Symbols such as \<alpha> and \<^sub> may be part of a name; cartouche delimiters may not.
const word = /'?(?:[\p{L}_]|\\<(?!open>|close>)\^?[A-Za-z][A-Za-z0-9_']*>)(?:[\p{L}\p{N}_'.]|\\<(?!open>|close>)\^?[A-Za-z][A-Za-z0-9_']*>)*/uy;

// The end of the comment, string or cartouche that starts at i, or i if none does.
function skip(source: string, i: number): number {
  if (source.startsWith('(*', i)) {
    let depth = 0;
    while (i < source.length) {
      if (source.startsWith('(*', i)) { depth++; i += 2; }
      else if (source.startsWith('*)', i)) { i += 2; if (!--depth) return i; }
      else i++;
    }
    return i;
  }
  if (source[i] === '"' || source[i] === '`') {
    const quote = source[i];
    for (i++; i < source.length && source[i] !== quote; i++) if (source[i] === '\\') i++;
    return Math.min(i + 1, source.length);
  }
  if (source[i] === '‹' || source.startsWith('\\<open>', i)) {
    let depth = 0;
    while (i < source.length) {
      if (source[i] === '‹') { depth++; i++; }
      else if (source.startsWith('\\<open>', i)) { depth++; i += 7; }
      else if (source[i] === '›') { i++; if (!--depth) return i; }
      else if (source.startsWith('\\<close>', i)) { i += 8; if (!--depth) return i; }
      else i++;
    }
    return i;
  }
  return i;
}

// Outer-syntax tokens from i to end. With grouped, a bracketed (…) or […] is one token.
function* tokens(source: string, i: number, end: number, grouped: boolean): Generator<Token> {
  while (i < end) {
    if (/\s/.test(source[i])) { i++; continue; }
    const after = skip(source, i);
    if (after > i) {
      if (!source.startsWith('(*', i)) yield { text: source.slice(i, after), start: i, end: after, type: 'quoted' };
      i = after;
      continue;
    }
    word.lastIndex = i;
    const match = word.exec(source);
    if (match) {
      yield { text: match[0], start: i, end: i + match[0].length, type: 'word' };
      i += match[0].length;
    } else if (grouped && (source[i] === '(' || source[i] === '[')) {
      const [open, close] = source[i] === '(' ? '()' : '[]';
      let j = i, depth = 0;
      while (j < end) {
        const k = skip(source, j);
        if (k > j) { j = k; continue; }
        if (source[j] === open) depth++;
        else if (source[j] === close && !--depth) { j++; break; }
        j++;
      }
      yield { text: source.slice(i, j), start: i, end: j, type: 'group' };
      i = j;
    } else {
      const length = source.startsWith('::', i) ? 2 : 1;
      yield { text: source.slice(i, i + length), start: i, end: i + length, type: 'other' };
      i += length;
    }
  }
}

const shown = (text: string) => {
  const line = unicodeSymbols(text).replace(/\s+/g, ' ').trim();
  return line.length > 60 ? line.slice(0, 59) + '…' : line;
};
const contents = (token: Token) => token.type !== 'quoted' ? token.text
  : token.text.replace(/^(?:["`‹]|\\<open>)/, '').replace(/(?:["`›]|\\<close>)$/, '');

// The name of the entry whose keyword ends at `from`, with its source range.
function name(source: string, parse: Parse, from: number, to: number): { name: string; start: number; end: number } | undefined {
  const list: Token[] = [];
  for (const token of tokens(source, from, Math.min(to, from + 4000), true)) {
    if (token.type === 'word' && proofStart.has(token.text) || list.length > 200) break;
    list.push(token);
  }
  const at = (token: Token | undefined, text = token && contents(token)) =>
    token && text?.trim() ? { name: shown(text), start: token.start, end: token.end } : undefined;
  if (parse === 'heading') return at(list.find(token => token.type === 'quoted'));
  if (parse === 'rest') {
    const last = list.at(-1);
    return list[0] && last ? { name: shown(source.slice(list[0].start, last.end)), start: list[0].start, end: last.end } : undefined;
  }
  let i = 0;
  while (list[i]?.type === 'group' && list[i].text.startsWith('(')) i++;
  if (parse === 'type') while (list[i]?.type === 'word' && list[i].text.startsWith("'")) i++;
  // Attributes without a name, as in definition [code del]: "…".
  if (list[i]?.type === 'group' && list[i].text.startsWith('[') && list[i + 1]?.text === ':') i += 2;
  const first = list[i];
  // A name labels a fact when a colon follows it, as in lemma foo [simp]: "…".
  const labelled = first?.type === 'word' && (list[i + 1]?.text === ':'
    || list[i + 1]?.type === 'group' && list[i + 1].text.startsWith('[') && list[i + 2]?.text === ':');
  if (parse === 'statement') {
    if (labelled) return at(first);
    const shows = list.findIndex(token => token.type === 'word' && token.text === 'shows');
    return at(list.slice(shows + 1).find(token => token.type === 'quoted'));
  }
  if (first?.type === 'word' && !unnamed.has(first.text) && !labelled) return at(first);
  // A definition given only by its equation, as in definition "f x = x" or
  // definition f_def: "f x = x": the constant comes first in the equation.
  const equation = first?.type === 'quoted' ? first : labelled ? list.slice(i + 1).find(token => token.type === 'quoted') : undefined;
  if (!equation) return labelled ? at(first) : undefined;
  word.lastIndex = 0;
  const constant = contents(equation).trimStart();
  const match = word.exec(constant);
  return match ? { name: shown(match[0]), start: equation.start, end: equation.end } : at(equation);
}

export function outline(source: string): OutlineItem[] {
  const root: OutlineItem[] = [];
  // An anonymous block, opened by a begin we cannot attribute, holds no item of its own.
  const stack: { item?: OutlineItem; role: 'block' | 'heading' | 'item'; level: number }[] = [];
  const parent = () => [...stack].reverse().find(frame => frame.item)?.item?.children ?? root;
  const close = (at: number) => {
    const { item } = stack.pop()!;
    if (!item) return;
    let end = at;
    while (end > item.nameEnd && /\s/.test(source[end - 1])) end--;
    item.end = Math.max(end, item.nameEnd);
  };
  const commands = [...tokens(source, 0, source.length, false)].filter(token => token.type === 'word'
    && (token.text in entries || stops.has(token.text)
      || unindented.has(token.text) && (token.start === 0 || source[token.start - 1] === '\n')));
  commands.forEach((command, index) => {
    const keyword = command.text, start = command.start;
    if (keyword === 'begin') {
      const top = stack.at(-1);
      if (top?.role === 'item' && blocks.has(top.item!.detail)) { top.role = 'block'; return; }
      while (stack.at(-1)?.role === 'item') close(start);
      stack.push({ role: 'block', level: -1 });
      return;
    }
    while (stack.at(-1)?.role === 'item') close(start);
    if (keyword === 'end') {
      if (!stack.some(frame => frame.role === 'block')) return;
      while (stack.at(-1)!.role !== 'block') close(start);
      close(command.end);
      return;
    }
    const level = headings.indexOf(keyword);
    if (keyword === 'theory') while (stack.length) close(start);
    if (level >= 0) while (stack.at(-1)?.role === 'heading' && stack.at(-1)!.level >= level) close(start);
    if (!(keyword in entries)) return;
    const [kind, parse] = entries[keyword];
    const found = parse === 'keyword' ? undefined : name(source, parse, command.end, commands[index + 1]?.start ?? source.length);
    const item: OutlineItem = { name: found?.name ?? keyword, detail: kind === 'heading' ? '' : keyword, kind,
      start, end: command.end, nameStart: found?.start ?? start, nameEnd: found?.end ?? command.end, children: [] };
    parent().push(item);
    stack.push({ item, role: level >= 0 ? 'heading' : 'item', level });
  });
  while (stack.length) close(source.length);
  return root;
}

const kinds: Record<string, SymbolKind> = {
  theorem: SymbolKind.Method, definition: SymbolKind.Function, constant: SymbolKind.Constant, type: SymbolKind.Struct,
  datatype: SymbolKind.Enum, theory: SymbolKind.Module, locale: SymbolKind.Interface, class: SymbolKind.Class,
  context: SymbolKind.Namespace, instance: SymbolKind.Object, heading: SymbolKind.String,
};

export class Outline implements DocumentSymbolProvider {
  provideDocumentSymbols(document: TextDocument): DocumentSymbol[] {
    const at = (offset: number) => document.positionAt(offset);
    const symbol = (item: OutlineItem): DocumentSymbol => {
      const result = new DocumentSymbol(item.name, item.detail, kinds[item.kind],
        new Range(at(item.start), at(item.end)), new Range(at(item.nameStart), at(item.nameEnd)));
      result.children = item.children.map(symbol);
      return result;
    };
    return outline(document.getText()).map(symbol);
  }
}
