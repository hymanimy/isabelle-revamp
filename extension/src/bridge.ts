import { randomBytes } from 'node:crypto';
import { createServer, Server, Socket } from 'node:net';
import { AgentSession, BridgeTools } from './bridgeTools';
import { publishWindow, withdrawWindow } from './discovery';

// Newline-delimited JSON on loopback, one connection per MCP client. Editor
// operations from all clients run one at a time.
export class Bridge {
  private server?: Server;
  private agents = new Set<Socket>();
  private operations = Promise.resolve();
  private readonly token = randomBytes(32).toString('hex');
  private port = 0;
  portFile?: string;

  constructor(private tools: BridgeTools, private folders: () => string[]) {}

  async start(): Promise<void> {
    const server = this.server = createServer(socket => this.connect(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing bridge TCP address.');
    this.port = address.port;
    await this.publish();
  }

  // MCP servers pick the window whose workspace contains the agent's directory.
  async publish(): Promise<void> {
    if (!this.port) return;
    this.portFile = await publishWindow({ port: this.port, token: this.token, pid: process.pid, folders: this.folders() }, this.portFile);
  }

  private connect(socket: Socket): void {
    socket.on('error', () => socket.destroy());
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
            // The MCP client's self-reported name labels its edits; it is not authentication.
            agent ??= { name: typeof request.client_name === 'string'
              && request.client_name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 40) || 'MCP agent', versions: new Map() };
            const session = agent;
            const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
              const operation = this.operations.then(() => {
                if (socket.destroyed) throw new Error('Client disconnected before the operation started.');
                return work();
              });
              this.operations = operation.then(() => {}, () => {});
              return operation;
            };
            // Sledgehammer waits for its result outside the queue, so other calls go on meanwhile.
            send({ id, result: await (request.method === 'sledgehammer'
              ? this.tools.sledgehammer(request.params, session, exclusive)
              : exclusive(() => this.tools.call(request.method, request.params, session))) });
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
    if (this.portFile) await withdrawWindow(this.portFile, this.token);
  }
}
