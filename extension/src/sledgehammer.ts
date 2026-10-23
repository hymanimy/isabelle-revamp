import { Disposable, EventEmitter, Range, TextDocument, Uri, workspace, WorkspaceEdit } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { Goals } from './goals';
import { proofEdit, suggestedProofs } from './suggestions';
import { encodeSymbols, unicodeSymbols } from './symbols';

// Sledgehammer through Isabelle's own query, as in jEdit's Sledgehammer panel: it runs
// on the command at the prover's caret as a temporary overlay, so the theory is never
// edited. The server holds one query at a time, shared by the user and MCP agents.
export type SledgehammerStatus = 'waiting' | 'running' | 'finished';
export interface SledgehammerRun {
  owner: string; uri: string; line: number; character: number;
  status: SledgehammerStatus; cancelled: boolean;
  messages: { kind: string; text: string }[]; proofs: string[];
}

// The server's output is Isabelle XML: one element per message, such as
// <writeln_message>e: Try this: <sendback …><block …>by force</block></sendback> (11 ms)</writeln_message>.
export function sledgehammerMessages(xml: string): { kind: string; text: string }[] {
  const entities: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  return [...xml.matchAll(/<(\w+)_message\b[^>]*>([\s\S]*?)<\/\1_message>/g)].map(([, kind, body]) => ({ kind,
    text: unicodeSymbols(body.replace(/<[^>]*>/g, '').replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => entities[name])) }));
}

const statuses: Record<string, SledgehammerStatus> = {
  'Waiting for evaluation of context ...': 'waiting', 'Sledgehammering ...': 'running', 'Finished': 'finished',
};

export class Sledgehammer implements Disposable {
  private changes = new EventEmitter<SledgehammerRun | undefined>();
  readonly onDidChange = this.changes.event;
  private subscriptions: Disposable[];
  private statusListeners: ((status: SledgehammerStatus) => void)[] = [];
  private provers?: Promise<string>;
  run?: SledgehammerRun;

  constructor(private client: LanguageClient, private goals: Goals) {
    this.subscriptions = [
      client.onNotification('PIDE/sledgehammer_status', ({ message }: { message: string }) => {
        const status = statuses[message] ?? 'running';
        this.statusListeners.splice(0).forEach(listener => listener(status));
        if (this.run) { this.run.status = status; this.changes.fire(this.run); }
      }),
      client.onNotification('PIDE/sledgehammer_output', ({ content }: { content: string }) => {
        if (!this.run) return;
        this.run.messages = sledgehammerMessages(content);
        this.run.proofs = suggestedProofs(this.run.messages.map(message => message.text));
        this.changes.fire(this.run);
      }),
    ];
  }

  get active(): boolean { return !!this.run && this.run.status !== 'finished'; }

  // The prover list from Isabelle's sledgehammer_provers option.
  private proverList(): Promise<string> {
    this.provers ??= new Promise<string>(resolve => {
      const subscription = this.client.onNotification('PIDE/sledgehammer_provers_response', ({ provers }: { provers: string }) => {
        subscription.dispose();
        resolve(provers);
      });
      void this.client.sendNotification('PIDE/sledgehammer_provers_request');
    });
    return this.provers;
  }

  private nextStatus(timeout: number): Promise<SledgehammerStatus | undefined> {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.statusListeners = this.statusListeners.filter(item => item !== listener); resolve(undefined); }, timeout);
      const listener = (status: SledgehammerStatus) => { clearTimeout(timer); resolve(status); };
      this.statusListeners.push(listener);
    });
  }

  // Start sledgehammer on the command at a position. A run already in progress is
  // replaced only if `replace` is set.
  async start(document: TextDocument, line: number, character: number, owner: string, replace = false): Promise<SledgehammerRun> {
    if (this.active && !replace) {
      const run = this.run!;
      throw new Error(`Sledgehammer is already running for ${run.owner} at line ${run.line + 1} of ${run.uri}.`);
    }
    const provers = await this.proverList();
    const previous = this.active ? this.run : undefined;
    const run: SledgehammerRun = { owner, uri: document.uri.toString(), line, character, status: 'waiting',
      cancelled: false, messages: [], proofs: [] };
    if (previous) { previous.cancelled = true; previous.status = 'finished'; }
    await this.goals.withCaretAt(document, line, character, async () => {
      // A theory just opened or edited may not be parsed into commands yet, and then the
      // query finishes at once with no command. Ask again for a few seconds.
      for (const deadline = Date.now() + 5000; ; await new Promise(resolve => setTimeout(resolve, 300))) {
        // The server reads the caret when it handles the request, so keep it there
        // until the query reports its first status.
        const first = this.nextStatus(10000);
        this.run = run;
        run.status = 'waiting';
        await this.client.sendNotification('PIDE/sledgehammer_request', { provers, isar: false, try0: true });
        const status = await first;
        if (status === undefined) throw new Error('Isabelle did not start sledgehammer.');
        if (status !== 'finished') return;
        if (Date.now() > deadline) {
          if (this.run === run) this.run = undefined;
          throw new Error('There is no command at that position to run sledgehammer on.');
        }
      }
    });
    this.changes.fire(run);
    return run;
  }

  async cancel(): Promise<void> {
    if (!this.active) return;
    this.run!.cancelled = true;
    await this.client.sendNotification('PIDE/sledgehammer_cancel');
  }

  // Put a proof of the latest run into the theory, after the command it ran on.
  async insert(proof: string): Promise<void> {
    const run = this.run;
    if (!run) throw new Error('Run sledgehammer first.');
    // The server knows where the command ends, if the theory has not changed since.
    const end = await new Promise<{ uri: string; line: number; character: number } | undefined>(resolve => {
      const timer = setTimeout(() => { subscription.dispose(); resolve(undefined); }, 3000);
      const subscription = this.client.onNotification('PIDE/sledgehammer_insert', (position: { uri: string; line: number; character: number }) => {
        clearTimeout(timer); subscription.dispose(); resolve(position);
      });
      void this.client.sendNotification('PIDE/sledgehammer_sendback', { text: proof });
    });
    if (!end) throw new Error('The theory changed after sledgehammer ran there. Run it again.');
    const document = await workspace.openTextDocument(Uri.parse(end.uri));
    const lines = document.getText().split(/\r?\n/);
    const { start, end: until, text } = proofEdit(lines, end.line, end.character, encodeSymbols(proof), run.line);
    const edit = new WorkspaceEdit();
    edit.replace(document.uri, new Range(...start, ...until), text);
    if (!await workspace.applyEdit(edit)) throw new Error('VS Code did not apply the proof.');
  }

  // Resolves when the run finishes, or after `timeout` ms.
  finished(run: SledgehammerRun, timeout: number): Promise<SledgehammerRun> {
    return new Promise(resolve => {
      if (run.status === 'finished' || this.run !== run) { resolve(run); return; }
      const timer = setTimeout(() => { listener.dispose(); resolve(run); }, timeout);
      const listener = this.onDidChange(() => {
        if (run.status !== 'finished' && this.run === run) return;
        clearTimeout(timer); listener.dispose(); resolve(run);
      });
    });
  }

  dispose(): void {
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.changes.dispose();
  }
}
