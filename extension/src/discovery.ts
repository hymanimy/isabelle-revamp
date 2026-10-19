import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';

// How an MCP server finds the VS Code window to talk to. Every window running the
// extension publishes a file with its bridge port, token and workspace folders.
export interface WindowInfo { port: number; token: string; pid: number; folders: string[] }

export const discoveryDirectory = () => join(homedir(), '.isabelle-revamp', 'windows');

// ISABELLE_REVAMP_PORT_FILE pins one file on both sides, e.g. for an isolated test instance.
export const pinnedFile = () => process.env.ISABELLE_REVAMP_PORT_FILE || undefined;

export async function publishWindow(info: WindowInfo, file = pinnedFile()
  ?? join(discoveryDirectory(), `${info.pid}-${randomBytes(4).toString('hex')}.json`)): Promise<string> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomBytes(4).toString('hex');
  await writeFile(temporary, JSON.stringify(info) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
  return file;
}

// Remove a window's file, unless another window has since replaced it.
export async function withdrawWindow(file: string, token: string): Promise<void> {
  try {
    if (parse(await readFile(file, 'utf8'))?.token === token) await unlink(file);
  } catch { /* already removed */ }
}

function parse(text: string): WindowInfo | undefined {
  try {
    const value = JSON.parse(text);
    if (Number.isInteger(value.port) && value.port > 0 && value.port < 65536 && typeof value.token === 'string') {
      return { port: value.port, token: value.token, pid: Number.isInteger(value.pid) ? value.pid : 0,
        folders: Array.isArray(value.folders) ? value.folders.filter((f: unknown) => typeof f === 'string') : [] };
    }
  } catch { /* partial or foreign file */ }
  return undefined;
}

function alive(pid: number): boolean {
  if (!pid) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

export async function windows(): Promise<WindowInfo[]> {
  const pinned = pinnedFile();
  if (pinned) {
    const info = parse(await readFile(pinned, 'utf8').catch(() => ''));
    return info ? [info] : [];
  }
  const directory = discoveryDirectory();
  const result: WindowInfo[] = [];
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    if (!name.endsWith('.json')) continue;
    const info = parse(await readFile(join(directory, name), 'utf8').catch(() => ''));
    if (!info) continue;
    // A crashed window cannot remove its own file.
    if (!alive(info.pid)) { await unlink(join(directory, name)).catch(() => {}); continue; }
    result.push(info);
  }
  return result;
}

const within = (folder: string, path: string) => {
  const part = relative(folder, path);
  return !part.startsWith('..') && !isAbsolute(part);
};

// The window whose workspace folder most closely contains `cwd`; the only window if
// none does. Otherwise an explanation for the agent.
export function chooseWindow(candidates: WindowInfo[], cwd: string): WindowInfo | string {
  if (!candidates.length) return 'No VS Code window is running Isabelle Revamp. Open a theory in VS Code first.';
  const matches = candidates.flatMap(info => info.folders.filter(folder => within(folder, cwd))
    .map(folder => ({ info, depth: folder.length })));
  if (matches.length) return matches.sort((a, b) => b.depth - a.depth)[0].info;
  if (candidates.length === 1) return candidates[0];
  return `Several VS Code windows run Isabelle Revamp and none has ${cwd} in its workspace: `
    + candidates.map(info => info.folders.join(', ') || '(no folder)').join('; ')
    + '. Start the agent inside the workspace folder of the window it should use.';
}
