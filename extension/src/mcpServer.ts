// The MCP server an agent such as Claude Code starts over stdio. It forwards tool
// calls to the VS Code window whose workspace contains the agent's directory, so the
// agent and the user share one Isabelle process. Runs on the Node.js built into
// VS Code (ELECTRON_RUN_AS_NODE=1); bundled into out/mcpServer.js.
import { connect, Socket } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { chooseWindow, windows } from './discovery';

const limit = 2 * 1024 * 1024;
// out/ and src/ both sit next to package.json, bundled or not.
const { version } = require('../package.json') as { version: string };

class BridgeClient {
  private socket?: Socket;
  private buffer = '';
  private reply?: (line: string | undefined) => void;
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;

  constructor(private cwd: string) {}

  // Connect on first use, so the server starts cleanly in projects without a VS Code
  // window, and reconnects after the window reloads.
  private async open(): Promise<void> {
    const choice = chooseWindow(await windows(), this.cwd);
    if (typeof choice === 'string') throw new Error(choice);
    const socket = connect(choice.port, '127.0.0.1');
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        this.reply?.(line);
      }
    });
    socket.on('close', () => { if (this.socket === socket) this.drop(); });
    socket.on('error', () => socket.destroy());
    this.socket = socket;
    this.buffer = '';
    const hello = JSON.parse(await this.line(5000, JSON.stringify({ token: choice.token })));
    if (hello.error) throw new Error(hello.error);
    if (hello.ok !== true) throw new Error('Unexpected bridge handshake.');
  }

  private drop(): void {
    this.socket?.destroy();
    this.socket = undefined;
    this.reply?.(undefined);
  }

  private line(timeout: number, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(undefined, 'timed out'), timeout);
      const finish = (line: string | undefined, reason = 'connection closed') => {
        clearTimeout(timer);
        this.reply = undefined;
        if (line === undefined) { this.drop(); reject(new Error('Extension ' + reason)); } else resolve(line);
      };
      this.reply = line => finish(line);
      this.socket!.write(body + '\n');
    });
  }

  request(method: string, params: Record<string, unknown>, client: string): Promise<unknown> {
    const run = async () => {
      if (!this.socket) {
        try { await this.open(); } catch (error) {
          this.drop();
          throw new Error(`Cannot reach Isabelle in VS Code: ${(error as Error).message}`);
        }
      }
      const id = ++this.sequence;
      const body = JSON.stringify({ id, method, params, client_name: client });
      if (Buffer.byteLength(body) > limit) throw new Error('Request exceeds the 2 MiB limit.');
      let reply;
      try {
        reply = JSON.parse(await this.line(35000, body));
        if (reply.id !== id) throw new Error('response ID mismatch');
      } catch (error) {
        this.drop();
        throw new Error(`Bridge request failed: ${(error as Error).message}. An edit may already have applied; inspect the file before retrying.`);
      }
      if ('error' in reply) throw new Error(reply.error);
      return reply.result;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}

const bridge = new BridgeClient(process.cwd());
const server = new McpServer({ name: 'Isabelle Revamp', version }, {
  instructions: 'Work in the open VS Code workspace. Positions are zero-based lines and UTF-16 columns; ends are exclusive. '
    + 'Start with open to read the current buffer. edit changes and saves that buffer. goals_at returns the proof state and messages at a position. '
    + 'None of these move the user\'s cursor. Empty errors do not prove completion: check status and sorry_positions. '
    + 'Read open immediately before every edit; stale edits are rejected. Never retry an uncertain edit without reading the buffer again.',
});

const read = { readOnlyHint: true, openWorldHint: false };
const file = z.string().describe('Theory file, absolute or relative to the first workspace folder.');
const position = z.number().int().min(0);

function tool(name: string, description: string, input: z.ZodRawShape, annotations: Record<string, boolean>) {
  server.registerTool(name, { description, inputSchema: input, annotations }, async (args: Record<string, unknown>) => {
    const client = server.server.getClientVersion()?.name ?? 'MCP agent';
    const result = await bridge.request(name, args, client);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 1) }] };
  });
}

tool('open', 'Read an existing workspace .thy file as VS Code holds it, including unsaved edits; return its text and version. Does not change the user\'s editor.',
  { file }, read);
tool('edit', 'Replace an exclusive-end range using zero-based lines/UTF-16 columns, then save. Read open first. Undo works in VS Code.',
  { file, start_line: position, start_col: position, end_line: position, end_col: position, text: z.string() },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
tool('goals_at', 'Return the proof state and messages (e.g. try0 suggestions) at a proof command, once Isabelle has checked up to it; waits up to 30s. Includes phase and version. Does not move the user\'s cursor.',
  { file, line: position, col: position }, read);
tool('errors', 'Check the whole theory (up to 15s per call), then return error messages and source ranges. complete=false means checking is still pending; call again, as progress is kept.',
  { file }, read);
tool('status', 'Check the theories open in the user\'s tabs and those this client has read or edited (up to 15s each per call), and report completion: versions, errors, admissions and saved state. Checking or sorry is never fully_checked; call again while checking.',
  {}, read);
tool('sorry_positions', 'Check the whole theory (up to 15s per call), then list sorry commands as [start_line,start_col,end_line,end_col] ranges. Ignores comments/strings; complete=false means the list is provisional.',
  { file }, read);
tool('processing_status', 'Advance checking of the same theories as status (up to 5s each), then report processing/known flags and pending ranges.',
  {}, read);

void server.connect(new StdioServerTransport());
