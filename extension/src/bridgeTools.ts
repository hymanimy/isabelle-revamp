import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { commands, DiagnosticSeverity, EndOfLine, Hover, languages, Location, LocationLink, Position, Range, TabInputText,
  TextDocument, Uri, window, workspace, WorkspaceEdit } from 'vscode';
import { Goals } from './goals';
import { encodeSymbols, unicodeSymbols } from './symbols';
import { hoverText } from './goalLinks';
import { AgentEdits } from './agentEdits';

export interface AgentSession { name: string; versions: Map<string, number> }


export class BridgeTools {
  constructor(private goals: Goals, private agentEdits: AgentEdits) {}

  private async filePath(file: unknown): Promise<string> {
    if (typeof file !== 'string' || !file.endsWith('.thy')) throw new Error('Expected a .thy file path.');
    const folders = workspace.workspaceFolders ?? [];
    if (!folders.length) throw new Error('Open a workspace folder first.');
    const path = await realpath(isAbsolute(file) ? file : resolve(folders[0].uri.fsPath, file));
    const roots = await Promise.all(folders.map(folder => realpath(folder.uri.fsPath)));
    if (!roots.some(root => {
      const part = relative(root, path);
      return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part);
    })) throw new Error('File must be inside the open workspace (including its symlink target).');
    if (!(await stat(path)).isFile() || !path.endsWith('.thy')) throw new Error('Expected an existing theory file.');
    return path;
  }

  private async document(file: unknown): Promise<TextDocument> {
    const document = await workspace.openTextDocument(Uri.file(await this.filePath(file)));
    if (document.languageId !== 'isabelle') throw new Error('The file must use the Isabelle language.');
    this.goals.observe(document);
    return document;
  }

  private position(document: TextDocument, line: unknown, col: unknown): Position {
    if (typeof line !== 'number' || typeof col !== 'number' || !Number.isInteger(line)
      || !Number.isInteger(col) || line < 0 || line >= document.lineCount || col < 0
      || col > document.lineAt(line).text.length) throw new Error('Position outside document: use zero-based lines and UTF-16 columns.');
    const text = document.lineAt(line).text;
    if (col > 0 && /[\uD800-\uDBFF]/.test(text[col - 1]) && /[\uDC00-\uDFFF]/.test(text[col] ?? '')) {
      throw new Error('A position cannot split a Unicode surrogate pair.');
    }
    return new Position(line, col);
  }

  // Where a definition is, and its source: the lines from its start to the next blank line.
  private async definition(target: Location | LocationLink) {
    const uri = 'targetUri' in target ? target.targetUri : target.uri;
    const range = 'targetUri' in target ? target.targetSelectionRange ?? target.targetRange : target.range;
    // Read files that aren't open from disk: opening a library theory would hand it to Isabelle as an editor buffer.
    const open = workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
    const lines = (open?.getText() ?? await readFile(uri.fsPath, 'utf8').catch(() => '')).split(/\r?\n/);
    const blank = lines.findIndex((text, line) => line > range.start.line && !text.trim());
    const end = Math.min(blank < 0 ? lines.length : blank, range.start.line + 20);
    return { file: uri.fsPath, range: [range.start.line, range.start.character, range.end.line, range.end.character],
      source: unicodeSymbols(lines.slice(range.start.line, end).join('\n')) };
  }

  // Theories open in the user's tabs, plus those this agent has read or edited.
  private async documents(agent: AgentSession): Promise<TextDocument[]> {
    const uris = new Set(window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab =>
      tab.input instanceof TabInputText && tab.input.uri.scheme === 'file' ? [tab.input.uri.toString()] : [])));
    for (const uri of agent.versions.keys()) uris.add(uri);
    const result = [];
    for (const uri of uris) {
      try { result.push(await this.document(Uri.parse(uri).fsPath)); } catch { /* not a workspace theory, or deleted */ }
    }
    return result;
  }

  async call(method: string, params: Record<string, unknown>, agent: AgentSession): Promise<unknown> {
    // Isabelle checks only near the user's cursor; status answers cover whole theories.
    if (method === 'status' || method === 'processing_status') {
      const documents = await this.documents(agent);
      for (const document of documents) await this.goals.checkWhole(document, method === 'status' ? 15000 : 5000);
      const files = documents.map(document => method === 'status'
        ? this.goals.documentStatus(document) : this.goals.processing(document));
      return method === 'status'
        ? { fully_checked: files.length > 0 && files.every(file => 'fully_checked' in file && file.fully_checked), files }
        : { processing: files.some(file => file.processing), files };
    }
    if (!['open', 'edit', 'goals_at', 'hover', 'definition', 'errors', 'sorry_positions'].includes(method)) {
      throw new Error('Unknown method: ' + method);
    }
    const document = await this.document(params.file);
    const identity = () => ({ file: document.uri.fsPath, version: document.version });
    if (method === 'errors') {
      await this.goals.checkWhole(document);
      const errors = languages.getDiagnostics(document.uri).filter(d => d.severity === DiagnosticSeverity.Error)
        .map(d => ({ message: d.message, range: [d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character] }));
      const status = this.goals.documentStatus(document);
      const hasErrors = status.has_errors || errors.length > 0;
      return { ...identity(), complete: status.processed && (!hasErrors || errors.length > 0),
        has_errors: hasErrors, errors };
    }
    if (method === 'sorry_positions') {
      await this.goals.checkWhole(document);
      const processing = this.goals.processing(document);
      return { ...identity(), complete: processing.processed,
        positions: processing.known ? this.goals.sorryPositions(document) : [] };
    }
    // Agents work on the document model, never on the user's editor: no tab
    // switches, cursor moves or scrolling.
    if (method === 'open') {
      agent.versions.set(document.uri.toString(), document.version);
      return { ...identity(), text: document.getText(), saved: !document.isDirty };
    }
    if (method === 'edit') {
      if (agent.versions.get(document.uri.toString()) !== document.version) {
        throw new Error('The buffer changed since this client last read it. Call open and recompute the edit range.');
      }
      const start = this.position(document, params.start_line, params.start_col);
      const end = this.position(document, params.end_line, params.end_col);
      if (start.isAfter(end)) throw new Error('Edit start must not be after its end.');
      if (typeof params.text !== 'string') throw new Error('Edit text must be a string.');
      const version = document.version;
      const offset = document.offsetAt(start);
      // Match VS Code's newline normalization when computing the new range.
      const eol = document.eol === EndOfLine.LF ? '\n' : '\r\n';
      const text = encodeSymbols(params.text as string).replace(/\r\n|\r|\n/g, eol);
      const visible = () => window.visibleTextEditors.find(editor => editor.document === document);
      // A workspace edit joins the document's undo history without needing an editor.
      const edit = new WorkspaceEdit();
      edit.replace(document.uri, new Range(start, end), text);
      if (!await workspace.applyEdit(edit) || document.version === version) {
        throw new Error('Document changed during the edit; read it again with open.');
      }
      this.goals.observe(document);
      const inserted = new Range(start, document.positionAt(offset + text.length));
      const editor = visible();
      if (editor) this.agentEdits.applied(editor, inserted, agent.name);
      agent.versions.set(document.uri.toString(), document.version);
      if (!await document.save()) throw new Error('Edit is in the editor, but saving failed. Do not retry the edit blindly.');
      return { ...identity(), saved: true, status: this.goals.documentStatus(document) };
    }
    const position = this.position(document, params.line, params.col);
    const at = { ...identity(), line: position.line, col: position.character };
    if (method === 'hover') {
      const hovers = await this.goals.queryAt(document, position.line, position.character, method,
        () => commands.executeCommand<Hover[]>('vscode.executeHoverProvider', document.uri, position)) ?? [];
      const range = hovers.find(hover => hover.range)?.range;
      return { ...at, text: hoverText(hovers).replace(/\n\s*\n/g, '\n'),
        range: range ? [range.start.line, range.start.character, range.end.line, range.end.character] : null };
    }
    if (method === 'definition') {
      const targets = await this.goals.queryAt(document, position.line, position.character, method,
        () => commands.executeCommand<(Location | LocationLink)[]>('vscode.executeDefinitionProvider', document.uri, position)) ?? [];
      return { ...at, definitions: await Promise.all(targets.map(target => this.definition(target))) };
    }
    const { html: _html, ...state } = await this.goals.stateAt(document, position.line, position.character);
    return { ...at, ...state };
  }
}
