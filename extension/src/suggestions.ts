// Proofs found by try0, try or sledgehammer, and where to put them: like jEdit's
// sendback, a suggestion replaces the command that found it.

// "Try this: by simp" first, then other "Found proof:" lines; timings dropped.
// Sledgehammer prefixes each with its prover: "algebra: Try this: by algebra (4 ms)".
export function suggestedProofs(messages: string[]): string[] {
  const tried: string[] = [], found: string[] = [];
  for (const message of messages) {
    for (const match of message.matchAll(/^(?:[\w.-]+:\s*)?(Try this|Found proof):\s*(.+?)(?:\s+\(\d+(?:\.\d+)?\s*m?s\))?$/gm)) {
      (match[1] === 'Try this' ? tried : found).push(match[2].trim());
    }
  }
  return [...new Set([...tried, ...found])];
}

// The try0/try/sledgehammer command on `line` at `character`, else the last one before
// it, else the first on the line. With a terminal proof, a directly following sorry or
// oops goes too: it would fail after a finished proof.
export function suggestionRange(lines: string[], line: number, character: number, proof: string):
  { start: [number, number]; end: [number, number] } | undefined {
  const text = lines[line] ?? '';
  const commands = [...text.matchAll(/\b(?:try0|try|sledgehammer)\b(?:\s*\[[^\]\n]*\])?/g)]
    .map(match => ({ start: match.index, end: match.index + match[0].length }));
  const command = commands.find(c => c.start <= character && character <= c.end)
    ?? commands.filter(c => c.start <= character).at(-1) ?? commands[0];
  if (!command) return undefined;
  let end: [number, number] = [line, command.end];
  if (/^(by\b|\.\.?$)/.test(proof.trim())) {
    // Skip blank lines; the admission must be the next command.
    let at = line, column = command.end;
    for (; at < lines.length; at++, column = 0) {
      const rest = lines[at].slice(column);
      const admission = /^\s*(sorry|oops)\b/.exec(rest);
      if (admission) { end = [at, column + admission[0].length]; break; }
      if (rest.trim()) break;
    }
  }
  return { start: [line, command.start], end };
}
