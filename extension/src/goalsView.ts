import { randomBytes } from 'node:crypto';
import { WebviewView, WebviewViewProvider } from 'vscode';
import { escapeText } from './outputText';
import { GoalLink, goalMarkup } from './goalHtml';
import { viewHeader, viewTheme } from './viewTheme';

export interface GoalState {
  phase: 'idle' | 'checking' | 'ready' | 'unfinished' | 'error' | 'unavailable';
  text: string;
  html?: string;
  errors: string[];
  theory?: string;
  checkStatus?: 'checking' | 'fully_checked' | 'unfinished' | 'error';
}

function presentation(state: GoalState) {
  const checking = state.phase === 'checking' || state.phase === 'ready' && state.checkStatus === 'checking';
  const status = checking ? 'checking…' : {
    idle: 'Open a theory and place the cursor in a proof.',
    checking: 'checking…',
    ready: state.checkStatus === 'fully_checked' ? 'fully checked'
      : state.checkStatus === 'unfinished' ? 'unfinished' : 'Goal at cursor',
    unfinished: 'unfinished (sorry)',
    error: 'Proof error — see editor diagnostics.',
    unavailable: 'Goal state unavailable. Move the cursor to retry.',
  }[state.phase];
  const markup = checking || state.html === undefined ? undefined : goalMarkup(state.html);
  return { theory: state.theory ?? 'Isabelle Goals', status, phase: state.phase,
    html: markup?.html, links: markup?.links ?? [],
    text: checking ? '' : state.text, errors: checking ? '' : state.errors.join('\n\n') };
}

export function goalsHtml(state: GoalState, nonce = randomBytes(16).toString('hex')): string {
  const goal = presentation(state);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${viewTheme}
</style></head><body class="${goal.phase}">
${viewHeader(goal.theory, goal.status)}
<div id="goal" class="source" aria-label="Goal at cursor">${goal.html ?? escapeText(goal.text)}</div>
<pre id="errors" class="errors" aria-label="Diagnostics">${escapeText(goal.errors)}</pre>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let revision = 0;
const goalNode = document.getElementById('goal');
function entity(event) {
  const node = event.target.closest?.('a.isabelle-entity');
  if (!node || !goalNode.contains(node)) return;
  const token = [...node.classList].find(name => name.startsWith('isabelle-link-'));
  const index = Number(token?.slice('isabelle-link-'.length));
  return Number.isInteger(index) ? { node, index } : undefined;
}
goalNode.addEventListener('click', event => {
  const link = entity(event); if (!link) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) vscode.postMessage({ type:'goalLink', action:'open', index:link.index, revision });
});
goalNode.addEventListener('mouseover', event => {
  const link = entity(event); if (!link || link.node.title) return;
  link.node.title = 'Loading definition…';
  vscode.postMessage({ type:'goalLink', action:'hover', index:link.index, revision });
});
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'goalHover' && message.revision === revision) {
    const node = goalNode.querySelector('.isabelle-link-' + message.index);
    if (node) node.title = message.text || 'Ctrl/Cmd-click to open definition.';
    return;
  }
  if (message.type === 'goal') {
    revision = message.revision;
    const goal = message.goal;
    document.querySelector('h1').textContent = goal.theory;
    document.querySelector('.status').textContent = goal.status;
    document.body.classList.toggle('error', goal.phase === 'error');
    if (goal.html === undefined) document.getElementById('goal').textContent = goal.text;
    else document.getElementById('goal').innerHTML = goal.html;
    document.getElementById('errors').textContent = goal.errors;
  }
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}

export class GoalsView implements WebviewViewProvider {
  private view?: WebviewView;
  private state: GoalState = { phase: 'idle', text: '', errors: [] };
  private revision = 0;
  private links: GoalLink[] = [];
  onNavigate?: (link: GoalLink) => Promise<void>;
  onHover?: (link: GoalLink) => Promise<string>;

  resolveWebviewView(view: WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const messages = view.webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') {
        this.update(this.state);
      } else if (message?.type === 'goalLink') {
        if (message.action === 'open') void this.followLink(message.index,message.revision).catch(() => {});
        else if (message.action === 'hover') void this.hoverLink(message.index,message.revision).then(text =>
          view.webview.postMessage({type:'goalHover',index:message.index,revision:message.revision,text})).catch(() => {});
      }
    });
    view.onDidDispose(() => { messages.dispose(); this.view = undefined; });
    view.webview.html = goalsHtml(this.state);
  }

  update(state: GoalState): void {
    this.state = state;
    const { links, ...goal } = presentation(state);
    this.links = links;
    void this.view?.webview.postMessage({ type: 'goal', goal, revision: ++this.revision });
  }
  linkSnapshot() { return { revision:this.revision, links:this.links.map(link=>({...link})) }; }
  private link(index: number, revision: number): GoalLink | undefined {
    return revision===this.revision && Number.isInteger(index) && index>=0 ? this.links[index] : undefined;
  }
  async followLink(index: number, revision: number): Promise<void> {
    const link=this.link(index,revision);if(link) await this.onNavigate?.(link);
  }
  async hoverLink(index: number, revision: number): Promise<string> {
    const link=this.link(index,revision);if(!link) return '';
    const text=await this.onHover?.(link);
    return revision===this.revision ? text ?? '' : '';
  }
  snapshot(): GoalState { return { ...this.state, errors: [...this.state.errors] }; }
}
