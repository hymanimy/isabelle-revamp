import { homedir } from 'node:os';
import { commands, ExtensionContext, window, workspace } from 'vscode';
import { LanguageClient, ServerOptions, State } from 'vscode-languageclient/node';
import { Goals } from './goals';
import { GoalsView } from './goalsView';
import { Bridge } from './bridge';
import { BridgeTools } from './bridgeTools';
import { unicodeSymbols } from './symbols';

// Minimal startup adapted from Isabelle2025-2:
// src/Tools/VSCode/extension/src/extension.ts:97–128.
// See ../THIRD_PARTY_NOTICES.md for attribution and the distribution license.
let client: LanguageClient | undefined;
let goals: Goals | undefined;
let bridge: Bridge | undefined;

export async function activate(context: ExtensionContext) {
  const output = window.createOutputChannel('Isabelle', { log: true });
  const view = new GoalsView();
  context.subscriptions.push(output,
    window.registerWebviewViewProvider('isabelleRevamp.goals', view),
    commands.registerCommand('isabelleRevamp.showGoals', () =>
      commands.executeCommand('isabelleRevamp.goals.focus')));

  const configured = workspace.getConfiguration('isabelleRevamp')
    .get<string>('executable', 'isabelle');
  const executable = configured.startsWith('~/')
    ? homedir() + configured.slice(1) : configured;
  const args = [
    'vscode_server', '-n', '-l', 'HOL',
    '-o', 'vscode_html_output=true',
    '-o', 'editor_output_state=true',
    '-o', 'vscode_pide_extensions=true',
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
  context.subscriptions.push(goals,
    window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === window.activeTextEditor) goals?.follow(event.textEditor);
    }),
    window.onDidChangeActiveTextEditor(editor => goals?.follow(editor)),
    workspace.onDidChangeTextDocument(event => {
      goals?.observe(event.document);
      if (event.document === window.activeTextEditor?.document) goals?.follow(window.activeTextEditor);
    }),
    client.onDidChangeState(event => {
      if (event.newState === State.Running) goals?.ready(window.activeTextEditor);
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
  bridge = new Bridge(new BridgeTools(goals, view));
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
  return { getGoalState: () => view.snapshot() };
}

export async function deactivate(): Promise<void> {
  await bridge?.close();
  bridge = undefined;
  goals?.dispose();
  goals = undefined;
  await client?.dispose();
  client = undefined;
}
