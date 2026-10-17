import { escapeText } from './outputText';

export const viewTheme = `body {
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
/* Isabelle etc/isabelle.css uses .source for mathematical output. Keep the
   host's font and colours instead of its fixed light-page background. */
.source { direction: ltr; unicode-bidi: isolate; font-family: var(--vscode-editor-font-family), monospace; }
body.vscode-high-contrast header, body.vscode-high-contrast-light header {
  border-color: var(--vscode-contrastBorder);
}`;

export function viewHeader(theory: string, status: string): string {
  return `<header><h1>${escapeText(theory)}</h1>
<p class="status" role="status" aria-live="polite">${escapeText(status)}</p></header>`;
}
