import { commands, ConfigurationTarget, Disposable, StatusBarAlignment, StatusBarItem, TextEditor, ThemeColor, ViewColumn, window, workspace } from 'vscode';
import { GraphState, graphSummary } from './graphTypes';
import { ProofGraph } from './proofGraph';

export class ProofStatus implements Disposable {
  private item: StatusBarItem = window.createStatusBarItem('isabelleRevamp.proofStatus', StatusBarAlignment.Right, 50);
  private subscription: Disposable;
  constructor(graph: ProofGraph) {
    this.item.name = 'Isabelle proof status';
    this.item.command = 'isabelleRevamp.showProofGraph';
    this.item.tooltip = 'Open Isabelle Proof Graph';
    this.subscription = graph.onDidUpdate(state => this.update(state));
    this.update(graph.snapshot());
  }
  private update(state?: GraphState): void {
    if (!state?.total) { this.item.hide(); return; }
    this.item.text = graphSummary(state);
    this.item.backgroundColor = state.nodes.some(node => ['error', 'abandoned', 'refuted'].includes(node.status))
      ? new ThemeColor('statusBarItem.errorBackground') : undefined;
    this.item.show();
  }
  snapshot() { return { text: this.item.text, command: this.item.command, alignment: this.item.alignment }; }
  dispose(): void { this.subscription.dispose(); this.item.dispose(); }
}

export async function demoLayout(editor: TextEditor | undefined, graph: ProofGraph): Promise<boolean> {
  if (!editor || editor.document.languageId !== 'isabelle' || editor.document.isClosed) {
    void window.showInformationMessage('Open a theory before choosing Demo Layout.'); return false;
  }
  const document = editor.document;
  const settings = workspace.getConfiguration('isabelleRevamp', document.uri);
  if (!settings.get<boolean>('prettySymbols', true)) await settings.update('prettySymbols', true, ConfigurationTarget.Workspace);
  // Public editor-layout command; joining preserves all tabs and unsaved edits.
  await commands.executeCommand('workbench.action.joinAllGroups');
  const source = await window.showTextDocument(document, { viewColumn: ViewColumn.One, preview: false });
  await commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 1 }] });
  graph.follow(source); graph.show();
  await commands.executeCommand('workbench.action.positionPanelBottom');
  await commands.executeCommand('workbench.action.alignPanelJustify');
  await commands.executeCommand('workbench.action.closeSidebar');
  await commands.executeCommand('workbench.action.closeAuxiliaryBar');
  if (settings.get<boolean>('demoShowGoals', false)) await commands.executeCommand('isabelleRevamp.showGoals');
  await commands.executeCommand('isabelleRevamp.ask');
  return true;
}
