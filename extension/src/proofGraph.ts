import { basename } from 'node:path';
import { DiagnosticSeverity, Disposable, EventEmitter, Position, Range, Selection, TextDocument, TextEditor, ViewColumn, window, languages } from 'vscode';
import { Goals, SourceRange } from './goals';
import { proofStructure, ProofStructure } from './isarSteps';
import { GraphFrame, GraphNode, GraphState } from './graphTypes';
import { unicodeSymbols } from './symbols';
import { ProofGraphPanel } from './proofGraphPanel';
import { GraphAnchors } from './graphAnchors';

export class ProofGraph implements Disposable {
  private editor?: TextEditor;
  private timer?: ReturnType<typeof setTimeout>;
  private hoverCache = new Map<string, Promise<string>>();
  private cache = new Map<string, { version: number; structure: ProofStructure }>();
  private starts = new Map<string, number>();
  private finishes = new Map<string, number>();
  private updates = new EventEmitter<GraphState | undefined>();
  readonly onDidUpdate = this.updates.event;
  private clock: ReturnType<typeof setInterval>;
  private logs = new Map<string, GraphFrame[]>();
  private signatures = new Map<string, string>();
  private tags = new Map<string, { name: string; until: number }>();
  private tagTimer?: ReturnType<typeof setTimeout>;
  private subscription: Disposable;
  readonly panel: ProofGraphPanel;
  readonly anchors: GraphAnchors;

  constructor(private goals: Goals, extensionPath: string) {
    this.anchors = new GraphAnchors(extensionPath);
    this.panel = new ProofGraphPanel(extensionPath, (uri, version, id) => this.select(uri, version, id), (uri, version, id) => this.hover(uri, version, id));
    this.subscription = goals.onDidUpdate(() => this.schedule());
    this.clock = setInterval(() => {
      const uri = this.editor?.document.uri.toString();
      if (uri && this.starts.has(uri) && !this.finishes.has(uri)) this.schedule();
    }, 1000);
  }
  follow(editor?: TextEditor): void {
    if (editor?.document.languageId === 'isabelle') this.editor = editor;
    this.schedule();
  }
  changed(document: TextDocument): void {
    if (document.languageId !== 'isabelle') return;
    if (!this.starts.has(document.uri.toString())) this.starts.set(document.uri.toString(), Date.now());
    this.finishes.delete(document.uri.toString());
    this.hoverCache.clear();
    this.schedule();
  }
  show(column?: ViewColumn): void {
    const editor = this.editor;
    if (editor && !editor.document.isClosed) {
      const roots = this.structure(editor.document).nodes.filter(node => !node.parent);
      const offset = editor.document.offsetAt(editor.selection.active);
      // print_state has no reply at a theory header. Opening the graph there
      // selects the nearest theorem, so checking still uses a tagged reply.
      if (roots.length && !roots.some(node => node.start <= offset && offset < node.end)) {
        const root = roots.filter(node => node.start <= offset).at(-1) ?? roots[0];
        const position = editor.document.positionAt(root.start);
        editor.selection = new Selection(position, position);
      }
      this.goals.follow(editor);
    }
    this.panel.show(column); this.refresh();
  }
  private schedule(): void {
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.refresh(); }, 150);
  }
  private structure(document: TextDocument): ProofStructure {
    const key = document.uri.toString(), cached = this.cache.get(key);
    if (cached?.version === document.version) return cached.structure;
    const structure = proofStructure(document.getText());
    this.cache.set(key, { version: document.version, structure }); return structure;
  }
  snapshot(document = this.editor?.document): GraphState | undefined {
    if (!document || document.isClosed) return;
    const uri = document.uri.toString(), source = this.structure(document);
    const processing = this.goals.processing(document), checked = this.goals.documentStatus(document).fully_checked;
    if (checked && this.starts.has(uri) && !this.finishes.has(uri)) this.finishes.set(uri, Date.now());
    const offsets = (range: SourceRange): [number, number] => [document.offsetAt(new Position(range[0], range[1])), document.offsetAt(new Position(range[2], range[3]))];
    const keywords = ['text_keyword1', 'text_keyword2', 'text_keyword3', 'text_improper']
      .flatMap(type => this.goals.decorationRanges(document, type)).map(offsets);
    const marked = (start: number, end: number) => keywords.some(([a, b]) => a <= start && b >= end);
    const sorry = this.goals.sorryPositions(document).map(offsets);
    const errors = languages.getDiagnostics(document.uri).filter(item => item.severity === DiagnosticSeverity.Error)
      .map(item => [document.offsetAt(item.range.start), document.offsetAt(item.range.end)] as [number, number]);
    errors.push(...this.goals.decorationRanges(document, 'text_overview_error').map(offsets));
    const pending = processing.pending.map(item => offsets(item.range));
    const bad = this.goals.decorationRanges(document, 'background_bad').map(offsets);
    const nodes = source.nodes.map(node => {
      // The entire named obligation includes every nested/unnamed command.
      const endOffset = node.end;
      const overlap = ([start, end]: [number, number]) => start === end
        ? start >= node.start && start < endOffset : start < endOffset && end > node.start;
      let status: GraphNode['status'] = sorry.some(overlap) ? 'open' : 'checking';
      if (processing.known) {
        if (node.abandoned) status = 'abandoned';
        else if (errors.some(overlap)) status = 'error';
        else if (sorry.some(overlap)) status = 'open';
        else if (!pending.some(overlap) && !bad.some(overlap) && node.closed && marked(node.start, node.commandEnd)
          && (!node.finish || marked(node.finish.start, node.finish.end))) status = 'proved';
      }
      if (!node.parent && status === 'proved' && !checked) status = 'checking';
      const start = document.positionAt(node.start), end = document.positionAt(node.end);
      const tag = this.tags.get(uri + '#' + node.id);
      return { id: node.id, name: unicodeSymbols(node.name), statement: unicodeSymbols(node.statement),
        line: start.line + 1, command: node.command, parent: node.parent ?? null, status,
        range: [start.line, start.character, end.line, end.character] as SourceRange,
        agent: tag && tag.until > Date.now() ? tag.name : undefined };
    });
    const cursor = this.editor?.document === document ? document.offsetAt(this.editor.selection.active) : -1;
    const focused = source.nodes.filter(node => node.start <= cursor && cursor < node.end).at(-1)?.id;
    return { focused, file: document.uri.fsPath, uri, version: document.version, theory: basename(document.uri.fsPath, '.thy'),
      nodes, edges: source.edges, complete: processing.processed, fully_checked: checked,
      proved: nodes.filter(node => node.status === 'proved').length, total: nodes.length,
      elapsed: this.starts.has(uri) ? (this.finishes.get(uri) ?? Date.now()) - this.starts.get(uri)! : 0 };
  }
  refresh(): void {
    const state = this.snapshot();
    this.anchors.update(state);
    this.updates.fire(state);
    if (!state) return;
    const signature = JSON.stringify([state.nodes.map(node => [node.id, node.parent, node.status]), state.edges, state.fully_checked]);
    const log = this.logs.get(state.uri) ?? [];
    if (this.signatures.get(state.uri) !== signature) {
      if (!log.length) log.push({ at: 0, state });
      else log.push({ at: state.elapsed, state });
      this.logs.set(state.uri, log); this.signatures.set(state.uri, signature);
    }
    this.panel.update(state, log);
  }
  editedNodes(document: TextDocument, range: Range): string[] {
    const start = document.offsetAt(range.start), end = document.offsetAt(range.end);
    const nodes = this.structure(document).nodes.filter(node => start === end
      ? start >= node.start && start < node.end : start < node.end && end > node.start);
    return nodes.filter(node => !nodes.some(child => child.parent === node.id)).map(node => node.id);
  }
  tag(document: TextDocument, ids: string[], name: string): void {
    for (const id of ids) this.tags.set(document.uri.toString() + '#' + id, { name, until: Date.now() + 10000 });
    this.expireTags();
    this.schedule();
  }
  private expireTags(): void {
    clearTimeout(this.tagTimer);
    for (const [id, tag] of this.tags) if (tag.until <= Date.now()) this.tags.delete(id);
    if (this.tags.size) this.tagTimer = setTimeout(() => {
      this.expireTags(); this.schedule();
    }, Math.max(1, Math.min(...[...this.tags.values()].map(tag => tag.until)) - Date.now()));
  }
  async hover(uri: string, version: number, id: string): Promise<string> {
    const document = this.editor?.document, state = this.snapshot();
    const node = state?.nodes.find(item => item.id === id);
    if (!document || !node || state?.uri !== uri || document.version !== version) return 'checking…';
    if (node.status === 'error') {
      const range = new Range(...node.range);
      const errors = languages.getDiagnostics(document.uri).filter(item => item.severity === DiagnosticSeverity.Error && range.intersection(item.range));
      return errors.map(item => item.message).join('\n') || 'Isabelle rejected a command in this step.';
    }
    if (node.status === 'abandoned') return 'Abandoned (oops).';
    const key = uri + ':' + version + ':' + id;
    if (!this.goals.processing(document).known) return 'checking…';
    if (!this.hoverCache.has(key)) this.hoverCache.set(key,
      this.goals.preview(document, node.range[0], node.range[1]).catch(() => 'Goal preview unavailable.'));
    const text = await this.hoverCache.get(key)!;
    if (text === 'checking…' || text.startsWith('Goal preview')) this.hoverCache.delete(key);
    return text;
  }
  async select(uri: string, version: number, id: string): Promise<void> {
    const document = this.editor?.document, state = this.snapshot();
    if (!document || document.isClosed || !state || uri !== state.uri || version !== document.version) return;
    const node = state.nodes.find(node => node.id === id);
    if (!node) return;
    const editor = await window.showTextDocument(document, { viewColumn: this.editor?.viewColumn, preserveFocus: false });
    const position = new Position(node.range[0], node.range[1]);
    editor.selection = new Selection(position, position); editor.revealRange(new Range(position, position));
    this.anchors.highlight(editor, position.line);
    this.goals.follow(editor); this.follow(editor);
  }
  dispose(): void { clearTimeout(this.timer); clearTimeout(this.tagTimer); clearInterval(this.clock); this.updates.dispose(); this.subscription.dispose(); this.panel.dispose(); this.anchors.dispose(); }
}
