import { Disposable, Range, TextEditor, TextEditorDecorationType, ThemeColor, Uri, window } from 'vscode';
import { GraphState, GraphStatus } from './graphTypes';

export class GraphAnchors implements Disposable {
  private dots = new Map<GraphStatus, TextEditorDecorationType>();
  private flash = window.createTextEditorDecorationType({ isWholeLine: true,
    backgroundColor: new ThemeColor('editor.wordHighlightStrongBackground') });
  private timer?: ReturnType<typeof setTimeout>;
  private flashed?: TextEditor;
  private state?: GraphState;
  private highlightLine?: number;
  constructor(extensionPath: string) {
    for (const status of ['open', 'checking', 'proved', 'error', 'abandoned'] as GraphStatus[]) {
      this.dots.set(status, window.createTextEditorDecorationType({ gutterIconPath:
        Uri.joinPath(Uri.file(extensionPath), 'media', `dot-${status === 'abandoned' ? 'error' : status}.svg`), gutterIconSize: 'contain' }));
    }
  }
  update(state?: GraphState): void {
    this.state = state;
    for (const editor of window.visibleTextEditors) {
      const current = state?.uri === editor.document.uri.toString() && state.version === editor.document.version;
      for (const [status, decoration] of this.dots) editor.setDecorations(decoration, current
        ? state.nodes.filter(node => node.status === status).map(node => new Range(node.range[0], 0, node.range[0], 0)) : []);
    }
  }
  highlight(editor: TextEditor, line: number): void {
    clearTimeout(this.timer); this.flashed?.setDecorations(this.flash, []);
    this.flashed = editor; this.highlightLine = line + 1;
    editor.setDecorations(this.flash, [new Range(line, 0, line, 0)]);
    this.timer = setTimeout(() => { editor.setDecorations(this.flash, []); this.highlightLine = undefined; }, 1000);
  }
  snapshot() { return { highlightLine: this.highlightLine,
    dots: this.state?.nodes.map(node => ({ id: node.id, line: node.line, status: node.status })) ?? [] }; }
  dispose(): void { clearTimeout(this.timer); this.flash.dispose(); for (const dot of this.dots.values()) dot.dispose(); }
}
