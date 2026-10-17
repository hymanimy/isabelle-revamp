import { Disposable, EventEmitter, languages, Range, SemanticTokens, SemanticTokensBuilder, SemanticTokensLegend, TextDocument } from 'vscode';
import { Goals } from './goals';

// Meanings come from PIDE, not guesses about identifier spelling.
// Reference: Isabelle src/Tools/VSCode/extension/src/decorations.ts text_colors.
const kinds = ['free', 'bound', 'skolem', 'tfree', 'tvar', 'var'] as const;
export const semanticLegend = new SemanticTokensLegend(kinds.map(kind => 'isabelle_' + kind));
export class SemanticColors implements Disposable {
  private changed = new EventEmitter<void>();
  private subscriptions: Disposable[];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private goals: Goals) {
    this.subscriptions = [languages.registerDocumentSemanticTokensProvider(
      { language: 'isabelle', scheme: 'file' }, {
        onDidChangeSemanticTokens: this.changed.event,
        provideDocumentSemanticTokens: document => this.tokens(document),
      }, semanticLegend), goals.onDidUpdate(() => {
        if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.changed.fire(); }, 150);
      })];
  }
  snapshot(document: TextDocument) {
    if (!this.goals.processing(document).known) return [];
    return kinds.flatMap(kind => this.goals.decorationRanges(document, 'text_' + kind)
      .filter(range => range[0] === range[2] && range[3] > range[1])
      .map(range => ({ kind, range, text: document.getText(new Range(...range)) })))
      .sort((a,b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
  }
  private tokens(document: TextDocument): SemanticTokens {
    const builder = new SemanticTokensBuilder(semanticLegend);
    let previous = [-1,-1];
    for (const item of this.snapshot(document)) {
      const [line,start,,end] = item.range;
      if (line === previous[0] && start < previous[1]) continue;
      builder.push(new Range(line,start,line,end), 'isabelle_' + item.kind);
      previous = [line,end];
    }
    return builder.build();
  }
  dispose(): void { clearTimeout(this.timer); this.changed.dispose(); this.subscriptions.forEach(item=>item.dispose()); }
}
