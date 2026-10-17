import { CompletionItem, CompletionItemKind, CompletionList, Disposable, languages, Position, Range, SnippetString, TextDocument, TextEdit, workspace } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { decodeSymbols, encodeSymbols, symbolCatalog } from './symbols';

export function asciiCompletion(item: CompletionItem): CompletionItem {
  if (typeof item.insertText === 'string') item.insertText = encodeSymbols(item.insertText);
  else if (item.insertText) item.insertText = new SnippetString(encodeSymbols(item.insertText.value));
  if (item.textEdit) item.textEdit.newText = encodeSymbols(item.textEdit.newText);
  for (const edit of item.additionalTextEdits ?? []) edit.newText = encodeSymbols(edit.newText);
  // The client may otherwise use a Unicode label as the insertion text.
  if (!item.insertText && !item.textEdit) item.insertText = encodeSymbols(typeof item.label === 'string' ? item.label : item.label.label);
  return item;
}
export function asciiCompletions(result: CompletionItem[] | CompletionList | null | undefined) {
  (Array.isArray(result) ? result : result?.items)?.forEach(asciiCompletion);
  return result;
}

export class SymbolInput implements Disposable {
  private sessionAbbrevs: [string,string][] = [];
  private subscriptions: Disposable[];
  constructor(private client: LanguageClient) {
    this.subscriptions = [client.onNotification('PIDE/abbrevs_response', (message: { abbrevs: [string,string][] }) => {
      this.sessionAbbrevs = message.abbrevs.filter(pair => Array.isArray(pair) && pair.length === 2
        && pair.every(value => typeof value === 'string') && pair[1] !== '');
    }), languages.registerCompletionItemProvider({language:'isabelle',scheme:'file'}, {
      provideCompletionItems: (document, position) => this.complete(document, position),
    }, '\\', '~', '=', '>', '!', '<', '^'),
    workspace.onWillSaveTextDocument(event => {
      const document = event.document;
      if (document.languageId !== 'isabelle' || !workspace.getWorkspaceFolder(document.uri)) return;
      const source = document.getText();
      const text = workspace.getConfiguration('isabelleRevamp',document.uri).get('unicodeOnSave',false)
        ? decodeSymbols(source) : encodeSymbols(source);
      if (source !== text) event.waitUntil(Promise.resolve([TextEdit.replace(
        new Range(document.positionAt(0), document.positionAt(source.length)), text)]));
    })];
  }
  async request(): Promise<void> { await this.client.sendNotification('PIDE/abbrevs_request'); }
  snapshot() { return this.sessionAbbrevs.map(pair=>[...pair]); }
  private complete(document: TextDocument, position: Position): CompletionItem[] {
    const before = document.lineAt(position.line).text.slice(0,position.character);
    const pairs: [string,string][] = [...symbolCatalog.entries.flatMap(entry =>
      entry.abbrevs.map(abbrev => [abbrev,entry.symbol] as [string,string])), ...this.sessionAbbrevs];
    const items: CompletionItem[] = [], seen = new Set<string>();
    for (const [abbrev,replacement] of pairs) {
      // Exact short forms; named backslash input also offers prefix matches.
      const prefix = /\\[A-Za-z^][A-Za-z0-9_]*$/.exec(before)?.[0];
      const match = before.endsWith(abbrev) ? abbrev : prefix && abbrev.startsWith(prefix) ? prefix : undefined;
      if (!match) continue;
      const start = position.character - match.length;
      if (/^[A-Za-z]/.test(match) && /[\p{L}\p{N}_']/u.test(before[start-1] ?? '')) continue;
      const ascii = encodeSymbols(replacement), key = start + ':' + ascii;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = new CompletionItem({label:decodeSymbols(ascii).replace(/\u0007/g,''),description:abbrev},CompletionItemKind.Text);
      item.detail = 'Isabelle abbreviation: ' + ascii.replace(/\u0007/g,'');
      item.range = new Range(position.line,start,position.line,position.character);
      item.filterText = match; item.sortText = '0' + abbrev;
      if (ascii.includes('\u0007')) {
        const snippet = new SnippetString();
        const parts = ascii.split('\u0007');
        parts.forEach((part,i) => { snippet.appendText(part); if (i < parts.length-1) snippet.appendTabstop(); });
        item.insertText = snippet;
      } else item.insertText = ascii;
      items.push(item);
    }
    return items;
  }
  dispose(): void { this.subscriptions.forEach(item=>item.dispose()); }
}
