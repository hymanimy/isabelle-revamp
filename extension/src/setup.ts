import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
async function executableFile(file: string): Promise<boolean> {
  try { await access(file, constants.X_OK); return (await stat(file)).isFile(); } catch { return false; }
}
export function registrationCommand(serverRoot: string): string {
  const launcher = join(serverRoot, 'mcp/launch.py').replace(/'/g, "'\\''");
  return `claude mcp add --transport stdio --scope local isabelle -- python3 '${launcher}'`;
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

export async function setupReport(executable: string | undefined, cwd: string, serverRoot: string): Promise<string[]> {
  const lines: string[] = [];
  if (!executable) lines.push('✗ Isabelle: not found — use Locate… or set isabelleRevamp.executable.');
  else {
    try {
      const result = await execute(executable, ['version'], { cwd, timeout: 15000 });
      lines.push(`✓ Isabelle: ${result.stdout.trim()} (${executable})`);
    } catch { lines.push(`✗ Isabelle: cannot run ${executable} — set isabelleRevamp.executable to a working installation.`); }
  }
  try {
    if (!executable) throw new Error('missing');
    await execute(executable, ['build', '-n', '-l', 'HOL'], { cwd, timeout: 60000 });
    lines.push('✓ HOL heap present (isabelle build -n -l HOL exited 0).');
  } catch { lines.push('✗ HOL heap: unavailable — run isabelle build -b HOL with this installation.'); }
  // Claude Code and MCP are optional: report them without marking a working setup as broken.
  const claude = await onPath('claude');
  lines.push(claude ? `✓ Claude on PATH: ${claude}` : '– Claude Code (optional): not on PATH. Install it to use the Isabelle MCP server.');
  try {
    if (!claude) throw new Error('missing');
    const result = await execute(claude, ['mcp', 'get', 'isabelle'], { cwd, timeout: 15000 });
    if (!/^isabelle:/m.test(result.stdout)) throw new Error('unregistered');
    lines.push('✓ MCP registered: isabelle (this extension’s bundled server).');
  } catch { lines.push(`– MCP (optional): not registered. To use it with Claude Code, run: ${registrationCommand(serverRoot)}`); }
  return lines;
}
