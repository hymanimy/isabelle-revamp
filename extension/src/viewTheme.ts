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
pre, #goal {
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
/* Names follow Isabelle etc/isabelle.css; colours adapt to VS Code themes. */
.source { --isa-free: #82aaff; --isa-bound: #9ccc65; --isa-skolem: #ffb454; --isa-type: #c792ea; }
.vscode-light .source, .vscode-high-contrast-light .source {
  --isa-free: #0000cc; --isa-bound: #087a28; --isa-skolem: #a65300; --isa-type: #8030a0;
}
.source .free, .source .var { color: var(--isa-free); }
.source .bound { color: var(--isa-bound); }
.source .skolem { color: var(--isa-skolem); }
.source .tfree, .source .tvar { color: var(--isa-type); }
.source .keyword, .source .keyword1, .source .keyword2, .source .keyword3, .source .quasi_keyword { color: var(--isa-free); font-weight: bold; }
.source .main, .source .inner_quoted, .source .inner_cartouche, .source .const { color: inherit; }
.source .state_message { white-space: pre-wrap; }
.source .error, .source .error_message { color: var(--vscode-errorForeground); }
.source .warning, .source .warning_message { color: var(--vscode-editorWarning-foreground); }
.source .isabelle-script-sup { vertical-align: super; font-size: 80%; }
.source .isabelle-script-sub { vertical-align: sub; font-size: 80%; }
.source .isabelle-script-bold { font-weight: bold; }
body.vscode-high-contrast header, body.vscode-high-contrast-light header {
  border-color: var(--vscode-contrastBorder);
}`;

export function viewHeader(theory: string, status: string): string {
  return `<header><h1>${escapeText(theory)}</h1>
<p class="status" role="status" aria-live="polite">${escapeText(status)}</p></header>`;
}
