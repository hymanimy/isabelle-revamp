import { randomBytes } from 'node:crypto';
import { Disposable, Webview, WebviewView, WebviewViewProvider } from 'vscode';
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
  // The command at the cursor has no proof state; text holds its messages.
  stateless?: boolean;
  // The command at the cursor is still running; text holds its output so far.
  running?: boolean;
}

function presentation(state: GoalState) {
  const checking = state.phase === 'checking';
  const status = checking ? 'checking…' : state.running && state.phase !== 'error' ? 'running…' : {
    idle: 'Open a theory and place the cursor in a proof.',
    checking: 'checking…',
    ready: state.stateless ? (state.text ? 'No proof state here · messages' : 'No proof state here')
      : state.checkStatus === 'fully_checked' ? 'fully checked'
      : state.checkStatus === 'unfinished' ? 'unfinished' : 'Goal at cursor',
    unfinished: 'unfinished (sorry)',
    error: 'Proof error — see editor diagnostics.',
    unavailable: 'Isabelle is not running.',
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
html, body, .source, .source pre { max-width: 100%; min-width: 0; box-sizing: border-box; }
.source, .source pre, .errors { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
/* Isabelle's sendback markup: proofs found by try0 or sledgehammer. */
.source .sendback { cursor: pointer; color: var(--vscode-textLink-foreground); text-decoration: underline; }
.source .sendback:hover { color: var(--vscode-textLink-activeForeground); }
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
function titleProofs() {
  for (const node of goalNode.querySelectorAll('.sendback')) node.title = 'Click to use this proof in place of the command that found it';
}
titleProofs();
goalNode.addEventListener('click', event => {
  const proof = event.target.closest?.('.sendback');
  if (proof && goalNode.contains(proof)) { vscode.postMessage({ type:'sendback', text:proof.textContent, revision }); return; }
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
    titleProofs();
    document.getElementById('errors').textContent = goal.errors;
  }
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}

export class GoalsView implements WebviewViewProvider, Disposable {
  private view?: WebviewView;
  private state: GoalState = { phase: 'idle', text: '', errors: [] };
  private revision = 0;
  private links: GoalLink[] = [];
  onNavigate?: (link: GoalLink) => Promise<void>;
  onHover?: (link: GoalLink) => Promise<string>;
  onSendback?: (proof: string) => Promise<unknown>;

  resolveWebviewView(view: WebviewView): void {
    this.view = view;
    const messages = this.prepare(view.webview);
    view.onDidDispose(() => { messages.dispose(); this.view = undefined; });
  }

  private prepare(webview: Webview): Disposable {
    webview.options = { enableScripts: true, localResourceRoots: [] };
    const messages = webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') {
        this.update(this.state);
      } else if (message?.type === 'sendback') {
        if (message.revision === this.revision && typeof message.text === 'string') void this.onSendback?.(message.text);
      } else if (message?.type === 'goalLink') {
        if (message.action === 'open') void this.followLink(message.index,message.revision).catch(() => {});
        else if (message.action === 'hover') void this.hoverLink(message.index,message.revision).then(text =>
          webview.postMessage({type:'goalHover',index:message.index,revision:message.revision,text})).catch(() => {});
      }
    });
    webview.html = goalsHtml(this.state);
    return messages;
  }

  update(state: GoalState): void {
    this.state = state;
    const { links, ...goal } = presentation(state);
    this.links = links;
    const message = { type: 'goal', goal, revision: ++this.revision };
    void this.view?.webview.postMessage(message);
  }
  dispose(): void {}
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
