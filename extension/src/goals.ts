import { Diagnostic, DiagnosticSeverity, Disposable, Range, TextDocument, TextEditor } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { GoalsView } from './goalsView';
import { outputText } from './outputText';

interface Caret { uri: string; line: number; character: number; version: number }
type SourceRange = [number, number, number, number];
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
  private generation = 0;
  private caret?: Caret;
  private document?: TextDocument;
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
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
        for (const entry of message.entries) {
          flags.set(entry.type, entry.content.length > 0);
          if (entry.type === 'background_bad') {
            this.badRanges.set(message.uri, entry.content.map(item => item.range));
          }
        }
        this.decorations.set(message.uri, flags);
        if (message.uri === this.caret?.uri) this.render();
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
    const next = document?.languageId === 'isabelle' && document.uri.scheme === 'file'
      ? { uri: document.uri.toString(), version: document.version,
          line: editor!.selection.active.line, character: editor!.selection.active.character }
      : undefined;
    if (JSON.stringify(next) === JSON.stringify(this.caret)) return;
    this.caret = next;
    const generation = ++this.generation;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.releasePanel();
    this.confirmed = undefined;
    this.dynamic = '';
    this.requestedAt = Date.now();
    this.view.update({ phase: next ? 'checking' : 'idle', text: '', errors: [] });
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
        this.view.update({ phase: 'unavailable', text: '', errors: [] });
      }
    } finally {
      if (--this.pending === 0) this.earlyStates.clear();
    }
  }

  private acceptState(text: string): void {
    this.confirmed = text;
    clearTimeout(this.deadline);
    this.render();
    if (this.caret) {
      void this.client.sendNotification('PIDE/decoration_request', { uri: this.caret.uri })
        .catch(() => this.unavailable());
    }
  }

  private render(): void {
    if (!this.caret || !this.available) return;
    const flags = this.decorations.get(this.caret.uri);
    const busy = [...busyTypes].some(type => flags?.get(type));
    const errors = this.diagnostics.get(this.caret.uri) ?? [];
    const failed = errors.length > 0 || [...errorTypes].some(type => flags?.get(type));
    if (busy || this.confirmed === undefined) {
      const phase = !busy && Date.now() - this.requestedAt >= 10000 ? 'unavailable' : 'checking';
      this.view.update({ phase, text: '', errors: [] });
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
    this.view.update({ phase, text: failed ? '' : text, errors });
  }

  unavailable(): void {
    this.available = false;
    ++this.generation;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.confirmed = undefined;
    this.view.update({ phase: 'unavailable', text: '', errors: [] });
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
  }
}
