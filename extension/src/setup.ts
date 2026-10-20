import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { ServerSettings, sessionArgs } from './serverSettings';

const execute = promisify(execFile);
async function executableFile(file: string): Promise<boolean> {
  try { await access(file, constants.X_OK); return (await stat(file)).isFile(); } catch { return false; }
}
// The Isabelle release this extension is built and tested against. Others start
// anyway: the language server protocol changes between releases, so some features may not work.
export const supportedIsabelle = 'Isabelle2025-2';
export async function isabelleVersion(executable: string, cwd: string): Promise<string> {
  return (await execute(executable, ['version'], { cwd, timeout: 15000 })).stdout.trim();
}
export const versionWarning = (version: string) => version === supportedIsabelle ? undefined
  : `Isabelle Revamp is built for ${supportedIsabelle}, but this Isabelle is ${version}: some features may not work. `
    + 'Support for Isabelle2026 will follow its release.';

// How agents start the MCP server: VS Code's own Node.js runs the bundled script,
// so neither Node nor Python needs to be installed.
export interface McpLaunch { command: string; args: string[]; env: Record<string, string> }
export const mcpLaunch = (extensionPath: string, runtime = process.execPath): McpLaunch =>
  ({ command: runtime, args: [join(extensionPath, 'out', 'mcpServer.js')], env: { ELECTRON_RUN_AS_NODE: '1' } });

const registration = (launch: McpLaunch) => ['mcp', 'add', '--scope', 'user', 'isabelle',
  ...Object.entries(launch.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]), '--', launch.command, ...launch.args];

export function registrationCommand(launch: McpLaunch): string {
  return ['claude', ...registration(launch)].map(arg => /^[\w./=:@-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
}

// Register for all of the user's projects, replacing any earlier registration
// (including a project-local one, which would take precedence).
export async function registerWithClaude(claude: string, launch: McpLaunch, cwd: string): Promise<void> {
  for (const scope of ['local', 'user']) {
    await execute(claude, ['mcp', 'remove', '--scope', scope, 'isabelle'], { cwd, timeout: 15000 }).catch(() => {});
  }
  await execute(claude, registration(launch), { cwd, timeout: 30000 });
}
export async function onPath(name: string, path = process.env.PATH ?? ''): Promise<string | undefined> {
  for (const directory of path.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    if (await executableFile(candidate)) return candidate;
  }
}

export async function findIsabelle(configured: string, home = homedir(), path = process.env.PATH ?? '', applications = '/Applications'): Promise<string | undefined> {
  const candidates: string[] = [];
  if (configured) {
    const expanded = configured.startsWith('~/') ? join(home, configured.slice(2)) : configured;
    candidates.push(expanded.includes('/') || expanded.includes('\\') ? expanded : await onPath(expanded, path) ?? '');
  }
  candidates.push(await onPath('isabelle', path) ?? '');
  for (const directory of [applications, home]) {
    try {
      const names = (await readdir(directory)).filter(name => /^Isabelle/.test(name)).sort().reverse();
      candidates.push(...names.map(name => join(directory, name, 'bin/isabelle')));
    } catch { /* optional installation location */ }
  }
  for (const candidate of new Set(candidates.filter(Boolean))) {
    if (await executableFile(candidate)) return candidate;
  }
}

export async function setupReport(executable: string | undefined, cwd: string, launch: McpLaunch,
  session: Pick<ServerSettings, 'logic' | 'sessionDirs'> = { logic: 'HOL', sessionDirs: [] }): Promise<string[]> {
  const lines: string[] = [];
  if (!executable) lines.push('✗ Isabelle: not found — use Locate… or set isabelleRevamp.executable.');
  else {
    try {
      const version = await isabelleVersion(executable, cwd), warning = versionWarning(version);
      lines.push(warning ? `⚠ Isabelle: ${warning} (${executable})` : `✓ Isabelle: ${version} (${executable})`);
    } catch { lines.push(`✗ Isabelle: cannot run ${executable} — set isabelleRevamp.executable to a working installation.`); }
  }
  try {
    if (!executable) throw new Error('missing');
    // build -n exits non-zero when the session would need building.
    const args = sessionArgs(session).filter(arg => arg !== '-l');
    await execute(executable, ['build', '-n', '-b', ...args], { cwd, timeout: 60000 });
    lines.push(`✓ ${session.logic} heap present.`);
  } catch {
    lines.push(`✗ ${session.logic} heap: unavailable — run isabelle build -b ${sessionArgs(session).filter(arg => arg !== '-l').join(' ')}`);
  }
  // Claude Code and MCP are optional: report them without marking a working setup as broken.
  const claude = await onPath('claude');
  lines.push(claude ? `✓ Claude on PATH: ${claude}` : '– Claude Code (optional): not on PATH. Install it to use the Isabelle MCP server.');
  const register = 'run Isabelle: Register MCP Server with Claude Code';
  let registered: string | undefined;
  if (claude) {
    registered = await execute(claude, ['mcp', 'get', 'isabelle'], { cwd, timeout: 15000 })
      .then(result => result.stdout, () => undefined);
  }
  if (registered?.includes(launch.args[0])) lines.push('✓ MCP registered: isabelle (this install’s bundled server).');
  else if (registered) lines.push(`– MCP (optional): isabelle is registered for another install or the old Python server; ${register}.`);
  else lines.push(`– MCP (optional): not registered. To use it with Claude Code, ${register}, or: ${registrationCommand(launch)}`);
  return lines;
}
