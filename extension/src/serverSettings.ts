import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

// Settings that shape the Isabelle process; changing any of them needs a restart.
export const serverSettingKeys = ['executable', 'logic', 'sessionDirs', 'checkingPerspective', 'outputDelay'].map(key => 'isabelleRevamp.' + key);

export interface ServerSettings { logic: string; sessionDirs: string[]; perspective: number; outputDelay: number }

interface Configuration { get<T>(key: string, fallback: T): T }

// Relative session directories resolve against base, normally the first workspace folder.
export function serverSettings(settings: Configuration, base = homedir()): ServerSettings {
  const sessionDirs = settings.get<string[]>('sessionDirs', []).filter(dir => typeof dir === 'string' && dir.trim())
    .map(dir => dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : isAbsolute(dir) ? dir : resolve(base, dir));
  const perspective = settings.get<number>('checkingPerspective', 50);
  const outputDelay = settings.get<number>('outputDelay', 0.2);
  return { logic: settings.get<string>('logic', 'HOL').trim() || 'HOL', sessionDirs,
    perspective: Number.isInteger(perspective) && perspective >= 0 ? perspective : 50,
    outputDelay: Number.isFinite(outputDelay) && outputDelay >= 0.05 && outputDelay <= 2 ? outputDelay : 0.2 };
}

export const sessionArgs = (settings: Pick<ServerSettings, 'logic' | 'sessionDirs'>): string[] =>
  [...settings.sessionDirs.flatMap(dir => ['-d', dir]), '-l', settings.logic];

export function serverArgs(settings: ServerSettings): string[] {
  return ['vscode_server', '-n', ...sessionArgs(settings),
    '-o', 'vscode_html_output=true',
    '-o', 'editor_output_state=true',
    '-o', 'vscode_pide_extensions=true',
    '-o', 'vscode_unicode_symbols_edits=true',
    '-o', 'vscode_unicode_symbols_output=true',
    // Like jEdit, check only near what you are looking at; 0 checks all of every open theory.
    '-o', `vscode_caret_perspective=${settings.perspective}`,
    // Isabelle's 0.5 s default makes a by simp take ~1 s to show; jEdit uses 0.1 s.
    // 0.2 s is as quick on small theories without flooding large ones (CREATION_NOTES.md).
    '-o', `vscode_output_delay=${settings.outputDelay}`,
  ];
}
