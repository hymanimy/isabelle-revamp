import { window } from 'vscode';
import { encodeSymbols } from './symbols';

export function quotesToCartouche(source: string): string {
  if (!source.startsWith('"') || !source.endsWith('"') || source.length < 2) {
    throw new Error('Select one complete quoted string, including its quotes.');
  }
  let content='';
  for(let i=1;i<source.length-1;i++) {
    const char=source[i];
    if (char==='\\' && i===source.length-2) throw new Error('The closing quote is escaped; select a complete literal.');
    if(char==='"') throw new Error('Select one quoted string at a time.');
    if(char==='\\' && /["\\]/.test(source[i+1] ?? '')) content+=source[++i];
    else if(char==='\\' && /^\d{3}/.test(source.slice(i+1))) {
      const code=Number(source.slice(i+1,i+4));
      if(code>127) throw new Error('Convert non-ASCII numeric string escapes explicitly before making a cartouche.');
      content+=String.fromCharCode(code);i+=3;
    } else content+=char;
  }
  content=encodeSymbols(content);
  let depth=0;
  for(const token of content.matchAll(/\\<(open|close)>/g)) {
    depth+=token[1]==='open'?1:-1;
    if(depth<0) throw new Error('The selection contains an unmatched closing cartouche.');
  }
  if(depth) throw new Error('The selection contains an unmatched opening cartouche.');
  return '\\<open>'+content+'\\<close>';
}
export async function convertQuotes(): Promise<boolean> {
  const editor=window.activeTextEditor;
  if(!editor || editor.document.languageId!=='isabelle') return false;
  try {
    if(editor.selections.length!==1) throw new Error('Select one quoted string at a time.');
    const text=quotesToCartouche(editor.document.getText(editor.selection));
    return editor.edit(edit=>edit.replace(editor.selection,text));
  } catch(error) { void window.showInformationMessage(error instanceof Error ? error.message : String(error));return false; }
}
