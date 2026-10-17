import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer, Server, Socket } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { BridgeTools } from './bridgeTools';

// Newline-delimited JSON on loopback. One persistent, authenticated agent socket.
export class Bridge {
  private server?: Server;
  private agent?: Socket;
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
    if (this.agent) {
      socket.end(JSON.stringify({ error: 'An agent is already connected to this extension instance.' }) + '\n');
      return;
    }
    this.agent = socket;
    socket.on('close', () => { if (this.agent === socket) this.agent = undefined; });
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => socket.destroy());
    let authenticated = false;
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
            send({ id, result: await this.tools.call(request.method, request.params) });
          } catch (error) {
            send({ id, error: error instanceof Error ? error.message : String(error) });
          }
        });
      }
    });
  }

  async close(): Promise<void> {
    this.agent?.destroy();
    if (this.server?.listening) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    // Another window may now own discovery. Never remove its port file.
    try { if (this.metadata && await readFile(this.portFile, 'utf8') === this.metadata) await unlink(this.portFile); } catch { /* already removed */ }
  }
}
