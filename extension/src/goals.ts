import { basename } from 'node:path';
import { Diagnostic, DiagnosticSeverity, Disposable, EventEmitter, Range, TextDocument, TextEditor } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { GoalsView, GoalState } from './goalsView';
import { outputText } from './outputText';

interface Caret { uri: string; line: number; character: number; version: number }
export type SourceRange = [number, number, number, number];
interface Decoration { uri: string; entries: { type: string; content: { range: SourceRange }[] }[] }
interface StateOutput { id: number; content: string }
interface Probe { uri: string; version: number; state?: string }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Isabelle batches output every vscode_output_delay (0.5 s); a command's messages
// can follow its proof state by one batch.
const outputSettle = 700;
// Each caret move changes the checking perspective, which Isabelle treats as a
// document update; it publishes output (diagnostics included) only for an up-to-date
// snapshot. Leave the caret still this long between holds so output can flush.
const caretQuiet = 1000;

// PIDE/decoration messages are deltas: omitted entries retain their old value.
const busyTypes = new Set([
  'background_unprocessed1', 'background_running1', 'background_canceled',
  'text_overview_unprocessed', 'text_overview_running',
]);
// background_bad also marks `sorry`; it is not an error diagnostic.

// Commands that run inside a proof, so the prover prints a proof state for them.
const proofCommands = new Set(['lemma', 'theorem', 'corollary', 'proposition', 'schematic_goal', 'proof', 'by', 'apply',
  'apply_end', 'subgoal', 'have', 'show', 'hence', 'thus', 'obtain', 'consider', 'fix', 'assume', 'presume', 'define',
  'let', 'note', 'from', 'with', 'then', 'using', 'unfolding', 'supply', 'next', 'case', 'also', 'finally', 'moreover',
  'ultimately', 'sorry']);

// The last line starting with a proof command, if any.
export function lastProofLine(source: string): number | undefined {
  const lines = source.split('\n');
  for (let line = lines.length - 1; line >= 0; line--) {
    if (proofCommands.has(/^\s*([a-z_]+)/.exec(lines[line])?.[1] ?? '')) return line;
  }
  return undefined;
}

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
  private navigation: Promise<void> = Promise.resolve();
  private earlyStates = new Map<number, string>();
  private probes = new Map<number, Probe>();
  private outputAt = 0;
  private caretRestoredAt = 0;
  private confirmed?: string;
  private confirmedHtml?: string;
  // Mirrors the server's caret panel, which only sends changed output.
  private dynamic = '';
  private dynamicHtml = '';
  private available = false;
  private requestedAt = 0;
  private decorations = new Map<string, Map<string, boolean>>();
  private badRanges = new Map<string, SourceRange[]>();
  private diagnostics = new Map<string, { message: string; range: SourceRange }[]>();
  private ranges = new Map<string, Map<string, SourceRange[]>>();
  private versions = new Map<string, number>();
  private confirmedVersions = new Map<string, number>();
  private annotatedVersions = new Map<string, number>();
  private changedAt = new Map<string, number>();
  private subscriptions: Disposable[] = [];

  constructor(private client: LanguageClient, private view: GoalsView) {
    this.subscriptions.push(
      client.onNotification('PIDE/dynamic_output', ({ content }: { content: string }) => {
        this.dynamic = outputText(content);
        this.dynamicHtml = content;
        this.outputAt = Date.now();
        this.render();
      }),
      client.onNotification('PIDE/state_output', (message: StateOutput) => {
        const text = message.content;
        const probe = this.probes.get(message.id);
        if (probe) this.acceptProbe(probe, text);
        else if (message.id === this.panel) this.acceptState(text);
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
          if (this.available && this.busyBeforeCaret()) {
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
    this.confirmedHtml = undefined;
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
      .map(d => ({ message: d.message, range: [d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character] })));
    if (uri === this.caret?.uri) this.render();
    this.updates.fire();
  }

  private navigate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.navigation.then(operation, operation);
    this.navigation = next.then(() => {}, () => {}); return next;
  }

  private async refresh(generation: number, caret: Caret): Promise<void> {
    return this.navigate(async () => {
      if (generation !== this.generation) return;
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
    });
  }

  // Point the prover at a position other than the user's cursor while `work` runs,
  // then restore the user's caret. Isabelle checks text near its caret, so this also
  // checks text out of the user's view; results persist after the caret returns.
  // Holds the prover's single caret, so the user's own goal waits until `work` ends.
  private hold<T>(document: TextDocument, line: number, character: number, work: (probe: Probe) => Promise<T>): Promise<T> {
    if (!this.available) return Promise.reject(new Error('Isabelle is not running.'));
    this.observe(document);
    return this.navigate(async () => {
      await pause(this.caretRestoredAt + caretQuiet - Date.now());
      const uri = document.uri.toString(), existing = this.panel;
      const probe: Probe = { uri, version: document.version };
      this.pending++;
      let id: number | undefined;
      try {
        if (existing !== undefined) await this.client.sendNotification('PIDE/state_auto_update', { id: existing, enabled: false });
        await this.client.sendNotification('PIDE/caret_update', { uri, line, character });
        id = (await this.client.sendRequest<{ state_id: number }>('PIDE/state_init', {})).state_id;
        this.probes.set(id, probe);
        const early = this.earlyStates.get(id);
        if (early !== undefined) this.acceptProbe(probe, early);
        return await work(probe);
      } finally {
        if (id !== undefined) {
          this.probes.delete(id);
          void this.client.sendNotification('PIDE/state_exit', { id }).catch(() => {});
        }
        if (--this.pending === 0) this.earlyStates.clear();
        const caret = this.caret;
        await this.client.sendNotification('PIDE/caret_update', caret
          ? { uri: caret.uri, line: caret.line, character: caret.character } : {}).catch(() => {});
        this.caretRestoredAt = Date.now();
        if (existing !== undefined && existing === this.panel) {
          await this.client.sendNotification('PIDE/state_auto_update', { id: existing, enabled: true }).catch(() => {});
        }
      }
    });
  }

  private acceptProbe(probe: Probe, text: string): void {
    probe.state = text;
    this.outputAt = Date.now();
    // Like the user's panel, a tagged state confirms the annotations of this version.
    if (this.versions.get(probe.uri) === probe.version) {
      this.confirmedVersions.set(probe.uri, probe.version);
      this.refreshDecorations(probe.uri);
    }
  }

  // The goal and messages at a position, once everything up to it is checked and
  // its output has settled. Never moves the user's cursor.
  async stateAt(document: TextDocument, line: number, character: number, timeout = 30000): Promise<GoalState> {
    return this.hold(document, line, character, async probe => {
      const deadline = Date.now() + timeout;
      let checkedAt: number | undefined;
      while (Date.now() < deadline) {
        if (document.isClosed || document.version !== probe.version) {
          throw new Error('The document changed during the query. Retry goals_at.');
        }
        const checked = this.annotatedVersions.get(probe.uri) === probe.version
          && !this.busyBefore(probe.uri, line, character);
        checkedAt = checked ? checkedAt ?? Date.now() : undefined;
        if (checked && probe.state !== undefined && Date.now() - this.outputAt >= outputSettle) {
          return { ...this.present(document, line, probe.state),
            theory: basename(document.uri.fsPath, '.thy'), checkStatus: this.documentStatus(document).state };
        }
        // A blank line or the theory header has no proof state.
        if (checkedAt !== undefined && probe.state === undefined && Date.now() - checkedAt > 3000) {
          throw new Error('No goal state at this position; choose a proof command.');
        }
        await pause(25);
      }
      throw new Error('Isabelle is still checking; query processing_status and retry goals_at.');
    });
  }

  // Check all of a theory, not just near the user's cursor, for up to `budget` ms.
  // An unfinished check keeps its progress, so repeated calls converge.
  async checkWhole(document: TextDocument, budget = 15000): Promise<void> {
    const deadline = Date.now() + budget, uri = document.uri.toString(), version = document.version;
    const current = () => Date.now() < deadline && !document.isClosed && document.version === version;
    if (this.processing(document).processed) return;
    // Holding the prover at the end makes Isabelle check everything before it.
    await this.hold(document, Math.max(0, document.lineCount - 1), 0, async () => {
      while (current() && [...busyTypes].some(type => this.decorationRanges(uri, type).length)) await pause(50);
    });
    if (this.processing(document).known || !current()) return;
    // Annotations count only once a tagged proof state confirms their version, and
    // theory-level commands (qed, end, definitions) have no proof state.
    const line = lastProofLine(document.getText());
    if (line !== undefined) {
      await this.hold(document, line, 0, async () => {
        while (current() && !this.processing(document).known) await pause(50);
      });
    } else {
      // No proof to confirm with: trust annotations once the text has been stable well
      // past Isabelle's input and output delays (0.1 s + 0.5 s).
      while (current() && Date.now() - (this.changedAt.get(uri) ?? 0) < 1500) await pause(50);
      if (!current()) return;
      this.confirmedVersions.set(uri, version);
      this.refreshDecorations(uri);
      while (current() && !this.processing(document).known) await pause(50);
    }
  }

  private acceptState(text: string): void {
    this.confirmed = outputText(text);
    this.confirmedHtml = text;
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

  // Isabelle checks only near the cursor, so later commands may stay unprocessed
  // indefinitely. The goal at the caret waits only for work at or before it.
  private busyBeforeCaret(): boolean {
    return this.caret !== undefined && this.busyBefore(this.caret.uri, this.caret.line, this.caret.character);
  }

  private busyBefore(uri: string, line: number, character: number): boolean {
    const ranges = this.ranges.get(uri);
    return [...busyTypes].some(type => (ranges?.get(type) ?? []).some(([start, column]) =>
      start < line || start === line && column <= character));
  }

  private render(): void {
    if (!this.caret || !this.available) return;
    const busy = this.busyBeforeCaret();
    if (busy || this.confirmed === undefined || !this.document) {
      const phase = !busy && Date.now() - this.requestedAt >= 10000 ? 'unavailable' : 'checking';
      this.publish({ phase, text: '', errors: [] });
      return;
    }
    this.publish(this.present(this.document, this.caret.line, this.confirmedHtml!));
  }

  private present(document: TextDocument, line: number, stateHtml: string): GoalState {
    const uri = document.uri.toString();
    // Untagged dynamic output prints the state plus the command's messages
    // (e.g. try0's "Try this"). Accept it only if it contains the tagged state.
    const state = outputText(stateHtml);
    const messages = state !== '' && this.dynamic.includes(state);
    const text = messages ? this.dynamic : state;
    const html = messages ? this.dynamicHtml : stateHtml;
    // Like jEdit, report errors of the command at the caret, not elsewhere in the theory.
    const atCaret = ([start, , end]: SourceRange) => start <= line && line <= end;
    const errors = (this.diagnostics.get(uri) ?? []).filter(d => atCaret(d.range)).map(d => d.message);
    const failed = errors.length > 0 || this.decorationRanges(uri, 'text_overview_error').some(atCaret);
    // Isabelle marks an admitted command as background_bad. Match its actual
    // source range: mentions in comments/quoted text are not admissions, and
    // other bad markup must not be mistaken for `sorry`.
    const unfinished = (this.badRanges.get(uri) ?? []).some(range => document.getText(new Range(...range)) === 'sorry');
    // A failed method can inherit a parent's "No subgoals!" state. Show its
    // diagnostic instead, never that misleading state under an error banner.
    const phase = failed ? 'error' : unfinished ? 'unfinished' : 'ready';
    return { phase, text: failed ? '' : text, html: failed ? undefined : html, errors };
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
    this.confirmedHtml = undefined;
    this.dynamic = '';
    this.dynamicHtml = '';
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
      this.changedAt.set(uri, Date.now());
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

  // Whether the server has sent any decorations for this file, i.e. it is a checked node.
  annotated(uri: string): boolean { return this.ranges.has(uri); }

  decorationRanges(document: TextDocument | string, type: string): SourceRange[] {
    return this.ranges.get(typeof document === 'string' ? document : document.uri.toString())?.get(type) ?? [];
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
    const errors = (this.diagnostics.get(uri) ?? []).map(d => d.message);
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
