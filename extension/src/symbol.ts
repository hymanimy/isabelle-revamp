// Minimal port of Isabelle src/Tools/VSCode/extension/src/symbol.ts (Makarius).
// Stock VS Code has no ISABELLE_VSCODIUM_RESOURCES font JSON: the caller loads
// the same entries from the installed etc/symbols table instead.
export interface Entry { symbol: string; name: string; decoded: string; abbrevs: string[] }
export class Symbols {
  private entriesMap: Map<string, Entry>;
  private decodedMap: Map<string, Entry>;
  constructor(readonly entries: Entry[]) {
    this.entriesMap = new Map(entries.map(entry => [entry.symbol, entry]));
    this.decodedMap = new Map(entries.map(entry => [entry.decoded, entry]));
  }
  get(symbol: string): Entry | undefined { return this.entriesMap.get(symbol); }
  defined(symbol: string): boolean { return this.entriesMap.has(symbol); }
  encode(text: string): string {
    return [...text].map(char => this.decodedMap.get(char)?.symbol ?? char).join('');
  }
  decode(text: string): string {
    return text.replace(/\\<[^>\n]+>/g, symbol => this.get(symbol)?.decoded ?? symbol);
  }
}
