import { randomBytes } from 'node:crypto';
import { WebviewView, WebviewViewProvider } from 'vscode';
import { viewHeader, viewTheme } from './viewTheme';

export interface SwarmCard {
  id: string; label: string; command: string; range: [number, number, number, number];
  status: 'sorry' | 'checking' | 'proved' | 'error'; agent?: string;
}
export interface SwarmState {
  uri?: string; version?: number; theory?: string; cards: SwarmCard[];
  proved: number; startedAt?: number; fullyChecked: boolean;
}

export function swarmHtml(nonce: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>${viewTheme}
#cards { display: grid; gap: 8px; margin-top: 12px; }
.card {
  --accent: var(--vscode-descriptionForeground);
  display: block; width: 100%; text-align: left; cursor: pointer; padding: 10px;
  font: inherit; color: var(--vscode-foreground);
  border: 1px solid var(--vscode-contrastBorder, var(--accent)); border-left: 4px solid var(--accent);
  background-color: color-mix(in srgb, var(--accent) 12%, var(--vscode-sideBar-background));
  transition: background-color 300ms, border-color 300ms;
}
.card[data-status="checking"] { --accent: var(--vscode-editorWarning-foreground); }
.card[data-status="proved"] { --accent: var(--vscode-testing-iconPassed); }
.card[data-status="error"] { --accent: var(--vscode-errorForeground); }
.card:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
.label { display: block; font-weight: 600; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family), monospace; }
.detail { display: block; margin-top: 5px; font-size: .9em; }
#empty { color: var(--vscode-descriptionForeground); }
</style></head><body>${viewHeader('Isabelle Swarm', 'Open a theory to follow its proof.')}
<div id="cards"></div><p id="empty">No top-level proof steps at this cursor.</p>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const cards = document.getElementById('cards');
let state = { cards: [], proved: 0 };
const labels = { sorry: 'unfinished (sorry)', checking: 'checking…', proved: 'proved', error: 'error' };
function header() {
  document.querySelector('h1').textContent = state.theory || 'Isabelle Swarm';
  const seconds = state.startedAt ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0;
  document.querySelector('.status').textContent = state.proved + '/' + state.cards.length + ' proved · ' + seconds + ' s'
    + (state.fullyChecked ? ' · kernel-checked ✓' : '');
}
window.addEventListener('message', event => {
  if (event.data.type !== 'state') return;
  state = event.data.state;
  const remaining = new Set(state.cards.map(card => card.id));
  for (const child of [...cards.children]) if (!remaining.has(child.dataset.id)) child.remove();
  for (const [index, card] of state.cards.entries()) {
    let button = [...cards.children].find(child => child.dataset.id === card.id);
    if (!button) {
      button = document.createElement('button'); button.className = 'card'; button.dataset.id = card.id;
      for (const name of ['label', 'detail']) { const span = document.createElement('span'); span.className = name; button.append(span); }
      button.addEventListener('click', () => vscode.postMessage({ type: 'select', uri: state.uri, version: state.version, id: button.dataset.id }));
    }
    button.dataset.status = card.status;
    button.querySelector('.label').textContent = card.label;
    button.querySelector('.detail').textContent = labels[card.status] + (card.agent ? ' · ' + card.agent : '');
    if (cards.children[index] !== button) cards.insertBefore(button, cards.children[index] || null);
  }
  document.getElementById('empty').hidden = state.cards.length > 0;
  header();
});
setInterval(header, 1000);
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}

export class SwarmView implements WebviewViewProvider {
  private view?: WebviewView;
  private state: SwarmState = { cards: [], proved: 0, fullyChecked: false };
  constructor(private select: (uri: string, version: number, id: string) => Promise<void>) {}

  resolveWebviewView(view: WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const messages = view.webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') this.update(this.state);
      else if (message?.type === 'select' && typeof message.uri === 'string'
        && Number.isInteger(message.version) && typeof message.id === 'string') {
        void this.select(message.uri, message.version, message.id);
      }
    });
    view.onDidDispose(() => { messages.dispose(); this.view = undefined; });
    view.webview.html = swarmHtml(randomBytes(16).toString('hex'));
  }

  update(state: SwarmState): void {
    this.state = state;
    void this.view?.webview.postMessage({ type: 'state', state });
  }

  snapshot(): SwarmState { return structuredClone(this.state); }
}
