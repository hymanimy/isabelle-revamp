import { basename } from 'node:path';
import { commands, Disposable, StatusBarAlignment, TextEditor, Uri, window } from 'vscode';
import { GoalsView, HammerView } from './goalsView';
import { Sledgehammer, SledgehammerRun } from './sledgehammer';
import { sledgehammerTarget } from './suggestions';

// The owner of runs started in the editor; MCP runs carry the agent's name.
export const user = 'you';

export function hammerView(run: SledgehammerRun): HammerView {
  const where = `${basename(Uri.parse(run.uri).fsPath)}:${run.line + 1}`;
  const count = run.proofs.length, found = count ? `${count} proof${count === 1 ? '' : 's'}` : '';
  const status = run.status === 'waiting' ? 'waiting for checking…'
    : run.status === 'running' ? (found ? `running · ${found}` : 'running…')
    : run.cancelled ? (found ? `cancelled · ${found}` : 'cancelled')
    : found ? `${found} found` : 'no proof found';
  return { title: `Sledgehammer ${where}${run.owner === user ? '' : ` · ${run.owner}`} · ${status}`,
    active: run.status !== 'finished', proofs: [...run.proofs], messages: run.messages.map(message => message.text) };
}

// Sledgehammer for the user: a command and Goals title button at the cursor, results
// with clickable proofs in Goals, and a status bar spinner that cancels.
export class SledgehammerUi implements Disposable {
  private item = window.createStatusBarItem('isabelleRevamp.sledgehammer', StatusBarAlignment.Left, 50);
  private subscriptions: Disposable[];

  constructor(private hammer: Sledgehammer, private view: GoalsView, private editor: () => TextEditor | undefined) {
    this.item.name = 'Isabelle Sledgehammer';
    this.item.command = 'isabelleRevamp.cancelSledgehammer';
    view.onHammerProof = proof => this.insert(proof);
    view.onHammerCancel = () => hammer.cancel();
    this.subscriptions = [this.item, hammer.onDidChange(run => this.show(run)),
      commands.registerCommand('isabelleRevamp.sledgehammer', () => this.runAtCursor()),
      commands.registerCommand('isabelleRevamp.cancelSledgehammer', () => hammer.cancel())];
  }

  private show(run: SledgehammerRun | undefined): void {
    this.view.showHammer(run && hammerView(run));
    if (!run || run.status === 'finished') { this.item.hide(); return; }
    this.item.text = `$(loading~spin) Sledgehammer${run.proofs.length ? ` (${run.proofs.length})` : ''}`;
    this.item.tooltip = `Sledgehammer at line ${run.line + 1}${run.owner === user ? '' : ` for ${run.owner}`}. Click to cancel.`;
    this.item.show();
  }

  async runAtCursor(): Promise<boolean> {
    const editor = this.editor();
    if (editor?.document.languageId !== 'isabelle') {
      void window.showInformationMessage('Place the cursor in a theory to run sledgehammer there.');
      return false;
    }
    const { line, character } = editor.selection.active;
    const target = sledgehammerTarget(editor.document.getText().split(/\r?\n/), line, character);
    // Isabelle runs one sledgehammer at a time: the user's own replaces silently, an agent's after asking.
    const running = this.hammer.active ? this.hammer.run : undefined;
    if (running && running.owner !== user) {
      const choice = await window.showWarningMessage(`${running.owner}'s sledgehammer is running at line ${running.line + 1}; `
        + 'Isabelle runs one at a time.', 'Replace it');
      if (choice !== 'Replace it') return false;
    }
    await this.view.reveal(editor);
    try {
      await this.hammer.start(editor.document, ...target, user, true);
      return true;
    } catch (error) {
      void window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private async insert(proof: string): Promise<void> {
    try { await this.hammer.insert(proof); } catch (error) {
      void window.showInformationMessage(error instanceof Error ? error.message : String(error));
    }
  }

  dispose(): void { this.subscriptions.forEach(subscription => subscription.dispose()); }
}
