import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DiagnosticSeverity, languages, Position, Range, Selection, TabInputText, TextDocument, Uri, window, workspace } from 'vscode';
import { Goals } from './goals';
import { GoalsView } from './goalsView';
import { Swarm } from './swarm';

export interface AgentSession { name: string; versions: Map<string, number> }

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class BridgeTools {
  constructor(private goals: Goals, private view: GoalsView, private swarm: Swarm) {}

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

  private async documents(): Promise<TextDocument[]> {
    const result = [];
    // textDocuments also contains cached buffers whose tabs have already closed.
    const tabs = new Set(window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab =>
      tab.input instanceof TabInputText ? [tab.input.uri.toString()] : [])));
    for (const document of workspace.textDocuments) {
      if (document.isClosed || !tabs.has(document.uri.toString())
        || document.languageId !== 'isabelle' || document.uri.scheme !== 'file') continue;
      try { await this.filePath(document.uri.fsPath); result.push(document); } catch { /* outside workspace */ }
    }
    return result;
  }

  async call(method: string, params: Record<string, unknown>, agent: AgentSession): Promise<unknown> {
    if (method === 'status' || method === 'processing_status') {
      const documents = await this.documents();
      const files = documents.map(document => method === 'status'
        ? this.goals.documentStatus(document) : this.goals.processing(document));
      return method === 'status'
        ? { fully_checked: files.length > 0 && files.every(file => 'fully_checked' in file && file.fully_checked), files }
        : { processing: files.some(file => file.processing), files };
    }
    if (!['open', 'edit', 'goals_at', 'errors', 'sorry_positions'].includes(method)) {
      throw new Error('Unknown method: ' + method);
    }
    const document = await this.document(params.file);
    const identity = () => ({ file: document.uri.fsPath, version: document.version });
    if (method === 'errors') {
      const errors = languages.getDiagnostics(document.uri).filter(d => d.severity === DiagnosticSeverity.Error)
        .map(d => ({ message: d.message, range: [d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character] }));
      const status = this.goals.documentStatus(document);
      const hasErrors = status.has_errors || errors.length > 0;
      return { ...identity(), complete: status.processed && (!hasErrors || errors.length > 0),
        has_errors: hasErrors, errors };
    }
    if (method === 'sorry_positions') {
      const processing = this.goals.processing(document);
      return { ...identity(), complete: processing.processed,
        positions: processing.known ? this.goals.sorryPositions(document) : [] };
    }
    const editor = await window.showTextDocument(document);
    this.goals.follow(editor);
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
      const ids = this.swarm.editedCards(document, new Range(start, end));
      const selection = editor.selection;
      if (!await editor.edit(edit => edit.replace(new Range(start, end), params.text as string))) {
        throw new Error('Document changed during the edit; read it again with open.');
      }
      editor.selection = new Selection(document.validatePosition(selection.anchor), document.validatePosition(selection.active));
      this.goals.observe(document);
      this.goals.follow(editor);
      this.swarm.tag(document, ids, agent.name);
      agent.versions.set(document.uri.toString(), document.version);
      if (!await document.save()) throw new Error('Edit is in the editor, but saving failed. Do not retry the edit blindly.');
      return { ...identity(), saved: true, status: this.goals.documentStatus(document) };
    }
    const position = this.position(document, params.line, params.col);
    editor.selection = new Selection(position, position);
    editor.revealRange(new Range(position, position));
    this.goals.follow(editor);
    const version = document.version;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (document.version !== version || window.activeTextEditor !== editor
        || !editor.selection.active.isEqual(position) || !this.goals.matches(document, position.line, position.character)) {
        throw new Error('The document or cursor changed during the query. Retry goals_at.');
      }
      const state = this.view.snapshot();
      if (['ready', 'unfinished', 'error'].includes(state.phase) && this.goals.processing(document).processed) {
        return { ...identity(), line: position.line, col: position.character, ...state };
      }
      if (state.phase === 'unavailable') throw new Error('No goal state at this position; choose a proof command.');
      await pause(25);
    }
    throw new Error('Isabelle is still checking; query processing_status and retry goals_at.');
  }
}
