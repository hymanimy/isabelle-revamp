import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { commands, ConfigurationTarget, env, ExtensionContext, TabInputText, Uri, window, workspace } from 'vscode';
import { LanguageClient, ServerOptions, State } from 'vscode-languageclient/node';
import { Goals } from './goals';
import { GoalsView } from './goalsView';
import { Bridge } from './bridge';
import { BridgeTools } from './bridgeTools';
import { AgentEdits } from './agentEdits';
import { loadSymbols, unicodeSymbols } from './symbols';
import { PrettySymbols } from './prettySymbols';
import { lockLibraryFiles } from './libraryFiles';
import { SemanticColors } from './semanticColors';
import { SymbolInput, asciiCompletion, asciiCompletions } from './symbolInput';
import { visibleScripts } from './scriptDecorations';
import { convertQuotes } from './cartouches';
import { GoalLinks } from './goalLinks';
import { findIsabelle, setupReport } from './setup';

// Minimal startup adapted from Isabelle2025-2:
// src/Tools/VSCode/extension/src/extension.ts:97–128.
// See ../THIRD_PARTY_NOTICES.md for attribution and the distribution license.
let client: LanguageClient | undefined;
let goals: Goals | undefined;
let bridge: Bridge | undefined;

export async function activate(context: ExtensionContext) {
  const output = window.createOutputChannel('Isabelle', { log: true });
  const view = new GoalsView();
  let theoryEditor = window.activeTextEditor;
  const visibleTheory = () => theoryEditor && !theoryEditor.document.isClosed && window.tabGroups.all.some(group =>
    group.tabs.some(tab => tab.input instanceof TabInputText && tab.input.uri.toString() === theoryEditor!.document.uri.toString()))
    ? theoryEditor : undefined;
  const serverRoot = existsSync(resolve(context.extensionPath, 'src/extension.ts'))
    ? resolve(context.extensionPath, '..') : context.extensionPath;
  context.subscriptions.push(output, view,
    window.registerWebviewViewProvider('isabelleRevamp.goals', view),
    commands.registerCommand('isabelleRevamp.showGoals', () =>
      commands.executeCommand('isabelleRevamp.goals.focus')));

  const locate = () => findIsabelle(workspace.getConfiguration('isabelleRevamp').get<string>('executable', 'isabelle'));
  context.subscriptions.push(commands.registerCommand('isabelleRevamp.setupCheck', async () => {
    output.show(true);
    const report = await setupReport(await locate(), workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionPath, serverRoot);
    report.forEach(line => output.appendLine(line));
    return report;
  }));
  const firstTheory = async () => {
    if (context.workspaceState.get('goalsOpened') || !workspace.textDocuments.some(doc => doc.languageId === 'isabelle')) return;
    await context.workspaceState.update('goalsOpened', true);
    await commands.executeCommand('isabelleRevamp.showGoals');
  };
  context.subscriptions.push(workspace.onDidOpenTextDocument(() => { void firstTheory(); }));
  void firstTheory();
  const executable = await locate();
  if (!executable) {
    view.update({ phase: 'idle', text: 'Isabelle not found. Use Locate… in the notification, or set isabelleRevamp.executable and reload.', errors: [] });
    void window.showInformationMessage('Isabelle not found', 'Locate…', 'Download').then(async choice => {
      if (choice === 'Download') await env.openExternal(Uri.parse('https://isabelle.in.tum.de/installation.html'));
      if (choice === 'Locate…') {
        const files = await window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false,
          openLabel: 'Locate Isabelle', title: 'Select bin/isabelle in your Isabelle installation' });
        if (files?.[0]) {
          // An explicit Locate choice saves only this setting. Prefer the workspace.
          await workspace.getConfiguration('isabelleRevamp').update('executable', files[0].fsPath,
            workspace.workspaceFolders?.length ? ConfigurationTarget.Workspace : ConfigurationTarget.Global);
          await commands.executeCommand('workbench.action.reloadWindow');
        }
      }
    });
    return { getGoalState: () => view.snapshot(), setupRequired: true };
  }
  let libraryRoots: string[] = [];
  try {
    const patterns = await lockLibraryFiles(executable);
    libraryRoots = patterns.map(pattern=>pattern.slice(0,-3));
    output.info(`Library read-only patterns: ${patterns.join(', ')}`);
  } catch (error) { output.warn(`Library read-only setup failed: ${String(error)}`); }
  try {
    const table = await loadSymbols(executable);
    output.info(`Loaded ${table.count} Unicode symbols from ${table.path}`);
  } catch (error) { output.warn(`Could not load installed symbols; using bundled fallback: ${String(error)}`); }
  const goalLinks = new GoalLinks(libraryRoots);
  view.onNavigate = link => goalLinks.open(link);
  view.onHover = link => goalLinks.hover(link);
  const prettySymbols = new PrettySymbols();
  context.subscriptions.push(prettySymbols,
    commands.registerCommand('isabelleRevamp.convertQuotes', convertQuotes),
    commands.registerCommand('isabelleRevamp.togglePrettySymbols', () => prettySymbols.toggle()));
  const args = [
    'vscode_server', '-n', '-l', 'HOL',
    '-o', 'vscode_html_output=true',
    '-o', 'editor_output_state=true',
    '-o', 'vscode_pide_extensions=true',
    '-o', 'vscode_unicode_symbols_edits=true',
    '-o', 'vscode_unicode_symbols_output=true',
    '-o', 'vscode_caret_perspective=0',
  ];
  const server: ServerOptions = { command: executable, args };

  output.info(`Starting ${executable} ${args.join(' ')}`);
  client = new LanguageClient('isabelleRevamp', 'Isabelle', server, {
    documentSelector: [{ scheme: 'file', language: 'isabelle' }],
    outputChannel: output,
    middleware: {
      provideCompletionItem: async (document,position,context,token,next) =>
        asciiCompletions(await next(document,position,context,token)),
      resolveCompletionItem: async (item,token,next) => {
        const resolved = await next(item,token);
        return resolved ? asciiCompletion(resolved) : resolved;
      },
      handleDiagnostics: (uri, diagnostics, next) => {
        for (const diagnostic of diagnostics) diagnostic.message = unicodeSymbols(diagnostic.message);
        next(uri, diagnostics);
        goals?.setDiagnostics(uri.toString(), diagnostics);
      },
    },
  });
  const symbolInput = new SymbolInput(client);
  context.subscriptions.push(symbolInput);
  goals = new Goals(client, view);
  const semanticColors = new SemanticColors(goals);
  context.subscriptions.push(semanticColors);
  const agentEdits = new AgentEdits();
  context.subscriptions.push(agentEdits);
  context.subscriptions.push(goals,
    window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === window.activeTextEditor) goals?.follow(event.textEditor);
    }),
    window.onDidChangeActiveTextEditor(editor => {
      if (editor) theoryEditor = editor;
      goals?.follow(editor ?? visibleTheory());
    }),
    workspace.onDidChangeTextDocument(event => {
      goals?.observe(event.document);
      if (event.document === window.activeTextEditor?.document) goals?.follow(window.activeTextEditor);
    }),
    client.onDidChangeState(event => {
      if (event.newState === State.Running) goals?.ready(window.activeTextEditor ?? visibleTheory());
      else goals?.unavailable();
    }));

  try {
    await client.start();
    await symbolInput.request();
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
  bridge = new Bridge(new BridgeTools(goals, view, agentEdits));
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
  return { getGoalState: () => view.snapshot(),
    getAgentEdits: () => agentEdits.snapshot(),
    getGoalLinks: () => view.linkSnapshot(),
    followGoalLink: (index: number, revision: number) => view.followLink(index,revision),
    hoverGoalLink: (index: number, revision: number) => view.hoverLink(index,revision),
    getScriptDecorations: () => window.activeTextEditor ? visibleScripts(window.activeTextEditor) : [],
    getAbbreviations: () => symbolInput.snapshot(),
    getSemanticColors: () => window.activeTextEditor ? semanticColors.snapshot(window.activeTextEditor.document) : [],
    getPrettySymbols: () => window.activeTextEditor ? prettySymbols.snapshot(window.activeTextEditor) : [] };
}

export async function deactivate(): Promise<void> {
  await bridge?.close();
  bridge = undefined;
  goals?.dispose();
  goals = undefined;
  await client?.dispose();
  client = undefined;
}
