import { randomBytes } from 'node:crypto';
import { commands, Disposable, Uri, ViewColumn, WebviewPanel, window } from 'vscode';
import { GraphFrame, GraphState } from './graphTypes';

export class ProofGraphPanel implements Disposable {
  private panel?: WebviewPanel;
  private state?: GraphState;
  private frames: GraphFrame[] = [];
  private replies = new Map<number, (result: any) => void>();
  private sequence = 0;
  private ready = false;
  private pending: unknown[] = [];
  get active(): boolean { return this.panel?.active === true; }
  constructor(private extensionPath: string, private select: (uri: string, version: number, id: string) => Promise<void>) {}
  show(): void {
    if (this.panel) { this.panel.reveal(); return; }
    const media = Uri.joinPath(Uri.file(this.extensionPath), 'media');
    const panel = this.panel = window.createWebviewPanel('isabelleRevamp.proofGraph', 'Isabelle Proof Graph',
      ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    panel.onDidDispose(() => { this.panel = undefined; this.ready = false; this.pending = []; for (const reply of this.replies.values()) reply({ error: 'Graph closed' }); this.replies.clear(); });
    panel.webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') {
        this.ready = true; this.publish();
        for (const message of this.pending) void panel.webview.postMessage(message);
        this.pending = [];
      }
      else if (message?.type === 'select' && typeof message.id === 'string') void this.select(message.uri, message.version, message.id);
      else if (message?.type === 'fullscreen') void this.fullscreen();
      else if (message?.type === 'replay') void panel.webview.postMessage({ type: 'replay', frames: this.frames });
      else if (message?.type === 'receipt' && Number.isSafeInteger(message.request)) {
        this.replies.get(message.request)?.(message.result); this.replies.delete(message.request);
      }
    });
    const nonce = randomBytes(16).toString('hex');
    const script = panel.webview.asWebviewUri(Uri.joinPath(media, 'proofGraph.js'));
    const style = panel.webview.asWebviewUri(Uri.joinPath(media, 'proofGraph.css'));
    panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${style}"></head>
<body><header><div><h1>Isabelle Proof Graph</h1><p id="status" role="status">Open a theory to follow its proof.</p></div>
<nav><button id="fit">Fit</button><button id="replay">Replay ×8</button><button id="fullscreen">Full screen</button></nav></header>
<main><svg id="graph" aria-label="Proof dependencies" role="img"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z"/></marker></defs><g id="viewport"><g id="containers"></g><g id="edges"></g><g id="nodes"></g></g></svg></main>
<footer>Open <span class="key open"></span> · Checking <span class="key checking"></span> · Proved <span class="key proved"></span> · Error <span class="key error"></span> · Drag to pan · Scroll to zoom</footer>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
  async fullscreen(): Promise<void> {
    this.panel?.reveal();
    // This is an editor tab, so maximizing the terminal/panel would maximize
    // the wrong surface. Maximize its editor group and hide the sidebars.
    await commands.executeCommand('workbench.action.maximizeEditorHideSidebar');
  }
  update(state: GraphState, frames: GraphFrame[]): void { this.state = state; this.frames = frames; this.publish(); }
  private publish(): void { if (this.panel && this.state) void this.panel.webview.postMessage({ type: 'state', state: this.state }); }
  // The host check asks the real offline webview for rendering/timing receipts.
  inspect(action: 'snapshot' | 'benchmark' | 'replay'): Promise<any> {
    this.show();
    const request = ++this.sequence;
    return new Promise((resolve, reject) => {
      const limit = action === 'replay' ? Math.max(30000, (this.frames.at(-1)?.at ?? 0) / 8 + 15000) : 30000;
      const timeout = setTimeout(() => { this.replies.delete(request); reject(new Error('Proof Graph webview did not reply')); }, limit);
      this.replies.set(request, value => { clearTimeout(timeout); resolve(value); });
      const message = { type: 'inspect', action, request, frames: action === 'replay' ? this.frames : undefined };
      if (this.ready) void this.panel!.webview.postMessage(message); else this.pending.push(message);
    });
  }
  dispose(): void { this.panel?.dispose(); }
}
