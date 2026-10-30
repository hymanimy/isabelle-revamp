import { DecorationRangeBehavior, DecorationRenderOptions, Disposable, OverviewRulerLane, Range, TextEditor,
  TextEditorDecorationType, ThemeColor, window } from 'vscode';
import { Goals, SourceRange } from './goals';

// Isabelle/jEdit's command status colours: unprocessed text pink, running commands
// purple, failed or admitted ones red, plus marks in the scrollbar and dotted
// underlines for messages. Colours are theme colours (package.json "colors").
const styles: Record<string, DecorationRenderOptions> = {
  background_unprocessed1: { backgroundColor: new ThemeColor('isabelle.unprocessedBackground') },
  background_running1: { backgroundColor: new ThemeColor('isabelle.runningBackground') },
  background_canceled: { backgroundColor: new ThemeColor('isabelle.canceledBackground') },
  background_bad: { backgroundColor: new ThemeColor('isabelle.badBackground') },
  background_intensify: { backgroundColor: new ThemeColor('isabelle.intensifyBackground') },
  text_overview_unprocessed: { overviewRulerLane: OverviewRulerLane.Right, overviewRulerColor: new ThemeColor('isabelle.unprocessedOverview') },
  text_overview_running: { overviewRulerLane: OverviewRulerLane.Right, overviewRulerColor: new ThemeColor('isabelle.runningOverview') },
  dotted_writeln: dotted('isabelle.writelnUnderline'),
  dotted_information: dotted('isabelle.informationUnderline'),
  dotted_warning: dotted('isabelle.warningUnderline'),
};

function dotted(color: string): DecorationRenderOptions {
  return { borderStyle: 'none none dotted none', borderWidth: '0 0 2px 0', borderColor: new ThemeColor(color) };
}

export class StatusDecorations implements Disposable {
  private types = new Map(Object.entries(styles).map(([type, style]) =>
    [type, window.createTextEditorDecorationType({ ...style, rangeBehavior: DecorationRangeBehavior.ClosedClosed })]));
  // The ranges each editor shows, by identity: Goals replaces a type's array only when it changes.
  private shown = new WeakMap<TextEditor, Map<string, SourceRange[]>>();
  private subscriptions: Disposable[];

  constructor(private goals: Goals) {
    this.subscriptions = [goals.onDidUpdate(() => this.update()),
      window.onDidChangeVisibleTextEditors(() => this.update())];
    this.update();
  }

  private update(): void {
    for (const editor of window.visibleTextEditors) {
      if (editor.document.languageId !== 'isabelle') continue;
      const shown = this.shown.get(editor) ?? new Map<string, SourceRange[]>();
      this.shown.set(editor, shown);
      for (const [type, decoration] of this.types) {
        const ranges = this.goals.decorationRanges(editor.document, type);
        const previous = shown.get(type);
        if (previous === ranges || previous?.length === 0 && ranges.length === 0) continue;
        editor.setDecorations(decoration, ranges.map(range => new Range(...range)));
        shown.set(type, ranges);
      }
    }
  }

  // Ranges shown in an editor, by decoration type, for the integration checks.
  snapshot(editor: TextEditor): Record<string, SourceRange[]> {
    return Object.fromEntries([...this.shown.get(editor) ?? []].filter(([, ranges]) => ranges.length));
  }

  dispose(): void {
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.types.forEach(type => type.dispose());
  }
}
