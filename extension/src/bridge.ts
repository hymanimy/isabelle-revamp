import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer, Server, Socket } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AgentSession, BridgeTools } from './bridgeTools';

// Newline-delimited JSON on loopback. Two agents; editor operations serialize.
export class Bridge {
  private server?: Server;
  private agents = new Set<Socket>();
  private operations = Promise.resolve();
  private readonly token = randomBytes(32).toString('hex');
  private metadata = '';
  readonly portFile = process.env.ISABELLE_REVAMP_PORT_FILE ?? join(homedir(), '.isabelle-revamp', 'port');

  constructor(private tools: BridgeTools) {}

  async start(): Promise<void> {
    const server = this.server = createServer(socket => this.connect(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing bridge TCP address.');
    this.metadata = JSON.stringify({ port: address.port, token: this.token }) + '\n';
    await mkdir(dirname(this.portFile), { recursive: true, mode: 0o700 });
    const temporary = this.portFile + '.' + process.pid;
    await writeFile(temporary, this.metadata, { mode: 0o600, flag: 'wx' });
    await rename(temporary, this.portFile);
  }

  private connect(socket: Socket): void {
    socket.on('error', () => socket.destroy());
    if (this.agents.size >= 2) {
      socket.end(JSON.stringify({ error: 'Two agents are already connected to this extension instance.' }) + '\n');
      return;
    }
    this.agents.add(socket);
    socket.on('close', () => this.agents.delete(socket));
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => socket.destroy());
    let authenticated = false;
    let agent: AgentSession | undefined;
    let buffer = '';
    let queue = Promise.resolve();
    const send = (value: unknown) => { if (!socket.destroyed) socket.write(JSON.stringify(value) + '\n'); };
    socket.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) { socket.destroy(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        queue = queue.then(async () => {
          if (socket.destroyed) return;
          let id: unknown = null;
          try {
            const request = JSON.parse(line);
            if (!authenticated) {
              if (request.token !== this.token) { socket.end('{"error":"Invalid bridge token."}\n'); return; }
              authenticated = true;
              socket.setTimeout(0);
              send({ ok: true });
              return;
            }
            id = request.id;
            if (!Number.isSafeInteger(id) || typeof request.method !== 'string'
              || !request.params || typeof request.params !== 'object' || Array.isArray(request.params)) {
              throw new Error('Expected {id: integer, method: string, params: object}.');
            }
            if (!agent) {
              const raw = typeof request.client_name === 'string' ? request.client_name : 'MCP agent';
              const name = /claude/i.test(raw) ? 'Claude' : /codex/i.test(raw) ? 'Codex'
                : raw.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 40) || 'MCP agent';
              agent = { name, versions: new Map() };
            }
            const session = agent;
            const operation = this.operations.then(() => {
              if (socket.destroyed) throw new Error('Client disconnected before the operation started.');
              return this.tools.call(request.method, request.params, session);
            });
            this.operations = operation.then(() => {}, () => {});
            send({ id, result: await operation });
          } catch (error) {
            send({ id, error: error instanceof Error ? error.message : String(error) });
          }
        });
      }
    });
  }

  async close(): Promise<void> {
    for (const agent of this.agents) agent.destroy();
    if (this.server?.listening) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    // Another window may now own discovery. Never remove its port file.
    try { if (this.metadata && await readFile(this.portFile, 'utf8') === this.metadata) await unlink(this.portFile); } catch { /* already removed */ }
  }
}
