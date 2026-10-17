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
      const name = /^\s*([\p{L}_][\p{L}\p{N}_'.]*)(?:\s*\[[^\]]*\])?\s*:(?!:)/u.exec(rest)?.[1];
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

export interface ProofNode extends ProofStep {
  name: string; statement: string; parent?: string; abandoned: boolean;
}
export interface ProofEdge { from: string; to: string; kind: 'fact' | 'implicit' | 'nesting' | 'refutation' }
export interface ProofStructure { nodes: ProofNode[]; edges: ProofEdge[] }

// The graph is a source-level explanation, not a kernel dependency certificate.
// Its colours are supplied separately by current-version PIDE annotations.
export function proofStructure(source: string, namedNested = false): ProofStructure {
  type Node = ProofNode & { own: Token[]; previous?: string; implicit: boolean; displayed: boolean };
  type Frame = { owner: Node; current?: Node; caseNode?: Node; prefix: Token[]; brace?: boolean };
  const nodes: Node[] = [], frames: Frame[] = [];
  const tokens = isarTokens(source);
  const commands = new Set([...steps, 'case', 'hence', 'thus']);
  const prefixes = new Set(['from', 'with', 'then']);
  const endings = new Set(['by', 'sorry', '.', '..', 'done']);
  const occurrences = new Map<string, number>();
  let brackets = 0;
  const trim = (start: number, end: number) => end - (source.slice(start, end).match(/\s*$/)?.[0].length ?? 0);
  const close = (node: Node | undefined, end: number) => { if (node) node.end = trim(node.start, end); };
  function finishFrame(frame: Frame, end: number) {
    if (frame.current !== frame.owner) close(frame.current, end);
    close(frame.caseNode, end);
  }
  function create(token: Token, index: number, parent?: Node, previous?: Node, prefix: Token[] = []): Node {
    const rest = source.slice(token.end);
    // Obtain names its facts after `where`, rather than naming the witnesses.
    const headerEnd = tokens.findIndex((item, at) => at > index
      && !item.quoted && ['proof', 'by', 'sorry', 'qed'].includes(item.text));
    const header = tokens.slice(index + 1, headerEnd < 0 ? tokens.length : headerEnd);
    const directName = /^\s*([\p{L}_][\p{L}\p{N}_'.]*)(?:\s*\[[^\]]*\])?\s*:(?!:)/u.exec(rest)?.[1];
    const where = header.findIndex(item => !item.quoted && item.text === 'where');
    const named = directName ?? (token.text === 'obtain' && where >= 0 && header[where + 2]?.text === ':'
      ? header[where + 1]?.text : undefined);
    const caseName = token.text === 'case' ? /^\s*\(?\s*([\p{L}_][\p{L}\p{N}_'.]*)/u.exec(rest)?.[1] : undefined;
    const statement = tokens[index + 1]?.quoted ? tokens[index + 1].text.slice(1, -1) : rest.split('\n')[0].trim();
    const name = named ?? caseName ?? token.text;
    const key = (parent ? parent.id + '/' : '') + (named ?? caseName ?? token.text);
    const count = occurrences.get(key) ?? 0; occurrences.set(key, count + 1);
    const node: Node = { id: key + (count ? '#' + count : ''), name, label: name, command: token.text,
      statement, start: token.start, commandEnd: token.end, end: source.length, parent: parent?.id,
      closed: ['case', 'also', 'finally'].includes(token.text), abandoned: false,
      own: [...prefix, token], previous: previous?.id,
      displayed: !parent || Boolean(named && ['have', 'show', 'obtain'].includes(token.text)
        && (namedNested || frames.filter(frame => !frame.brace).length === 2)),
      implicit: ['hence', 'thus', 'also', 'finally'].includes(token.text) || prefix.some(item => ['then', 'with'].includes(item.text)) };
    nodes.push(node); return node;
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], word = token.text;
    let frame = frames.at(-1);
    if (token.quoted) { (frame?.prefix.length ? frame.prefix : frame?.current?.own)?.push(token); continue; }
    if (word === '(' || word === '[') brackets++;
    if (brackets) {
      (frame?.prefix.length ? frame.prefix : frame?.current?.own)?.push(token);
      if (word === ')' || word === ']') brackets--;
      continue;
    }
    if (['theorem', 'lemma'].includes(word)) {
      for (const open of frames) { finishFrame(open, token.start); close(open.owner, token.start); }
      frames.length = 0;
      const root = create(token, i);
      frames.push({ owner: root, current: root, prefix: [] });
      continue;
    }
    if (!frame) continue;
    if (word === 'proof') {
      const owner = frame.current ?? frame.caseNode ?? frame.owner;
      owner.own.push(token); frames.push({ owner, prefix: [] }); continue;
    }
    if (word === '{') { frames.push({ owner: frame.caseNode ?? frame.owner, prefix: [], brace: true }); continue; }
    if (word === '}') {
      if (frame.brace) { finishFrame(frame, token.start); frames.pop(); }
      continue;
    }
    if (word === 'qed') {
      finishFrame(frame, token.start);
      frame.owner.closed = true; frame.owner.finish = token; close(frame.owner, token.end);
      frames.pop();
      if (frames.length === 1 && frames[0].owner === frame.owner) frames.length = 0;
      continue;
    }
    if (word === 'oops') {
      for (const open of frames) {
        finishFrame(open, token.end); open.owner.abandoned = true; open.owner.finish = token; close(open.owner, token.end);
        if (open.current) { open.current.abandoned = true; open.current.finish = token; }
      }
      frames.length = 0; continue;
    }
    if (word === 'end' && frames.length === 1) { close(frame.owner, token.start); frames.length = 0; continue; }
    if (frames.length > 1 && (prefixes.has(word) || frame.prefix.length && !commands.has(word))) {
      if (!frame.prefix.length) close(frame.current, token.start);
      frame.prefix.push(token); continue;
    }
    if (frames.length > 1 && word === 'next') {
      finishFrame(frame, token.start); frame.current = undefined; frame.caseNode = undefined; frame.prefix = []; continue;
    }
    if (frames.length > 1 && commands.has(word)) {
      close(frame.current, frame.prefix[0]?.start ?? token.start);
      if (word === 'case') close(frame.caseNode, token.start);
      const parent = word === 'case' ? frame.owner : frame.caseNode ?? frame.owner;
      const node = create(token, i, parent, frame.current, frame.prefix);
      frame.current = node; frame.prefix = [];
      if (word === 'case') frame.caseNode = node;
      continue;
    }
    frame.current?.own.push(token);
    if (frame.current && endings.has(word)) {
      frame.current.closed = true; frame.current.finish = token;
      if (word === '.' || word === '..') frame.current.implicit = true;
    }
  }
  for (const frame of frames) { finishFrame(frame, source.length); close(frame.owner, source.length); }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const factNames = new Map(nodes.map(node => {
    const end = node.own.findIndex(token => !token.quoted && ['using', 'proof', 'by', 'sorry'].includes(token.text));
    const header = end < 0 ? node.own : node.own.slice(0, end);
    const names = header.filter((token, i) => !token.quoted && /^[\p{L}_][\p{L}\p{N}_'.]*$/u.test(token.text)
      && header[i + 1]?.text === ':' && header[i + 2]?.text !== ':').map(token => token.text);
    return [node.id, new Set([node.name, ...names])] as const;
  }));
  const edges = new Map<string, ProofEdge>();
  const add = (from: string, to: string, kind: ProofEdge['kind']) => {
    if (from !== to) edges.set(from + '\0' + to, { from, to, kind });
  };
  function visible(candidate: Node, node: Node): boolean {
    if (!candidate.parent) return true;
    let parent = node.parent;
    while (parent) {
      if (candidate.parent === parent || candidate.id === parent && candidate.command === 'case') return true;
      parent = byId.get(parent)?.parent;
    }
    return !candidate.parent && !node.parent;
  }
  for (const node of nodes) {
    // A show discharges the enclosing obligation. Case commands introduce
    // assumptions, not circular obligations back from their own conclusions.
    if (node.parent && ['show', 'thus'].includes(node.command)) {
      let owner = byId.get(node.parent);
      while (owner?.command === 'case') owner = owner.parent ? byId.get(owner.parent) : undefined;
      if (owner) add(node.id, owner.id, 'nesting');
    }
    if (node.implicit && node.previous) add(node.previous, node.id, 'implicit');
    let facts = false;
    for (let i = 0; i < node.own.length; i++) {
      const token = node.own[i];
      if (token.quoted) continue;
      if (['using', 'from', 'with', 'by', 'apply', 'unfolding'].includes(token.text)) facts = true;
      if (!facts && !(node.own[i + 1]?.text === '[' && node.own[i + 2]?.text === 'OF')) continue;
      const candidate = nodes.filter(other => (factNames.get(other.id)!.has(token.text)
        || other.command === 'case' && token.text.startsWith(other.name + '.')) && other.start < node.start
        && (other.end <= token.start || other.command === 'case') && visible(other, node)).at(-1);
      if (candidate) add(candidate.id, node.id, 'fact');
    }
    const headerEnd = node.own.find(token => !token.quoted && ['proof', 'by', 'sorry', 'apply'].includes(token.text))?.start
      ?? Math.min(node.end, source.indexOf('\n', node.start) < 0 ? source.length : source.indexOf('\n', node.start));
    node.statement = source.slice(node.start, headerEnd).trim();
  }
  // The compact admission summary retains its outer-obligation policy. The
  // graph opts into all named nested steps; unnamed commands still belong to
  // their owner. Unnamed chains forward dependencies, never invented labels.
  const owner = (node: Node): Node => node.displayed || !node.parent ? node : owner(byId.get(node.parent)!);
  const sources = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    const node = byId.get(id)!;
    if (node.displayed) return [id];
    const enclosing = owner(node);
    if (enclosing.parent) return [enclosing.id];
    return [...edges.values()].filter(edge => edge.to === id && edge.kind !== 'nesting')
      .flatMap(edge => sources(edge.from, new Set(seen)));
  };
  const projected = new Map<string, ProofEdge>();
  for (const edge of edges.values()) {
    const target = owner(byId.get(edge.to)!).id;
    for (const from of sources(edge.from)) if (from !== target) {
      projected.set(from + '\0' + target, { ...edge, from, to: target });
    }
  }
  return { nodes: nodes.filter(node => node.displayed).map(({ own, previous, implicit, displayed, ...node }) => ({
    ...node, parent: node.parent ? owner(byId.get(node.parent)!).id : undefined,
  })), edges: [...projected.values()] };
}
