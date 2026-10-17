import { basename } from 'node:path';
import { Diagnostic, DiagnosticSeverity, Disposable, EventEmitter, Range, TextDocument, TextEditor } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { GoalsView, GoalState } from './goalsView';
import { outputText } from './outputText';

interface Caret { uri: string; line: number; character: number; version: number }
export type SourceRange = [number, number, number, number];
interface Decoration { uri: string; entries: { type: string; content: { range: SourceRange }[] }[] }
interface StateOutput { id: number; content: string }

// PIDE/decoration messages are deltas: omitted entries retain their old value.
const busyTypes = new Set([
  'background_unprocessed1', 'background_running1', 'background_canceled',
  'text_overview_unprocessed', 'text_overview_running',
]);
// background_bad also marks `sorry`; it is not an error diagnostic.
const errorTypes = new Set(['text_overview_error']);

export class Goals implements Disposable {
  private updates = new EventEmitter<void>();
  readonly onDidUpdate = this.updates.event;
  private generation = 0;
  private caret?: Caret;
  private document?: TextDocument;
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private decorationTimer?: ReturnType<typeof setTimeout>;
  private panel?: number;
  private pending = 0;
  private earlyStates = new Map<number, string>();
  private confirmed?: string;
  private dynamic = '';
  private available = false;
  private requestedAt = 0;
  private decorations = new Map<string, Map<string, boolean>>();
  private badRanges = new Map<string, SourceRange[]>();
  private diagnostics = new Map<string, string[]>();
  private ranges = new Map<string, Map<string, SourceRange[]>>();
  private versions = new Map<string, number>();
  private confirmedVersions = new Map<string, number>();
  private annotatedVersions = new Map<string, number>();
  private subscriptions: Disposable[] = [];

  constructor(private client: LanguageClient, private view: GoalsView) {
    this.subscriptions.push(
      client.onNotification('PIDE/dynamic_output', ({ content }: { content: string }) => {
        this.dynamic = outputText(content);
        this.render();
      }),
      client.onNotification('PIDE/state_output', (message: StateOutput) => {
        const text = outputText(message.content);
        if (message.id === this.panel) this.acceptState(text);
        else if (this.pending) this.earlyStates.set(message.id, text);
      }),
      client.onNotification('PIDE/decoration', (message: Decoration) => {
        const flags = this.decorations.get(message.uri) ?? new Map<string, boolean>();
        const ranges = this.ranges.get(message.uri) ?? new Map<string, SourceRange[]>();
        for (const entry of message.entries) {
          flags.set(entry.type, entry.content.length > 0);
          ranges.set(entry.type, entry.content.map(item => item.range));
          if (entry.type === 'background_bad') {
            this.badRanges.set(message.uri, entry.content.map(item => item.range));
          }
        }
        this.decorations.set(message.uri, flags);
        this.ranges.set(message.uri, ranges);
        // A full snapshot after a fresh state query confirms annotations for
        // that version. Deltas alone must not certify a newly edited document.
        if ([...busyTypes, 'background_bad', 'text_overview_error'].every(type =>
          message.entries.some(entry => entry.type === type))) {
          const version = this.confirmedVersions.get(message.uri);
          if (version !== undefined && version === this.versions.get(message.uri)) {
            this.annotatedVersions.set(message.uri, version);
          }
        }
        if (message.uri === this.caret?.uri) {
          this.render();
          clearTimeout(this.decorationTimer);
          // force_decorations does not advance the server's delta baseline.
          // A transient busy range in a forced snapshot might never be cleared
          // by a normal delta. Refresh while busy so it cannot stick forever.
          if (this.available && [...busyTypes].some(type => flags.get(type))) {
            this.decorationTimer = setTimeout(() => this.refreshDecorations(message.uri), 250);
          }
        }
        this.updates.fire();
      }),
    );
  }

  ready(editor?: TextEditor): void {
    this.available = true;
    this.caret = undefined;
    this.follow(editor);
  }

  follow(editor?: TextEditor): void {
    const document = editor?.document;
    this.document = document;
    if (document) this.observe(document);
    const next = document?.languageId === 'isabelle' && document.uri.scheme === 'file'
      ? { uri: document.uri.toString(), version: document.version,
          line: editor!.selection.active.line, character: editor!.selection.active.character }
      : undefined;
    if (JSON.stringify(next) === JSON.stringify(this.caret)) return;
    this.caret = next;
    const generation = ++this.generation;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    clearTimeout(this.decorationTimer);
    this.releasePanel();
    this.confirmed = undefined;
    this.dynamic = '';
    this.requestedAt = Date.now();
    this.publish({ phase: next ? 'checking' : 'idle', text: '', errors: [] });
    if (!this.available) return;
    if (!next) {
      void this.client.sendNotification('PIDE/caret_update', {}).catch(() => this.unavailable());
      return;
    }
    this.timer = setTimeout(() => { void this.refresh(generation, next); }, 150);
    this.deadline = setTimeout(() => {
      if (generation === this.generation) this.render();
    }, 10000);
  }

  setDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
    this.diagnostics.set(uri, diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
      .map(d => d.message));
    if (uri === this.caret?.uri) this.render();
    this.updates.fire();
  }

  private async refresh(generation: number, caret: Caret): Promise<void> {
    this.pending++;
    try {
      const { uri, line, character } = caret;
      await this.client.sendNotification('PIDE/caret_update', { uri, line, character });
      if (generation !== this.generation) return;
      // Dynamic output has no cursor/version ID. A fresh built-in state panel
      // supplies a tagged confirmation and re-emits identical goal text.
      const { state_id } = await this.client.sendRequest<{ state_id: number }>('PIDE/state_init', {});
      if (generation !== this.generation) {
        await this.client.sendNotification('PIDE/state_exit', { id: state_id });
        return;
      }
      this.panel = state_id;
      const early = this.earlyStates.get(state_id);
      if (early !== undefined) this.acceptState(early);
    } catch {
      if (generation === this.generation) {
        clearTimeout(this.deadline);
        this.publish({ phase: 'unavailable', text: '', errors: [] });
      }
    } finally {
      if (--this.pending === 0) this.earlyStates.clear();
    }
  }

  private acceptState(text: string): void {
    this.confirmed = text;
    if (this.caret) this.confirmedVersions.set(this.caret.uri, this.caret.version);
    clearTimeout(this.deadline);
    this.render();
    if (this.caret) {
      this.refreshDecorations(this.caret.uri);
    }
    this.updates.fire();
  }

  private refreshDecorations(uri: string): void {
    void this.client.sendNotification('PIDE/decoration_request', { uri })
      .catch(() => this.unavailable());
  }

  private render(): void {
    if (!this.caret || !this.available) return;
    const flags = this.decorations.get(this.caret.uri);
    const busy = [...busyTypes].some(type => flags?.get(type));
    const errors = this.diagnostics.get(this.caret.uri) ?? [];
    const failed = errors.length > 0 || [...errorTypes].some(type => flags?.get(type));
    if (busy || this.confirmed === undefined) {
      const phase = !busy && Date.now() - this.requestedAt >= 10000 ? 'unavailable' : 'checking';
      this.publish({ phase, text: '', errors: [] });
      return;
    }
    // Only accept untagged dynamic output if it agrees with the current state.
    // Rich messages that disagree (e.g. a failed tactic) stay in diagnostics.
    const text = this.dynamic === this.confirmed ? this.dynamic : this.confirmed;
    // Isabelle marks an admitted command as background_bad. Match its actual
    // source range: mentions in comments/quoted text are not admissions, and
    // other bad markup must not be mistaken for `sorry`.
    const unfinished = (this.badRanges.get(this.caret.uri) ?? []).some(range =>
      this.document?.getText(new Range(...range)) === 'sorry');
    // A failed method can inherit a parent's "No subgoals!" state. Show its
    // diagnostic instead, never that misleading state under an error banner.
    const phase = failed ? 'error' : unfinished ? 'unfinished' : 'ready';
    this.publish({ phase, text: failed ? '' : text, errors });
  }

  private publish(state: GoalState): void {
    const document = this.caret ? this.document : undefined;
    this.view.update({ ...state,
      // Isabelle theory files are named after their theory; no source parser is needed.
      theory: document ? basename(document.uri.fsPath, '.thy') : undefined,
      checkStatus: document ? this.documentStatus(document).state : undefined,
    });
  }

  unavailable(): void {
    this.available = false;
    ++this.generation;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    clearTimeout(this.decorationTimer);
    this.confirmed = undefined;
    this.confirmedVersions.clear();
    this.annotatedVersions.clear();
    this.publish({ phase: 'unavailable', text: '', errors: [] });
    this.updates.fire();
  }

  observe(document: TextDocument): void {
    if (document.languageId !== 'isabelle') return;
    const uri = document.uri.toString();
    if (this.versions.get(uri) !== document.version) {
      this.versions.set(uri, document.version);
      // Imports may depend on this file, so invalidate their cached completion too.
      this.confirmedVersions.clear();
      this.annotatedVersions.clear();
      this.updates.fire();
    }
  }

  matches(document: TextDocument, line: number, character: number): boolean {
    return this.caret?.uri === document.uri.toString() && this.caret.version === document.version
      && this.caret.line === line && this.caret.character === character;
  }

  processing(document: TextDocument) {
    const uri = document.uri.toString();
    const ranges = this.ranges.get(uri);
    const known = this.available && this.annotatedVersions.get(uri) === document.version;
    const pending = [...busyTypes].flatMap(type => (ranges?.get(type) ?? []).map(range => ({ type, range })));
    const processed = known && pending.length === 0;
    return { file: document.uri.fsPath, version: document.version, known, processed,
      processing: !processed, pending };
  }

  sorryPositions(document: TextDocument): SourceRange[] {
    return (this.badRanges.get(document.uri.toString()) ?? [])
      .filter(range => document.getText(new Range(...range)) === 'sorry');
  }

  decorationRanges(document: TextDocument, type: string): SourceRange[] {
    return this.ranges.get(document.uri.toString())?.get(type) ?? [];
  }

  documentStatus(document: TextDocument) {
    const processing = this.processing(document);
    const uri = document.uri.toString();
    const ranges = this.ranges.get(uri);
    const keywords = ['text_keyword1', 'text_keyword2', 'text_keyword3', 'text_improper']
      .flatMap(type => ranges?.get(type) ?? [])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(range => document.getText(new Range(...range)));
    const theoryClosed = keywords[0] === 'theory' && keywords.at(-1) === 'end'
      && keywords.filter(word => word === 'begin').length === keywords.filter(word => word === 'end').length;
    const errors = this.diagnostics.get(uri) ?? [];
    const failed = errors.length > 0 || this.decorations.get(uri)?.get('text_overview_error') === true;
    const sorry = this.sorryPositions(document);
    const incomplete = sorry.length > 0 || keywords.includes('oops') || !theoryClosed
      || (this.badRanges.get(uri)?.length ?? 0) > 0;
    const state: NonNullable<GoalState['checkStatus']> = !processing.processed ? 'checking'
      : failed ? 'error' : incomplete ? 'unfinished' : 'fully_checked';
    return { ...processing, state, fully_checked: state === 'fully_checked',
      saved: !document.isDirty, theory_closed: theoryClosed, sorry_count: sorry.length, has_errors: failed, errors };
  }

  private releasePanel(): void {
    if (this.panel !== undefined) {
      void this.client.sendNotification('PIDE/state_exit', { id: this.panel }).catch(() => {});
      this.panel = undefined;
    }
  }

  dispose(): void {
    this.releasePanel();
    this.unavailable();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.updates.dispose();
  }
}
