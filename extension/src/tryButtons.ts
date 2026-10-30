import { Hover, MarkdownString, Position, Range, Uri, window, workspace, WorkspaceEdit } from 'vscode';
import { suggestedProofs, suggestionRange } from './suggestions';
import { encodeSymbols } from './symbols';

// Replace the try0/try/sledgehammer command on `line` with a proof it found.
export async function applySuggestion(uri: string, line: number, character: number, proof: string): Promise<boolean> {
  const document = await workspace.openTextDocument(Uri.parse(uri));
  const range = suggestionRange(document.getText().split(/\r?\n/), line, character, proof);
  if (!range) {
    void window.showInformationMessage('There is no try0, try or sledgehammer command on this line to replace.');
    return false;
  }
  const edit = new WorkspaceEdit();
  edit.replace(document.uri, new Range(...range.start, ...range.end), encodeSymbols(proof));
  return workspace.applyEdit(edit);
}

// Add "Apply" links to the server's hover over a command that found proofs.
export function withSuggestionLinks(hover: Hover | null | undefined, uri: string, position: Position): Hover | null | undefined {
  if (!hover) return hover;
  const proofs = suggestedProofs(hover.contents.map(content => typeof content === 'string' ? content : content.value)).slice(0, 5);
  if (!proofs.length) return hover;
  const link = (proof: string) => `[Apply \`${proof}\`](command:isabelleRevamp.applySuggestion?${
    encodeURIComponent(JSON.stringify([uri, position.line, position.character, proof]))})`;
  const links = new MarkdownString(proofs.map(link).join(' · '));
  links.isTrusted = { enabledCommands: ['isabelleRevamp.applySuggestion'] };
  return new Hover([links, ...hover.contents], hover.range);
}
