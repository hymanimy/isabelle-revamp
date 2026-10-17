import { commands, ConfigurationTarget, Disposable, StatusBarAlignment, StatusBarItem, TextEditor, ThemeColor, ViewColumn, window, workspace } from 'vscode';
import { GraphState, graphSummary } from './graphTypes';
import { ProofGraph } from './proofGraph';
import { GoalsView } from './goalsView';

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

export async function demoLayout(editor: TextEditor | undefined, graph: ProofGraph, goals: GoalsView): Promise<boolean> {
  if (!editor || editor.document.languageId !== 'isabelle' || editor.document.isClosed) {
    void window.showInformationMessage('Open a theory before choosing Demo Layout.'); return false;
  }
  const document = editor.document;
  const settings = workspace.getConfiguration('isabelleRevamp', document.uri);
  if (!settings.get<boolean>('prettySymbols', true)) await settings.update('prettySymbols', true, ConfigurationTarget.Workspace);
  if (settings.get<boolean>('showAsk', true)) await settings.update('showAsk', false, ConfigurationTarget.Workspace);
  const activity = workspace.getConfiguration('workbench.activityBar');
  if (activity.get('location') !== 'hidden') await activity.update('location', 'hidden', ConfigurationTarget.Workspace);
  await commands.executeCommand('setContext', 'isabelleRevamp.demoLayout', true);
  // Recreate only our read-only views. Joining groups may discard preview
  // webviews; their live models and replay log stay in the extension host.
  graph.panel.closeEditor(); goals.closeEditor();
  // Public editor-layout command; joining preserves all tabs and unsaved edits.
  await commands.executeCommand('workbench.action.joinAllGroups');
  const source = await window.showTextDocument(document, { viewColumn: ViewColumn.One, preview: false });
  await commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 1 }] });
  graph.follow(source);
  graph.panel.configureDemo();
  graph.show(ViewColumn.Beside);
  await commands.executeCommand('workbench.action.keepEditor');
  goals.openEditor(ViewColumn.Two);
  await commands.executeCommand('workbench.action.keepEditor');
  await commands.executeCommand('workbench.action.moveEditorToAboveGroup');
  await commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [
    { size: .62 }, { size: .38, groups: [{ size: .4 }, { size: .6 }] },
  ] });
  await commands.executeCommand('workbench.action.positionPanelBottom');
  await commands.executeCommand('workbench.action.alignPanelJustify');
  await commands.executeCommand('workbench.action.closeSidebar');
  await commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const terminal = window.activeTerminal ?? window.createTerminal({ name: 'Claude Code', cwd: workspace.getWorkspaceFolder(document.uri)?.uri });
  terminal.show();
  await commands.executeCommand('workbench.action.terminal.focus');
  // VS Code has no public pixel/ratio API for its panel. Terminal resize
  // commands step by four character heights, even when Code lacks OS focus.
  // Chrome allowance = title/status bars + the two editor tab bars.
  for (let attempt = 0; attempt < 12; attempt++) {
    const lower = await graph.panel.inspect('snapshot');
    const upper = await goals.inspect();
    const height = upper.outerHeight;
    if (!height || !lower.window) break;
    const panelHeight = height - 60 - upper.height - lower.window.height - 70;
    const delta = height * .28 - panelHeight;
    if (Math.abs(delta) <= 35) break;
    await commands.executeCommand(delta > 0 ? 'workbench.action.terminal.resizePaneUp' : 'workbench.action.terminal.resizePaneDown');
    // The command returns before the renderer has applied its new bounds.
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  return true;
}
