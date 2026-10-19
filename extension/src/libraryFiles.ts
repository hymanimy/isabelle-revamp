import { execFile } from 'node:child_process';
import { dirname, isAbsolute, relative } from 'node:path';
import { promisify } from 'node:util';
import { commands, Disposable, TextEditor, window, workspace } from 'vscode';

export async function libraryRoots(executable: string): Promise<string[]> {
  const { stdout } = await promisify(execFile)(executable,
    ['getenv', '-b', 'ISABELLE_HOME', 'ISABELLE_HOME_USER'], { timeout: 15000 });
  const [home, user] = stdout.trim().split(/\r?\n/);
  if (!home || !user || !isAbsolute(home) || !isAbsolute(user)) throw new Error('Isabelle returned invalid library paths.');
  return [home, dirname(user)];
}

const inside = (root: string, file: string) => {
  const part = relative(root, file);
  return part !== '' && !part.startsWith('..') && !isAbsolute(part);
};

// Make library theories read-only for this session when they open, so a
// Ctrl-click into HOL cannot be edited by accident. Unlike files.readonlyInclude
// this never writes the user's settings. Files inside an open workspace folder
// stay writable, so working on the Isabelle sources themselves still works.
export class LibraryFiles implements Disposable {
  private locked = new WeakSet<TextEditor>();
  private subscription: Disposable;
  constructor(private roots: string[]) {
    this.subscription = window.onDidChangeActiveTextEditor(editor => { void this.lock(editor); });
    void this.lock(window.activeTextEditor);
  }
  isLibrary(file: string): boolean {
    return this.roots.some(root => inside(root, file))
      && !(workspace.workspaceFolders ?? []).some(folder => inside(folder.uri.fsPath, file));
  }
  private async lock(editor?: TextEditor): Promise<void> {
    if (!editor || editor.document.uri.scheme !== 'file' || this.locked.has(editor)
      || !this.isLibrary(editor.document.uri.fsPath)) return;
    this.locked.add(editor);
    // The command applies to the active editor only.
    if (window.activeTextEditor === editor) await commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
  }
  dispose(): void { this.subscription.dispose(); }
}
