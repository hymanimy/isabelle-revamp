import { WebviewView, WebviewViewProvider } from 'vscode';
import { escapeText } from './outputText';

export interface GoalState {
  phase: 'idle' | 'checking' | 'ready' | 'unfinished' | 'error' | 'unavailable';
  text: string;
  errors: string[];
  theory?: string;
  checkStatus?: 'checking' | 'fully_checked' | 'unfinished' | 'error';
}

export function goalsHtml(state: GoalState): string {
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
  // While checking, old output is hidden rather than presented as current.
  const text = checking ? '' : state.text;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body {
  padding: 12px;
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
h1 { font-size: 1em; margin: 0 0 6px; overflow-wrap: anywhere; }
.status { margin: 0; color: var(--vscode-descriptionForeground); }
.error .status, .errors { color: var(--vscode-errorForeground); }
pre {
  font-family: var(--vscode-editor-font-family), monospace;
  font-size: var(--vscode-editor-font-size);
  font-weight: var(--vscode-editor-font-weight);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
pre:empty { display: none; }
body.vscode-high-contrast header, body.vscode-high-contrast-light header {
  border-color: var(--vscode-contrastBorder);
}
</style>
</head><body class="${state.phase}"><header>
<h1>${escapeText(state.theory ?? 'Isabelle Goals')}</h1>
<p class="status" role="status" aria-live="polite">${escapeText(status)}</p></header>
<pre aria-label="Goal at cursor">${escapeText(text)}</pre>
${!checking && state.errors.length ? `<pre class="errors" aria-label="Proof errors">${escapeText(state.errors.join('\n\n'))}</pre>` : ''}
</body></html>`;
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
