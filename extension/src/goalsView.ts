import { WebviewView, WebviewViewProvider } from 'vscode';
import { escapeText } from './outputText';

export interface GoalState {
  phase: 'idle' | 'checking' | 'ready' | 'error' | 'unavailable';
  text: string;
  errors: string[];
}

export function goalsHtml(state: GoalState): string {
  const status = {
    idle: 'Open a theory and place the cursor in a proof.',
    checking: 'checking…',
    ready: 'Goal at cursor',
    error: 'Proof error — see editor diagnostics.',
    unavailable: 'Goal state unavailable. Move the cursor to retry.',
  }[state.phase];
  // While checking, old output is hidden rather than presented as current.
  const text = state.phase === 'checking' ? '' : state.text;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body { padding: 10px; } pre { font-family: monospace; white-space: pre-wrap; overflow-wrap: anywhere; }</style>
</head><body><p role="status">${escapeText(status)}</p>
<pre>${escapeText(text)}</pre><pre>${escapeText(state.errors.join('\n\n'))}</pre></body></html>`;
}

export class GoalsView implements WebviewViewProvider {
  private view?: WebviewView;
  private state: GoalState = { phase: 'idle', text: '', errors: [] };

  resolveWebviewView(view: WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false, localResourceRoots: [] };
    view.onDidDispose(() => { this.view = undefined; });
    this.update(this.state);
  }

  update(state: GoalState): void {
    this.state = state;
    if (this.view) this.view.webview.html = goalsHtml(state);
  }

  snapshot(): GoalState {
    return { ...this.state, errors: [...this.state.errors] };
  }
}
