import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { commands, ExtensionContext, window, workspace } from 'vscode';
import { LanguageClient, ServerOptions, State } from 'vscode-languageclient/node';
import { Goals } from './goals';
import { GoalsView } from './goalsView';
import { Bridge } from './bridge';
import { BridgeTools } from './bridgeTools';
import { loadSymbols, unicodeSymbols } from './symbols';
import { PrettySymbols } from './prettySymbols';
import { Swarm } from './swarm';
import { Ask } from './ask';

// Minimal startup adapted from Isabelle2025-2:
// src/Tools/VSCode/extension/src/extension.ts:97–128.
// See ../THIRD_PARTY_NOTICES.md for attribution and the distribution license.
let client: LanguageClient | undefined;
let goals: Goals | undefined;
let bridge: Bridge | undefined;
let ask: Ask | undefined;

export async function activate(context: ExtensionContext) {
  const output = window.createOutputChannel('Isabelle', { log: true });
  const view = new GoalsView();
  let theoryEditor = window.activeTextEditor;
  const visibleTheory = () => theoryEditor && window.visibleTextEditors.includes(theoryEditor) ? theoryEditor : undefined;
  ask = new Ask(resolve(context.extensionPath, '..'), state => view.updateAsk(state));
  const sendAsk = async (text: string) => {
    const editor = visibleTheory();
    const folder = editor && workspace.getWorkspaceFolder(editor.document.uri);
    if (!editor || editor.document.isClosed || editor.document.languageId !== 'isabelle' || !folder) {
      ask?.notice('Open a theory in this workspace before asking Isabelle.');
      view.updateAsk(ask!.snapshot()); return false;
    }
    if (!bridge) { ask?.notice('The Isabelle MCP bridge is unavailable. See Output → Isabelle.'); return false; }
    return ask!.send({ file: editor.document.uri.fsPath, line: editor.selection.active.line + 1,
      cwd: folder.uri.fsPath, portFile: bridge.portFile }, text);
  };
  view.onAsk = text => { void sendAsk(text); };
  view.onStop = () => ask?.stop();
  context.subscriptions.push(output,
    window.registerWebviewViewProvider('isabelleRevamp.goals', view),
    commands.registerCommand('isabelleRevamp.showGoals', () =>
      commands.executeCommand('isabelleRevamp.goals.focus')),
    commands.registerCommand('isabelleRevamp.ask', async () => {
      view.focusAsk();
      await commands.executeCommand('isabelleRevamp.goals.focus');
      view.focusAsk();
    }));

  const configured = workspace.getConfiguration('isabelleRevamp')
    .get<string>('executable', 'isabelle');
  const executable = configured.startsWith('~/')
    ? homedir() + configured.slice(1) : configured;
  try {
    const table = await loadSymbols(executable);
    output.info(`Loaded ${table.count} Unicode symbols from ${table.path}`);
  } catch (error) { output.warn(`Could not load installed symbols; using bundled fallback: ${String(error)}`); }
  const prettySymbols = new PrettySymbols();
  context.subscriptions.push(prettySymbols,
    commands.registerCommand('isabelleRevamp.togglePrettySymbols', () => prettySymbols.toggle()));
  const args = [
    'vscode_server', '-n', '-l', 'HOL',
    '-o', 'vscode_html_output=true',
    '-o', 'editor_output_state=true',
    '-o', 'vscode_pide_extensions=true',
    '-o', 'vscode_unicode_symbols_edits=false',
  ];
  const server: ServerOptions = { command: executable, args };

  output.info(`Starting ${executable} ${args.join(' ')}`);
  output.show(true);
  client = new LanguageClient('isabelleRevamp', 'Isabelle', server, {
    documentSelector: [{ scheme: 'file', language: 'isabelle' }],
    outputChannel: output,
    middleware: {
      handleDiagnostics: (uri, diagnostics, next) => {
        for (const diagnostic of diagnostics) diagnostic.message = unicodeSymbols(diagnostic.message);
        next(uri, diagnostics);
        goals?.setDiagnostics(uri.toString(), diagnostics);
      },
    },
  });
  goals = new Goals(client, view);
  const swarm = new Swarm(goals);
  context.subscriptions.push(swarm,
    window.registerWebviewViewProvider('isabelleRevamp.swarm', swarm.view),
    commands.registerCommand('isabelleRevamp.showSwarm', () => commands.executeCommand('isabelleRevamp.swarm.focus')));
  swarm.follow(window.activeTextEditor);
  context.subscriptions.push(goals,
    window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === window.activeTextEditor) { goals?.follow(event.textEditor); swarm.follow(event.textEditor); }
    }),
    window.onDidChangeActiveTextEditor(editor => {
      if (editor) theoryEditor = editor;
      goals?.follow(editor ?? visibleTheory()); swarm.follow(editor);
    }),
    workspace.onDidChangeTextDocument(event => {
      goals?.observe(event.document);
      if (event.contentChanges.length) swarm.changed(event.document);
      if (event.document === window.activeTextEditor?.document) goals?.follow(window.activeTextEditor);
    }),
    client.onDidChangeState(event => {
      if (event.newState === State.Running) goals?.ready(window.activeTextEditor ?? visibleTheory());
      else goals?.unavailable();
    }));

  try {
    await client.start();
    output.info('Isabelle language server ready (HOL).');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(`Startup failed: ${message}`);
    goals.unavailable();
    await window.showErrorMessage(
      'Isabelle could not start. Check Isabelle Revamp: Executable in workspace settings and the Isabelle Output channel.',
    );
    throw error;
  }
  bridge = new Bridge(new BridgeTools(goals, view, swarm));
  try {
    await bridge.start();
    output.info(`MCP bridge ready; discovery file: ${bridge.portFile}`);
  } catch (error) {
    await bridge.close();
    bridge = undefined;
    output.error(`MCP bridge failed: ${String(error)}`);
    await window.showErrorMessage('The MCP bridge could not start. See Output → Isabelle.');
  }
  // The integration check reads the same model that the webview renders.
  return { getGoalState: () => view.snapshot(), getSwarmState: () => swarm.view.snapshot(),
    getPrettySymbols: () => window.activeTextEditor ? prettySymbols.snapshot(window.activeTextEditor) : [],
    getAskState: () => ask!.snapshot(), sendAsk, stopAsk: () => ask?.stop(),
    selectSwarmStep: (uri: string, version: number, id: string) => swarm.select(uri, version, id) };
}

export async function deactivate(): Promise<void> {
  ask?.dispose();
  ask = undefined;
  await bridge?.close();
  bridge = undefined;
  goals?.dispose();
  goals = undefined;
  await client?.dispose();
  client = undefined;
}
