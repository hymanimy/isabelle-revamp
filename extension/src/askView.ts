import { randomBytes } from 'node:crypto';
import { WebviewView, WebviewViewProvider } from 'vscode';
import { AskState } from './ask';
import { viewTheme } from './viewTheme';

export function askHtml(nonce = randomBytes(16).toString('hex')): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${viewTheme}
body { height: 100vh; margin: 0; padding: 8px 14px; box-sizing: border-box; display: flex; flex-direction: column; }
#input { display: flex; align-items: start; gap: 8px; }
#input textarea { flex: 1; }
label { display: block; font-weight: 600; margin-bottom: 6px; }
textarea { box-sizing: border-box; width: 100%; height: 32px; min-height: 32px; resize: vertical; font: inherit;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 5px 8px; }
textarea:focus, button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
button { font: inherit; cursor: pointer; padding: 4px 10px; margin-top: 0;
  color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; }
button:disabled { opacity: .5; cursor: default; }
#ask-status, .tool { color: var(--vscode-descriptionForeground); }
#transcript { flex: 1; min-height: 0; overflow-y: auto; }
#ask-status { margin: 4px 0; font-size: .9em; }
#transcript p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0; }
#transcript .user { font-weight: 600; }
#transcript .tool { font-family: var(--vscode-editor-font-family), monospace; font-size: .9em; }
#transcript .notice { color: var(--vscode-editorWarning-foreground); }
</style></head><body>
<div id="input"><textarea id="prompt" rows="1" aria-label="Ask Isabelle" placeholder="Ask Isabelle — prove this" aria-describedby="ask-status"></textarea>
<button id="send">Send</button><button id="stop" disabled>Stop</button></div>
<p id="ask-status" role="status">Enter sends · Shift+Enter adds a line</p>
<div id="transcript" role="log" aria-label="Ask transcript"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const prompt = document.getElementById('prompt');
const send = document.getElementById('send'), stop = document.getElementById('stop');
const transcript = document.getElementById('transcript');
let active = false;
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
  if (message.type === 'focus') { prompt.focus(); return; }
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

export class AskView implements WebviewViewProvider {
  private view?: WebviewView;
  private focusPending = false;
  private state: AskState = { active: false, entries: [] };
  onAsk?: (text: string) => void;
  onStop?: () => void;
  resolveWebviewView(view: WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const messages = view.webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') {
        this.update(this.state);
        if (this.focusPending) this.focus();
      } else if (message?.type === 'ask' && typeof message.text === 'string') this.onAsk?.(message.text);
      else if (message?.type === 'stop') this.onStop?.();
    });
    view.onDidDispose(() => { messages.dispose(); this.view = undefined; });
    view.webview.html = askHtml();
  }
  focus(): void {
    this.focusPending = true;
    void this.view?.webview.postMessage({ type: 'focus' }).then(delivered => {
      if (delivered) this.focusPending = false;
    });
  }
  update(state: AskState): void {
    this.state = state;
    void this.view?.webview.postMessage({ type: 'askState', state });
  }
  snapshot() { return { visible: this.view?.visible === true }; }
}
