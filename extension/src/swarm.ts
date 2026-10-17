import { basename } from 'node:path';
import { DiagnosticSeverity, Disposable, languages, Position, Range, Selection, TabInputText, TextDocument, TextEditor, window } from 'vscode';
import { Goals, SourceRange } from './goals';
import { proofSteps, ProofStep } from './isarSteps';
import { SwarmCard, SwarmView } from './swarmView';
import { unicodeSymbols } from './symbols';

export class Swarm implements Disposable {
  readonly view = new SwarmView((uri, version, id) => this.select(uri, version, id));
  private editor?: TextEditor;
  private timer?: ReturnType<typeof setTimeout>;
  private firstEdit = new Map<string, number>();
  private agents = new Map<string, { name: string; until: number }>();
  private updates: Disposable;
  private clock: ReturnType<typeof setInterval>;

  constructor(private goals: Goals) {
    this.updates = goals.onDidUpdate(() => this.schedule());
    this.clock = setInterval(() => {
      let expired = false;
      for (const [key, agent] of this.agents) if (agent.until <= Date.now()) { this.agents.delete(key); expired = true; }
      if (expired) this.schedule();
    }, 250);
  }

  follow(editor?: TextEditor): void {
    // Focusing a webview may hide the editor without selecting a different file.
    if (!editor) {
      const open = window.tabGroups.all.some(group => group.tabs.some(tab =>
        tab.input instanceof TabInputText && tab.input.uri.toString() === this.editor?.document.uri.toString()));
      if (!open) { this.editor = undefined; this.schedule(); }
      return;
    }
    this.editor = editor.document.languageId === 'isabelle' ? editor : undefined;
    this.schedule();
  }

  changed(document: TextDocument): void {
    if (document.languageId !== 'isabelle') return;
    const uri = document.uri.toString();
    if (!this.firstEdit.has(uri)) this.firstEdit.set(uri, Date.now());
    this.schedule();
  }

  private schedule(): void {
    // Coalesce bursts, but do not starve the board during continuous checking.
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.refresh(); }, 150);
  }

  private offsetRange(document: TextDocument, range: SourceRange): [number, number] {
    return [document.offsetAt(new Position(range[0], range[1])), document.offsetAt(new Position(range[2], range[3]))];
  }

  private overlaps(document: TextDocument, card: ProofStep, range: SourceRange): boolean {
    const [start, end] = this.offsetRange(document, range);
    return start === end ? start >= card.start && start < card.end : start < card.end && end > card.start;
  }

  private cards(document: TextDocument, cursor: number): ProofStep[] {
    return proofSteps(document.getText(), cursor);
  }

  // Capture the IDs before the edit moves source offsets. Called only for a
  // successful MCP edit; hand edits never invent an agent identity.
  editedCards(document: TextDocument, range: Range): string[] {
    const start = document.offsetAt(range.start), end = document.offsetAt(range.end);
    return this.cards(document, start).filter(card => start === end
      ? start >= card.start && start < card.end : start < card.end && end > card.start).map(card => card.id);
  }

  tag(document: TextDocument, ids: string[], name: string): void {
    for (const id of ids) this.agents.set(document.uri.toString() + '#' + id, { name, until: Date.now() + 10000 });
    this.schedule();
  }

  refresh(): void {
    const document = this.editor?.document;
    if (!document || document.isClosed) {
      this.view.update({ cards: [], proved: 0, fullyChecked: false }); return;
    }
    const uri = document.uri.toString();
    const processing = this.goals.processing(document);
    const keywordRanges = ['text_keyword1', 'text_keyword2', 'text_keyword3', 'text_improper']
      .flatMap(type => this.goals.decorationRanges(document, type));
    const marked = (start: number, end: number) => keywordRanges.some(range => {
      const [a, b] = this.offsetRange(document, range); return a <= start && b >= end;
    });
    const errors = languages.getDiagnostics(document.uri).filter(d => d.severity === DiagnosticSeverity.Error)
      .map(d => [d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character] as SourceRange);
    const cards = this.cards(document, document.offsetAt(this.editor!.selection.active)).map(card => {
      const overlap = (range: SourceRange) => this.overlaps(document, card, range);
      // Admissions are safe to show before a cursor state is available: the
      // stored range must still select the literal sorry in this buffer.
      let status: SwarmCard['status'] = this.goals.sorryPositions(document).some(overlap) ? 'sorry' : 'checking';
      if (processing.known) {
        // Errors win over admissions in the same card. All colours refer to
        // current-version annotations, never pre-edit cached ranges.
        if (errors.some(overlap) || this.goals.decorationRanges(document, 'text_overview_error').some(overlap)) status = 'error';
        else if (this.goals.sorryPositions(document).some(overlap)) status = 'sorry';
        else if (!processing.pending.some(item => overlap(item.range))
          && !this.goals.decorationRanges(document, 'background_bad').some(overlap)
          && card.closed && marked(card.start, card.commandEnd)
          && (!card.finish || marked(card.finish.start, card.finish.end))) status = 'proved';
      }
      const start = document.positionAt(card.start), end = document.positionAt(card.end);
      const agent = this.agents.get(uri + '#' + card.id);
      return { id: card.id, command: card.command, label: unicodeSymbols(card.label), status,
        range: [start.line, start.character, end.line, end.character] as SourceRange,
        agent: agent && agent.until > Date.now() ? agent.name : undefined };
    });
    this.view.update({ uri, version: document.version, theory: basename(document.uri.fsPath, '.thy'), cards,
      proved: cards.filter(card => card.status === 'proved').length,
      startedAt: this.firstEdit.get(uri), fullyChecked: this.goals.documentStatus(document).fully_checked });
  }

  async select(uri: string, version: number, id: string): Promise<void> {
    const state = this.view.snapshot();
    const document = this.editor?.document;
    if (!document || document.isClosed || document.uri.toString() !== uri
      || document.version !== version || state.uri !== uri) return;
    const card = state.cards.find(card => card.id === id);
    if (!card) return;
    const editor = await window.showTextDocument(document);
    const position = new Position(card.range[0], card.range[1]);
    editor.selection = new Selection(position, position);
    editor.revealRange(new Range(position, position));
    this.goals.follow(editor);
    this.follow(editor);
  }

  dispose(): void { clearTimeout(this.timer); clearInterval(this.clock); this.updates.dispose(); }
}
