import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { ConfigurationTarget, workspace } from 'vscode';

// Protect navigation targets in this workspace; never change global settings.
export async function lockLibraryFiles(executable: string): Promise<string[]> {
  const { stdout } = await promisify(execFile)(executable,
    ['getenv', '-b', 'ISABELLE_HOME', 'ISABELLE_HOME_USER'], { timeout: 15000 });
  const [home, user] = stdout.trim().split(/\r?\n/);
  if (!home?.startsWith('/') || !user?.startsWith('/')) throw new Error('Isabelle returned invalid library paths.');
  const patterns = [home, dirname(user)].map(path => path.replace(/\\/g, '/') + '/**');
  if (workspace.workspaceFolders?.length) {
    const settings = workspace.getConfiguration('files', null);
    const includes = settings.get<Record<string, boolean>>('readonlyInclude', {});
    const missing = patterns.filter(pattern => !Object.hasOwn(includes, pattern));
    if (missing.length) await settings.update('readonlyInclude',
      { ...includes, ...Object.fromEntries(missing.map(pattern => [pattern, true])) }, ConfigurationTarget.Workspace);
  }
  return patterns;
}
