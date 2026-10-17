import { ConfigurationTarget, DecorationRangeBehavior, Disposable, Range, TextEditor, window, workspace } from 'vscode';
import { symbolReplacements, SymbolReplacement } from './symbols';

// Ranges always refer to the untouched source, including search selections.
export class PrettySymbols implements Disposable {
  private decoration = window.createTextEditorDecorationType({
    textDecoration: 'none; display: none', rangeBehavior: DecorationRangeBehavior.ClosedClosed,
    before: { textDecoration: 'none; display: inline', color: 'inherit' },
  });
  private subscriptions: Disposable[];
  private cache = new Map<string, { version: number; replacements: SymbolReplacement[] }>();
  constructor() {
    this.subscriptions = [
      workspace.onDidChangeTextDocument(event => { this.cache.delete(event.document.uri.toString()); this.refresh(); }),
      workspace.onDidCloseTextDocument(document => this.cache.delete(document.uri.toString())),
      window.onDidChangeVisibleTextEditors(() => this.refresh()),
      window.onDidChangeTextEditorSelection(event => this.refresh(event.textEditor)),
      workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('isabelleRevamp.prettySymbols')) this.refresh(); }),
    ];
    this.refresh();
  }
  snapshot(editor: TextEditor): SymbolReplacement[] {
    const document = editor.document;
    if (document.languageId !== 'isabelle' || !workspace.getConfiguration('isabelleRevamp', document.uri).get('prettySymbols', true)) return [];
    const uri = document.uri.toString();
    let cached = this.cache.get(uri);
    if (cached?.version !== document.version) {
      cached = { version: document.version, replacements: symbolReplacements(document.getText()) };
      this.cache.set(uri, cached);
    }
    return cached.replacements.filter(item => !editor.selections.some(selection => {
      const start = document.offsetAt(selection.start), end = document.offsetAt(selection.end);
      return selection.isEmpty ? start >= item.start && start <= item.end : start < item.end && end > item.start;
    }));
  }
  refresh(editor?: TextEditor): void {
    for (const target of editor ? [editor] : window.visibleTextEditors) {
      const ranges = this.snapshot(target).map(item => ({
        range: new Range(target.document.positionAt(item.start), target.document.positionAt(item.end)),
        renderOptions: { before: { contentText: item.text } },
      }));
      target.setDecorations(this.decoration, ranges);
    }
  }
  async toggle(): Promise<void> {
    const settings = workspace.getConfiguration('isabelleRevamp', window.activeTextEditor?.document.uri);
    await settings.update('prettySymbols', !settings.get('prettySymbols', true), ConfigurationTarget.Workspace);
  }
  dispose(): void { this.decoration.dispose(); this.subscriptions.forEach(item => item.dispose()); this.cache.clear(); }
}
