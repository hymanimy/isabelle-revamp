import { randomBytes } from 'node:crypto';
import { commands, Disposable, Uri, ViewColumn, Webview, WebviewPanel, WebviewView, WebviewViewProvider, window } from 'vscode';
import { GraphFrame, GraphState } from './graphTypes';
import { replaySpeed, replayTimeline } from './graphReplay';

export interface GraphViewOptions { fold?: boolean; speed?: number; width?: number; height?: number; frames?: GraphFrame[] }

// One renderer/model, hosted either in the bottom view or the optional editor tab.
export class ProofGraphPanel implements Disposable, WebviewViewProvider {
  private panel?: WebviewPanel;
  private view?: WebviewView;
  private state?: GraphState;
  private frames: GraphFrame[] = [];
  private ready = new Set<Webview>();
  private pending: unknown[] = [];
  private replies = new Map<number, (result: any) => void>();
  private sequence = 0;
  get active(): boolean { return this.panel?.active === true || this.view?.visible === true; }
  constructor(private extensionPath: string, private select: (uri: string, version: number, id: string) => Promise<void>,
    private hover: (uri: string, version: number, id: string) => Promise<string>) {}
  resolveWebviewView(view: WebviewView): void {
    this.view = view; this.prepare(view.webview);
    view.onDidDispose(() => { this.ready.delete(view.webview); this.view = undefined; });
  }
  show(column?: ViewColumn): void {
    if (column !== undefined) { this.openEditor(column); return; }
    void commands.executeCommand('isabelleRevamp.proofGraph.focus');
    void commands.executeCommand('workbench.action.closeSidebar');
  }
  openEditor(column = ViewColumn.Beside): void {
    if (this.panel) { this.panel.reveal(column); return; }
    const panel = this.panel = window.createWebviewPanel('isabelleRevamp.proofGraph', 'Isabelle Proof Graph', column,
      { enableScripts: true, retainContextWhenHidden: true });
    this.prepare(panel.webview);
    panel.onDidDispose(() => { this.ready.delete(panel.webview); this.panel = undefined; });
  }
  private prepare(webview: Webview): void {
    const media = Uri.joinPath(Uri.file(this.extensionPath), 'media');
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') {
        this.ready.add(webview); this.publish();
        for (const request of this.pending) void webview.postMessage(request);
        this.pending = [];
      } else if (message?.type === 'select' && typeof message.id === 'string') void this.select(message.uri, message.version, message.id);
      else if (message?.type === 'hover' && typeof message.id === 'string') {
        void this.hover(message.uri, message.version, message.id).then(text => webview.postMessage({ type: 'hover', id: message.id, uri: message.uri, version: message.version, text }));
      }
      else if (message?.type === 'fullscreen') this.openEditor();
      else if (message?.type === 'replay') void webview.postMessage({ type: 'replay', frames: this.frames });
      else if (message?.type === 'receipt' && Number.isSafeInteger(message.request)) {
        this.replies.get(message.request)?.(message.result); this.replies.delete(message.request);
      }
    });
    const nonce = randomBytes(16).toString('hex');
    const script = webview.asWebviewUri(Uri.joinPath(media, 'proofGraph.js'));
    const style = webview.asWebviewUri(Uri.joinPath(media, 'proofGraph.css'));
    webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${style}"></head>
<body><header><p id="status" role="status">Open a theory to follow its proof.</p>
<nav><label><input id="fold" type="checkbox">Fold proved</label><button id="fit">Fit</button><button id="replay">Replay</button>
<select id="speed" aria-label="Replay speed"><option value="1">×1</option><option value="2" selected>×2</option><option value="4">×4</option><option value="8">×8</option></select>
<button id="fullscreen">Open in editor column</button></nav></header>
<main><svg id="graph" aria-label="Proof dependencies" role="img"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z"/></marker></defs><g id="viewport"><g id="containers"></g><g id="edges"></g><g id="nodes"></g></g></svg></main>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
  async fullscreen(): Promise<void> {
    this.openEditor();
    await commands.executeCommand('workbench.action.maximizeEditorHideSidebar');
  }
  update(state: GraphState, frames: GraphFrame[]): void { this.state = state; this.frames = frames; this.publish(); }
  private publish(): void {
    if (this.state) for (const webview of this.ready) void webview.postMessage({ type: 'state', state: this.state });
  }
  inspect(action: 'snapshot' | 'benchmark' | 'replay', options?: GraphViewOptions): Promise<any> {
    const target = this.panel?.active ? this.panel.webview : this.view?.webview;
    if (!target) this.show();
    const request = ++this.sequence;
    return new Promise((resolve, reject) => {
      const frames = options?.frames ?? this.frames;
      const limit = action === 'replay' ? Math.max(30000, (replayTimeline(frames).at(-1)?.at ?? 0) / replaySpeed(options?.speed) + 15000) : 30000;
      const timeout = setTimeout(() => { this.replies.delete(request); reject(new Error('Proof Graph webview did not reply')); }, limit);
      this.replies.set(request, value => { clearTimeout(timeout); resolve(value); });
      const message = { type: 'inspect', action, request, options, frames: action === 'replay' ? frames : undefined };
      if (target && this.ready.has(target)) void target.postMessage(message); else this.pending.push(message);
    });
  }
  dispose(): void {
    this.panel?.dispose(); this.ready.clear();
    for (const reply of this.replies.values()) reply({ error: 'Graph closed' }); this.replies.clear();
  }
}
