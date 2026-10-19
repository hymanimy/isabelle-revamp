import { homedir } from 'node:os';
import { commands, ConfigurationTarget, DiagnosticSeverity, env, ExtensionContext, TabInputText, Uri, window, workspace } from 'vscode';
import { LanguageClient, ServerOptions, State } from 'vscode-languageclient/node';
import { Goals } from './goals';
import { GoalsView } from './goalsView';
import { Bridge } from './bridge';
import { BridgeTools } from './bridgeTools';
import { AgentEdits } from './agentEdits';
import { loadSymbols, unicodeSymbols } from './symbols';
import { PrettySymbols } from './prettySymbols';
import { LibraryFiles, libraryRoots as findLibraryRoots } from './libraryFiles';
import { SemanticColors } from './semanticColors';
import { SymbolInput, asciiCompletion, asciiCompletions } from './symbolInput';
import { visibleScripts } from './scriptDecorations';
import { convertQuotes } from './cartouches';
import { GoalLinks } from './goalLinks';
import { findIsabelle, mcpLaunch, onPath, registerWithClaude, setupReport } from './setup';
import { serverArgs, serverSettingKeys, serverSettings } from './serverSettings';
import { Theories } from './theories';
import { applySuggestion, withSuggestionLinks } from './tryButtons';

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
  const launch = mcpLaunch(context.extensionPath);
  context.subscriptions.push(output, view,
    window.registerWebviewViewProvider('isabelleRevamp.goals', view),
    commands.registerCommand('isabelleRevamp.showGoals', () =>
      commands.executeCommand('isabelleRevamp.goals.focus')));

  const currentSettings = () => serverSettings(workspace.getConfiguration('isabelleRevamp'), workspace.workspaceFolders?.[0]?.uri.fsPath);
  const locate = () => findIsabelle(workspace.getConfiguration('isabelleRevamp').get<string>('executable', 'isabelle'));
  context.subscriptions.push(commands.registerCommand('isabelleRevamp.setupCheck', async () => {
    output.show(true);
    const report = await setupReport(await locate(), workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionPath, launch, currentSettings());
    report.forEach(line => output.appendLine(line));
    return report;
  }));
  // The registration names this install's paths. Re-register after an update moves them,
  // but only if the user registered through this command before.
  const register = async (quiet: boolean) => {
    const claude = await onPath('claude');
    if (!claude) {
      if (!quiet) void window.showErrorMessage('Claude Code is not on PATH. Install it, then run this command again.');
      return;
    }
    try {
      await registerWithClaude(claude, launch, workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir());
      await context.globalState.update('mcpRegistration', JSON.stringify(launch));
      output.info(`Registered the isabelle MCP server with Claude Code: ${launch.command} ${launch.args.join(' ')}`);
      if (!quiet) void window.showInformationMessage('Registered the isabelle MCP server with Claude Code for all your projects. Restart running Claude Code sessions to use it.');
    } catch (error) {
      output.error(`MCP registration failed: ${String(error)}`);
      if (!quiet) void window.showErrorMessage('Could not register the MCP server with Claude Code. See Output → Isabelle.');
    }
  };
  context.subscriptions.push(commands.registerCommand('isabelleRevamp.registerMcp', () => register(false)));
  const registered = context.globalState.get<string>('mcpRegistration');
  if (registered && registered !== JSON.stringify(launch)) void register(true);
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
          // The path belongs to this machine, not to the project: save it in user settings.
          await workspace.getConfiguration('isabelleRevamp').update('executable', files[0].fsPath, ConfigurationTarget.Global);
          await commands.executeCommand('workbench.action.reloadWindow');
        }
      }
    });
    return { getGoalState: () => view.snapshot(), setupRequired: true };
  }
  let libraryRoots: string[] = [];
  try {
    libraryRoots = await findLibraryRoots(executable);
    context.subscriptions.push(new LibraryFiles(libraryRoots));
    output.info(`Library files open read-only: ${libraryRoots.join(', ')}`);
  } catch (error) { output.warn(`Library read-only setup failed: ${String(error)}`); }
  try {
    const table = await loadSymbols(executable);
    output.info(`Loaded ${table.count} Unicode symbols from ${table.path}`);
  } catch (error) { output.warn(`Could not load installed symbols; using bundled fallback: ${String(error)}`); }
  const goalLinks = new GoalLinks(libraryRoots);
  view.onNavigate = link => goalLinks.open(link);
  view.onHover = link => goalLinks.hover(link);
  // A proof clicked in Goals replaces the try0/sledgehammer at the cursor that found it.
  view.onSendback = async proof => {
    const caret = goals?.caretPosition();
    if (caret) await applySuggestion(caret.uri, caret.line, caret.character, proof);
  };
  const prettySymbols = new PrettySymbols();
  context.subscriptions.push(prettySymbols,
    commands.registerCommand('isabelleRevamp.convertQuotes', convertQuotes),
    commands.registerCommand('isabelleRevamp.applySuggestion', applySuggestion),
    commands.registerCommand('isabelleRevamp.togglePrettySymbols', () => prettySymbols.toggle()));
  const settings = currentSettings();
  const args = serverArgs(settings);
  context.subscriptions.push(workspace.onDidChangeConfiguration(event => {
    if (!serverSettingKeys.some(key => event.affectsConfiguration(key))) return;
    void window.showInformationMessage('Reload the window to restart Isabelle with the new settings.', 'Reload')
      .then(choice => { if (choice === 'Reload') void commands.executeCommand('workbench.action.reloadWindow'); });
  }));
  const server: ServerOptions = { command: executable, args };

  output.info(`Starting ${executable} ${args.join(' ')}`);
  client = new LanguageClient('isabelleRevamp', 'Isabelle', server, {
    documentSelector: [{ scheme: 'file', language: 'isabelle' }],
    outputChannel: output,
    middleware: {
      provideHover: async (document, position, token, next) =>
        withSuggestionLinks(await next(document, position, token), document.uri.toString(), position),
      provideCompletionItem: async (document,position,context,token,next) =>
        asciiCompletions(await next(document,position,context,token)),
      resolveCompletionItem: async (item,token,next) => {
        const resolved = await next(item,token);
        return resolved ? asciiCompletion(resolved) : resolved;
      },
      handleDiagnostics: (uri, diagnostics, next) => {
        for (const diagnostic of diagnostics) {
          diagnostic.message = unicodeSymbols(diagnostic.message);
          // The server means legacy messages as warnings, but looks their severity up by
          // "legacy" while messages are named "legacy_message", so none is sent and
          // VS Code assumes Error. Output.legacy_feature always starts them like this.
          if (diagnostic.message.startsWith('Legacy feature!')) diagnostic.severity = DiagnosticSeverity.Warning;
        }
        next(uri, diagnostics);
        goals?.setDiagnostics(uri.toString(), diagnostics);
      },
    },
  });
  const symbolInput = new SymbolInput(client);
  context.subscriptions.push(symbolInput);
  goals = new Goals(client, view, settings.outputDelay);
  const semanticColors = new SemanticColors(goals);
  context.subscriptions.push(semanticColors);
  const agentEdits = new AgentEdits();
  const theories = new Theories(goals);
  context.subscriptions.push(agentEdits, theories,
    commands.registerCommand('isabelleRevamp.showTheories', () => commands.executeCommand('isabelleRevamp.theories.focus')));
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
    output.info(`Isabelle language server ready (${settings.logic}).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(`Startup failed: ${message}`);
    goals.unavailable();
    await window.showErrorMessage(
      'Isabelle could not start. Check Isabelle Revamp: Executable in workspace settings and the Isabelle Output channel.',
    );
    throw error;
  }
  bridge = new Bridge(new BridgeTools(goals, agentEdits), () => (workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
  const published = bridge;
  context.subscriptions.push(workspace.onDidChangeWorkspaceFolders(() => { void published.publish(); }));
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
    useProofFromGoals: (proof: string) => view.onSendback?.(proof),
    getTheories: async () => { await theories.refresh(); return theories.snapshot(); },
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
