import { DecorationOptions, DecorationRangeBehavior, Disposable, Range, TextDocumentChangeEvent,
  TextEditor, TextEditorDecorationType, ThemeColor, window, workspace } from 'vscode';

interface Flash {
  editor: TextEditor;
  start: number;
  end: number;
  agent: string;
  at: number;
}

// These decorations never enter the document, undo history, or PIDE stream.
export class AgentEdits implements Disposable {
  private marker = window.createTextEditorDecorationType({
    after: { color: new ThemeColor('editorInfo.foreground'), margin: '0 0 0 1em' },
    rangeBehavior: DecorationRangeBehavior.ClosedClosed });
  private fades = Array.from({ length: 20 }, (_, i) => window.createTextEditorDecorationType({
    backgroundColor: `color-mix(in srgb, var(--vscode-editorInfo-foreground, #3794ff) ${30 - i * 1.5}%, transparent)`,
    rangeBehavior: DecorationRangeBehavior.ClosedClosed }));
  private flashes: Flash[] = [];
  private painted = new Map<TextEditor, Set<TextEditorDecorationType>>();
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private listeners: Disposable[];

  constructor() {
    this.listeners = [
      workspace.onDidChangeTextDocument(event => this.changed(event)),
      workspace.onDidCloseTextDocument(document => {
        this.flashes = this.flashes.filter(f => f.editor.document !== document);
        this.render();
      }),
      workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('isabelleRevamp.showAgentEdits')) return;
        this.flashes = this.flashes.filter(f => this.enabled(f.editor));
        this.render();
      }),
    ];
  }

  private enabled(editor: TextEditor): boolean {
    return !this.disposed && workspace.getConfiguration('isabelleRevamp', editor.document.uri).get('showAgentEdits', true);
  }

  applied(editor: TextEditor, range: Range, agent: string): void {
    if (!this.enabled(editor)) return;
    this.flashes.push({ editor, start: editor.document.offsetAt(range.start),
      end: editor.document.offsetAt(range.end), agent, at: Date.now() });
    this.render();
    this.timer ??= setInterval(() => this.render(), 100);
  }

  private changed(event: TextDocumentChangeEvent): void {
    if (!event.contentChanges.length) return;
    // Changes use offsets in the old buffer. Descending order keeps offsets
    // valid, including multi-cursor edits. Never attribute human typing to an agent.
    const changes = [...event.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
    this.flashes = this.flashes.filter(flash => {
      if (flash.editor.document !== event.document) return true;
      for (const change of changes) {
        const end = change.rangeOffset + change.rangeLength;
        if (end <= flash.start) {
          const delta = change.text.length - change.rangeLength;
          flash.start += delta; flash.end += delta;
        } else if (change.rangeOffset < flash.end || (flash.start === flash.end && change.rangeOffset === flash.start)) {
          return false;
        }
      }
      return true;
    });
    this.render();
  }

  private range(flash: Flash): Range {
    const document = flash.editor.document;
    return new Range(document.positionAt(flash.start), document.positionAt(flash.end));
  }

  private render(): void {
    const now = Date.now();
    this.flashes = this.flashes.filter(f => now - f.at < 3000 && !f.editor.document.isClosed);
    const next = new Map<TextEditor, Map<TextEditorDecorationType, DecorationOptions[]>>();
    const add = (editor: TextEditor, type: TextEditorDecorationType, option: DecorationOptions) => {
      if (!next.has(editor)) next.set(editor, new Map());
      const decorations = next.get(editor)!;
      if (!decorations.has(type)) decorations.set(type, []);
      decorations.get(type)!.push(option);
    };
    for (const flash of this.flashes) {
      const age = now - flash.at, range = this.range(flash);
      if (age < 2000) add(flash.editor, this.fades[Math.floor(age / 100)], { range });
      // An inserted trailing newline belongs to the preceding edited line.
      const line = range.end.line > range.start.line && range.end.character === 0 ? range.end.line - 1 : range.end.line;
      const end = flash.editor.document.lineAt(line).range.end;
      add(flash.editor, this.marker, { range: new Range(end, end),
        renderOptions: { after: { contentText: `✎ ${flash.agent}` } } });
    }
    for (const [editor, types] of this.painted) for (const type of types) {
      if (!next.get(editor)?.has(type)) editor.setDecorations(type, []);
    }
    this.painted.clear();
    for (const [editor, decorations] of next) {
      for (const [type, options] of decorations) editor.setDecorations(type, options);
      this.painted.set(editor, new Set(decorations.keys()));
    }
    if (!this.flashes.length) { clearInterval(this.timer); this.timer = undefined; }
  }

  // Inspect the same ranges/lifetimes sent to VS Code in the live host check.
  snapshot() {
    const coordinates = (range: Range) => [range.start.line, range.start.character, range.end.line, range.end.character];
    return { flashes: this.flashes.map(f => ({ file: f.editor.document.uri.fsPath, range: coordinates(this.range(f)), agent: f.agent,
      opacity: Math.max(0, 30 - Math.floor((Date.now() - f.at) / 100) * 1.5), marker: `✎ ${f.agent}` })) };
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    this.flashes = []; this.render();
    for (const listener of this.listeners) listener.dispose();
    for (const decoration of [this.marker, ...this.fades]) decoration.dispose();
  }
}
