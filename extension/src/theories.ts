import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DiagnosticSeverity, Disposable, EventEmitter, languages, TabInputText, ThemeColor, ThemeIcon, TreeDataProvider,
  TreeItem, TreeView, Uri, window, workspace } from 'vscode';
import { Goals } from './goals';
import { importFile, theoryHeader } from './theoryHeader';

export type TheoryStatus = 'waiting' | 'idle' | 'checking' | 'partial' | 'failed' | 'unfinished' | 'finished';
export interface Theory {
  name: string; file: string; open: boolean; status: TheoryStatus;
  progress: number; errors: number; imports: string[];
}

const presentation: Record<TheoryStatus, { label: string; icon: string; color?: string }> = {
  waiting: { label: 'waiting', icon: 'clock' },
  idle: { label: 'not checked: not the active editor', icon: 'circle-outline' },
  checking: { label: 'checking', icon: 'sync~spin' },
  partial: { label: 'checked near the cursor', icon: 'eye' },
  failed: { label: 'failed', icon: 'error', color: 'errorForeground' },
  unfinished: { label: 'unfinished (sorry)', icon: 'warning', color: 'editorWarning.foreground' },
  finished: { label: 'finished', icon: 'pass', color: 'testing.iconPassed' },
};

// Lines of a file inside the given ranges, counted once each.
function coveredLines(ranges: [number, number, number, number][]): Set<number> {
  const lines = new Set<number>();
  for (const [start, , end] of ranges) for (let line = start; line <= end; line++) lines.add(line);
  return lines;
}

// Like Isabelle/jEdit's Theories panel: every open theory and the local theories
// it imports, in import order, with the prover's progress on each. While the view
// is visible, imported theories are opened in the background so that the server
// reports their progress; the prover checks them in full either way.
export class Theories implements TreeDataProvider<Theory>, Disposable {
  private changed = new EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly view: TreeView<Theory>;
  private theories: Theory[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private refreshing?: Promise<void>;
  private stale = false;
  private subscriptions: Disposable[];

  constructor(private goals: Goals) {
    this.view = window.createTreeView('isabelleRevamp.theories', { treeDataProvider: this });
    this.subscriptions = [this.view, this.changed,
      goals.onDidUpdate(() => this.schedule()),
      languages.onDidChangeDiagnostics(() => this.schedule()),
      window.tabGroups.onDidChangeTabs(() => this.schedule()),
      window.onDidChangeActiveTextEditor(() => this.schedule()),
      workspace.onDidSaveTextDocument(document => { if (document.languageId === 'isabelle') this.schedule(); }),
      workspace.onDidCloseTextDocument(document => { if (document.languageId === 'isabelle') this.schedule(); }),
      this.view.onDidChangeVisibility(() => this.schedule()),
    ];
    this.schedule();
  }

  private schedule(): void {
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 250);
  }

  // One refresh at a time; changes during a refresh trigger one more.
  refresh(): Promise<void> {
    if (this.refreshing) { this.stale = true; return this.refreshing; }
    this.refreshing = this.update().finally(() => {
      this.refreshing = undefined;
      if (this.stale) { this.stale = false; this.schedule(); }
    });
    return this.refreshing;
  }

  private roots(): string[] {
    return [...new Set(window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab =>
      tab.input instanceof TabInputText && tab.input.uri.scheme === 'file' && tab.input.uri.fsPath.endsWith('.thy')
        ? [tab.input.uri.fsPath] : [])))];
  }

  private async source(file: string): Promise<string | undefined> {
    const open = workspace.textDocuments.find(document => document.uri.fsPath === file);
    if (open) return open.getText();
    try { return await readFile(file, 'utf8'); } catch { return undefined; }
  }

  private async update(): Promise<void> {
    const roots = this.roots();
    const imports = new Map<string, string[]>(), names = new Map<string, string>(), sources = new Map<string, string>();
    const pending = [...roots];
    while (pending.length) {
      const file = pending.pop()!;
      if (imports.has(file)) continue;
      const text = await this.source(file);
      const header = text === undefined ? undefined : theoryHeader(text);
      if (text !== undefined) sources.set(file, text);
      names.set(file, header?.name ?? file.replace(/^.*[\\/]|\.thy$/g, ''));
      const local = (header?.imports ?? []).flatMap(name => importFile(name, dirname(file), existsSync) ?? []);
      imports.set(file, local);
      pending.push(...local);
    }
    // Imports before the theories that use them, as Isabelle loads them.
    const order: string[] = [], visited = new Set<string>();
    const visit = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);
      for (const dependency of imports.get(file) ?? []) visit(dependency);
      order.push(file);
    };
    roots.forEach(visit);
    const active = window.activeTextEditor?.document.uri.fsPath;
    this.theories = order.map(file => this.status(file, names.get(file)!, roots.includes(file), file === active,
      imports.get(file) ?? [], sources.get(file)));
    this.changed.fire();
    if (this.view.visible) await this.openImports();
  }

  private status(file: string, name: string, open: boolean, active: boolean, imports: string[], text?: string): Theory {
    const uri = Uri.file(file).toString();
    const errors = languages.getDiagnostics(Uri.file(file)).filter(d => d.severity === DiagnosticSeverity.Error).length
      || this.goals.decorationRanges(uri, 'text_overview_error').length;
    const busy = coveredLines(['background_unprocessed1', 'background_running1', 'background_canceled']
      .flatMap(type => this.goals.decorationRanges(uri, type)));
    const running = this.goals.decorationRanges(uri, 'background_running1').length > 0;
    const lines = (text ?? '').split('\n').filter(line => line.trim()).length || 1;
    const progress = Math.max(0, Math.min(1, 1 - busy.size / lines));
    const sorry = this.goals.decorationRanges(uri, 'background_bad').length > 0;
    const status: TheoryStatus = !this.goals.annotated(uri) ? 'waiting'
      : errors ? 'failed'
      : running ? 'checking'
      : busy.size ? (active ? 'partial' : open ? 'idle' : 'waiting')
      : sorry ? 'unfinished' : 'finished';
    return { name, file, open, status, progress, errors, imports };
  }

  // The server reports progress only for files the editor has opened.
  private async openImports(): Promise<void> {
    for (const theory of this.theories) {
      if (theory.open || workspace.textDocuments.some(document => document.uri.fsPath === theory.file)) continue;
      try { await workspace.openTextDocument(Uri.file(theory.file)); } catch { /* deleted or unreadable */ }
    }
  }

  getChildren(element?: Theory): Theory[] { return element ? [] : this.theories; }

  getTreeItem(theory: Theory): TreeItem {
    const { label, icon, color } = presentation[theory.status];
    const item = new TreeItem(theory.name);
    const percent = Math.round(theory.progress * 100);
    item.description = theory.status === 'failed' ? `${theory.errors} error${theory.errors === 1 ? '' : 's'}`
      : ['checking', 'partial'].includes(theory.status) ? `${label} · ${percent}%` : label;
    item.iconPath = new ThemeIcon(icon, color ? new ThemeColor(color) : undefined);
    item.tooltip = `${theory.file}\n${label}${theory.open ? '' : ' (imported)'}`;
    item.resourceUri = Uri.file(theory.file);
    item.command = { command: 'vscode.open', title: 'Open Theory', arguments: [Uri.file(theory.file)] };
    return item;
  }

  snapshot(): Theory[] { return this.theories.map(theory => ({ ...theory, imports: [...theory.imports] })); }

  dispose(): void { clearTimeout(this.timer); this.subscriptions.forEach(item => item.dispose()); }
}
