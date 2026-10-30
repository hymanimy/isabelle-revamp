import { ConfigurationTarget, DecorationRangeBehavior, Disposable, Range, TextDocument, TextEditor, window, workspace } from 'vscode';
import { symbolReplacements, SymbolReplacement } from './symbols';
import { ScriptDecorations, visibleScripts } from './scriptDecorations';
import { scriptRanges } from './scriptRanges';

// Decorate this many lines beyond the viewport, so scrolling rarely shows raw source.
const margin = 100;

// Ranges always refer to the untouched source, including search selections.
export class PrettySymbols implements Disposable {
  private decoration = window.createTextEditorDecorationType({
    textDecoration: 'none; display: none', rangeBehavior: DecorationRangeBehavior.ClosedClosed,
    before: { textDecoration: 'none; display: inline', color: 'inherit' },
  });
  private scripts = new ScriptDecorations();
  private subscriptions: Disposable[];
  private cache = new Map<string, { version: number; replacements: SymbolReplacement[] }>();
  constructor() {
    this.subscriptions = [
      workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId !== 'isabelle' || !event.contentChanges.length) return;
        for (const editor of window.visibleTextEditors) if (editor.document === event.document) this.refresh(editor);
      }),
      workspace.onDidCloseTextDocument(document => this.cache.delete(document.uri.toString())),
      window.onDidChangeVisibleTextEditors(() => this.refresh()),
      window.onDidChangeTextEditorSelection(event => this.refresh(event.textEditor)),
      window.onDidChangeTextEditorVisibleRanges(event => this.refresh(event.textEditor)),
      workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('isabelleRevamp.prettySymbols')) this.refresh(); }),
    ];
    this.refresh();
  }
  // Replacements hidden by script controls never change for a version, so filter them once.
  private replacements(document: TextDocument): SymbolReplacement[] {
    const uri = document.uri.toString();
    let cached = this.cache.get(uri);
    if (cached?.version !== document.version) {
      const source = document.getText();
      const controls = scriptRanges(source).flatMap(group => group.controls).sort((a, b) => a[0] - b[0]);
      let next = 0;
      const replacements = symbolReplacements(source).filter(item => {
        while (next < controls.length && controls[next][1] <= item.start) next++;
        return !(next < controls.length && controls[next][0] < item.end);
      });
      cached = { version: document.version, replacements };
      this.cache.set(uri, cached);
    }
    return cached.replacements;
  }
  snapshot(editor: TextEditor): SymbolReplacement[] {
    const document = editor.document;
    if (document.languageId !== 'isabelle' || !workspace.getConfiguration('isabelleRevamp', document.uri).get('prettySymbols', true)) return [];
    const replacements = this.replacements(document);
    const visible = editor.visibleRanges;
    if (!visible.length) return [];
    const first = Math.max(0, visible[0].start.line - margin);
    const last = Math.min(document.lineCount - 1, visible[visible.length - 1].end.line + margin);
    const from = document.offsetAt(document.lineAt(first).range.start), to = document.offsetAt(document.lineAt(last).range.end);
    // Replacements are sorted by offset: binary search for the first one in the window.
    let low = 0, high = replacements.length;
    while (low < high) { const mid = (low + high) >> 1; if (replacements[mid].end <= from) low = mid + 1; else high = mid; }
    const selections = editor.selections.map(selection =>
      [document.offsetAt(selection.start), document.offsetAt(selection.end), selection.isEmpty] as const);
    const result: SymbolReplacement[] = [];
    for (let i = low; i < replacements.length && replacements[i].start < to; i++) {
      const item = replacements[i];
      if (!selections.some(([start, end, empty]) =>
        empty ? start >= item.start && start <= item.end : start < item.end && end > item.start)) result.push(item);
    }
    return result;
  }
  refresh(editor?: TextEditor): void {
    for (const target of editor ? [editor] : window.visibleTextEditors) {
      if (target.document.languageId !== 'isabelle') continue;
      const ranges = this.snapshot(target).map(item => ({
        range: new Range(target.document.positionAt(item.start), target.document.positionAt(item.end)),
        renderOptions: { before: { contentText: item.text } },
      }));
      target.setDecorations(this.decoration, ranges);
      this.scripts.update(target,visibleScripts(target));
    }
  }
  async toggle(): Promise<void> {
    const settings = workspace.getConfiguration('isabelleRevamp', window.activeTextEditor?.document.uri);
    await settings.update('prettySymbols', !settings.get('prettySymbols', true), ConfigurationTarget.Workspace);
  }
  dispose(): void { this.scripts.dispose(); this.decoration.dispose(); this.subscriptions.forEach(item => item.dispose()); this.cache.clear(); }
}
