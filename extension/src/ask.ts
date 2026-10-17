import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export interface AskEntry { id: number; kind: 'user' | 'assistant' | 'tool' | 'notice'; text: string }
export interface AskState { active: boolean; entries: AskEntry[] }
export interface AskContext { file: string; line: number; cwd: string; portFile: string }
export const registrationCommand = 'claude mcp add --transport stdio --scope local isabelle -- "$PWD/mcp/.venv/bin/python" "$PWD/mcp/server.py"';
export function helpLine(missing: 'claude' | 'MCP'): string {
  return `${missing === 'claude' ? 'claude is not on PATH.' : 'The isabelle MCP server is not registered.'} From the repository root: ${registrationCommand}`;
}
const toolNames = ['open', 'edit', 'goals_at', 'errors', 'status', 'sorry_positions', 'processing_status'];

export function preamble(context: AskContext): string {
  return 'You have the `isabelle` MCP tools. The active theory is ' + context.file + ', cursor at line ' + context.line
    + '. Work only through those tools. Write structured Isar: named `have` steps with short `by` justifications, no Sledgehammer. '
    + 'After each edit check errors and status; stop when fully_checked is true or you are stuck, and say which.\n'
    + 'The cursor line above is one-based; MCP lines and UTF-16 columns are zero-based. '
    + 'Read open immediately before each edit and recompute its range. Query goals_at on a theorem or have command '
    + 'after editing to confirm the current version, then check errors and status. '
    + 'For an explanation request, inspect the actual diagnostics and explain them without editing. '
    + 'Change only the active theory. Do not use sorry, oops, axioms, ML, external tools or other proof automation services to bypass a proof.';
}

export function claudeArgs(context: AskContext, serverRoot: string): string[] {
  // Explicit config isolates this extension instance without changing registration.
  const config = { mcpServers: { isabelle: { type: 'stdio',
    command: join(serverRoot, 'mcp/.venv/bin/python'), args: [join(serverRoot, 'mcp/server.py'), '--port-file', context.portFile] } } };
  return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--allowedTools', ...toolNames.map(name => 'mcp__isabelle__' + name),
    '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', JSON.stringify(config),
    '--disable-slash-commands', '--settings', JSON.stringify({ disableAllHooks: true }),
    '--no-session-persistence', '--system-prompt', preamble(context)];
}

export function toolLabel(name: string, input: Record<string, unknown>): string {
  const short = name.replace(/^mcp__isabelle__/, '');
  const file = typeof input.file === 'string' ? basename(input.file) : '';
  if (short === 'edit' && Number.isInteger(input.start_line)) {
    return `edit ${file} ${input.start_line}:${input.start_col}–${input.end_line}:${input.end_col}`;
  }
  if (short === 'goals_at' && Number.isInteger(input.line)) return `goals_at ${input.line}:${input.col}`;
  return [short, file].filter(Boolean).join(' ');
}

// Decode only displayable text and tool inputs. Never render raw JSON or HTML.
export class AskStream {
  private message = '';
  private blocks = new Map<number, { type: string; entry: AskEntry; json: string; name: string }>();
  private texts = new Map<string, AskEntry[]>();
  private pendingTexts = new Map<string, AskEntry[]>();
  private tools = new Map<string, AskEntry>();
  result = false;
  constructor(private add: (kind: AskEntry['kind'], text: string) => AskEntry) {}

  accept(value: any): void {
    const event = value.type === 'stream_event' ? value.event : undefined;
    if (event?.type === 'message_start') { this.message = event.message.id; this.blocks.clear(); }
    if (event?.type === 'content_block_start') {
      const block = event.content_block;
      if (block.type === 'text') {
        const entry = this.add('assistant', block.text || '');
        this.texts.set(this.message, [...(this.texts.get(this.message) ?? []), entry]);
        this.pendingTexts.set(this.message, [...(this.pendingTexts.get(this.message) ?? []), entry]);
        this.blocks.set(event.index, { type: 'text', entry, json: '', name: '' });
      } else if (block.type === 'tool_use') {
        const entry = this.tools.get(block.id) ?? this.add('tool', toolLabel(block.name, block.input ?? {}));
        this.tools.set(block.id, entry);
        this.blocks.set(event.index, { type: 'tool', entry, json: '', name: block.name });
      }
    }
    if (event?.type === 'content_block_delta') {
      const block = this.blocks.get(event.index);
      if (block && event.delta.type === 'text_delta') block.entry.text += event.delta.text;
      if (block && event.delta.type === 'input_json_delta') {
        block.json += event.delta.partial_json;
        try { block.entry.text = toolLabel(block.name, JSON.parse(block.json)); } catch { /* incomplete input */ }
      }
    }
    if (value.type === 'assistant') {
      value.message.content.forEach((block: any) => {
        if (block.type === 'text') {
          // Claude emits an assistant message per completed block: its content
          // array starts at zero even after a streamed thinking block at index 0.
          const entries = this.texts.get(value.message.id) ?? [];
          const entry = this.pendingTexts.get(value.message.id)?.shift()
            ?? entries.find(item => item.text === block.text) ?? this.add('assistant', '');
          entry.text = block.text;
          if (!entries.includes(entry)) entries.push(entry);
          this.texts.set(value.message.id, entries);
        } else if (block.type === 'tool_use') {
          const entry = this.tools.get(block.id) ?? this.add('tool', '');
          entry.text = toolLabel(block.name, block.input ?? {}); this.tools.set(block.id, entry);
        }
      });
    }
    if (value.type === 'result') {
      this.result = true;
      if (value.is_error) this.add('notice', value.result || value.errors?.join('\n') || 'Claude stopped: ' + value.subtype);
      else if (value.result && ![...this.texts.values()].flat().some(entry => entry.text === value.result)) this.add('assistant', value.result);
      if (value.permission_denials?.length) this.add('notice', 'Claude was denied a tool request; the proof may be unfinished.');
    }
  }
}

interface RunOptions { executable?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }
export class Ask {
  private state: AskState = { active: false, entries: [] };
  private child?: ChildProcessWithoutNullStreams;
  private stopped = false;
  private sequence = 0;
  constructor(private serverRoot: string, private changed: (state: AskState) => void, private options: RunOptions = {}) {}
  snapshot(): AskState { return structuredClone(this.state); }
  private publish(): void { this.changed(this.snapshot()); }
  private add = (kind: AskEntry['kind'], text: string): AskEntry => {
    const entry = { id: ++this.sequence, kind, text }; this.state.entries.push(entry); return entry;
  };
  notice(text: string): void { this.add('notice', text); this.publish(); }

  private signal(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* already exited */ }
  }
  stop(reason = 'Stopped. Edits already submitted to Isabelle remain in the editor.'): void {
    if (!this.state.active || this.stopped) return;
    this.stopped = true; this.notice(reason);
    const child = this.child;
    if (child) {
      this.signal(child, 'SIGTERM');
      setTimeout(() => this.signal(child, 'SIGKILL'), 1500);
    }
  }
  dispose(): void { this.stop(); }

  private execute(args: string[], context: AskContext, input: string, line?: (line: string) => void): Promise<{ code: number | null; output: string; error: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.executable ?? 'claude', args, { cwd: context.cwd,
        env: this.options.env ?? process.env, detached: process.platform !== 'win32', stdio: 'pipe' });
      this.child = child;
      let output = '', error = '', buffer = '', failure: Error | undefined;
      const framed = new StringDecoder('utf8');
      child.stdout.on('data', chunk => {
        const decoded = framed.write(chunk);
        output = (output + decoded).slice(-16384);
        if (!line || this.stopped) return;
        buffer += decoded;
        try {
          if (buffer.length > 2 * 1024 * 1024) throw new Error('Claude stream record exceeds 2 MiB.');
          let end: number;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const record = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            if (record.trim()) line(record);
          }
        } catch (err) {
          failure = err as Error; this.signal(child, 'SIGTERM');
          setTimeout(() => this.signal(child, 'SIGKILL'), 1500);
        }
      });
      child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-4000); });
      child.on('error', err => { failure = err; });
      child.stdin.on('error', () => { /* child may exit before reading */ });
      child.on('close', code => {
        if (this.child === child) this.child = undefined;
        if (!this.stopped && !failure && line && buffer.trim()) {
          try { line(buffer + framed.end()); } catch (err) { failure = err as Error; }
        }
        if (failure) reject(failure); else resolve({ code, output, error });
      });
      child.stdin.end(input);
    });
  }

  async send(context: AskContext, text: string): Promise<boolean> {
    if (this.state.active || !text.trim()) return false;
    const history = this.state.entries.filter(entry => entry.kind === 'user' || entry.kind === 'assistant')
      .map(entry => `${entry.kind}: ${entry.text}`).join('\n\n');
    this.state.active = true; this.stopped = false; this.add('user', text.trim()); this.publish();
    const timeout = setTimeout(() => this.stop('Stopped after the 10-minute time limit. Edits already submitted remain in the editor.'), this.options.timeoutMs ?? 600000);
    try {
      const registration = await this.execute(['mcp', 'get', 'isabelle'], context, '');
      if (this.stopped) return true;
      if (registration.code !== 0 || !/^isabelle:/m.test(registration.output)) {
        this.notice(helpLine('MCP')); return true;
      }
      const stream = new AskStream(this.add);
      const prompt = (history ? 'Earlier conversation (context only; read the current buffer again):\n' + history + '\n\n' : '') + 'User request:\n' + text.trim();
      const result = await this.execute(claudeArgs(context, this.serverRoot), context, prompt, record => {
        let value;
        try { value = JSON.parse(record); } catch { throw new Error('Claude returned an invalid stream-json record.'); }
        stream.accept(value); this.publish();
      });
      if (!this.stopped && (result.code !== 0 || !stream.result)) {
        this.notice(`Claude exited ${result.code ?? 'by signal'} without a successful completion${result.error.trim() ? ': ' + result.error.trim() : '.'}`);
      }
    } catch (error) {
      if (!this.stopped) this.notice((error as NodeJS.ErrnoException).code === 'ENOENT' ? helpLine('claude') : 'Claude could not run: ' + String(error));
    } finally {
      clearTimeout(timeout);
      // Leave the brief escalation timer armed after Stop, even if the parent exits first.
      this.state.active = false; this.publish();
    }
    return true;
  }
}
