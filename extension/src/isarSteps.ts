// A small structural lexer, not an Isar parser or a proof checker. Strings,
// cartouches and nested comments are opaque, so prose cannot create cards.
export interface Token { text: string; start: number; end: number; quoted?: boolean }
export interface ProofStep {
  id: string; label: string; command: string; start: number; end: number;
  commandEnd: number; closed: boolean; finish?: Token;
}
const steps = new Set(['have', 'show', 'obtain', 'also', 'finally']);
const theorems = new Set(['theorem', 'lemma', 'corollary', 'proposition']);

export function isarTokens(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/u.test(source[i])) { i++; continue; }
    if (source.startsWith('(*', i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth) {
        if (source.startsWith('(*', i)) { depth++; i += 2; }
        else if (source.startsWith('*)', i)) { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    const start = i;
    if (source[i] === '"') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += Math.min(2, source.length - i); }
        else if (source[i++] === '"') break;
      }
      tokens.push({ text: source.slice(start, i), start, end: i, quoted: true });
      continue;
    }
    if (source[i] === '‹' || source.startsWith('\\<open>', i)) {
      let depth = 0;
      do {
        if (source[i] === '‹') { depth++; i++; }
        else if (source.startsWith('\\<open>', i)) { depth++; i += 7; }
        else if (source[i] === '›') { depth--; i++; }
        else if (source.startsWith('\\<close>', i)) { depth--; i += 8; }
        else i++;
      } while (i < source.length && depth > 0);
      tokens.push({ text: source.slice(start, i), start, end: i, quoted: true });
      continue;
    }
    const match = /^(?:[\p{L}_][\p{L}\p{N}_'.]*|\\<[^>]+>|\.\.)/u.exec(source.slice(i));
    i += match?.[0].length ?? 1;
    tokens.push({ text: source.slice(start, i), start, end: i });
  }
  return tokens;
}

export function proofSteps(source: string, cursor: number): ProofStep[] {
  const tokens = isarTokens(source);
  const declarations = tokens.map((token, i) => !token.quoted && theorems.has(token.text) ? i : -1)
    .filter(i => i >= 0);
  const selected = declarations.filter(i => tokens[i].start <= cursor).at(-1) ?? declarations[0];
  if (selected === undefined) return [];
  const limit = declarations.find(i => i > selected) ?? tokens.length;
  const theorem = tokens[selected + 1]?.text ?? 'theorem';
  const cards: ProofStep[] = [];
  let depth = 0;
  let blocks = 0;
  let card: ProofStep | undefined;
  const closeRange = (end: number) => {
    if (card) card.end = end - (source.slice(card.start, end).match(/\s*$/)?.[0].length ?? 0);
  };
  for (let i = selected + 1; i < limit; i++) {
    const token = tokens[i];
    if (token.quoted) continue;
    const word = token.text;
    if (word === 'proof') { depth++; continue; }
    if (word === 'qed') {
      if (depth === 1) { closeRange(token.start); break; }
      depth = Math.max(0, depth - 1);
      if (depth === 1 && !blocks && card) { card.closed = true; card.finish = token; }
      continue;
    }
    if (word === '{') { blocks++; continue; }
    if (word === '}') { blocks = Math.max(0, blocks - 1); continue; }
    if (depth !== 1 || blocks) continue;
    if (steps.has(word)) {
      closeRange(token.start);
      const rest = source.slice(token.end);
      const name = /^\s*([\p{L}_][\p{L}\p{N}_'.]*)(?:\s*\[[^\]]*\])?\s*:/u.exec(rest)?.[1];
      const statement = tokens[i + 1]?.quoted ? tokens[i + 1].text.slice(1, -1) : rest.split('\n')[0].trim();
      card = { id: `${theorem}:${cards.length}`, command: word, label: name ?? (statement || word).slice(0, 40),
        start: token.start, commandEnd: token.end, end: source.length,
        closed: word === 'also' || word === 'finally' };
      cards.push(card);
    } else if (card && ['by', 'sorry', '.', '..', 'done'].includes(word)) {
      card.closed = true;
      card.finish = token;
    }
  }
  if (card?.end === source.length) closeRange(tokens[limit]?.start ?? source.length);
  return cards;
}
