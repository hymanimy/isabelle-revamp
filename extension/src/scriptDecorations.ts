// Adapted from Isabelle src/Tools/VSCode/extension/src/script_decorations.ts
// (Denis Paluca): same hidden controls and relative script/bold CSS. Token
// offsets below additionally handle ASCII symbol spellings and astral glyphs.
import { DecorationRangeBehavior, Disposable, Range, TextEditor, window, workspace } from 'vscode';
import { decodeSymbols } from './symbols';
export interface ScriptGroup { controls: [number,number][]; content: [number,number]; style: 'sup'|'sub'|'bold' }
export function scriptRanges(source: string): ScriptGroup[] {
  const tokens = [...source.matchAll(/\\<[^>\n]+>|[\s\S]/gu)].map(match =>
    ({ start:match.index,end:match.index+match[0].length,text:decodeSymbols(match[0]) }));
  const control = Object.fromEntries(['sub','sup','bold','bsub','esub','bsup','esup']
    .map(name=>[name,decodeSymbols('\\<^'+name+'>')]));
  const groups: ScriptGroup[] = [];
  const stack: { index:number; style:'sup'|'sub'; close:string }[] = [];
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i], next=tokens[i+1];
    const style = token.text===control.sup ? 'sup' : token.text===control.sub ? 'sub' : token.text===control.bold ? 'bold' : undefined;
    if (style && next && !/\s/u.test(next.text) && !Object.values(control).includes(next.text)) {
      groups.push({controls:[[token.start,token.end]],content:[next.start,next.end],style});
    } else if(token.text===control.bsup || token.text===control.bsub) {
      stack.push({index:i,style:token.text===control.bsup?'sup':'sub',close:token.text===control.bsup?control.esup:control.esub});
    } else if(token.text===stack.at(-1)?.close) {
      const open=stack.pop()!;
      if (i>open.index+1) groups.push({controls:[[tokens[open.index].start,tokens[open.index].end],[token.start,token.end]],
        content:[tokens[open.index].end,token.start],style:open.style});
    }
  }
  return groups;
}
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
