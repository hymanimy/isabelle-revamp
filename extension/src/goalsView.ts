import { randomBytes } from 'node:crypto';
import { WebviewView, WebviewViewProvider } from 'vscode';
import { AskState } from './ask';
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
#ask { margin-bottom: 16px; }
label { display: block; font-weight: 600; margin-bottom: 6px; }
textarea { box-sizing: border-box; width: 100%; min-height: 65px; resize: vertical; font: inherit;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 8px; }
textarea:focus, button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
button { font: inherit; cursor: pointer; padding: 4px 10px; margin-top: 6px;
  color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; }
button:disabled { opacity: .5; cursor: default; }
#ask-status, .tool { color: var(--vscode-descriptionForeground); }
#transcript { max-height: 40vh; overflow-y: auto; }
#transcript p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0; }
#transcript .user { font-weight: 600; }
#transcript .tool { font-family: var(--vscode-editor-font-family), monospace; font-size: .9em; }
#transcript .notice { color: var(--vscode-editorWarning-foreground); }
</style></head><body class="${goal.phase}">
<section id="ask" aria-label="Ask Isabelle">
<label for="prompt">Ask Isabelle</label>
<textarea id="prompt" placeholder="prove this" aria-describedby="ask-status"></textarea>
<button id="send">Send</button> <button id="stop" disabled>Stop</button>
<p id="ask-status" role="status">Enter sends · Shift+Enter adds a line</p>
<div id="transcript" role="log" aria-label="Ask transcript"></div>
</section>
${viewHeader(goal.theory, goal.status)}
<div id="goal" class="source" aria-label="Goal at cursor">${goal.html ?? escapeText(goal.text)}</div>
<pre id="errors" class="errors" aria-label="Diagnostics">${escapeText(goal.errors)}</pre>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const prompt = document.getElementById('prompt');
const send = document.getElementById('send'), stop = document.getElementById('stop');
const transcript = document.getElementById('transcript');
let active = false, revision = 0;
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
prompt.value = vscode.getState()?.draft || '';
prompt.addEventListener('input', () => vscode.setState({ draft: prompt.value }));
function submit() {
  if (active || !prompt.value.trim()) return;
  active = true; prompt.disabled = true; send.disabled = true; stop.disabled = false;
  vscode.postMessage({ type: 'ask', text: prompt.value });
  prompt.value = ''; vscode.setState({ draft: '' });
}
send.addEventListener('click', submit);
stop.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); }
});
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'goalHover' && message.revision === revision) {
    const node = goalNode.querySelector('.isabelle-link-' + message.index);
    if (node) node.title = message.text || 'Ctrl/Cmd-click to open definition.';
    return;
  }
  if (message.type === 'focus') { prompt.focus(); return; }
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
  if (message.type === 'askState') {
    const wasActive = active;
    active = message.state.active;
    prompt.disabled = active; send.disabled = active; stop.disabled = !active;
    document.getElementById('ask-status').textContent = active ? 'Claude is working…' : 'Enter sends · Shift+Enter adds a line';
    const follow = transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 40;
    for (const entry of message.state.entries) {
      let node = [...transcript.children].find(child => child.dataset.id === String(entry.id));
      if (!node) { node = document.createElement('p'); node.dataset.id = String(entry.id); transcript.append(node); }
      node.className = entry.kind;
      node.textContent = entry.kind === 'user' ? 'You: ' + entry.text : entry.text;
    }
    if (follow) transcript.scrollTop = transcript.scrollHeight;
    if (wasActive && !active) prompt.focus();
  }
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}

export class GoalsView implements WebviewViewProvider {
  private view?: WebviewView;
  private focusPending = false;
  private state: GoalState = { phase: 'idle', text: '', errors: [] };
  private askState: AskState = { active: false, entries: [] };
  private revision = 0;
  private links: GoalLink[] = [];
  onNavigate?: (link: GoalLink) => Promise<void>;
  onHover?: (link: GoalLink) => Promise<string>;
  onAsk?: (text: string) => void;
  onStop?: () => void;

  resolveWebviewView(view: WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const messages = view.webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') {
        this.update(this.state); this.updateAsk(this.askState);
        if (this.focusPending) this.focusAsk();
      } else if (message?.type === 'ask' && typeof message.text === 'string') this.onAsk?.(message.text);
      else if (message?.type === 'stop') this.onStop?.();
      else if (message?.type === 'goalLink') {
        if (message.action === 'open') void this.followLink(message.index,message.revision).catch(() => {});
        else if (message.action === 'hover') void this.hoverLink(message.index,message.revision).then(text =>
          view.webview.postMessage({type:'goalHover',index:message.index,revision:message.revision,text})).catch(() => {});
      }
    });
    view.onDidDispose(() => { messages.dispose(); this.view = undefined; });
    view.webview.html = goalsHtml(this.state);
  }

  focusAsk(): void {
    this.focusPending = true;
    void this.view?.webview.postMessage({ type: 'focus' }).then(delivered => {
      if (delivered) this.focusPending = false;
    });
  }
  update(state: GoalState): void {
    this.state = state;
    const { links, ...goal } = presentation(state);
    this.links = links;
    void this.view?.webview.postMessage({ type: 'goal', goal, revision: ++this.revision });
  }
  updateAsk(state: AskState): void {
    this.askState = state;
    void this.view?.webview.postMessage({ type: 'askState', state });
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
