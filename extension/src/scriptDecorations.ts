// Adapted from Isabelle src/Tools/VSCode/extension/src/script_decorations.ts
// (Denis Paluca): same hidden controls and relative script/bold CSS. Token
// offsets below additionally handle ASCII symbol spellings and astral glyphs.
import { DecorationRangeBehavior, Disposable, Range, TextEditor, window, workspace } from 'vscode';
import { ScriptGroup, scriptRanges } from './scriptRanges';
export { scriptRanges } from './scriptRanges';
export function visibleScripts(editor: TextEditor): ScriptGroup[] {
  if (editor.document.languageId!=='isabelle' || !workspace.getConfiguration('isabelleRevamp',editor.document.uri).get('prettySymbols',true)) return [];
  return scriptRanges(editor.document.getText()).filter(group=>!editor.selections.some(selection=>{
    const start=editor.document.offsetAt(selection.start),end=editor.document.offsetAt(selection.end);
    return group.controls.some(([a,b])=>selection.isEmpty ? start>=a && start<=b : start<b && end>a);
  }));
}
export class ScriptDecorations implements Disposable {
  private hide=window.createTextEditorDecorationType({textDecoration:'none; font-size: 0.001em',rangeBehavior:DecorationRangeBehavior.ClosedClosed});
  private styles={
    sup:window.createTextEditorDecorationType({textDecoration:'none; position: relative; top: -0.5em; font-size: 80%'}),
    sub:window.createTextEditorDecorationType({textDecoration:'none; position: relative; bottom: -0.5em; font-size: 80%'}),
    bold:window.createTextEditorDecorationType({textDecoration:'none; font-weight: bold'}),
  };
  update(editor: TextEditor, groups: ScriptGroup[]): void {
    const range=([a,b]:[number,number])=>new Range(editor.document.positionAt(a),editor.document.positionAt(b));
    editor.setDecorations(this.hide,groups.flatMap(group=>group.controls.map(range)));
    for(const style of ['sup','sub','bold'] as const) editor.setDecorations(this.styles[style],groups.filter(group=>group.style===style).map(group=>range(group.content)));
  }
  dispose(): void { this.hide.dispose();Object.values(this.styles).forEach(style=>style.dispose()); }
}
